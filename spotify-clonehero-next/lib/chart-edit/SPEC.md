# chart-edit Library Specification

## 1. Purpose

A TypeScript library for reading, modifying, and writing Clone Hero chart files. Designed as the data layer for a web-based chart editor (browser Moonscraper). The library handles:

- **Reading** `.chart` and `.mid` files into an editable in-memory model
- **Modifying** chart data via direct mutation of plain objects + ergonomic helper functions
- **Writing** the modified chart back to its original format (`.chart` or `.mid`)
- **Outputting** `{ fileName, data }[]` — the same shape the consumer provides

The library is framework-agnostic (no React dependency), manages no UI state, and does not implement undo/redo — those concerns belong to the consuming editor application.

### Scope

**v1: Drums only.** All 10 instruments will be supported in future versions, but v1 focuses on drum tracks (4-lane, 4-lane pro, 5-lane).

### Constraints

- **Browser-compatible.** No Node.js-specific APIs (Buffer, fs, path). Uses Uint8Array, DataView, Web APIs.
- **No side effects.** All functions are pure transforms (input → output). No global state, no singletons.
- **Reuse project utilities.** Import shared helpers from `lib/src-shared/utils.ts` and other project files where applicable. When this library is eventually extracted to its own npm package, these will be vendored in.

### Non-goals

- **Packaging.** No zip or sng output. The library outputs `{ fileName, data }[]`. Packaging into zip/sng is the consumer's responsibility.
- **SNG parsing.** Consumer unpacks `.sng` files before passing to this library.
- Undo/redo (consumer responsibility)
- UI state management (selection, cursor, playback position)
- Audio processing (decoding, mixing, effects)
- Chart quality validation beyond format requirements (use scan-chart for that)
- Real-time rendering (consumer uses CloneHeroRenderer separately)

---

## 2. Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Data model | Extend scan-chart's `RawChartData` | Tick-based, close to raw format, no lossy normalization. Reuse scan-chart's types directly — don't duplicate. |
| Consumer DX | Friendly helper functions over raw storage | Helpers handle modifier pairing (e.g., cymbal markers), grouping, and queries. Raw `trackEvents` still accessible. |
| Parsing | Export raw parsers from scan-chart via patch-package | `parseNotesFromChart()` and `parseNotesFromMidi()` exported via patch. Avoids duplicating parser code. |
| MIDI writing | Functionally equivalent rebuild | Rebuild MIDI from internal model. Binary won't be identical to input but plays identically in-game. |
| Metadata | song.ini is source of truth | Always write song.ini. `.chart` `[Song]` section only contains format-required fields (Resolution, Offset, audio stream refs). |
| Validation | Format requirements only in serializer | Sort events by tick, deduplicate. No auto-fix of quality issues. Use scan-chart for quality validation. |
| I/O shape | `{ fileName, data }[]` in and out | Same as scan-chart. Library does not handle zip/sng packaging. |
| scan-chart modification | patch-package | Already installed. Patch `@eliwhite/scan-chart` to export raw parsers. |
| Test fixtures | Real charts from `/Users/eliwhite/Desktop/enchor-songs copy` + inline | Change copyrighted metadata. Don't commit audio files or album art — use dummy files. |

---

## 3. Data Model

### ChartDocument

Extends scan-chart's `RawChartData` with fields needed for write-back and metadata.

```typescript
import { RawChartData } from '@eliwhite/scan-chart';

interface ChartDocument extends RawChartData {
  /** Song metadata (source of truth for song.ini output). */
  metadata: ChartMetadata;
  /** Original file format — determines write-back format. */
  originalFormat: 'chart' | 'mid';
  /** Pass-through files not managed by the library (audio, album art, video). */
  assets: FileEntry[];
}
```

This spreads all of `RawChartData`'s fields directly onto ChartDocument:
- `chartTicksPerBeat: number`
- `hasLyrics: boolean`
- `hasVocals: boolean`
- `lyrics: { tick, length, text }[]`
- `vocalPhrases: { tick, length }[]`
- `tempos: { tick, beatsPerMinute }[]`
- `timeSignatures: { tick, numerator, denominator }[]`
- `sections: { tick, name }[]`
- `endEvents: { tick }[]`
- `trackData: TrackData[]` — where TrackData includes `instrument`, `difficulty`, `starPowerSections`, `soloSections`, `flexLanes`, `drumFreestyleSections`, `trackEvents`

Note: `RawChartData` has its own `metadata` field (a small subset: name, artist, album, genre, year, charter, diff_guitar, delay, preview_start_time). `ChartDocument.metadata` overrides this with the full `ChartMetadata` type. The RawChartData metadata is only used during parsing; ChartDocument's `metadata` is the source of truth.

### ChartMetadata

Full song.ini field set. All fields optional.

```typescript
interface ChartMetadata {
  name?: string;
  artist?: string;
  album?: string;
  genre?: string;
  year?: string;
  charter?: string;
  song_length?: number;
  diff_band?: number;
  diff_guitar?: number;
  diff_guitar_coop?: number;
  diff_rhythm?: number;
  diff_bass?: number;
  diff_drums?: number;
  diff_drums_real?: number;
  diff_keys?: number;
  diff_guitarghl?: number;
  diff_guitar_coop_ghl?: number;
  diff_rhythm_ghl?: number;
  diff_bassghl?: number;
  diff_vocals?: number;
  preview_start_time?: number;
  icon?: string;
  loading_phrase?: string;
  album_track?: number;
  playlist_track?: number;
  modchart?: boolean;
  delay?: number;
  hopo_frequency?: number;
  eighthnote_hopo?: boolean;
  multiplier_note?: number;
  sustain_cutoff_threshold?: number;
  chord_snap_threshold?: number;
  video_start_time?: number;
  five_lane_drums?: boolean;
  pro_drums?: boolean;
  end_events?: boolean;
}
```

### FileEntry

```typescript
interface FileEntry {
  fileName: string;
  data: Uint8Array;
}
```

### Why extend RawChartData?

- **No lossy normalization.** RawChartData preserves tick-based positioning, separate modifier events, and format-specific details. Unlike ParsedChart, it doesn't apply chord snapping, sustain trimming, or ms-time computation.
- **Bidirectional.** The shape maps directly to both .chart and .mid formats, making serialization straightforward.
- **scan-chart compatible.** Tests can round-trip through scan-chart's `parseChartFile()` to validate output.
- **Partially normalized.** scan-chart's raw parsers already do useful normalization (e.g., MIDI per-range force markers → per-note modifier events) without losing information.
- **No type duplication.** All of scan-chart's types (`EventType`, `eventTypes`, `Instrument`, `Difficulty`, `RawChartData`, `NoteEvent`, `noteTypes`, `noteFlags`, etc.) are reused directly.

---

## 4. Public API

### Core Functions

```typescript
/** Read chart files into an editable document. */
function readChart(files: FileEntry[]): ChartDocument;

/** Create a new empty chart document. */
function createChart(options?: {
  format?: 'chart' | 'mid';      // default: 'mid'
  resolution?: number;            // default: 480
  bpm?: number;                   // default: 120
  timeSignature?: { numerator: number; denominator: number }; // default: 4/4
}): ChartDocument;

/** Serialize document to output files (chart file + song.ini + pass-through assets). */
function writeChart(doc: ChartDocument): FileEntry[];
```

### readChart Behavior

1. Identify chart file from `files` array using `hasChartName()` from `lib/src-shared/utils.ts`.
   - If both `notes.chart` and `notes.mid` exist, prefer `notes.chart` (same as scan-chart).
   - If neither exists, throw an error.
2. Detect format from extension using `getExtension()` from `lib/src-shared/utils.ts`.
3. Parse `song.ini` (if present, detected via `hasIniName()`) to extract `ChartMetadata` and `IniChartModifiers`.
4. Call scan-chart's raw parser (`parseNotesFromChart` or `parseNotesFromMidi`) to get `RawChartData`.
5. Merge RawChartData fields + parsed metadata + format info + remaining files as assets into `ChartDocument`.
6. Classify remaining files as assets based on `hasAudioName()`, `hasVideoName()`, or image extensions. These are stored as-is for pass-through.

### writeChart Behavior

1. Serialize track data, tempos, time signatures, sections, and events to the original format:
   - `.chart` → text-based .chart file
   - `.mid` → binary MIDI file
2. Serialize metadata to `song.ini`.
3. Return array containing: chart file, song.ini, and all pass-through assets.
4. Serializer enforces format requirements:
   - Events sorted by tick
   - No exact duplicate events (same tick + same type)
   - Does NOT auto-fix missing tempo at tick 0, short sustains, or other quality issues

### Audio File References

When writing `.chart` format, the `[Song]` section includes audio stream references based on asset filenames. Uses `getBasename()` from `lib/src-shared/utils.ts` to detect stem names:

| Asset basename | .chart field |
|---|---|
| `song` | `MusicStream` |
| `guitar` | `GuitarStream` |
| `bass` | `BassStream` |
| `rhythm` | `RhythmStream` |
| `vocals` | `VocalStream` |
| `drums` | `DrumStream` |
| `drums_1` | `Drum2Stream` |
| `drums_2` | `Drum3Stream` |
| `drums_3` | `Drum4Stream` |
| `keys` | `KeysStream` |
| `crowd` | `CrowdStream` |

### createChart Behavior

Returns a minimal valid `ChartDocument` with:
- One tempo event (default 120 BPM) at tick 0
- One time signature (default 4/4) at tick 0
- Empty trackData, sections, lyrics, etc.
- `originalFormat` per options (default `'mid'`)
- Empty metadata and assets

---

## 5. Drum Helper Functions

Helpers operate on `TrackData` objects (scan-chart's type), translating between friendly drum types and raw `trackEvents`. They mutate the `trackEvents` array in-place.

### Types

```typescript
type DrumNoteType = 'kick' | 'redDrum' | 'yellowDrum' | 'blueDrum' |
                    'greenDrum' | 'fiveGreenDrum';

interface DrumNoteFlags {
  cymbal?: boolean;      // yellow/blue/green only (4-lane pro)
  doubleKick?: boolean;  // kick only (Expert+)
  accent?: boolean;
  ghost?: boolean;
  flam?: boolean;
}

/** Friendly view of a drum note, returned by getDrumNotes(). */
interface DrumNote {
  tick: number;
  length: number;
  type: DrumNoteType;
  flags: DrumNoteFlags;
}
```

### Functions

```typescript
/** Add a drum note to a track. Handles modifier event pairing internally. */
function addDrumNote(track: TrackData, note: {
  tick: number;
  type: DrumNoteType;
  length?: number;   // default: 0
  flags?: DrumNoteFlags;
}): void;

/** Remove a drum note (and its modifiers) from a track. */
function removeDrumNote(track: TrackData, tick: number, type: DrumNoteType): void;

/** Get all drum notes as friendly DrumNote objects (grouped with modifiers). */
function getDrumNotes(track: TrackData): DrumNote[];

/** Update flags on an existing drum note. */
function setDrumNoteFlags(track: TrackData, tick: number, type: DrumNoteType, flags: DrumNoteFlags): void;

/** Add a star power section. */
function addStarPower(track: TrackData, tick: number, length: number): void;

/** Remove a star power section by tick. */
function removeStarPower(track: TrackData, tick: number): void;

/** Add a drum activation lane (freestyle section). */
function addActivationLane(track: TrackData, tick: number, length: number): void;

/** Remove a drum activation lane by tick. */
function removeActivationLane(track: TrackData, tick: number): void;

/** Add a solo section. */
function addSoloSection(track: TrackData, tick: number, length: number): void;

/** Remove a solo section by tick. */
function removeSoloSection(track: TrackData, tick: number): void;

/** Add a flex lane (roll). */
function addFlexLane(track: TrackData, tick: number, length: number, isDouble: boolean): void;

/** Remove a flex lane by tick. */
function removeFlexLane(track: TrackData, tick: number): void;
```

### DrumNoteType → EventType Mapping

Uses scan-chart's `eventTypes` constants directly:

| DrumNoteType | EventType constant | Integer | .chart note# | MIDI note (Expert) |
|---|---|---|---|---|
| `kick` | `eventTypes.kick` | 17 | 0 | 96 |
| `redDrum` | `eventTypes.redDrum` | 19 | 1 | 97 |
| `yellowDrum` | `eventTypes.yellowDrum` | 20 | 2 | 98 |
| `blueDrum` | `eventTypes.blueDrum` | 21 | 3 | 99 |
| `greenDrum` | `eventTypes.fiveOrangeFourGreenDrum` | 22 | 4 | 100 |
| `fiveGreenDrum` | `eventTypes.fiveGreenDrum` | 23 | 5 | 101 |

### Modifier → EventType Mapping

Uses scan-chart's `eventTypes` constants:

| Flag | EventType(s) | Notes |
|---|---|---|
| `cymbal` (yellow) | `eventTypes.yellowCymbalMarker` (36) | .chart: emit marker. MIDI: absence of tom marker. |
| `cymbal` (blue) | `eventTypes.blueCymbalMarker` (37) | Same |
| `cymbal` (green) | `eventTypes.greenCymbalMarker` (38) | Same |
| `doubleKick` | `eventTypes.kick2x` (18) | Separate event at same tick |
| `accent` (red) | `eventTypes.redAccent` (45) | Per-color accent markers |
| `accent` (yellow) | `eventTypes.yellowAccent` (46) | |
| `accent` (blue) | `eventTypes.blueAccent` (47) | |
| `accent` (green) | `eventTypes.fiveOrangeFourGreenAccent` (48) | |
| `ghost` (red) | `eventTypes.redGhost` (39) | Per-color ghost markers |
| `ghost` (yellow) | `eventTypes.yellowGhost` (40) | |
| `ghost` (blue) | `eventTypes.blueGhost` (41) | |
| `ghost` (green) | `eventTypes.fiveOrangeFourGreenGhost` (42) | |
| `flam` | `eventTypes.forceFlam` (32) | Single event at tick |

---

## 6. Serialization

### .chart Writer

Serializes `ChartDocument` to `.chart` text format.

**Sections written:**
1. `[Song]` — Format-required fields: `Resolution`, `Offset` (if non-zero), audio stream references (detected from asset filenames)
2. `[SyncTrack]` — Tempo (`B`) and time signature (`TS`) events, sorted by tick. At same tick: TS before B.
3. `[Events]` — Section markers (`section <name>`) and end events (`end`)
4. `[<Difficulty><Instrument>]` — One section per track (e.g., `[ExpertDrums]`). Contains:
   - `N` (note) events from trackEvents
   - `S 2` (star power) events
   - `S 64` (activation lane) events
   - Solo section markers as local events (`solo` / `soloend`)
   - Flex lanes as `S 65` (single) / `S 66` (double)

**Encoding details:**
- BPM stored as millibeats: `120.5` → `120500`
- Time signature denominator as log2 exponent: `8` → `3` (since 2³=8)
- Notes encode as `<tick> = N <noteNumber> <length>`
- Modifier events (cymbal markers, accents, ghosts, flam, 2x kick) emit as additional `N` events at the same tick
- Windows line endings (`\r\n`), UTF-8

**Format-specific drum handling:**
- 4-lane pro: cymbal notes emit cymbal marker events (66/67/68)
- Double kick: emits both note 0 and note 32
- Accent/ghost: emit per-color modifier notes (34-38 for accent, 40-44 for ghost)

### .mid Writer

Serializes `ChartDocument` to MIDI binary format.

**MIDI structure:**
- Format type 1 (multi-track)
- Resolution from `chartTicksPerBeat`
- Track 0: tempo map (tempo + time signature meta events)
- Track 1: `EVENTS` (section markers as text meta events, end events)
- Track N: `PART DRUMS` (one track for all drum difficulties)

**Drum track encoding:**
- Difficulty note ranges: Expert 96-101, Hard 84-89, Medium 72-77, Easy 60-65
- Expert+ kick: note 95
- Note velocity: 127 for accents, 1 for ghosts, 100 for normal
- Requires `[ENABLE_CHART_DYNAMICS]` text event if accents or ghosts are present
- Tom markers (MIDI notes 110-112): emit as range notes spanning the notes they modify
  - Note 110 = green tom marker, 111 = blue, 112 = yellow
  - In MIDI, cymbals are DEFAULT. Tom markers indicate toms. (Opposite of .chart.)
- Star power: note 116
- Solo: note 103
- Flex lanes: note 126 (single), 127 (double)
- Flam: note 109
- Delta-time encoding for all events

**Dependencies:** `midi-file` npm package for MIDI binary encoding.

### song.ini Writer

Serializes `ChartMetadata` to song.ini format.

```ini
[Song]
name = Song Name
artist = Artist Name
album = Album Name
...
```

- Only writes fields that have values (skip undefined/null)
- No quoting of values
- Standard field ordering (name, artist, album, genre, year, charter, then others)

---

## 7. scan-chart Integration

### Patch via patch-package

Add exports to scan-chart's `src/index.ts` via patch-package (already installed in project):

```typescript
export { parseNotesFromChart } from './chart/chart-parser'
export { parseNotesFromMidi } from './chart/midi-parser'
```

These functions already exist and are already exported from their source files — they're just not re-exported from the package entry point.

### Types Reused from scan-chart

All of these are imported directly — no duplication:

- `RawChartData` — Base type for ChartDocument (extended via `extends`)
- `EventType`, `eventTypes` — Note and modifier type constants
- `Instrument`, `Difficulty` — Enum types for track identification
- `IniChartModifiers`, `defaultIniChartModifiers` — Modifier config for MIDI parsing
- `NoteEvent`, `NoteType`, `noteTypes`, `noteFlags` — For test validation (ParsedChart output)
- `DrumType`, `drumTypes` — Drum track type identification

### How scan-chart is Used

| Use case | scan-chart function | When |
|----------|-------------------|------|
| Parse .chart input | `parseNotesFromChart()` | `readChart()` |
| Parse .mid input | `parseNotesFromMidi()` | `readChart()` |
| Validate output (tests) | `parseChartFile()` | Test assertions — round-trip verification |
| Quality validation (consumer) | `scanChartFolder()` | Consumer's choice, not in library |

### Utilities Reused from Project

| Utility | Source | Used for |
|---------|--------|----------|
| `getExtension()` | `lib/src-shared/utils.ts` | Detect file format from extension |
| `getBasename()` | `lib/src-shared/utils.ts` | Detect audio stem names for .chart stream references |
| `hasChartName()` | `lib/src-shared/utils.ts` | Identify chart files in input |
| `hasAudioName()` | `lib/src-shared/utils.ts` | Classify audio assets |
| `hasIniName()` | `lib/src-shared/utils.ts` | Identify song.ini in input |
| `hasVideoName()` | `lib/src-shared/utils.ts` | Classify video assets |

---

## 8. Testing Strategy

### Approach

All tests operate at the public API boundary. No tests for internal implementation details. Tests validate behavior by round-tripping through scan-chart:

```
create/read → modify → writeChart → parseChartFile (scan-chart) → assert
```

### Test Fixtures

**Real charts** from `/Users/eliwhite/Desktop/enchor-songs copy/`:
- Copy `notes.chart` and `notes.mid` files as fixtures
- Change copyrighted metadata (song name, artist) to generic values
- Do NOT copy audio files or album art — create small dummy files instead
- Select charts that cover: basic drums, pro drums with cymbals, multi-tempo, star power, .mid format

**Inline tests** for focused unit testing:
- Create chart → add single note → write → parse → verify
- Create chart → add note with each flag type → write → parse → verify flags
- Modifier pairing: addDrumNote with cymbal → verify correct raw events
- getDrumNotes → verify grouping and flag resolution

### Test Categories

1. **Round-trip identity tests**: Load fixture → no edits → write → parse → compare with original parse
2. **Drum helper tests**: addDrumNote, removeDrumNote, getDrumNotes, setDrumNoteFlags
3. **Chart writer tests**: .chart format-specific (BPM encoding, note emission, section formatting)
4. **MIDI writer tests**: MIDI structure, track names, note ranges, tom marker emission, delta-time
5. **Cross-format tests**: Load .chart → change format to .mid → write → parse → compare notes
6. **Metadata tests**: Set metadata → write → verify song.ini content
7. **createChart tests**: Verify defaults, custom options
8. **Asset pass-through tests**: Include dummy audio files → verify they appear unchanged in output

---

## 9. Directory Structure

```
lib/chart-edit/
  SPEC.md               # This specification
  index.ts              # Public API exports
  types.ts              # ChartDocument, ChartMetadata, DrumNote, FileEntry
  reader.ts             # readChart()
  create.ts             # createChart()
  writer.ts             # writeChart() — dispatches to format-specific writers
  writer-chart.ts       # .chart text serializer
  writer-mid.ts         # .mid binary serializer
  writer-ini.ts         # song.ini serializer
  helpers/
    drum-notes.ts       # addDrumNote, removeDrumNote, getDrumNotes, setDrumNoteFlags
    drum-sections.ts    # addStarPower, addActivationLane, addSoloSection, addFlexLane + removes
    tempo.ts            # addTempo, removeTempo, addTimeSignature, removeTimeSignature
    sections.ts         # addSection, removeSection
  __tests__/
    fixtures/           # Hand-crafted .chart and .mid files (from real charts, metadata changed)
    read-write.test.ts  # Core round-trip tests
    drum-helpers.test.ts # Drum helper function tests
    chart-writer.test.ts # .chart format-specific tests
    mid-writer.test.ts   # .mid format-specific tests
    create.test.ts       # createChart() tests
```

---

## 10. Dependencies

| Package | Purpose | Status |
|---------|---------|--------|
| `@eliwhite/scan-chart` | Raw parsing, types, test validation | Installed; needs patch-package to export raw parsers |
| `midi-file` | MIDI binary encoding for .mid writer | Needs to be added |
| `patch-package` | Patch scan-chart exports | Installed |

### Project Utilities (imported, not npm)

- `lib/src-shared/utils.ts` — File classification helpers

---

## 11. Code Reuse from Early Implementation

Reference and adapt from existing code:

| Source | What to reuse |
|--------|---------------|
| `lib/drum-transcription/chart-io/writer.ts` | .chart serialization logic (BPM encoding, note emission, section formatting) |
| `lib/drum-transcription/chart-io/song-ini.ts` | song.ini serialization approach |
| `lib/drum-transcription/chart-io/note-mapping.ts` | DrumNoteType ↔ EventType mapping patterns |
| `lib/drum-transcription/chart-io/validate.ts` | Reference for what format requirements the serializer should enforce |

After chart-edit is complete, the drum-transcription code should be updated to import from chart-edit instead of its own chart-io/ directory.

---

## 12. Edge Cases & Format Gotchas

### Cymbal/Tom Inversion Between Formats

- **`.chart`**: Toms are default. Cymbal markers (66/67/68) indicate cymbals.
- **`.mid`**: Cymbals are default. Tom markers (110/111/112) indicate toms.

scan-chart's raw parsers normalize this: `.chart` parser emits `yellowCymbalMarker` etc., `.mid` parser emits `yellowTomMarker` etc. Both stored in `trackEvents`.

**Writers must reverse correctly:**
- `.chart` writer: emit cymbal marker events for cymbal notes
- `.mid` writer: emit tom marker notes for notes that are NOT cymbals (since cymbals are default in MIDI)

### Sustain Cutoff in MIDI

MIDI sustains shorter than 1/12th step are cut by scan-chart during *normalized* parsing. Since we use the *raw* parser, sustains are preserved as-is.

### Empty or Missing Fields

- Missing `song.ini`: `readChart()` succeeds with empty metadata. `writeChart()` still produces a song.ini.
- Missing BPM at tick 0: Preserved as-is. Not auto-fixed.
- Missing time signature at tick 0: Preserved as-is.
- Empty tracks (no notes): Included in output.

### Both notes.chart and notes.mid Present

`readChart()` uses `notes.chart` (matching scan-chart). `notes.mid` is treated as an asset and passed through.

---

## 13. Future Work

### Other Instruments (v2+)

The data model already supports all instruments via RawChartData's `trackData` and scan-chart's `Instrument` type. Future work:

- 5-fret guitar helpers (HOPO, tap, forced, open flags)
- 6-fret GHL helpers
- Keys helpers
- .chart/.mid writer extensions for guitar/GHL/keys tracks

### Additional Features

- Resolution resampling (change chartTicksPerBeat, rescale all ticks)
- Batch operations (cut/copy/paste tick ranges)
- Quantize notes to grid
- Difficulty auto-generation (copy Expert down with simplification)
