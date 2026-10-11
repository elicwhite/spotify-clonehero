# 0159 — Read folders and save files in every browser, across the tools

Status: todo

Depends on 0116 for `lib/file-access/capabilities.ts`
(`supportsDirectoryPicker()`) and `components/file-access/DownloadFallbackNotice.tsx`.
0116 builds them for `/find-music`; this plan uses them on the other tools.

## Rules

These come from the repo owner (2026-10-10) and apply to every tool:

1. **Reading a folder must work in every browser.** Where
   `showDirectoryPicker` is missing, use `<input type="file" webkitdirectory>`
   (or a drop, which already uses `webkitGetAsEntry()`). All paths produce
   one type: `FolderSource` from `lib/chart-files/chart-package.ts`, which
   0116 Phase 3 exports and extends for `scanLocalCharts`. Do not add a
   second folder type.
2. **Saving falls back to Downloads.** Where the browser cannot save into the
   picked folder, the file downloads to the Downloads folder.
3. **The user knows why.** Each fallback download shows the download notice
   from 0116: the browser is the reason, and it says where the file went and
   what to do with it. The copy says "your browser", never a browser name and
   never "Chrome-based" (Brave is Chrome-based and fails the test).
4. **Feature tests only.** Every branch reads `supportsDirectoryPicker()` or
   checks the specific API. No user-agent checks.

Chromium keeps the picker where it has it. The picker keeps access across
visits and saves in place, and `webkitdirectory` makes Chrome show an "Upload
N files?" prompt, which is wrong for a site that uploads nothing.

## What is broken today

Audit of 2026-10-10. Each control below calls a Chromium-only picker with no
feature test.

| Control | Site | What Firefox and Brave users see |
| --- | --- | --- |
| `/sng` "Select files" | `app/sng/components/DropZone.tsx:60` → `pickFiles` | Toast `window.showOpenFilePicker is not a function`. Drag-and-drop on the same zone works. |
| `/sng` "Modify SNG" | `app/sng/components/SngLanding.tsx:29` → `pickFiles` | Raw TypeError toast. No other way in. |
| `/chart-editor` "Add stem" | `components/chart-editor/sidebar/StemsMixer.tsx:348` → `pickFiles` | Toast "Could not open the file picker". The drop target works. |
| `/add-lyrics` "Choose new chart" | `app/add-lyrics/AddLyricsClient.tsx:599` | Raw TypeError toast. The `.zip`/`.sng` input next to it works. |
| `/sng` "Convert folder" | `app/sng/SngClient.tsx:37` | Raw TypeError toast. |

## Phase 1 — `pickFiles` falls back to a file input

`pickFiles` (`lib/chart-files/entries.ts:110`) calls `showOpenFilePicker`.
Where it is missing, open a hidden `<input type="file">` with `multiple` and
`accept` built from the file extensions in the same `types` option, and
resolve with its `File[]`, or `null` on cancel. Firefox fires a `cancel` event
on the input; use it so a cancelled pick resolves and does not hang.

- Build `accept` from the extensions only, never the MIME keys.
  `SngLanding` passes `application/octet-stream`, which would let the dialog
  offer any file.
- Call `input.click()` synchronously, before any `await` in `pickFiles` and
  in its callers. The click needs the user's transient activation; after an
  `await` it can be lost, and Firefox then opens nothing.

This one change fixes "Select files", "Modify SNG" and "Add stem". No notice:
these controls only read.

Done when: in Firefox, all three controls open the OS file dialog and load
the picked file, and a cancel leaves no toast.

## Phase 2 — `/add-lyrics` "Choose new chart" reads a folder in every browser

Use the same fallback `ChartDropZone` has had since plan 0103:
`webkitdirectory` and `readChartFileList`. Export is already a download, so
no notice.

Better: make one shared `pickFolder()` that returns a `FolderSource` from
either path, and move this control onto it. Three copies of the same
picker-or-`webkitdirectory` branch exist today, and all three move onto it:
`components/chart-picker/ChartDropZone.tsx`,
`app/sng/components/DropZone.tsx` and
`app/debug/chart-scan/ChartScanDebugClient.tsx`.

Done when: Firefox loads a chart folder from "Choose new chart".

## Phase 3 — `/sng` "Convert folder" downloads where it cannot write

Today `lib/sng/convert-folder-to-sng.ts:71` writes `<folder>.sng` next to each
chart folder. Where the picker is missing:

- Read the folder with `webkitdirectory`. `scanLocalCharts` takes the
  `FolderSource` from 0116 Phase 3, so this needs no second scanner.
- The convert step needs changes too. Today it uses real handles:
  `selectChartFoldersToConvert` keeps only charts with
  `'parentDir' in chart.handleInfo`, and `convertChartFolderToSng` calls
  `parentDir.getDirectoryHandle()` and `readChartDirectory()`. Without
  changes, every chart from a file input is dropped and the page reports 0
  charts to convert. Change `lib/sng/convert-folder-to-sng.ts` so that:
  - `selectChartFoldersToConvert` accepts both arms of the `handleInfo`
    union from 0116 Phase 3.
  - Conversion reads the chart folder through its `FolderSource` (the same
    reader `readChartFileList` uses), and returns the `.sng` bytes.
  - The caller decides where the bytes go: `createWritable()` next to the
    folder when it has a handle, or the `.zip` below when it does not.
- Put the `.sng` files into one `.zip` download, each at the same relative
  path as its folder. A download per chart does not work: browsers block a
  page that starts many downloads.
- Show the download notice with `folder: "the folder you picked"` and
  `action: "Unzip each part into your Songs folder."`. It renders:

  > Your browser cannot save files into the folder you picked. The files go
  > to your Downloads folder. Unzip each part into your Songs folder.

**Memory limit.** A `Blob` download holds the whole `.zip` in memory, and a
full library converts to many GB. Split into parts at a fixed size (start at
1 GB, then measure).

Do not use `exportAsZip` (`lib/chart-export/zip.ts`). It calls `zipSync` with
default deflate on the main thread and holds all inputs plus the output. A
`.sng` is already-compressed audio, so deflate wastes CPU and freezes the
page, and a 1 GB part costs about 2 GB of memory. Use fflate's streaming
`Zip` with `ZipPassThrough` (no compression), in a worker, and push each
`.sng` into it as soon as it is converted.

When a part is complete, the page shows a "Download part N" button. The user
clicks it to start the download. Do not start part downloads automatically:
browsers block a page that starts many downloads without a click.

Done when: Firefox converts a folder of three charts and downloads one `.zip`
with three `.sng` files at the right paths, with the notice shown.

## Not in scope

- `/drum-fills` keeps its gate. It needs a Songs folder it can keep across
  visits and Web MIDI. Firefox has Web MIDI, so revisit when a read-once scan
  is acceptable there.
- `/drum-transcription` and `/tempo` gate on WebGPU and `AudioEncoder`, by
  feature test. Correct as is.
- `AudioEncoder` is used with no test in the chart-editor export
  (`components/chart-editor/ExportDialog.tsx:617`) and project audio
  (`components/chart-editor/hooks/projectAudio.ts:221`). A separate problem.
- Safari. `COEP: credentialless` is probably not supported there, which
  would stop SQLocal. Not verified.

## Test plan

- Unit: `pickFiles` fallback — `accept` built from `types`, `multiple`
  passed through, cancel resolves `null`.
- Unit: `pickFolder` returns the same `FolderSource` tree from a handle
  fixture and from a `webkitRelativePath` file list.
- Unit: the convert-folder zip has one `.sng` per chart at the right relative
  path, and a new part starts at the size limit.
- Component: the notice shows for each fallback download and not in a
  browser with the picker.
- Manual: Firefox and Brave, each control in the table above. Chrome
  regression: every control still uses the picker.

## Open questions

1. The `.zip` part size for Phase 3. 1 GB is a guess; measure peak memory in
   Firefox on a real library.
