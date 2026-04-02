# chart-edit

Read, create, modify, and write Clone Hero chart files (`.chart` and `.mid`) entirely in TypeScript. Wraps [`@eliwhite/scan-chart`](https://github.com/eliwhite/scan-chart) for parsing and provides a higher-level `ChartDocument` model with helpers for in-place editing.

## Core Concepts

A **`ChartDocument`** is the central data structure. It extends scan-chart's `RawChartData` with:

- **`metadata`** — song.ini fields (name, artist, BPM settings, difficulty ratings, etc.)
- **`originalFormat`** — `'chart'` or `'mid'`, determines which format is written back
- **`assets`** — pass-through files (audio, album art, video) that aren't parsed but are included in output

A **`FileEntry`** is `{ fileName: string; data: Uint8Array }` — the I/O primitive used for both reading and writing.

## Quick Start

### Reading an existing chart

Pass an array of `FileEntry` objects (e.g. from a ZIP, folder, or SNG file) to `readChart()`. It finds `notes.chart` or `notes.mid`, parses `song.ini` for metadata, and classifies remaining files as assets.

```ts
import { readChart } from '@/lib/chart-edit';

// files: FileEntry[] — e.g. from unzipping a chart archive
const doc = readChart(files);

console.log(doc.metadata.name);        // "Through the Fire and Flames"
console.log(doc.metadata.artist);      // "DragonForce"
console.log(doc.originalFormat);       // "chart" or "mid"
console.log(doc.chartTicksPerBeat);    // 192 (resolution)
console.log(doc.tempos);               // [{ tick: 0, beatsPerMinute: 200 }, ...]
console.log(doc.timeSignatures);       // [{ tick: 0, numerator: 4, denominator: 4 }]
console.log(doc.sections);             // [{ tick: 0, name: "Intro" }, ...]
console.log(doc.trackData.length);     // number of instrument/difficulty tracks
console.log(doc.assets.map(a => a.fileName)); // ["song.ogg", "album.png", ...]
```

### Creating a chart from scratch

Use `createChart()` to get a minimal valid `ChartDocument`, then populate it with helpers.

```ts
import {
  createChart,
  addTempo,
  addTimeSignature,
  addSection,
  addDrumNote,
  addStarPower,
  writeChart,
} from '@/lib/chart-edit';
import { instruments, difficulties } from '@/lib/chart-edit';
import type { TrackData } from '@/lib/chart-edit';

// Create a chart at 150 BPM, 4/4 time, 480 ticks per beat
const doc = createChart({
  format: 'chart',
  resolution: 480,
  bpm: 150,
  timeSignature: { numerator: 4, denominator: 4 },
});

// Set metadata
doc.metadata.name = 'My Song';
doc.metadata.artist = 'My Band';
doc.metadata.charter = 'Me';

// Add a tempo change at beat 32
addTempo(doc, 480 * 32, 180);

// Add a time signature change (3/4) at beat 64
addTimeSignature(doc, 480 * 64, 3, 4);

// Add section markers
addSection(doc, 0, 'Intro');
addSection(doc, 480 * 32, 'Verse 1');
```

### Writing a chart to files

`writeChart()` returns a `FileEntry[]` — the chart file, `song.ini`, and all assets.

```ts
import { writeChart } from '@/lib/chart-edit';

const files = writeChart(doc);
// files = [
//   { fileName: 'notes.chart', data: Uint8Array },  // or notes.mid
//   { fileName: 'song.ini',    data: Uint8Array },
//   { fileName: 'song.ogg',    data: Uint8Array },   // pass-through assets
//   ...
// ]

// Write to disk, ZIP, OPFS, etc.
for (const file of files) {
  console.log(file.fileName, file.data.byteLength);
}
```

### Round-trip: read, modify, write

```ts
import { readChart, writeChart, addSection } from '@/lib/chart-edit';

const doc = readChart(originalFiles);
doc.metadata.charter = 'Updated by chart-edit';
addSection(doc, 0, 'New Intro');
const outputFiles = writeChart(doc);
```

## Working with Tracks

Each `doc.trackData` entry represents one instrument + difficulty combination. Tracks contain `trackEvents` (raw note/modifier events), plus section arrays for star power, solos, etc.

```ts
import { instruments, difficulties } from '@/lib/chart-edit';
import type { TrackData } from '@/lib/chart-edit';

// Find the Expert Drums track
const expertDrums = doc.trackData.find(
  (t) => t.instrument === instruments.drums && t.difficulty === difficulties.expert,
);

// Create a new track and add it
const newTrack: TrackData = {
  instrument: instruments.drums,
  difficulty: difficulties.expert,
  trackEvents: [],
  starPowerSections: [],
  soloSections: [],
  drumFreestyleSections: [],
  flexLanes: [],
};
doc.trackData.push(newTrack);
```

## Drum Note Helpers

The drum helpers translate between friendly `DrumNote` objects and raw `trackEvents`. All mutations are in-place on the track.

### Adding notes

```ts
import { addDrumNote } from '@/lib/chart-edit';

// Add a kick at tick 0
addDrumNote(track, { tick: 0, type: 'kick' });

// Add a snare (red) at tick 480
addDrumNote(track, { tick: 480, type: 'redDrum' });

// Add a hi-hat cymbal (yellow + cymbal flag) at tick 480
addDrumNote(track, { tick: 480, type: 'yellowDrum', flags: { cymbal: true } });

// Add a ghost note with a flam
addDrumNote(track, {
  tick: 960,
  type: 'blueDrum',
  flags: { ghost: true, flam: true },
});

// Add a double kick
addDrumNote(track, { tick: 1440, type: 'kick', flags: { doubleKick: true } });

// Add an accented crash cymbal
addDrumNote(track, {
  tick: 1920,
  type: 'greenDrum',
  flags: { cymbal: true, accent: true },
});
```

### DrumNoteType values

| Type | Instrument |
|------|-----------|
| `'kick'` | Bass drum |
| `'redDrum'` | Snare |
| `'yellowDrum'` | Hi-hat / Yellow cymbal (use `cymbal` flag) |
| `'blueDrum'` | Rack tom / Blue cymbal (use `cymbal` flag) |
| `'greenDrum'` | Floor tom / Green cymbal (use `cymbal` flag) |
| `'fiveGreenDrum'` | 5-lane green (rare) |

### DrumNoteFlags

| Flag | Applies to | Effect |
|------|-----------|--------|
| `cymbal` | yellow, blue, green | `true` = cymbal, `false` = tom |
| `doubleKick` | kick only | Marks as 2x bass pedal |
| `accent` | all except kick | Louder hit |
| `ghost` | all except kick | Softer hit |
| `flam` | all | Double-stroke (shared across all notes at the same tick) |

### Removing notes

```ts
import { removeDrumNote } from '@/lib/chart-edit';

// Remove the kick at tick 0
removeDrumNote(track, 0, 'kick');
```

This removes the base note event and all its modifier events. If no other base drum note remains at the tick, the shared `forceFlam` event is also removed.

### Reading notes

```ts
import { getDrumNotes } from '@/lib/chart-edit';

const notes = getDrumNotes(track);
// Returns DrumNote[] sorted by tick:
// [
//   { tick: 0, length: 0, type: 'kick', flags: {} },
//   { tick: 480, length: 0, type: 'redDrum', flags: {} },
//   { tick: 480, length: 0, type: 'yellowDrum', flags: { cymbal: true } },
//   ...
// ]
```

### Modifying flags on existing notes

```ts
import { setDrumNoteFlags } from '@/lib/chart-edit';

// Make an existing yellow drum into a cymbal with accent
setDrumNoteFlags(track, 480, 'yellowDrum', { cymbal: true, accent: true });
```

This removes all existing modifiers for the note type at that tick, then adds new ones. Throws if no base note exists at the tick.

## Track Section Helpers

Manage star power, activation lanes, solo sections, and flex lanes on a track. All operate in-place.

```ts
import {
  addStarPower,
  removeStarPower,
  addActivationLane,
  removeActivationLane,
  addSoloSection,
  removeSoloSection,
  addFlexLane,
  removeFlexLane,
} from '@/lib/chart-edit';

// Star power: tick + length (in ticks)
addStarPower(track, 0, 960);
removeStarPower(track, 0);

// Activation lanes (drum freestyle, non-coda)
addActivationLane(track, 1920, 480);
removeActivationLane(track, 1920);

// Solo sections
addSoloSection(track, 3840, 1920);
removeSoloSection(track, 3840);

// Flex lanes (single or double)
addFlexLane(track, 0, 960, false);   // single
addFlexLane(track, 960, 480, true);  // double
removeFlexLane(track, 0);
```

All `add*` functions replace any existing section at the same tick.

## Tempo & Time Signature Helpers

These operate on the `ChartDocument` directly (not on a track).

```ts
import {
  addTempo,
  removeTempo,
  addTimeSignature,
  removeTimeSignature,
} from '@/lib/chart-edit';

addTempo(doc, 0, 120);           // Set initial tempo to 120 BPM
addTempo(doc, 480 * 16, 140);   // Tempo change at beat 16
removeTempo(doc, 480 * 16);     // Remove it (cannot remove tick 0)

addTimeSignature(doc, 0, 4, 4);         // 4/4 time
addTimeSignature(doc, 480 * 32, 3, 4);  // Change to 3/4 at beat 32
removeTimeSignature(doc, 480 * 32);     // Remove it (cannot remove tick 0)
```

## Section Marker Helpers

Named section markers (e.g. "Verse 1", "Chorus") are stored on the document.

```ts
import { addSection, removeSection } from '@/lib/chart-edit';

addSection(doc, 0, 'Intro');
addSection(doc, 480 * 16, 'Verse 1');
addSection(doc, 480 * 48, 'Chorus');
removeSection(doc, 480 * 16);
```

## Format Details

- **`.chart` format**: Text-based, Windows line endings (`\r\n`). Supports all instruments (guitar, bass, drums, keys, GHL).
- **`.mid` format**: Standard MIDI with Clone Hero conventions. Requires `song.ini` for chart modifiers.
- **`song.ini`**: INI file with `[song]` section. Unknown fields are preserved through round-trips via `extraIniFields`.

The `originalFormat` field on `ChartDocument` determines which format `writeChart()` produces. Cross-format conversion (e.g. MIDI tom markers → .chart cymbal markers) is handled automatically.

## API Reference

### Core Functions

| Function | Input | Output | Description |
|----------|-------|--------|-------------|
| `readChart(files)` | `FileEntry[]` | `ChartDocument` | Parse chart + ini + assets into a document |
| `createChart(options?)` | options object | `ChartDocument` | Create a minimal empty document |
| `writeChart(doc)` | `ChartDocument` | `FileEntry[]` | Serialize document to files |

### Drum Note Functions

| Function | Description |
|----------|-------------|
| `addDrumNote(track, note)` | Add a drum note with optional flags |
| `removeDrumNote(track, tick, type)` | Remove a note and all its modifiers |
| `getDrumNotes(track)` | Read all notes as `DrumNote[]` |
| `setDrumNoteFlags(track, tick, type, flags)` | Replace modifiers on an existing note |

### Track Section Functions

| Function | Description |
|----------|-------------|
| `addStarPower(track, tick, length)` | Add/replace star power section |
| `removeStarPower(track, tick)` | Remove star power at tick |
| `addActivationLane(track, tick, length)` | Add/replace activation lane |
| `removeActivationLane(track, tick)` | Remove activation lane at tick |
| `addSoloSection(track, tick, length)` | Add/replace solo section |
| `removeSoloSection(track, tick)` | Remove solo section at tick |
| `addFlexLane(track, tick, length, isDouble)` | Add/replace flex lane |
| `removeFlexLane(track, tick)` | Remove flex lane at tick |

### Tempo & Section Functions

| Function | Description |
|----------|-------------|
| `addTempo(doc, tick, bpm)` | Add/replace tempo marker |
| `removeTempo(doc, tick)` | Remove tempo (not tick 0) |
| `addTimeSignature(doc, tick, num, denom)` | Add/replace time signature |
| `removeTimeSignature(doc, tick)` | Remove time signature (not tick 0) |
| `addSection(doc, tick, name)` | Add/replace named section marker |
| `removeSection(doc, tick)` | Remove section marker |
