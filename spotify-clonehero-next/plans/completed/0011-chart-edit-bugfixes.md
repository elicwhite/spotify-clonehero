# 0011 — chart-edit Bug Fixes & Test Gaps

## Context

Code review of `lib/chart-edit/` found 8 bugs, 5 functionality gaps, and 8 missing test categories. All 134 existing tests pass, but the test fixtures are narrow (single difficulty, no lyrics, no cross-format) so these issues are untested. This plan covers every fix needed to bring the library in line with `lib/chart-edit/SPEC.md`.

## Depends On

All completed plans (0001–0010). This is a bugfix pass on the existing implementation.

---

## A. Bug Fixes

### A1. Shared forceFlam corruption in `removeDrumNote`

**File:** `lib/chart-edit/helpers/drum-notes.ts:130-143`

**Problem:** `removeDrumNote` removes ALL `forceFlam` events at a tick when deleting one note. If tick 0 has kick + redDrum both with flam, removing kick strips flam from redDrum too.

**Root cause:** `getModifierTypesForNote` (line 36-60) unconditionally includes `eventTypes.forceFlam` for every note type. The filter at line 138-142 removes all events matching modifier types at the tick.

**Fix:** After filtering out the target note and its per-note modifiers (cymbal, accent, ghost, kick2x), only remove `forceFlam` if no other base drum note remains at the tick:

```typescript
// In removeDrumNote, after the main filter:
const remainingBasesAtTick = track.trackEvents.some(
  (e) => e.tick === tick && baseDrumEventTypes.has(e.type),
);
if (!remainingBasesAtTick) {
  track.trackEvents = track.trackEvents.filter(
    (e) => e.tick !== tick || e.type !== eventTypes.forceFlam,
  );
}
```

Split `getModifierTypesForNote` into per-note modifiers (cymbal, accent, ghost, kick2x) and shared modifiers (flam). The main filter uses per-note modifiers only. Flam is handled separately with the remaining-notes check.

**Test:** Add to `drum-helpers.test.ts`:
- Add kick + redDrum at tick 0, both with `flam: true`
- Remove kick
- Verify `getDrumNotes` returns redDrum with `flam: true`

---

### A2. Shared forceFlam corruption in `setDrumNoteFlags`

**File:** `lib/chart-edit/helpers/drum-notes.ts:234-287`

**Problem:** Same as A1. `setDrumNoteFlags` removes all modifiers for the note type at the tick (line 253-256), which includes forceFlam, affecting other notes.

**Fix:** Same approach as A1 — handle forceFlam separately from per-note modifiers:

1. Remove only per-note modifiers (cymbal, accent, ghost, kick2x) in the filter
2. For flam: if `flags.flam` is true, ensure exactly one forceFlam exists at the tick (add if missing). If `flags.flam` is false/undefined, only remove forceFlam if no other note at the tick has flam (check all other base notes' modifier events)

Alternatively, since flam applies to the entire chord: when setting flam=false on one note, keep the forceFlam if any other base note at the tick previously had flam. The simplest correct behavior: only remove forceFlam when setting flags on the LAST note that could want it. Since flam is chord-wide, the safest approach is:
- When `flags.flam` is explicitly `false`: remove forceFlam only if no other base drum note at the tick exists
- When `flags.flam` is `true`: ensure exactly one forceFlam exists (no duplicates)
- When `flags.flam` is `undefined`: leave existing forceFlam untouched

**Test:** Add to `drum-helpers.test.ts`:
- Add kick + redDrum at tick 0, both with `flam: true`
- `setDrumNoteFlags(track, 0, 'kick', { flam: false })`
- Verify redDrum still has `flam: true`

---

### A3. Duplicate forceFlam events from `addDrumNote`

**File:** `lib/chart-edit/helpers/drum-notes.ts:122-124`

**Problem:** Each `addDrumNote` call with `flam: true` pushes a new `forceFlam` event. Two flammed notes at same tick produce two `forceFlam` events. Violates the spec's "No exact duplicate events" requirement.

**Fix:** Before pushing forceFlam, check if one already exists at the tick:

```typescript
if (flags.flam) {
  const flamExists = track.trackEvents.some(
    (e) => e.tick === tick && e.type === eventTypes.forceFlam,
  );
  if (!flamExists) {
    pushEvent(track, tick, 0, eventTypes.forceFlam);
  }
}
```

**Test:** Add to `drum-helpers.test.ts`:
- Add kick with `flam: true` at tick 0
- Add redDrum with `flam: true` at tick 0
- Verify only ONE forceFlam event exists in `trackEvents`
- Verify both notes report `flam: true` from `getDrumNotes`

---

### A4. Tom/flam/kick2x not deduplicated across difficulties in MIDI writer

**File:** `lib/chart-edit/writer-mid.ts:366-392`

**Problem:** Tom markers (lines 373-379), flam (lines 382-386), and kick2x (lines 388-392) are emitted inside the per-difficulty `for (const td of trackDataEntries)` loop without deduplication. If Expert and Hard both have the same tom marker at tick 480, it's emitted twice. Star power, solo, activation, and flex lanes ARE deduplicated (lines 327-330 define `emitted*` sets).

**Fix:** Add dedup sets for these three event categories, matching the pattern used for star power etc.:

```typescript
const emittedTomMarker = new Set<string>();
const emittedFlam = new Set<string>();
const emittedKick2x = new Set<string>();
```

Then wrap each emission:

```typescript
// Tom markers
if (tomMarkerEventTypes.has(ev.type)) {
  const midiNote = tomMarkerNotes[ev.type];
  if (midiNote !== undefined) {
    const key = `${ev.tick}:${ev.length}:${midiNote}`;
    if (!emittedTomMarker.has(key)) {
      emittedTomMarker.add(key);
      addNoteOnOff(events, ev.tick, ev.length, midiNote, 100);
    }
  }
  continue;
}
// Same pattern for flam and kick2x
```

**Test:** Add to `mid-writer.test.ts`:
- Create a doc with Expert + Hard drum tracks, both containing the same `yellowTomMarker` at tick 0
- Write to MIDI → verify only ONE noteOn at MIDI note 110, not two

---

### A5. Coda freestyle sections emitted as MIDI note 120

**File:** `lib/chart-edit/writer-mid.ts:467-474`

**Problem:** The drum freestyle loop emits ALL sections (including `isCoda: true`) as MIDI note 120. The .chart writer correctly filters at `writer-chart.ts:299` with `if (!fs.isCoda)`. Coda sections should be `[coda]` text events on the EVENTS track, not note 120 on the instrument track.

**Fix:** Two changes:

1. In `buildInstrumentTrack` (writer-mid.ts), filter drum freestyle sections:
```typescript
for (const fs of td.drumFreestyleSections) {
  if (fs.isCoda) continue;  // ← add this line
  const key = `${fs.tick}:${fs.length}`;
  // ...
}
```

2. In `buildEventsTrack` (writer-mid.ts), emit coda events. Collect coda sections from all trackData:
```typescript
// Coda events
const codaSections = doc.trackData.flatMap(td =>
  td.drumFreestyleSections.filter(fs => fs.isCoda)
);
const emittedCoda = new Set<string>();
for (const cs of codaSections) {
  const key = `${cs.tick}`;
  if (!emittedCoda.has(key)) {
    emittedCoda.add(key);
    events.push({
      tick: cs.tick,
      event: { deltaTime: 0, meta: true, type: 'text', text: '[coda]' } as MidiEvent,
    });
  }
}
```

**Test:** Add to `mid-writer.test.ts`:
- Create a doc with one `drumFreestyleSections` entry where `isCoda: true`
- Write to MIDI → verify no note 120, and EVENTS track has `[coda]` text event

---

### A6. Lyrics not written in .chart format

**File:** `lib/chart-edit/writer-chart.ts:250-266`

**Problem:** `serializeEventsSection` builds events from `doc.sections` and `doc.endEvents` only. `doc.lyrics` entries are silently dropped.

**Fix:** Add lyrics to the events array:

```typescript
const events: { tick: number; text: string }[] = [
  ...doc.sections.map((s) => ({ tick: s.tick, text: `section ${s.name}` })),
  ...doc.endEvents.map((e) => ({ tick: e.tick, text: 'end' })),
  ...doc.lyrics.map((l) => ({ tick: l.tick, text: `lyric ${l.text}` })),
];
```

**Test:** Add to `chart-writer.test.ts`:
- Create a doc with lyrics entries
- Serialize → verify output contains `E "lyric Hello"` lines at correct ticks

---

### A7. Reader fails on `[Song]` (uppercase) in song.ini

**File:** `lib/chart-edit/reader.ts:91`

**Problem:** `parseMetadataFromIni` looks up `iniObject['song']` but `lib/ini-parser.ts:31` preserves the case of section names. Many real-world song.ini files use `[Song]` (uppercase S). The reader silently returns empty metadata for these files.

**Fix:** Case-insensitive section lookup:

```typescript
function parseMetadataFromIni(iniText: string): ChartMetadata {
  const { iniObject } = parseIni(iniText);
  // Case-insensitive section lookup — real charts use [song], [Song], or [SONG]
  const sectionKey = Object.keys(iniObject).find(
    (k) => typeof k === 'string' && k.toLowerCase() === 'song',
  );
  const section = sectionKey ? iniObject[sectionKey] : {};
  // ...
}
```

**Test:** Add to `read-write.test.ts`:
- Create an INI string with `[Song]` (uppercase) containing `name = Test`
- Encode as FileEntry, pass to readChart with a chart file
- Verify `metadata.name === 'Test'`

---

### A8. `ENABLE_CHART_DYNAMICS` / `ENHANCED_OPENS` missing brackets

**File:** `lib/chart-edit/writer-mid.ts:495,511`

**Problem:** Code emits `'ENABLE_CHART_DYNAMICS'` and `'ENHANCED_OPENS'` without brackets. The spec says `[ENABLE_CHART_DYNAMICS]`. Standard Clone Hero MIDI files use the bracketed form. scan-chart accepts both, but other tools may not.

**Fix:** Add brackets:

```typescript
// Line 495
text: '[ENABLE_CHART_DYNAMICS]',

// Line 511
text: '[ENHANCED_OPENS]',
```

**Test:** Update existing test in `mid-writer.test.ts` (`'emits ENABLE_CHART_DYNAMICS text event when accents present'`) to check for bracketed form:
```typescript
const dynamicsEvent = textEvents.find(
  (e) => (e as any).text === '[ENABLE_CHART_DYNAMICS]',
);
```

---

## B. Functionality Gaps

### B1. `midi-file` not declared in package.json

**File:** `package.json`

**Problem:** `writer-mid.ts:17` imports `midi-file` directly, but it's not in `dependencies` or `devDependencies`. It only resolves because it's a transitive dependency. A future `yarn install` in a clean environment or a dep update could break this.

**Fix:**
```bash
yarn add midi-file
```

**Verification:** `grep midi-file package.json` shows it in dependencies.

---

### B2. No event deduplication in writers

**Files:** `lib/chart-edit/writer-chart.ts:326-335`, `lib/chart-edit/writer-mid.ts`

**Problem:** SPEC.md line 189 requires "No exact duplicate events (same tick + same type)." Neither writer deduplicates. Normally benign, but bug A3 (duplicate forceFlam) actively creates duplicates that reach the writer.

**Fix:** Deduplicate in the .chart writer after sorting, before emitting lines. Two events are duplicates if they have the same tick, kind, and value (for N/S events) or same tick and text (for E events):

```typescript
// In serializeTrackSection, after events.sort(...):
const deduped: TrackLineEvent[] = [];
for (const event of events) {
  const prev = deduped[deduped.length - 1];
  if (prev && prev.tick === event.tick && prev.kind === event.kind) {
    if (event.kind === 'E' && prev.kind === 'E' && prev.text === event.text) continue;
    if (event.kind !== 'E' && prev.kind !== 'E' && prev.value === event.value) continue;
  }
  deduped.push(event);
}
```

For the MIDI writer, dedup is already handled per-category (A4 covers the remaining cases). The defensive dedup in the .chart writer is a safety net.

Also deduplicate the [Events] section (sections + end events + lyrics) and [SyncTrack] in the .chart writer using the same pattern.

---

### B3. `drumAccentEventType` / `drumGhostEventType` missing `fiveGreenDrum`

**File:** `lib/chart-edit/types.ts:173-186`

**Problem:** The accent and ghost mapping tables don't include `fiveGreenDrum`. Calling `addDrumNote(track, { type: 'fiveGreenDrum', flags: { accent: true } })` silently ignores the accent flag. The .chart writer has mappings for `fiveGreenAccent` (note 38) and `fiveGreenGhost` (note 44), but the helper can't create these events.

**Fix:** Add entries:

```typescript
export const drumAccentEventType: Partial<Record<DrumNoteType, EventType>> = {
  redDrum: eventTypes.redAccent,
  yellowDrum: eventTypes.yellowAccent,
  blueDrum: eventTypes.blueAccent,
  greenDrum: eventTypes.fiveOrangeFourGreenAccent,
  fiveGreenDrum: eventTypes.fiveGreenAccent,       // ← add
};

export const drumGhostEventType: Partial<Record<DrumNoteType, EventType>> = {
  redDrum: eventTypes.redGhost,
  yellowDrum: eventTypes.yellowGhost,
  blueDrum: eventTypes.blueGhost,
  greenDrum: eventTypes.fiveOrangeFourGreenGhost,
  fiveGreenDrum: eventTypes.fiveGreenGhost,         // ← add
};
```

Also add to `drumModifierEventTypes` set if `fiveGreenAccent` / `fiveGreenGhost` aren't already there:

```typescript
export const drumModifierEventTypes = new Set<EventType>([
  // ... existing entries ...
  eventTypes.fiveGreenAccent,   // ← add
  eventTypes.fiveGreenGhost,    // ← add
]);
```

**Test:** Add to `drum-helpers.test.ts`:
- `addDrumNote(track, { tick: 0, type: 'fiveGreenDrum', flags: { accent: true } })`
- Verify `trackEvents` contains `fiveGreenAccent` event
- Verify `getDrumNotes` returns note with `accent: true`
- Same for ghost

---

### B4. Cross-format cymbal/tom marker conversion

**Files:** `lib/chart-edit/writer-mid.ts`, `lib/chart-edit/writer-chart.ts`

**Problem:** .chart format uses cymbal markers (presence = cymbal, absence = tom). MIDI format uses tom markers (presence = tom, absence = cymbal). scan-chart's raw parsers store whichever marker the source format uses. When writing to the other format, the conversion is missing:

- .chart → MIDI: No tom markers emitted. All notes default to cymbal.
- MIDI → .chart: No cymbal markers emitted. All notes default to tom.

Same-format round-trips work because the marker type matches. Cross-format breaks.

**Fix — MIDI writer (`writer-mid.ts`):**

When the instrument is drums, after processing all track events for a difficulty, generate tom markers for notes that do NOT have cymbal markers. This requires:

1. Collect all yellow/blue/green drum note ticks that have cymbal markers in the trackEvents
2. For each yellow/blue/green drum note tick that does NOT have a cymbal marker, emit the corresponding tom marker note (110/111/112)
3. Skip this logic if the data already has tom markers (i.e., came from a MIDI source)

Detection: check if ANY tom marker events exist in trackEvents. If yes, the data is MIDI-sourced and tom markers are already present. If no, the data is .chart-sourced and needs conversion.

```typescript
// After processing all trackEvents for this difficulty:
const hasTomMarkers = td.trackEvents.some(e => tomMarkerEventTypes.has(e.type));
if (!hasTomMarkers) {
  // Data is .chart-sourced. Generate tom markers for non-cymbal notes.
  const cymbalTicks = { yellow: new Set<number>(), blue: new Set<number>(), green: new Set<number>() };
  for (const ev of td.trackEvents) {
    if (ev.type === eventTypes.yellowCymbalMarker) cymbalTicks.yellow.add(ev.tick);
    if (ev.type === eventTypes.blueCymbalMarker) cymbalTicks.blue.add(ev.tick);
    if (ev.type === eventTypes.greenCymbalMarker) cymbalTicks.green.add(ev.tick);
  }
  // For each drum note at each tick, if no cymbal marker → emit tom marker
  for (const ev of td.trackEvents) {
    if (ev.type === eventTypes.yellowDrum && !cymbalTicks.yellow.has(ev.tick)) {
      addNoteOnOff(events, ev.tick, 0, 110, 100); // yellowTomMarker
    }
    // ... same for blue (111) and green (112)
  }
}
```

Note: tom markers in MIDI are typically range notes that span the notes they modify. For simplicity, emit per-note (length 0) tom markers since scan-chart handles both.

**Fix — .chart writer (`writer-chart.ts`):**

Analogous: if data has tom markers but no cymbal markers (MIDI-sourced), generate cymbal markers for yellow/blue/green notes that do NOT have tom markers.

```typescript
// In serializeTrackSection, when instrument is drums:
const hasCymbalMarkers = track.trackEvents.some(e =>
  e.type === eventTypes.yellowCymbalMarker ||
  e.type === eventTypes.blueCymbalMarker ||
  e.type === eventTypes.greenCymbalMarker
);
if (!hasCymbalMarkers) {
  // Data is MIDI-sourced. Generate cymbal markers for non-tom notes.
  const tomTicks = { yellow: new Set<number>(), blue: new Set<number>(), green: new Set<number>() };
  for (const ev of track.trackEvents) {
    if (ev.type === eventTypes.yellowTomMarker) tomTicks.yellow.add(ev.tick);
    if (ev.type === eventTypes.blueTomMarker) tomTicks.blue.add(ev.tick);
    if (ev.type === eventTypes.greenTomMarker) tomTicks.green.add(ev.tick);
  }
  for (const ev of track.trackEvents) {
    if (ev.type === eventTypes.yellowDrum && !tomTicks.yellow.has(ev.tick)) {
      events.push({ tick: ev.tick, sortKey: 1, kind: 'N', value: 66, length: 0 }); // cymbal marker
    }
    // ... same for blue (67) and green (68)
  }
}
```

**Test:** See C1 (cross-format tests).

---

### B5. `vocalPhrases` not written in either format

**Files:** `lib/chart-edit/writer-chart.ts`, `lib/chart-edit/writer-mid.ts`

**Problem:** `doc.vocalPhrases` (array of `{ tick, length }`) is silently dropped by both writers. Vocal phrases mark lyric phrase boundaries.

**Decision needed:** vocalPhrases are part of vocals track data, and v1 is drums-only. Two options:

**Option A (recommended): Document as intentional v1 omission.** Add a comment in both writers noting that vocalPhrases are not written because v1 doesn't support the vocals instrument track. No code change, just documentation.

**Option B: Write them.** In .chart: `E "phrase_start"` at tick, `E "phrase_end"` at tick+length in [Events]. In MIDI: similar text events on EVENTS track. This preserves round-trip fidelity for charts that have vocals data, even though v1 doesn't edit vocals.

If option A: add inline comments in `serializeEventsSection` and `buildEventsTrack` explaining the omission. Update SPEC.md section 6 to note this.

---

## C. Missing Tests

### C1. Cross-format round-trip tests

**File:** New tests in `lib/chart-edit/__tests__/cross-format.test.ts` (or add to `read-write.test.ts`)

**Tests to add:**

1. **.chart → .mid:** Load drums-basic.chart fixture → set `doc.originalFormat = 'mid'` → `writeChart(doc)` → `parseChartFile(output)` → compare note counts, note types, and positions with original parse
2. **.mid → .chart:** Load drums-basic.mid fixture → set `doc.originalFormat = 'chart'` → `writeChart(doc)` → `parseChartFile(output)` → compare
3. **Cymbal preservation .chart → .mid:** Create chart with cymbal + tom notes → convert to .mid → parse → verify cymbals are still cymbals and toms are still toms
4. **Tom preservation .mid → .chart:** Create chart from .mid with tom markers → convert to .chart → parse → verify

These tests validate fix B4 (cross-format cymbal/tom conversion).

---

### C2. readChart without song.ini

**File:** `lib/chart-edit/__tests__/read-write.test.ts`

**Tests to add:**

1. Read the drums-basic.chart fixture WITHOUT its song.ini → verify metadata falls back to .chart [Song] section values (name, artist, genre, year, charter)
2. Verify `metadata.name`, `metadata.artist` etc. match what's in the fixture's `[Song]` section

---

### C3. Boolean metadata round-trip

**File:** `lib/chart-edit/__tests__/read-write.test.ts`

**Tests to add:**

1. Create a doc, set `metadata.modchart = true`, `metadata.pro_drums = true`, `metadata.five_lane_drums = false`, `metadata.eighthnote_hopo = true`, `metadata.end_events = false`
2. `writeChart` → extract song.ini → verify `modchart = True`, `pro_drums = True`, `five_lane_drums = False` etc.
3. Re-read via `readChart` → verify boolean values round-trip correctly

---

### C4. greenDrum / fiveGreenDrum drum helper tests

**File:** `lib/chart-edit/__tests__/drum-helpers.test.ts`

**Tests to add:**

1. `addDrumNote(track, { tick: 0, type: 'greenDrum' })` → verify `trackEvents` contains `fiveOrangeFourGreenDrum` event
2. `addDrumNote(track, { tick: 0, type: 'fiveGreenDrum' })` → verify `trackEvents` contains `fiveGreenDrum` event
3. `addDrumNote(track, { tick: 0, type: 'greenDrum', flags: { cymbal: true } })` → verify `greenCymbalMarker` event
4. `addDrumNote(track, { tick: 0, type: 'fiveGreenDrum', flags: { accent: true } })` → verify `fiveGreenAccent` event (after fix B3)
5. `getDrumNotes` → verify correct `DrumNoteType` returned for each

---

### C5. Image asset classification

**File:** `lib/chart-edit/__tests__/read-write.test.ts`

**Tests to add:**

1. Include dummy `album.png` (1-byte Uint8Array) and `background.jpg` in files array alongside a chart file
2. Call `readChart` → verify both appear in `doc.assets`
3. Call `writeChart` → verify both appear in output file list

---

### C6. Multi-difficulty fixture and tests

**File:** New fixture + tests in `lib/chart-edit/__tests__/`

**Fixture:** Create `drums-multidiff.chart` with Expert + Hard + Medium + Easy difficulty sections, each with a few notes, star power, and tom/cymbal markers.

**Tests to add:**

1. Round-trip .chart: read → write → parse → compare all four difficulties
2. Round-trip .mid: read as .chart → write as .mid → parse → verify all four difficulties have correct MIDI note offsets (Expert: 96+, Hard: 84+, Medium: 72+, Easy: 60+)
3. Verify instrument-wide events (star power, tom markers) are not duplicated across difficulties in MIDI output (validates fix A4)

---

### C7. Tom marker round-trip through MIDI

**File:** `lib/chart-edit/__tests__/mid-writer.test.ts`

**Tests to add:**

1. Create doc with Expert drums, add yellow/blue/green drum notes with tom markers in `trackEvents`
2. `serializeMidi` → `parseChartFile` → verify tom markers survive the round-trip
3. Verify correct MIDI note numbers: yellow=110, blue=111, green=112

---

### C8. Accent/ghost MIDI velocity round-trip

**File:** `lib/chart-edit/__tests__/mid-writer.test.ts`

**Tests to add:**

1. Create doc with Expert drums, add notes with accent and ghost flags (via `trackEvents` directly: base note + accent/ghost modifier events)
2. `serializeMidi` → verify noteOn velocities: 127 for accented, 1 for ghosted, 100 for normal
3. `serializeMidi` → `parseChartFile` → verify accent/ghost flags survive the round-trip
4. Verify `[ENABLE_CHART_DYNAMICS]` text event is present when accents/ghosts exist

---

## Implementation Order

Recommended order to minimize conflicts:

1. **B1** (add midi-file to package.json) — trivial, unblocks nothing but should be first
2. **A8** (bracket text events) — one-line fix each, update existing test
3. **A3** (duplicate forceFlam) — foundational for A1/A2
4. **A1 + A2** (shared flam corruption) — depends on A3's approach
5. **B3** (fiveGreenDrum accent/ghost mappings) — small, standalone
6. **A6** (lyrics in .chart) — small, standalone
7. **A7** (INI section case) — small, standalone
8. **A5** (coda sections) — small, standalone
9. **A4** (MIDI dedup) — straightforward after A5
10. **B2** (.chart dedup) — defensive, after A3/A4
11. **B4** (cross-format cymbal/tom) — largest change, most complex
12. **B5** (vocalPhrases) — decision needed, lowest priority
13. **C1–C8** (tests) — write alongside or after each fix

---

## Verification

After all fixes:

```bash
yarn test --testPathPattern='lib/chart-edit'
```

All existing tests must still pass. New tests must cover each fix. Total test count should increase from 134 to ~170+.

Additionally, spot-check with real chart files from `~/Desktop/enchor-songs copy/`:
- Load a .chart file with pro drums → write → re-parse → compare
- Load a .mid file → write → re-parse → compare
- Load a .chart file → change to .mid format → write → re-parse → compare notes
