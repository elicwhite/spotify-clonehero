# Plan 0012: Consolidate drum-transcription chart-io → chart-edit

## Context

`lib/drum-transcription/chart-io/` has its own chart I/O implementation (8 files, ~1170 lines) that duplicates `lib/chart-edit/`. Both serialize .chart files, handle drum notes, and manage chart metadata. The chart-edit library is newer, more thoroughly tested (15K real-chart validation), supports both .chart and .mid formats, and has complete lyrics/vocalPhrases support.

## Goal

Replace all `chart-io` usage in drum-transcription with `chart-edit`. Delete `chart-io/`.

## Key Type Differences

| chart-io                            | chart-edit                                           | Notes                                                        |
| ----------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------ |
| `ChartDocument.resolution`          | `ChartDocument.chartTicksPerBeat`                    | Rename                                                       |
| `ChartDocument.tracks: TrackData[]` | `ChartDocument.trackData` (from RawChartData)        | Different structure                                          |
| `TrackData.notes: DrumNote[]`       | `trackData[].trackEvents` + `getDrumNotes()`         | chart-edit uses raw events internally, typed view via helper |
| `tempos[].bpm`                      | `tempos[].beatsPerMinute`                            | Rename                                                       |
| `DrumNoteType: 'red'`               | `DrumNoteType: 'redDrum'`                            | Different naming                                             |
| `metadata.musicStream`              | `assets[]`                                           | chart-edit stores audio refs as pass-through assets          |
| —                                   | `originalFormat`, `assets`, `lyrics`, `vocalPhrases` | chart-edit has more fields                                   |

## Files to Change

### Delete (chart-io/)

| File                        | Lines | Replacement                                                    |
| --------------------------- | ----- | -------------------------------------------------------------- |
| `chart-io/writer.ts`        | 237   | `chart-edit/writeChart()`                                      |
| `chart-io/reader.ts`        | 43    | `chart-edit/readChart()` + `writeChart()` + `parseChartFile()` |
| `chart-io/parsed-to-doc.ts` | 160   | `chart-edit/readChart()`                                       |
| `chart-io/song-ini.ts`      | 70    | `chart-edit/writeChart()` (includes song.ini)                  |
| `chart-io/note-mapping.ts`  | 114   | `chart-edit/types` mappings                                    |
| `chart-io/types.ts`         | 233   | `chart-edit/types` (re-export what's needed)                   |

### Keep (move out of chart-io/)

| File                   | Lines | Reason                                                                            |
| ---------------------- | ----- | --------------------------------------------------------------------------------- |
| `chart-io/timing.ts`   | 90    | Tick↔ms conversion, snapToGrid — not chart I/O, it's drum-transcription-specific |
| `chart-io/validate.ts` | 223   | Chart validation with auto-fixes — drum-transcription-specific                    |

### Update (consumers)

| File                                                       | Lines | Changes                                                                           |
| ---------------------------------------------------------- | ----- | --------------------------------------------------------------------------------- |
| `app/drum-transcription/commands.ts`                       | 375   | Use chart-edit types + `addDrumNote`/`removeDrumNote` helpers                     |
| `app/drum-transcription/contexts/EditorContext.tsx`        | 379   | Use chart-edit `ChartDocument` type                                               |
| `app/drum-transcription/hooks/useEditCommands.ts`          | 82    | Use `writeChart()` + `parseChartFile()` instead of `chartDocumentToParsedChart()` |
| `app/drum-transcription/hooks/useAutoSave.ts`              | ~60   | Update imports                                                                    |
| `app/drum-transcription/hooks/useEditorKeyboard.ts`        | ~80   | Update type imports                                                               |
| `app/drum-transcription/components/ExportDialog.tsx`       | 323   | Use `writeChart()` instead of `serializeSongIni()`                                |
| `app/drum-transcription/components/NoteInspector.tsx`      | ~100  | Update type imports                                                               |
| `app/drum-transcription/components/EditorApp.tsx`          | ~200  | Update type imports                                                               |
| `app/drum-transcription/components/HighwayEditor.tsx`      | ~300  | Update type imports                                                               |
| `app/drum-transcription/components/DrumHighwayPreview.tsx` | ~200  | Update type imports                                                               |
| `lib/drum-transcription/pipeline/runner.ts`                | 477   | Use `createChart()` + `addDrumNote()` + `writeChart()`                            |
| `lib/drum-transcription/ml/class-mapping.ts`               | 250   | Map ML output to chart-edit's `DrumNoteType`                                      |

### Update (tests)

| File                                | Changes                                      |
| ----------------------------------- | -------------------------------------------- |
| `__tests__/chart-writer.test.ts`    | Use chart-edit writeChart                    |
| `__tests__/chart-reader.test.ts`    | Use chart-edit readChart                     |
| `__tests__/parsed-to-doc.test.ts`   | Delete (functionality replaced by readChart) |
| `__tests__/song-ini.test.ts`        | Delete (covered by chart-edit tests)         |
| `__tests__/commands.test.ts`        | Update types                                 |
| `__tests__/editor-workflow.test.ts` | Update types                                 |
| `__tests__/class-mapping.test.ts`   | Update types                                 |

## Execution Order

1. **Move timing.ts and validate.ts** out of chart-io/ to `lib/drum-transcription/` (no functional change, just path). Update all imports.

2. **Create adapter types** in `lib/drum-transcription/chart-types.ts`:
   - Re-export chart-edit types consumers need
   - Add drum-transcription-specific types (RawDrumHit, QuantizedDrumNote, TimedTempo, ValidationResult)
   - Map old DrumNoteType names to chart-edit names: `'red'` → `'redDrum'`, etc.
   - Add `TempoEvent` as alias: `{ tick: number; bpm: number }` → convert to/from `beatsPerMinute`

3. **Update pipeline runner** (`runner.ts`):
   - Use `createChart()` + `addDrumNote()` instead of manually building ChartDocument
   - Use `writeChart()` instead of `serializeChart()`
   - Update tempo field names (bpm → beatsPerMinute)

4. **Update class-mapping.ts**:
   - Map ML classes to chart-edit's `DrumNoteType` ('redDrum' not 'red')
   - Update returned types

5. **Update commands.ts**:
   - Use chart-edit `addDrumNote()`/`removeDrumNote()` in command execute/undo
   - Use chart-edit types for ChartDocument, TrackData

6. **Update EditorContext + hooks**:
   - Use chart-edit's `ChartDocument`
   - Replace `chartDocumentToParsedChart()` with `writeChart()` + `parseChartFile()`

7. **Update components** (ExportDialog, NoteInspector, EditorApp, etc.):
   - Update type imports
   - ExportDialog: use `writeChart()` which produces song.ini automatically

8. **Update tests**:
   - Delete tests for deleted chart-io files
   - Update remaining tests to use chart-edit types

9. **Delete chart-io/**:
   - Remove `writer.ts`, `reader.ts`, `parsed-to-doc.ts`, `song-ini.ts`, `note-mapping.ts`, `types.ts`
   - Keep `timing.ts` and `validate.ts` (already moved in step 1)

## Verification

```bash
# All chart-edit tests still pass
npx jest --testPathPattern='lib/chart-edit' --no-coverage

# All drum-transcription tests pass
npx jest --testPathPattern='drum-transcription' --no-coverage

# Real chart validation still passes
CHART_DIR=~/Desktop/enchor-songs\ copy CHART_LIMIT=1000 npx jest --testPathPattern=real-charts --no-coverage

# No remaining imports from chart-io
grep -r "chart-io" lib/drum-transcription/ app/drum-transcription/ --include="*.ts" --include="*.tsx"

# Lint passes
yarn lint
```
