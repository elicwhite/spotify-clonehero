# 0054 — /preview route: chart previewer on the editor shell

## Goal

A new `/preview` page that, like `/sheet-music`, lets the user search
Chorus (Encore) for a chart or open a local chart (folder/.zip/.sng via
the shared selector), then previews it in the drum-transcription-style
editor shell: 3D highway, playback waveform in the transport bar,
sections in the timeline minimap + transport jumping, and a left-sidebar
toggle between the Classic and Waveform highway surfaces.

## Approach

Reuse `components/chart-editor/ChartEditor` (the shared shell used by
drum-transcription / drum-edit / add-lyrics) in a new read-only
capabilities profile instead of building a bespoke viewer.

- **Shared extraction (own commit, per reuse rule):**
  - Export `getChartFiles()` from `lib/preview/chorus-chart-processing.ts`
    so the preview page can download an Encore .sng and hand the raw
    files to `readChart()` (the editor stack needs a `ChartDocument`,
    which `getChartAndAudioFiles()` discards).
  - Move `app/sheet-music/LocalChartLoader.tsx` →
    `components/chart-picker/LocalChartLoader.tsx`, extend `LocalChart`
    with the full `chartDoc: ChartDocument` (it already calls
    `readChart` and throws the doc away). Update the sheet-music import
    directly (no re-export shim).
- **Capabilities:** add `PREVIEW_CAPABILITIES` to
  `components/chart-editor/capabilities.ts` — nothing hoverable /
  selectable / draggable, no placement tools, no tool palette, drum
  lanes on, highway-mode toggle on. Add a `showEditingControls` flag
  (true in existing profiles) gating LeftSidebar's Grid + History
  sections, which are meaningless without editing.
- **Route:**
  - `app/preview/page.tsx` — server component mirroring
    `app/sheet-music/page.tsx` (initial `searchEncore` results, drums
    filter).
  - `app/preview/Search.tsx` — adapted from sheet-music's Search:
    same search box + infinite scroll + local-chart disclosure. A
    result click loads in-page (no `[slug]` route): download files via
    `getChartFiles`, `readChart(files)`, `findAudioFiles(files)`.
    Deep-linkable via a `?md5=` query param (nuqs); back clears it.
  - `app/preview/PreviewViewer.tsx` — mounts
    `ChartEditorProvider` (PREVIEW_CAPABILITIES, drums-expert scope) +
    `ChartEditor`. Builds the `AudioManager` from the chart's audio
    files, sets chart delay, dispatches `SET_CHART_DOC`, and decodes
    all audio stems → mixed interleaved stereo PCM for the transport
    waveform + waveform highway surface. No export/metadata-edit
    callbacks (read-only preview).
- **PCM mixing helper:** pure `mixToInterleavedStereo()` in
  `lib/preview/waveformMix.ts` (sums all decoded stems, normalizes by
  peak) + Jest test. Decoding failures skip the file; no waveform if
  none decode.

## Files

- `lib/preview/chorus-chart-processing.ts` — export `getChartFiles`.
- `components/chart-picker/LocalChartLoader.tsx` — moved, + `chartDoc`.
- `app/sheet-music/Search.tsx` — import path update.
- `components/chart-editor/capabilities.ts` — `showEditingControls`,
  `PREVIEW_CAPABILITIES`.
- `components/chart-editor/LeftSidebar.tsx` — gate Grid/History.
- `app/preview/page.tsx`, `app/preview/Search.tsx`,
  `app/preview/PreviewViewer.tsx` — new.
- `lib/preview/waveformMix.ts` + `lib/preview/__tests__/waveformMix.test.ts`.

## Out of scope

- Non-drum charts (search stays drums-filtered; local charts require a
  drum track, same as sheet-music).
- Persisting previewed charts (OPFS) or favorites.
- Editing/export from the preview page.
