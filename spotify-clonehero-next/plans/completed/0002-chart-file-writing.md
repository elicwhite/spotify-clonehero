# 0002 - Chart File Writing

> **Dependencies:** 0001 (types and project structure)
> **Unlocks:** 0005 (ML model integration), 0006 (chart preview), 0007 (web editor), 0008 (pipeline orchestration)

## Overview

Write `.chart` files (Clone Hero format) from an in-memory representation. The scan-chart package only reads charts; this module provides the inverse operation. The design must produce output that round-trips cleanly through scan-chart's `parseChartFile()`.

**Browser note:** This is pure string serialization — no system dependencies. The serialized `.chart` text is stored in OPFS via `lib/fileSystemHelpers.ts` patterns or downloaded via `URL.createObjectURL(new Blob([chartText]))`.

**Integration:** Reuse existing `tickToMs()` from `app/sheet-music/[slug]/chartUtils.ts` (consider moving to `lib/` for sharing). The inverse `msToTick()` is new. Reuse `noteTypes` and `noteFlags` from `@eliwhite/scan-chart`. Reuse drum lane mapping from `lib/fill-detector/drumLaneMap.ts`. All new code goes in `lib/drum-transcription/chart-io/`.

## References

- **Moonscraper Chart Editor:** Any behavior not explicitly defined in this plan should match the behavior of Moonscraper Chart Editor at `~/projects/Moonscraper-Chart-Editor`. The most important constraint is that all data must round-trip cleanly through scan-chart's `parseChartFile()`.
- **Chart format spec:** The complete chart format specification can be found at `~/projects/GuitarGame_ChartFormats`.
- **scan-chart types:** Types should be imported from `@eliwhite/scan-chart` wherever possible. The package exports: `Instrument`, `Difficulty`, `NoteType`, `NoteEvent`, `EventType`, `RawChartData`, `NotesData`, `DrumType`, along with the value objects `noteTypes`, `noteFlags`, `eventTypes`, `instruments`, `difficulties`, `drumTypes`, and the `parseChartFile` function. Custom types should only be defined where scan-chart does not export a suitable type.

---

## 1. Data Model (TypeScript Interfaces)

The in-memory model is designed to be easy to construct from the ML transcription output (which produces millisecond-timed onsets with drum labels) while also being complete enough to serialize a valid `.chart` file.

**scan-chart type reuse:** Many of these types align with structures in `@eliwhite/scan-chart`. Where noted below, use the scan-chart type directly rather than defining a parallel type. Import from `@eliwhite/scan-chart`:
- `Instrument` — union type for instrument names (includes `'drums'`)
- `Difficulty` — union type `'expert' | 'hard' | 'medium' | 'easy'`
- `NoteType`, `noteTypes` — note type enum values (e.g. `noteTypes.kick`, `noteTypes.redDrum`)
- `noteFlags` — bitmask constants for cymbal, tom, doubleKick, ghost, accent, etc.
- `RawChartData` — scan-chart's intermediate parsed representation; its sub-types for `tempos`, `timeSignatures`, `sections`, `endEvents`, and `trackData` should be used as the structural reference

```typescript
import type { Instrument, Difficulty } from '@eliwhite/scan-chart';

/**
 * Top-level chart document. Everything needed to write a .chart file.
 *
 * This mirrors the shape of scan-chart's `RawChartData` (exported from
 * `@eliwhite/scan-chart`). Fields like `tempos`, `timeSignatures`,
 * `sections`, and `endEvents` use the same structure as `RawChartData`
 * so that data can move between parsing and serialization without
 * transformation. `ChartDocument` is NOT directly exported by scan-chart,
 * so we define it here.
 */
interface ChartDocument {
  /** Ticks per quarter note. Use 480 for our pipeline (see Section 7). */
  resolution: number;

  metadata: ChartMetadata;

  /** Must be sorted by tick, ascending. First entry must be at tick 0. */
  tempos: TempoEvent[];

  /** Must be sorted by tick, ascending. First entry must be at tick 0. */
  timeSignatures: TimeSignatureEvent[];

  /** Section markers (e.g. "Intro", "Verse 1"). Sorted by tick. */
  sections: SectionEvent[];

  /** End event, if any. */
  endEvents: { tick: number }[];

  /** Note tracks keyed by instrument+difficulty. For drums, we only need ExpertDrums. */
  tracks: TrackData[];
}

/**
 * Chart metadata for the [Song] section.
 *
 * scan-chart exports `RawChartData['metadata']` with a subset of these
 * fields (name, artist, album, genre, year, charter, delay,
 * preview_start_time). We extend beyond that for serialization-specific
 * fields (musicStream, drumStream, etc.) that scan-chart does not model.
 * This type is NOT exported by scan-chart.
 */
interface ChartMetadata {
  name: string;
  artist: string;
  album?: string;
  genre?: string;
  year?: string;
  charter?: string;
  resolution: number;       // Same as ChartDocument.resolution
  offset?: number;          // Seconds (float). Audio delay.
  difficulty?: number;      // Overall difficulty rating
  previewStart?: number;    // Seconds (float)
  previewEnd?: number;      // Seconds (float)
  /** Audio stem file references */
  musicStream?: string;     // e.g. "song.ogg"
  drumStream?: string;      // e.g. "drums.ogg"
}

/**
 * Matches the shape of `RawChartData['tempos'][number]` from scan-chart,
 * except scan-chart uses `beatsPerMinute` instead of `bpm`. Use `bpm` here
 * for brevity; convert to/from `beatsPerMinute` at the boundary.
 */
interface TempoEvent {
  tick: number;
  /** BPM as a float (e.g. 120.0). Serialized as millibeats (120000). */
  bpm: number;
}

/**
 * Same shape as `RawChartData['timeSignatures'][number]` from scan-chart.
 * Use scan-chart's type directly if convenient.
 */
interface TimeSignatureEvent {
  tick: number;
  numerator: number;
  /** Denominator as the actual value (4, 8, etc.), NOT the exponent. */
  denominator: number;
}

/**
 * Same shape as `RawChartData['sections'][number]` from scan-chart.
 * Use scan-chart's type directly if convenient.
 */
interface SectionEvent {
  tick: number;
  name: string;
}

/**
 * Uses `Instrument` and `Difficulty` from `@eliwhite/scan-chart`.
 * The `starPower` and `activationLanes` shapes match
 * `RawChartData['trackData'][number]['starPowerSections']` and
 * `RawChartData['trackData'][number]['drumFreestyleSections']` respectively.
 */
interface TrackData {
  instrument: Instrument;   // Use scan-chart's Instrument type (constrained to 'drums' for our pipeline)
  difficulty: Difficulty;    // Use scan-chart's Difficulty type
  notes: DrumNote[];
  /** Star power phrases. */
  starPower?: { tick: number; length: number }[];
  /** Drum activation lanes (freestyle sections). */
  activationLanes?: { tick: number; length: number }[];
}

/**
 * Note: scan-chart's `NoteEvent` (exported) uses numeric `NoteType` and a
 * bitmask `flags` field. Our `DrumNote` uses string-based `DrumNoteType`
 * and a boolean-based `DrumNoteFlags` for ergonomic construction from ML
 * output. Conversion between these representations happens at
 * serialization time (see `drumNoteTypeToScanChartType()` in Section 9)
 * and uses `noteTypes` / `noteFlags` from scan-chart.
 *
 * `DrumNote` is NOT exported by scan-chart — it is specific to our writer.
 */
interface DrumNote {
  tick: number;
  /** Note type determines which .chart note number(s) to emit. */
  type: DrumNoteType;
  /** Note length in ticks. 0 for non-sustained hits (almost always 0 for drums). */
  length: number;
  /** Flags for pro drums (cymbal), accent, ghost, double kick. */
  flags: DrumNoteFlags;
}

/**
 * String-based drum note type for ergonomic construction. Maps to
 * scan-chart's numeric `noteTypes.kick`, `noteTypes.redDrum`, etc.
 * NOT exported by scan-chart.
 */
type DrumNoteType = 'kick' | 'red' | 'yellow' | 'blue' | 'green';

/**
 * Boolean-based flags for ergonomic construction. Maps to scan-chart's
 * bitmask `noteFlags` (cymbal=32, doubleKick=8, ghost=512, accent=1024).
 * NOT exported by scan-chart.
 */
interface DrumNoteFlags {
  cymbal?: boolean;     // For yellow/blue/green in pro drums mode
  doubleKick?: boolean; // Expert+ double kick (note 32)
  accent?: boolean;
  ghost?: boolean;
}
```

---

## 2. .chart File Format Specification

### Overall structure

The file is UTF-8 text with Windows-style line endings (`\r\n`). Sections are enclosed in `[SectionName]` headers followed by `{` ... `}` blocks. Each line inside a block is indented with two spaces.

```
[Song]
{
  Name = "Song Title"
  Artist = "Artist Name"
  Album = "Album Name"
  Genre = "rock"
  Year = ", 2024"
  Charter = "AutoChart"
  Resolution = 480
  Offset = 0
  Player2 = bass
  Difficulty = 0
  PreviewStart = 0
  PreviewEnd = 0
  MediaType = "cd"
  MusicStream = "song.ogg"
  DrumStream = "drums.ogg"
}
[SyncTrack]
{
  0 = TS 4
  0 = B 120000
  3840 = B 130000
}
[Events]
{
  0 = E "section Intro"
  3840 = E "section Verse 1"
}
[ExpertDrums]
{
  0 = N 0 0
  0 = N 2 0
  0 = N 66 0
  480 = N 1 0
  960 = N 0 0
  960 = N 4 0
  960 = N 68 0
  960 = S 2 480
}
```

### [Song] section

Key-value pairs. String values are quoted with `"`. Numeric values are unquoted.

| Key | Type | Example | Notes |
|-----|------|---------|-------|
| `Name` | string | `"Song Title"` | Song name |
| `Artist` | string | `"Artist Name"` | |
| `Album` | string | `"Album Name"` | |
| `Genre` | string | `"rock"` | |
| `Year` | string | `", 2024"` | Note: Moonscraper prefixes with `, ` |
| `Charter` | string | `"AutoChart"` | |
| `Resolution` | number | `480` | Ticks per quarter note |
| `Offset` | number | `0` | Audio offset in seconds |
| `Player2` | string | `"bass"` | |
| `Difficulty` | number | `0` | Overall difficulty 0-6 |
| `PreviewStart` | number | `0` | Preview start in seconds |
| `PreviewEnd` | number | `0` | Preview end in seconds |
| `MediaType` | string | `"cd"` | |
| `MusicStream` | string | `"song.ogg"` | Main audio file |
| `DrumStream` | string | `"drums.ogg"` | Drum stem audio file |

### [SyncTrack] section

Two event types, sorted by tick:

**Tempo (B):**
```
<tick> = B <millibeats_per_minute>
```
- `millibeats_per_minute` = BPM * 1000, as an integer
- Example: 120 BPM -> `0 = B 120000`
- Example: 145.5 BPM -> `0 = B 145500`

**Time Signature (TS):**
```
<tick> = TS <numerator>
<tick> = TS <numerator> <denominator_exponent>
```
- `denominator_exponent` = log2(denominator). Omitted when denominator is 4 (exponent = 2).
- Example: 4/4 -> `0 = TS 4` (exponent 2 is default, omitted)
- Example: 3/4 -> `0 = TS 3`
- Example: 6/8 -> `0 = TS 6 3` (2^3 = 8)
- Example: 7/8 -> `0 = TS 7 3`
- Example: 2/2 -> `0 = TS 2 1` (2^1 = 2)

### [Events] section

```
<tick> = E "<event_text>"
```

Section markers use the format:
```
<tick> = E "section <section_name>"
```

End events:
```
<tick> = E "end"
```

### Note Tracks: [ExpertDrums], [HardDrums], etc.

Track section names follow the pattern `[<Difficulty><Instrument>]`:

| Section Name | Instrument | Difficulty |
|---|---|---|
| `ExpertDrums` | drums | expert |
| `HardDrums` | drums | hard |
| `MediumDrums` | drums | medium |
| `EasyDrums` | drums | easy |

**Note events (N):**
```
<tick> = N <note_number> <length>
```

**Drum note numbers:**

| Note # | Meaning | When to emit |
|--------|---------|-------------|
| 0 | Kick | `type === 'kick'` and not double kick |
| 1 | Red (snare) | `type === 'red'` |
| 2 | Yellow (hi-hat/tom) | `type === 'yellow'` |
| 3 | Blue (tom/ride) | `type === 'blue'` |
| 4 | Orange/Green (crash/tom) | `type === 'green'` (4-lane) |
| 5 | Green (5-lane only) | Not used in our pipeline |
| 32 | Double kick (Expert+) | `type === 'kick'` AND `flags.doubleKick` |

**Pro drums cymbal markers (emitted as separate N events at same tick):**

| Note # | Meaning | When to emit |
|--------|---------|-------------|
| 66 | Yellow cymbal | `type === 'yellow'` AND `flags.cymbal` |
| 67 | Blue cymbal | `type === 'blue'` AND `flags.cymbal` |
| 68 | Green cymbal | `type === 'green'` AND `flags.cymbal` |

Important: In .chart format, drums default to **tom**. Cymbal markers are additive.
- Yellow with no marker = yellow tom
- Yellow + note 66 = yellow cymbal (hi-hat/crash)
- Red is always snare (no cymbal marker exists for red)

**Accent flags:**

| Note # | Meaning |
|--------|---------|
| 34 | Red accent |
| 35 | Yellow accent |
| 36 | Blue accent |
| 37 | Green accent |

**Ghost flags:**

| Note # | Meaning |
|--------|---------|
| 40 | Red ghost |
| 41 | Yellow ghost |
| 42 | Blue ghost |
| 43 | Green ghost |

**Special events (S):**
```
<tick> = S 2 <length>
```
- `S 2` = star power phrase
- `S 64` = drum freestyle section (activation lane)

**Length for drum notes** is almost always `0`. Sustains on drum notes are uncommon and generally ignored by games.

### Line ordering within sections

Within a section, events MUST be sorted by tick (ascending). At the same tick, Moonscraper orders:
1. `S` (special) events first
2. `N` (note) events second
3. `E` (text) events third

Within the same tick and same event type, order by the value (note number ascending).

---

## 3. Serialization Logic

### High-level approach

```typescript
function serializeChart(doc: ChartDocument): string {
  const lines: string[] = [];

  lines.push(...serializeSongSection(doc.metadata));
  lines.push(...serializeSyncTrack(doc.tempos, doc.timeSignatures));
  lines.push(...serializeEvents(doc.sections, doc.endEvents));

  for (const track of doc.tracks) {
    lines.push(...serializeTrack(track));
  }

  return lines.join('\r\n') + '\r\n';
}
```

### serializeSongSection

```typescript
function serializeSongSection(meta: ChartMetadata): string[] {
  const lines = ['[Song]', '{'];

  lines.push(`  Name = "${meta.name}"`);
  lines.push(`  Artist = "${meta.artist}"`);
  if (meta.album) lines.push(`  Album = "${meta.album}"`);
  if (meta.genre) lines.push(`  Genre = "${meta.genre}"`);
  if (meta.year) lines.push(`  Year = ", ${meta.year}"`);
  if (meta.charter) lines.push(`  Charter = "${meta.charter}"`);
  lines.push(`  Resolution = ${meta.resolution}`);
  lines.push(`  Offset = ${meta.offset ?? 0}`);
  lines.push(`  Player2 = bass`);
  lines.push(`  Difficulty = ${meta.difficulty ?? 0}`);
  lines.push(`  PreviewStart = ${meta.previewStart ?? 0}`);
  lines.push(`  PreviewEnd = ${meta.previewEnd ?? 0}`);
  lines.push(`  MediaType = "cd"`);
  if (meta.musicStream) lines.push(`  MusicStream = "${meta.musicStream}"`);
  if (meta.drumStream) lines.push(`  DrumStream = "${meta.drumStream}"`);

  lines.push('}');
  return lines;
}
```

### serializeSyncTrack

Interleave tempo and time signature events, sorted by tick. At the same tick, emit TS before B (matches Moonscraper convention).

```typescript
function serializeSyncTrack(
  tempos: TempoEvent[],
  timeSignatures: TimeSignatureEvent[]
): string[] {
  const lines = ['[SyncTrack]', '{'];

  // Merge and sort by tick
  type SyncEvent =
    | { tick: number; kind: 'tempo'; bpm: number }
    | { tick: number; kind: 'ts'; numerator: number; denominator: number };

  const events: SyncEvent[] = [
    ...tempos.map(t => ({ tick: t.tick, kind: 'tempo' as const, bpm: t.bpm })),
    ...timeSignatures.map(ts => ({
      tick: ts.tick,
      kind: 'ts' as const,
      numerator: ts.numerator,
      denominator: ts.denominator,
    })),
  ];

  // Sort by tick, then TS before B at same tick
  events.sort((a, b) => {
    if (a.tick !== b.tick) return a.tick - b.tick;
    return (a.kind === 'ts' ? 0 : 1) - (b.kind === 'ts' ? 0 : 1);
  });

  for (const event of events) {
    if (event.kind === 'tempo') {
      const millibeats = Math.round(event.bpm * 1000);
      lines.push(`  ${event.tick} = B ${millibeats}`);
    } else {
      const denomExp = Math.log2(event.denominator);
      if (event.denominator === 4) {
        lines.push(`  ${event.tick} = TS ${event.numerator}`);
      } else {
        lines.push(`  ${event.tick} = TS ${event.numerator} ${denomExp}`);
      }
    }
  }

  lines.push('}');
  return lines;
}
```

### serializeEvents

```typescript
function serializeEvents(
  sections: SectionEvent[],
  endEvents: { tick: number }[]
): string[] {
  const lines = ['[Events]', '{'];

  const events: { tick: number; text: string }[] = [
    ...sections.map(s => ({ tick: s.tick, text: `section ${s.name}` })),
    ...endEvents.map(e => ({ tick: e.tick, text: 'end' })),
  ];

  events.sort((a, b) => a.tick - b.tick);

  for (const event of events) {
    lines.push(`  ${event.tick} = E "${event.text}"`);
  }

  lines.push('}');
  return lines;
}
```

### serializeTrack

```typescript
const difficultyPrefix: Record<string, string> = {
  expert: 'Expert',
  hard: 'Hard',
  medium: 'Medium',
  easy: 'Easy',
};

function serializeTrack(track: TrackData): string[] {
  const sectionName = `${difficultyPrefix[track.difficulty]}Drums`;
  const lines = [`[${sectionName}]`, '{'];

  // Collect all events for this track
  type TrackEvent =
    | { tick: number; kind: 'S'; value: number; length: number }
    | { tick: number; kind: 'N'; value: number; length: number };

  const events: TrackEvent[] = [];

  // Star power
  for (const sp of track.starPower ?? []) {
    events.push({ tick: sp.tick, kind: 'S', value: 2, length: sp.length });
  }

  // Activation lanes
  for (const al of track.activationLanes ?? []) {
    events.push({ tick: al.tick, kind: 'S', value: 64, length: al.length });
  }

  // Notes
  for (const note of track.notes) {
    // Base note number
    const baseNoteNum = drumTypeToNoteNumber(note.type, note.flags);
    events.push({ tick: note.tick, kind: 'N', value: baseNoteNum, length: note.length });

    // Double kick marker (emit note 32 in addition to note 0)
    if (note.type === 'kick' && note.flags.doubleKick) {
      events.push({ tick: note.tick, kind: 'N', value: 32, length: 0 });
    }

    // Pro drums cymbal markers
    if (note.flags.cymbal) {
      const cymbalNum = drumTypeToCymbalNumber(note.type);
      if (cymbalNum !== null) {
        events.push({ tick: note.tick, kind: 'N', value: cymbalNum, length: 0 });
      }
    }

    // Accent flags
    if (note.flags.accent) {
      const accentNum = drumTypeToAccentNumber(note.type);
      if (accentNum !== null) {
        events.push({ tick: note.tick, kind: 'N', value: accentNum, length: 0 });
      }
    }

    // Ghost flags
    if (note.flags.ghost) {
      const ghostNum = drumTypeToGhostNumber(note.type);
      if (ghostNum !== null) {
        events.push({ tick: note.tick, kind: 'N', value: ghostNum, length: 0 });
      }
    }
  }

  // Sort: by tick, then S before N, then by value
  events.sort((a, b) => {
    if (a.tick !== b.tick) return a.tick - b.tick;
    const kindOrder = (k: string) => (k === 'S' ? 0 : 1);
    if (kindOrder(a.kind) !== kindOrder(b.kind))
      return kindOrder(a.kind) - kindOrder(b.kind);
    return a.value - b.value;
  });

  for (const event of events) {
    lines.push(`  ${event.tick} = ${event.kind} ${event.value} ${event.length}`);
  }

  lines.push('}');
  return lines;
}
```

### Note number mapping helpers

```typescript
function drumTypeToNoteNumber(
  type: DrumNoteType,
  flags: DrumNoteFlags
): number {
  switch (type) {
    case 'kick':   return 0;  // Always note 0 (double kick adds 32 separately)
    case 'red':    return 1;
    case 'yellow': return 2;
    case 'blue':   return 3;
    case 'green':  return 4;
  }
}

function drumTypeToCymbalNumber(type: DrumNoteType): number | null {
  switch (type) {
    case 'yellow': return 66;
    case 'blue':   return 67;
    case 'green':  return 68;
    default:       return null;  // kick and red have no cymbal markers
  }
}

function drumTypeToAccentNumber(type: DrumNoteType): number | null {
  switch (type) {
    case 'red':    return 34;
    case 'yellow': return 35;
    case 'blue':   return 36;
    case 'green':  return 37;
    default:       return null;
  }
}

function drumTypeToGhostNumber(type: DrumNoteType): number | null {
  switch (type) {
    case 'red':    return 40;
    case 'yellow': return 41;
    case 'blue':   return 42;
    case 'green':  return 43;
    default:       return null;
  }
}
```

---

## 4. Tempo Map Handling

### BPM events

Each tempo change in the SyncTrack is serialized as:
```
<tick> = B <millibeats>
```
Where `millibeats = Math.round(bpm * 1000)`.

Requirements:
- There MUST be a tempo event at tick 0. If not provided, default to 120 BPM (`0 = B 120000`).
- BPM must be > 0.
- Millibeats is always a positive integer.

### Time signatures

```
<tick> = TS <numerator> [<denominator_exponent>]
```

Requirements:
- There MUST be a time signature at tick 0. If not provided, default to 4/4 (`0 = TS 4`).
- Numerator must be > 0.
- Denominator must be a power of 2 (1, 2, 4, 8, 16, 32). The exponent `log2(denominator)` is written. If denominator is 4 (exponent = 2), the exponent is omitted (Moonscraper convention, not strictly required but conventional).

### Example: variable tempo

A song that starts at 120 BPM, changes to 140 BPM at bar 5 (tick 7680 with resolution 480):

```
[SyncTrack]
{
  0 = TS 4
  0 = B 120000
  7680 = B 140000
}
```

---

## 5. Tick Calculation from Millisecond Timestamps

The ML model outputs onset times in milliseconds. We need to convert these to ticks for the .chart file. This is the inverse of the `setEventMsTimes` function in scan-chart.

### Algorithm: msToTick

Given a sorted list of timed tempos and a target ms time, find the tick position:

```typescript
interface TimedTempo {
  tick: number;
  bpm: number;
  msTime: number;
}

/**
 * Convert a millisecond timestamp to a tick position using the tempo map.
 *
 * Formula (inverse of scan-chart's getTimedTempos):
 *   msTime = lastTempo.msTime + (tick - lastTempo.tick) * 60000 / (lastTempo.bpm * resolution)
 *
 * Solving for tick:
 *   tick = lastTempo.tick + (msTime - lastTempo.msTime) * lastTempo.bpm * resolution / 60000
 */
function msToTick(
  msTime: number,
  timedTempos: TimedTempo[],
  resolution: number
): number {
  // Find the active tempo at this msTime
  let tempoIndex = 0;
  for (let i = 1; i < timedTempos.length; i++) {
    if (timedTempos[i].msTime <= msTime) {
      tempoIndex = i;
    } else {
      break;
    }
  }

  const tempo = timedTempos[tempoIndex];
  const elapsedMs = msTime - tempo.msTime;
  const tickOffset = (elapsedMs * tempo.bpm * resolution) / 60000;

  return Math.round(tempo.tick + tickOffset);
}
```

### Building the timed tempo map

Before converting ms to ticks, pre-compute `msTime` for each tempo event (same algorithm scan-chart uses):

```typescript
function buildTimedTempos(
  tempos: TempoEvent[],
  resolution: number
): TimedTempo[] {
  const timed: TimedTempo[] = [];

  for (let i = 0; i < tempos.length; i++) {
    if (i === 0) {
      timed.push({ tick: tempos[0].tick, bpm: tempos[0].bpm, msTime: 0 });
    } else {
      const prev = timed[i - 1];
      const msTime =
        prev.msTime +
        ((tempos[i].tick - prev.tick) * 60000) / (prev.bpm * resolution);
      timed.push({ tick: tempos[i].tick, bpm: tempos[i].bpm, msTime });
    }
  }

  return timed;
}
```

### Quantization

Raw `msToTick` produces floating-point ticks. We need to quantize to valid grid positions. Options:

1. **Round to nearest tick** (`Math.round`) - simplest, sufficient if resolution is 480.
2. **Snap to musical grid** (e.g., nearest 1/16th, 1/32nd, 1/64th note) - reduces drift from floating-point errors but may incorrectly "correct" intentional offsets.

Recommendation: **Round to nearest tick** for the initial implementation. At resolution 480, a single tick at 120 BPM is ~1.04ms, which is well below the ~5ms human perception threshold. Provide an optional snap-to-grid function as a post-processing step for the human editor.

### Snap-to-grid helper (optional)

```typescript
/**
 * Snap a tick to the nearest grid position.
 * gridDivision: number of divisions per quarter note (e.g., 4 = 16th notes, 8 = 32nd notes)
 */
function snapToGrid(tick: number, resolution: number, gridDivision: number): number {
  const gridSize = resolution / gridDivision;
  return Math.round(tick / gridSize) * gridSize;
}
```

At resolution 480:
- 1/4 note grid: 480 ticks
- 1/8 note grid: 240 ticks
- 1/16 note grid: 120 ticks
- 1/32 note grid: 60 ticks
- 1/48 (triplet 16th): 40 ticks
- 1/64 note grid: 30 ticks
- 1/192 note grid: 10 ticks (smallest sensible grid at 480 resolution)

---

## 6. Pro Drums Support

### Cymbal markers in .chart

In .chart files, drums default to **tom** (unlike .mid where yellow/blue/green default to cymbal). To mark a note as a cymbal, add a separate `N` event with the cymbal marker note number at the same tick.

scan-chart confirms this behavior (from `chart-parser.ts` line 361-362):
```
case '66': return eventTypes.yellowCymbalMarker
case '67': return eventTypes.blueCymbalMarker
case '68': return eventTypes.greenCymbalMarker
```

And from `notes-parser.ts` `getTomOrCymbalFlags` (chart format, lines 334-346):
- Red is always tom (no cymbal option)
- Yellow: cymbal if `yellowCymbalMarker` present, otherwise tom
- Blue: cymbal if `blueCymbalMarker` present, otherwise tom
- Green: cymbal if `greenCymbalMarker` present, otherwise tom

### Serialization for pro drums

When writing a note with `flags.cymbal === true`:

```
960 = N 2 0
960 = N 66 0
```
This is a yellow cymbal hit at tick 960. The `N 2 0` is the yellow drum note; the `N 66 0` is the cymbal marker.

Without the cymbal marker, `960 = N 2 0` alone would be a yellow tom hit.

### Note: scan-chart cymbal marker scope

In scan-chart's chart parser, cymbal markers are zero-length events at a specific tick. They apply to the note at that same tick only (they are grouped by tick in `notes-parser.ts`). This is simpler than .mid where cymbal/tom markers are ranged phrases.

### Default pro drums behavior

For our pipeline, we should default to `pro_drums: true` in the song.ini and emit cymbal markers for all hi-hat and cymbal hits. The ML model classifies drums into classes that map to:

| ML Class | DrumNoteType | Cymbal? |
|----------|-------------|---------|
| Kick | kick | n/a |
| Snare | red | n/a (always tom) |
| Hi-hat (closed) | yellow | yes |
| Hi-hat (open) | yellow | yes |
| High tom | yellow | no |
| Low tom / floor tom | blue | no |
| Ride cymbal | blue | yes |
| Crash cymbal | green | yes |
| Low floor tom | green | no |

---

## 7. Chart Resolution Choice

### 192 vs 480

| Resolution | Pros | Cons |
|-----------|------|------|
| 192 | Traditional CH standard; smallest file sizes | 1 tick = ~2.6ms at 120 BPM; less precise |
| 480 | Standard in modern charting; 1 tick = ~1.04ms at 120 BPM; better subdivision support | Slightly larger files |

**Recommendation: 480 ticks per quarter note.**

Reasons:
- Better precision for ML-derived onset times (1.04ms vs 2.6ms per tick at 120 BPM)
- Clean subdivision into common note values: 1/4=480, 1/8=240, 1/12=160, 1/16=120, 1/24=80, 1/32=60, 1/48=40, 1/64=30
- 192 only cleanly divides into: 1/4=192, 1/8=96, 1/12=64, 1/16=48, 1/24=32, 1/32=24, 1/48=16, 1/64=12
- 480 is the de facto standard for modern Clone Hero charts
- All major CH engines (Clone Hero, YARG) support both

---

## 8. Validation Before Writing

Run these checks before serialization. Errors should throw; warnings should be collected and returned.

### Errors (prevent writing)

1. **No tempo at tick 0** - auto-fix by inserting `{ tick: 0, bpm: 120 }` (matching scan-chart behavior)
2. **No time signature at tick 0** - auto-fix by inserting `{ tick: 0, numerator: 4, denominator: 4 }`
3. **Zero or negative BPM** - throw error
4. **Zero numerator or denominator** - throw error
5. **Denominator not a power of 2** - throw error
6. **Resolution not a positive integer** - throw error
7. **Duplicate notes** - same type at same tick: deduplicate (keep first)
8. **Negative tick values** - throw error

### Warnings (allow writing, return to caller)

1. **No notes in any track** - valid file but probably unintentional
2. **Notes not sorted by tick** - auto-sort (scan-chart does this during parse)
3. **Very high BPM (> 300)** or very low BPM (< 20) - likely an error in tempo mapping
4. **isDefaultBPM** - only one 120 BPM marker and 4/4 time sig (probably untempo-mapped)
5. **No sections** - chart has no section markers
6. **Cymbal marker on red drum** - red has no cymbal marker; flag is silently ignored
7. **Double kick on non-Expert difficulty** - should only appear on Expert

### Validation function signature

```typescript
interface ValidationResult {
  errors: string[];
  warnings: string[];
  /** The (possibly auto-corrected) document */
  document: ChartDocument;
}

function validateChart(doc: ChartDocument): ValidationResult {
  // ...
}
```

---

## 9. Round-Trip Testing Strategy

### Approach: write -> read with scan-chart -> compare

The core test: serialize a `ChartDocument` to a `.chart` string, then parse it back with scan-chart's `parseChartFile()`, and verify the data matches.

### Test harness

```typescript
import { parseChartFile } from 'scan-chart';

function roundTripTest(doc: ChartDocument): void {
  // 1. Serialize
  const chartText = serializeChart(doc);
  const chartBytes = new TextEncoder().encode(chartText);

  // 2. Parse back with scan-chart
  const parsed = parseChartFile(chartBytes, 'chart', {
    pro_drums: true,
  });

  // 3. Compare resolution
  assert(parsed.resolution === doc.resolution);

  // 4. Compare tempos
  assert(parsed.tempos.length === doc.tempos.length);
  for (let i = 0; i < doc.tempos.length; i++) {
    assert(parsed.tempos[i].tick === doc.tempos[i].tick);
    // BPM may have rounding due to millibeats integer conversion
    assertApprox(parsed.tempos[i].beatsPerMinute, doc.tempos[i].bpm, 0.001);
  }

  // 5. Compare time signatures
  assert(parsed.timeSignatures.length === doc.timeSignatures.length);
  for (let i = 0; i < doc.timeSignatures.length; i++) {
    assert(parsed.timeSignatures[i].tick === doc.timeSignatures[i].tick);
    assert(parsed.timeSignatures[i].numerator === doc.timeSignatures[i].numerator);
    assert(parsed.timeSignatures[i].denominator === doc.timeSignatures[i].denominator);
  }

  // 6. Compare sections
  assert(parsed.sections.length === doc.sections.length);
  for (let i = 0; i < doc.sections.length; i++) {
    assert(parsed.sections[i].tick === doc.sections[i].tick);
    assert(parsed.sections[i].name === doc.sections[i].name);
  }

  // 7. Compare tracks
  for (const docTrack of doc.tracks) {
    const parsedTrack = parsed.trackData.find(
      t => t.instrument === docTrack.instrument &&
           t.difficulty === docTrack.difficulty
    );
    assert(parsedTrack !== undefined);

    // Compare note event groups
    // scan-chart groups notes by tick and resolves modifiers into NoteEvent[][]
    // We need to reconstruct expected groups from our flat note list
    const expectedGroups = groupNotesByTick(docTrack.notes);
    assert(parsedTrack.noteEventGroups.length === expectedGroups.length);

    for (let g = 0; g < expectedGroups.length; g++) {
      const parsedGroup = parsedTrack.noteEventGroups[g];
      const expectedGroup = expectedGroups[g];

      // Compare each note in the group
      for (const expectedNote of expectedGroup) {
        const parsedNote = parsedGroup.find(
          n => n.type === drumNoteTypeToScanChartType(expectedNote.type)
        );
        assert(parsedNote !== undefined);
        assert(parsedNote.tick === expectedNote.tick);
        assert(parsedNote.length === expectedNote.length);

        // Verify flags
        if (expectedNote.flags.cymbal) {
          assert(parsedNote.flags & noteFlags.cymbal);
        } else if (expectedNote.type !== 'kick') {
          assert(parsedNote.flags & noteFlags.tom);
        }
        if (expectedNote.flags.doubleKick) {
          assert(parsedNote.flags & noteFlags.doubleKick);
        }
        if (expectedNote.flags.accent) {
          assert(parsedNote.flags & noteFlags.accent);
        }
        if (expectedNote.flags.ghost) {
          assert(parsedNote.flags & noteFlags.ghost);
        }
      }
    }
  }
}
```

### Test cases

1. **Minimal chart** - Single note, single tempo, single time signature. Verifies basic structure.

2. **Multiple notes at same tick (chord)** - Kick + hi-hat simultaneously. Verifies note grouping.

3. **Pro drums** - Mix of toms and cymbals. Verifies cymbal markers are emitted and parsed correctly.

4. **Tempo changes** - Multiple BPM changes mid-song. Verifies sync track serialization and ms<->tick conversion accuracy.

5. **Time signature changes** - 4/4 to 3/4 to 6/8. Verifies denominator exponent encoding.

6. **Fractional BPM** - 145.5 BPM (millibeats = 145500). Verifies no precision loss in millibeats conversion.

7. **Double kick** - Note 0 + note 32. Verifies Expert+ encoding.

8. **Accent and ghost flags** - Verifies all modifier note numbers.

9. **Star power and activation lanes** - Verifies S events round-trip.

10. **Section markers** - Multiple sections with spaces and special characters.

11. **Full song simulation** - Generate a realistic chart from fake ML output (~500 notes, tempo changes, sections) and verify round-trip.

12. **ms-to-tick-to-ms round-trip** - Convert ms timestamps to ticks, write chart, parse back with scan-chart (which computes ms times from ticks), verify ms times are within 1ms of originals.

### Testing with Jest

```typescript
import { describe, test, expect } from '@jest/globals';

describe('chart-writer', () => {
  test('minimal chart round-trips', () => {
    const doc: ChartDocument = {
      resolution: 480,
      metadata: { name: 'Test', artist: 'Test', resolution: 480 },
      tempos: [{ tick: 0, bpm: 120 }],
      timeSignatures: [{ tick: 0, numerator: 4, denominator: 4 }],
      sections: [],
      endEvents: [],
      tracks: [{
        instrument: 'drums',
        difficulty: 'expert',
        notes: [
          { tick: 0, type: 'kick', length: 0, flags: {} },
          { tick: 480, type: 'red', length: 0, flags: {} },
        ],
      }],
    };

    const text = serializeChart(doc);
    const parsed = parseChartFile(
      new TextEncoder().encode(text), 'chart', { pro_drums: true }
    );

    expect(parsed.resolution).toBe(480);
    expect(parsed.trackData).toHaveLength(1);
    expect(parsed.trackData[0].noteEventGroups).toHaveLength(2);
  });
});
```

---

## 10. Implementation Order

1. **Data model types** (`lib/drum-transcription/chart-io/types.ts`) — import `Instrument`, `Difficulty`, `NoteType`, `noteTypes`, `noteFlags`, `EventType`, `eventTypes` from `@eliwhite/scan-chart`. Only define `ChartDocument`, `ChartMetadata`, `DrumNote`, `DrumNoteType`, and `DrumNoteFlags` locally (these are not exported by scan-chart)
2. **Note number mapping** (`lib/drum-transcription/chart-io/note-mapping.ts`) — reference existing `lib/fill-detector/drumLaneMap.ts`
3. **Tick calculation** (`lib/drum-transcription/chart-io/timing.ts`) — `msToTick` (inverse of existing `tickToMs` from `app/sheet-music/[slug]/chartUtils.ts`)
4. **Serialization** (`lib/drum-transcription/chart-io/writer.ts`) — serializeChart and section serializers
5. **Validation** (`lib/drum-transcription/chart-io/validate.ts`) — pre-write validation
6. **Round-trip tests** (`lib/drum-transcription/__tests__/chart-writer.test.ts`) — uses Jest (existing test setup)
7. **Integration** — wire into pipeline: ML output → ChartDocument → .chart text → OPFS via `lib/fileSystemHelpers.ts`

---

## Appendix A: Complete Example .chart Output

A minimal but complete drum chart file:

```
[Song]
{
  Name = "Test Song"
  Artist = "Test Artist"
  Charter = "AutoChart"
  Resolution = 480
  Offset = 0
  Player2 = bass
  Difficulty = 0
  PreviewStart = 0
  PreviewEnd = 0
  MediaType = "cd"
  MusicStream = "song.ogg"
  DrumStream = "drums.ogg"
}
[SyncTrack]
{
  0 = TS 4
  0 = B 120000
}
[Events]
{
  0 = E "section Intro"
  7680 = E "section Verse"
}
[ExpertDrums]
{
  0 = N 0 0
  0 = N 2 0
  0 = N 66 0
  240 = N 2 0
  240 = N 66 0
  480 = N 0 0
  480 = N 2 0
  480 = N 66 0
  720 = N 2 0
  720 = N 66 0
  960 = N 0 0
  960 = N 1 0
  960 = N 4 0
  960 = N 68 0
}
```

This represents a simple rock beat at 120 BPM:
- Beat 1 (tick 0): Kick + hi-hat (cymbal)
- "And" of 1 (tick 240): hi-hat (cymbal)
- Beat 2 (tick 480): Kick + hi-hat (cymbal)
- "And" of 2 (tick 720): hi-hat (cymbal)
- Beat 3 (tick 960): Kick + snare + crash (cymbal)

---

## Appendix B: scan-chart Note Type Mapping Reference

These values are all available via `import { noteTypes, noteFlags, eventTypes } from '@eliwhite/scan-chart'`. Do not redefine them — import and use them directly.

From `scan-chart/src/chart/note-parsing-interfaces.ts`, the `noteTypes` used after parsing:

| scan-chart noteType | Value | Our DrumNoteType |
|---|---|---|
| `kick` | 13 | `'kick'` |
| `redDrum` | 14 | `'red'` |
| `yellowDrum` | 15 | `'yellow'` |
| `blueDrum` | 16 | `'blue'` |
| `greenDrum` | 17 | `'green'` |

And `noteFlags` bitmask values:

| Flag | Value | Our DrumNoteFlags field |
|---|---|---|
| `tom` | 16 | Default (no cymbal flag) |
| `cymbal` | 32 | `flags.cymbal` |
| `doubleKick` | 8 | `flags.doubleKick` |
| `ghost` | 512 | `flags.ghost` |
| `accent` | 1024 | `flags.accent` |

### Chart note number <-> scan-chart event type mapping (drums)

From `chart-parser.ts` `getEventType()`:

| .chart N value | scan-chart eventType | Our DrumNoteType |
|---|---|---|
| 0 | `kick` (17) | `'kick'` |
| 1 | `redDrum` (19) | `'red'` |
| 2 | `yellowDrum` (20) | `'yellow'` |
| 3 | `blueDrum` (21) | `'blue'` |
| 4 | `fiveOrangeFourGreenDrum` (22) | `'green'` |
| 5 | `fiveGreenDrum` (23) | (5-lane only, not used) |
| 32 | `kick2x` (18) | `'kick'` + doubleKick flag |
| 34 | `redAccent` (45) | accent modifier |
| 35 | `yellowAccent` (46) | accent modifier |
| 36 | `blueAccent` (47) | accent modifier |
| 37 | `fiveOrangeFourGreenAccent` (48) | accent modifier |
| 40 | `redGhost` (39) | ghost modifier |
| 41 | `yellowGhost` (40) | ghost modifier |
| 42 | `blueGhost` (41) | ghost modifier |
| 43 | `fiveOrangeFourGreenGhost` (42) | ghost modifier |
| 66 | `yellowCymbalMarker` (36) | cymbal modifier |
| 67 | `blueCymbalMarker` (37) | cymbal modifier |
| 68 | `greenCymbalMarker` (38) | cymbal modifier |
