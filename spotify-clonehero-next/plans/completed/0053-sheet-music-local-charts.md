# 0053 — Sheet Music: play local charts

## Goal

Let users open a local chart (folder, .zip, or .sng) on `/sheet-music`,
directly below the search input, and play it in the existing sheet-music
viewer (`SongView`) without going through Encore.

## Approach

- Reuse `components/chart-picker/ChartDropZone` (the existing
  folder/zip/sng selector used by drum-edit, tempo, add-lyrics,
  drum-transcription).
- On load, parse with `readChart()` from `lib/chart-edit` (handles
  song.ini overlay incl. delay) and pick audio via `findAudioFiles()`
  from `lib/preview/chorus-chart-processing`.
- Build a local `ChartResponseEncore` metadata stub from the parsed
  chart metadata (same pattern as `app/chart-review`'s `prepareChart`),
  with `md5: ''` (no Encore/Supabase identity).
- Render `SongView` in place of the search results (dynamic import),
  with a "Back to search" affordance.
- Validate: chart must contain a drums track; otherwise toast an error
  and stay on search.

## Files

- `app/sheet-music/Search.tsx` — add local-chart section below search,
  local state, SongView rendering.
- `app/sheet-music/LocalChartLoader.tsx` (new, client) — dropzone +
  parse logic, kept out of Search's render body.

## Out of scope

- Persisting local charts (OPFS) / deep-linkable URLs for local charts.
- Save/favorite/practice-section persistence for local charts (they key
  on Encore md5).
