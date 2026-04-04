# Plan 0028: Move chart document parsing into scan-chart

## Context

chart-edit currently fills a gap between scan-chart's raw parsers and what consumers need:
- Raw parsers (`parseNotesFromChart`, `parseNotesFromMidi`) produce `RawChartData` with 9-field metadata — they parse a single file with no INI awareness.
- chart-edit's `readChart()` adds file discovery, INI parsing, metadata merging, asset classification, and produces `ChartDocument` — which is just `RawChartData` with richer metadata + `originalFormat` + `assets`.

This gap causes problems:
- **5 patches on scan-chart** via patch-package (must patch both `.js` and `.mjs`, fragile)
- **INI parsing duplicated** — scan-chart has `ini-scanner.ts`/`ini-parser.ts`, chart-edit uses `lib/ini-parser` + its own field extraction
- **Metadata type split** — `RawChartData.metadata` (9 fields) vs `ChartMetadata` (30+ fields + `extraIniFields`), connected by `Omit<RawChartData, 'metadata'>`
- **IniChartModifiers round-trip** — chart-edit reads INI → builds modifiers → passes back to scan-chart for MIDI parsing
- **`scanChartFolder` reimplements** file discovery and INI handling that chart-edit also does

## Goal

Move all parsing and metadata logic into scan-chart so it produces a complete `ChartDocument` from a set of files. chart-edit becomes purely a writing + editing library.

## Design

### New layering

```
parseNotesFromChart / parseNotesFromMidi     (unchanged, low-level)
        ↓ RawChartData

parseChartFolder(files: FileEntry[])         (new, in scan-chart)
        ↓ finds chart file, parses INI, merges metadata, classifies assets
        ↓ ChartDocument

scanChartFolder(files)                       (refactored, calls parseChartFolder internally)
        ↓ ScannedChart (hashes, issues, statistics)
```

### Type changes in scan-chart

**Three types currently serve overlapping roles:**

| Type | Role | Fields | Where populated |
|------|------|--------|-----------------|
| `RawChartData.metadata` | Parser **output** — what a single file contains | 9 display fields (name, artist, album, genre, year, charter, diff_guitar, delay, preview_start_time) | .chart parser from `[Song]`; MIDI parser gets almost nothing (just delay via patch) |
| `IniChartModifiers` | Parser **input** — changes how the MIDI parser interprets notes | 8 behavioral fields (hopo_frequency, five_lane_drums, pro_drums, sustain_cutoff_threshold, etc.) | Built from song.ini before MIDI parsing starts |
| `ChartMetadata` (chart-edit) | **Union** of everything from song.ini | 30+ fields: all of the above + display-only fields (diff_drums, icon, loading_phrase, album_track, etc.) + `extraIniFields` | Merged from song.ini + raw parser metadata |

These have **zero overlap** between metadata (output) and modifiers (input). `ChartMetadata` is the superset.

**After refactor:** `RawChartData.metadata` becomes `ChartMetadata`. `IniChartModifiers` stays as a separate type — it's still needed as the input contract for `parseNotesFromMidi`. `parseChartFolder` builds `IniChartModifiers` from `ChartMetadata` internally (step 4 below), just as chart-edit's `reader.ts` does today.

**Expand `RawChartData.metadata`** to the full INI field set. Raw parsers will only populate the fields they can (name, artist, delay, etc. from `.chart` `[Song]`). The rest stay `undefined` until INI merging fills them in.

```typescript
// Before (note-parsing-interfaces.ts)
metadata: {
  name?: string; artist?: string; album?: string; genre?: string;
  year?: string; charter?: string; diff_guitar?: number;
  delay?: number; preview_start_time?: number;
}

// After
metadata: ChartMetadata
```

**Add `ChartMetadata` type to scan-chart** (moved from chart-edit's `types.ts`):
```typescript
export interface ChartMetadata {
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
  extraIniFields?: Record<string, string>;
}
```

**Add passthrough fields to `RawChartData`:**
```typescript
// Added to RawChartData for roundtrip data preservation
chartSongSection?: Array<{ key: string; value: string }>;
unknownMidiTracks?: Array<{ name: string; events: MidiEvent[] }>;
unknownChartSections?: Array<{ name: string; lines: string[] }>;
// modifierSustains already on trackData[] (existing patch)
```

**Add `ChartDocument` type to scan-chart:**
```typescript
export interface ChartDocument extends RawChartData {
  originalFormat: 'chart' | 'mid';
  assets: FileEntry[];
}
```

Note: `RawChartData.metadata` is now `ChartMetadata`, so no `Omit` needed.

**Add `FileEntry` type to scan-chart:**
```typescript
export interface FileEntry {
  fileName: string;
  data: Uint8Array;
}
```

### New function in scan-chart: `parseChartFolder`

Moved from chart-edit's `reader.ts`. Logic:

1. Find chart file (`notes.chart` preferred over `notes.mid`)
2. Determine `originalFormat` from extension
3. Parse `song.ini` if present → full `ChartMetadata` with type conversion and `extraIniFields`
4. Build `IniChartModifiers` from metadata (for MIDI parsing)
5. Call raw parser (`parseNotesFromChart` or `parseNotesFromMidi`)
6. Merge raw parser metadata as fallbacks (INI takes precedence; `delay` always merges)
7. Normalize `delay=0` to `undefined`
8. Classify remaining files as assets (audio, video, images)
9. Return `ChartDocument`

### Refactor `scanChartFolder`

Currently reimplements file discovery and INI parsing. Refactor to:

1. Call `parseChartFolder(files)` to get `ChartDocument`
2. Layer scanning concerns on top: hash calculation, issue detection, metadata validation, album art, audio/video scanning
3. Produce `ScannedChart` from `ChartDocument` + scan results

### INI consolidation

scan-chart currently has two INI-related files:
- `ini/ini-parser.ts` — raw `[section] key=value` parser
- `ini/ini-scanner.ts` — `scanIni()` + `extractSongMetadata()` + `defaultMetadata`

chart-edit currently uses:
- `lib/ini-parser` — separate raw INI parser (used by `reader.ts`)
- `reader.ts` — field extraction with `INI_STRING_FIELDS`, `INI_INT_FIELDS`, etc.

After refactor:
- scan-chart's `ini/ini-parser.ts` stays (raw parser)
- `parseChartFolder` uses scan-chart's INI parser + new field extraction logic (merged from chart-edit's `reader.ts` and scan-chart's `extractSongMetadata()`)
- chart-edit drops its INI parsing — no longer imports `lib/ini-parser`
- `lib/ini-parser` may still be used elsewhere in the project (check before removing)

### Passthrough data preservation

**Problem:** scan-chart currently drops everything it doesn't understand. This makes round-tripping lossy — loading a chart and saving it back can destroy data the user didn't touch. Moonscraper avoids this by storing unrecognized data in passthrough fields that survive round-trip.

scan-chart's parsers must preserve unknown data instead of silently dropping it.

#### Unknown MIDI tracks

MIDI files often contain tracks scan-chart doesn't parse: `PART REAL_GUITAR`, `PART REAL_BASS`, `BEAT`, `VENUE`, practice/animation tracks, etc. Currently these are silently dropped by `getTracks()` which filters to known `trackNames` only. After round-trip, entire MIDI tracks vanish.

**Fix:** In `parseNotesFromMidi`, collect tracks whose names aren't in `trackNames` and store them as raw `MidiEvent[]` arrays on `RawChartData`.

```typescript
// New field on RawChartData
unknownMidiTracks: Array<{
  name: string;
  events: MidiEvent[];  // Raw midi-file events, preserving delta times
}>
```

The MIDI writer emits these tracks verbatim after all known tracks.

#### Unknown .chart sections

.chart files can contain track sections scan-chart doesn't recognize (custom instruments, proprietary Moonscraper sections like `[ExpertVocals]`, etc.). Currently these are dropped by the `_.pick(_.keys(trackNameMap))` filter.

**Fix:** In `parseNotesFromChart`, collect sections whose names aren't in `trackNameMap` or known global sections (`Song`, `SyncTrack`, `Events`) and store them as raw line arrays.

```typescript
// New field on RawChartData
unknownChartSections: Array<{
  name: string;
  lines: string[];  // Raw lines between { and }, preserving original text
}>
```

The .chart writer emits these sections verbatim after all known sections.

#### Raw .chart [Song] section

The .chart `[Song]` section can contain fields scan-chart doesn't parse (Player2, MediaType, CountWarning, etc.). Currently only ~8 fields are extracted; the rest are lost. Even known fields lose their original order.

**Fix:** In `parseNotesFromChart`, capture all `[Song]` key-value pairs in order.

```typescript
// New field on RawChartData
chartSongSection?: Array<{
  key: string;
  value: string;  // Raw value string including quotes if present
}>
```

The .chart writer uses this to reconstruct the `[Song]` section with original field order and unknown fields preserved. Known fields (Resolution, Offset) are updated from the document if they changed.

#### MIDI modifier sustain ranges (existing patch)

Already patched: `modifierSustains` on `trackData[]` preserves original MIDI modifier sustain ranges before `splitMidiModifierSustains` splits them into zero-length per-note events. This enables the MIDI writer to emit sustain-range SysEx instead of per-note SysEx.

This patch gets baked into scan-chart source.

### Patches baked in

All patches from `patches/@eliwhite+scan-chart+7.2.1.patch` get applied directly to scan-chart source:
1. Missing drum note mappings (kickAccent, kickGhost, forceFlam)
2. Track section E events with quotes
3. Solo section length calculation
4. MIDI delay propagation from iniChartModifiers
5. Vocal phrase noteNumber tracking
6. Event deduplication (dedupByTickType, orphaned accent/ghost removal)
7. MIDI track deduplication (uniqBy trackName)
8. Instrument-specific event validation (forceFlam/tom markers restricted to drums)
9. **Modifier sustain preservation** (modifierSustains field on trackData)
10. **Unknown MIDI track preservation** (unknownMidiTracks)
11. **Unknown .chart section preservation** (unknownChartSections)
12. **Raw .chart [Song] section preservation** (chartSongSection)

The patch file is deleted. `postinstall: patch-package` removed (if no other patches remain).

## Changes by package

### scan-chart (~/projects/scan-chart)

| File | Change |
|------|--------|
| `src/chart/note-parsing-interfaces.ts` | Add `ChartMetadata`, `FileEntry` types. Change `RawChartData.metadata` to `ChartMetadata`. Add passthrough fields (`chartSongSection`, `unknownMidiTracks`, `unknownChartSections`). Add `ChartDocument` extending `RawChartData`. |
| `src/chart/chart-folder-parser.ts` | **New file.** `parseChartFolder(files: FileEntry[]): ChartDocument` — moved from chart-edit `reader.ts`. |
| `src/ini/ini-scanner.ts` | Refactor `extractSongMetadata()` to produce `ChartMetadata` with full field set + `extraIniFields`. Remove `defaultMetadata` flat object (replaced by typed extraction). |
| `src/index.ts` | Export `parseChartFolder`, `ChartDocument`, `ChartMetadata`, `FileEntry`. Refactor `scanChartFolder` to call `parseChartFolder` internally. |
| `src/chart/chart-parser.ts` | Apply patch: quote stripping, section name parsing. **Add:** capture raw `[Song]` key-value pairs into `chartSongSection`. Collect unrecognized track sections into `unknownChartSections` (sections not in `trackNameMap` and not `Song`/`SyncTrack`/`Events`). |
| `src/chart/midi-parser.ts` | Apply patches: drum note mappings, delay propagation, vocal phrase noteNumber, event dedup, track dedup, instrument event validation. **Add:** collect unrecognized MIDI tracks into `unknownMidiTracks`. Preserve modifier sustains in `modifierSustains` (bake existing patch). |
| `src/chart/notes-parser.ts` | Apply patch: solo section length |
| `src/index.ts` | Export raw parsers directly (currently patched in) |

### chart-edit (lib/chart-edit)

| File | Change |
|------|--------|
| `reader.ts` | **Delete.** Logic moved to scan-chart's `parseChartFolder`. |
| `types.ts` | Remove `ChartMetadata`, `ChartDocument`, `FileEntry` — import from scan-chart. Keep drum helper types (`DrumNoteType`, `DrumNoteFlags`, etc.) and event type mappings. |
| `index.ts` | Replace `export { readChart }` with re-export of `parseChartFolder` from scan-chart (or alias as `readChart` for compatibility). Export `ChartDocument`, `ChartMetadata`, `FileEntry` from scan-chart. |
| `writer.ts` | Import `ChartDocument` from scan-chart instead of local types. |
| `writer-chart.ts` | Import types from scan-chart. Use `chartSongSection` to preserve [Song] field order and unknown fields. Emit `unknownChartSections` verbatim after known sections. |
| `writer-mid.ts` | Import types from scan-chart. Use `modifierSustains` for sustain-range SysEx (already implemented). Emit `unknownMidiTracks` verbatim after known instrument tracks. |
| `writer-ini.ts` | Import `ChartMetadata` from scan-chart. |
| `helpers/*.ts` | Import types from scan-chart. |
| `__tests__/*.ts` | Update imports. Tests that called `readChart` now call `parseChartFolder`. |

### Consumers in the app

| File | Change |
|------|--------|
| `app/add-lyrics/page.tsx` | `readChart` → `parseChartFolder` (or use re-exported alias) |
| `app/drum-edit/page.tsx` | Same |
| `lib/preview/chorus-chart-processing.ts` | May use `parseChartFolder` instead of `parseChartFile` + manual INI handling |
| All files importing from `@eliwhite/scan-chart` | No change if types are re-exported from chart-edit. Direct scan-chart imports still work. |

### Project root

| File | Change |
|------|--------|
| `package.json` | Update `@eliwhite/scan-chart` dependency to local workspace path or new version |
| `patches/@eliwhite+scan-chart+7.2.1.patch` | Delete |

## Migration strategy

1. **Apply patches to scan-chart source** — bake all patches directly into `~/projects/scan-chart`
2. **Add passthrough preservation to parsers** — unknown MIDI tracks, unknown .chart sections, raw [Song] section, modifier sustains
3. **Add types to scan-chart** — `ChartMetadata`, `FileEntry`, `ChartDocument`; expand `RawChartData.metadata`; add passthrough fields
4. **Add `parseChartFolder` to scan-chart** — port logic from chart-edit's `reader.ts`
5. **Refactor `scanChartFolder`** — use `parseChartFolder` internally
6. **Publish/link new scan-chart version**
7. **Update chart-edit** — delete `reader.ts`, update types to import from scan-chart, re-export for compatibility
8. **Update writers** — emit `unknownMidiTracks`, `unknownChartSections`, `chartSongSection` passthrough data
9. **Update consumers** — minimal, mostly import path changes
10. **Delete patch file** — remove `patches/@eliwhite+scan-chart+7.2.1.patch`
11. **Run full test suite** — unit tests + three levels of real-chart validation:
    - **Byte-level roundtrip** (strictest): parse MIDI with midi-file and compare track-by-track; compare .chart text line-by-line. No scan-chart in the comparison loop. This catches any data modification.
    - **Same-format roundtrip**: read → write → re-parse with scan-chart → compare. Catches semantic differences.
    - **Cross-format**: read → convert to other format → re-parse → compare. Only normalizes inherent format differences (drum note lengths, MIDI 0→1 length minimum, cymbal/tom marker encoding, forceUnnatural ↔ forceHopo/forceStrum).

## What doesn't change

- Writers stay in chart-edit (`.chart`, `.mid`, `.ini` serializers)
- Editing helpers stay in chart-edit (drum notes, sections, tempo, etc.)
- `createChart()` stays in chart-edit
- Raw parsers (`parseNotesFromChart`, `parseNotesFromMidi`) stay as low-level scan-chart APIs
- All existing scan-chart exports remain available (no breaking changes for other consumers)
- The drum helper types (`DrumNoteType`, `DrumNoteFlags`, etc.) and mapping constants stay in chart-edit

## Risks

- **scan-chart has its own INI field extraction** with validation (integer checking, multiplier_note validation, conflicting flag detection). Need to decide whether `parseChartFolder`'s metadata extraction includes this validation or stays permissive like chart-edit's current reader.
- **`scanChartFolder` uses `defaultMetadata`** with sentinel values (`"Unknown Artist"`, `diff_guitar: -1`, etc.). `parseChartFolder` uses `undefined` for missing fields. The refactored `scanChartFolder` would need to apply defaults after calling `parseChartFolder`.
- **`lib/ini-parser`** may be used by other code besides chart-edit. Check before removing.
- **Unknown MIDI track event format** — `midi-file`'s `MidiEvent` type is used for raw track storage. scan-chart would take a dependency on `midi-file`'s types (it already uses it internally for parsing, so this is low risk).
- **Memory overhead of passthrough data** — storing raw MIDI tracks and .chart sections increases memory usage per loaded chart. For `scanChartFolder` (bulk scanning), passthrough fields should be optional or skippable since scanning doesn't need roundtrip fidelity.
- **Overlapping MIDI notes** — .chart allows per-difficulty star power/solo sections at different tick ranges. When written to MIDI (single note 116/103), overlapping ranges must be merged. This is an inherent format constraint. The MIDI writer handles this with `mergeOverlappingSections`, but the merged result won't match the original per-difficulty data on re-read. The byte-level test must account for this in cross-format scenarios.
