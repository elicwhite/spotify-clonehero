# chart-edit

Thin wrapper around [`@eliwhite/scan-chart`](https://www.npmjs.com/package/@eliwhite/scan-chart) that adds a single convenience (`readChart`) and a handful of drum / tempo / section editing helpers on top of scan-chart's normalized `ParsedChart` / `ChartDocument` types.

All parsing **and writing** live in scan-chart. This library exists to:

1. Offer `readChart(files)` — parse a folder's files into a `ChartDocument` in one call (wraps `parseChartAndIni` + asset classification).
2. Expose mutation helpers (`addDrumNote`, `addSection`, `addTempo`, etc.) that operate on the normalized data in place.
3. Re-export the scan-chart types and constants consumers use (`ParsedChart`, `File`, `noteTypes`, `noteFlags`, ...).

## Core types (from scan-chart)

- **`ChartDocument`** — `{ parsedChart: ParsedChart; assets: File[] }`. Metadata lives on `parsedChart.metadata`; chart format lives on `parsedChart.format`.
- **`ParsedChart`** — normalized chart data: resolution, tempos, timeSignatures, sections, trackData, vocalTracks, etc.
- **`File`** — `{ fileName: string; data: Uint8Array }`.

## Quick start

```ts
import {
  readChart,
  writeChartFolder,
  createEmptyChart,
  addDrumNote,
  addSection,
} from '@/lib/chart-edit';

// Read an existing chart folder
const doc = readChart(files); // File[]
console.log(doc.parsedChart.metadata.name);
console.log(doc.parsedChart.format); // 'chart' | 'mid'

// Mutate a drum track in place
const expert = doc.parsedChart.trackData.find(
  t => t.instrument === 'drums' && t.difficulty === 'expert',
);
if (expert) addDrumNote(expert, {tick: 960, type: 'redDrum'});
addSection(doc, 1920, 'Verse 1');

// Serialize back to files (notes.chart/notes.mid + song.ini + assets)
const outFiles = writeChartFolder(doc);

// Or build a chart from scratch
const empty = createEmptyChart({format: 'chart', bpm: 120, resolution: 480});
```

## What lives here

- `helpers/drum-notes.ts` — `addDrumNote`, `removeDrumNote`, `getDrumNotes`, `setDrumNoteFlags`
- `helpers/drum-sections.ts` — star power, activation lanes, solo sections, flex lanes
- `helpers/tempo.ts` — `addTempo` / `removeTempo`, `addTimeSignature` / `removeTimeSignature`
- `helpers/sections.ts` — named section markers (globalEvent "section X")
- `types.ts` — the `DrumNote` / `DrumNoteType` / `DrumNoteFlags` surface and `drumNoteTypeMap` / `noteTypeToDrumNote` constants; re-exports scan-chart types

All helpers accept either a `ChartDocument` (for global edits like tempo) or a `ParsedTrackData` (for per-track edits).

## What doesn't live here anymore

- `.chart` / `.mid` serializers — in scan-chart (`writeChartFolder`)
- Chart reader — in scan-chart (`parseChartAndIni`)
- Empty-chart scaffolding — in scan-chart (`createEmptyChart`)
- Spec docs — the upstream scan-chart types and docs are authoritative
