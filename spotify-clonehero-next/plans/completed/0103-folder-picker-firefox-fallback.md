# 0103 — Folder picking in browsers without `showDirectoryPicker`

Status: completed

`ChartDropZone`'s "Select a chart folder" button calls `window.showDirectoryPicker`
unguarded. That API is Chromium-only, so in Firefox and Safari the call throws
`TypeError: window.showDirectoryPicker is not a function`, and the handler's
`catch` — which only special-cases `AbortError` — puts that raw message in a
toast. A user reported exactly that string on `/chart-editor` (2026-08-13).

The button is shared, so `/preview` and `/sheet-music` have the same bug.

## Why a fallback, not a warning

Nothing downstream of the picker needs the File System Access API. The folder is
read once into `LoadedFiles`, the editor copies that into OPFS (`createWritable`,
supported in Firefox 111+), and export is a plain `downloadBlob`
(`ExportDialog.tsx:597`). The handle is never retained and never written back
through. So `<input type="file" webkitdirectory>` — supported in Firefox since
50 and Safari since 11.1 — restores the full feature rather than just explaining
its absence.

## Deliverables

1. `readChartFileList(files: File[]): LoadedFiles` in
   `components/chart-picker/chart-file-readers.ts`, converting a
   `webkitdirectory` selection into the same shape `readChartDirectory` returns.
   - `originalName` is the selected folder: the first segment of
     `webkitRelativePath`.
   - Only files directly inside the selected folder are kept, matching
     `readChartDirectory`, which does not recurse.
   - If the selected folder holds no files of its own but everything sits under
     a single subdirectory, use that subdirectory. Picking the parent of a song
     folder is an easy mistake and the zip reader already tolerates the
     equivalent. `originalName` follows the descent, since it is the export's
     filename and the project's fallback song name.
   - Dotfiles are skipped, as in `readChartDirectory`, and dot-directories with
     them. The selected folder's own name is exempt — a chart kept in a hidden
     folder is still the chart the user asked for.
   - Every shape it cannot place a chart in throws with a message about the
     folder. Returning no files instead would surface to the user as a chart
     parsing error, which is not what went wrong.
2. `ChartDropZone` routes "Select a chart folder" to a hidden
   `webkitdirectory` input when `window.showDirectoryPicker` is absent. The
   choice is made in the click handler, not at render, so there is no
   hydration-time branch and the button's appearance is identical everywhere.
   The three copies of the read/loading/toast dance collapse into one
   `runLoad`, so every way in reports failure identically.
3. Unit tests for `readChartFileList` and the `ChartDropZone` wiring.

## Notes

`webkitdirectory` is typed as a string in `types/react.d.ts`, and written
`webkitdirectory=""`, because React does not know it as a boolean attribute:
passing `true` warns and renders no attribute at all, which silently turns the
input back into a file picker. Verified, not assumed.

## Out of scope

The same bug report mentions the drop zone "locking up" on drag-and-drop. That
is untriaged; the leading suspect is synchronous `unzipSync` + `readChart` +
OPFS write on the main thread with only a static "Reading files..." label. It
needs a repro before it gets a plan.
