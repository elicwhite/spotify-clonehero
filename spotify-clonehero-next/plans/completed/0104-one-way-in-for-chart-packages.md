# 0104 — One way in for chart packages

Status: completed

A chart package reaches this app as a folder, a .zip or a .sng, through a drop,
a folder picker or a file picker. There are currently three separate
implementations of that, in two libraries, and they disagree about what a user
is allowed to drop:

| Surface | Drop a .zip/.sng | Drop a folder | Mechanism |
| --- | --- | --- | --- |
| `components/chart-picker/ChartDropZone` | yes | **no** | `dataTransfer.files[0]` |
| `components/landing/SectionDropZone` | yes | Chromium only | `getAsFileSystemHandle` |
| `app/sng/components/DropZone` | yes | yes | `webkitGetAsEntry` |

So dropping a chart folder on `/chart-editor` fails with "Please drop a .zip or
.sng file", and on a landing page it fails in Firefox only. `webkitGetAsEntry`
is the mechanism that works everywhere; two of the three don't use it.

Underneath, the same "these files are a chart package" logic exists four times:
`readChartDirectory`, `readChartFileList` (0103), `readDroppedItems` and
`readFileList`. Every one of them is "(path, File) pairs → files", differing
only in where the pairs come from.

## Stage 1 — move, no behavior change

Per `extract-utility`, its own commit.

- `components/chart-picker/chart-file-readers.ts` → `lib/chart-files/chart-package.ts`
- `lib/sng/read-dropped-entries.ts` → `lib/chart-files/entries.ts`
- Tests move with them. Every import updated directly; no re-export shims.

This is what lets a shared reader exist at all: today `lib/sng` imports from
`components/chart-picker` and `components/chart-picker` would have to import
back for any of this to be shared.

## Stage 2 — one reader, one drop path

1. **One normalizer.** The folder rules from 0103 — read one level, descend
   into a lone subfolder, skip dotfiles below the root, throw about the folder
   rather than returning nothing — move into a single function over
   `{path, file}` pairs. `readChartFolderHandle` (was `readChartDirectory`),
   `readChartDirectoryInput` (was `readChartFileList`) and the new dropped-folder
   reader become adapters that produce pairs and call it.

   This changes folder-handle reads: they gain the subfolder descent and the
   folder-shaped error messages, which only the directory-input path had. That
   is the intended convergence, not a side effect.

2. **`readDroppedChart(dataTransfer)`** returns a chart package for a dropped
   folder, .zip or .sng, using `webkitGetAsEntry` so folders work in every
   browser. A single file that is not a chart package comes back as
   `{kind: 'file'}` for the caller to route — `SectionDropZone` sends audio to
   the audio flow, everyone else toasts.

3. **All three drop zones use it.** `ChartDropZone` and `SectionDropZone` gain
   folder drops; `SectionDropZone` stops being Chromium-only.

4. **`app/sng/components/DropZone` gets 0103's picker fallback**, which it
   needs for the same reason `ChartDropZone` did: it calls
   `window.showDirectoryPicker` unguarded, so its "Select folder" button throws
   in Firefox today.

## Not in scope

The buttons stay two. `webkitdirectory` is a mode switch on the input, not a
filter: an input with it opens a folder-only chooser and one without it cannot
select folders, and `showOpenFilePicker`/`showDirectoryPicker` split the same
way. No browser offers one dialog that takes either, so "one button for
everything" is not buildable. Drag-and-drop is the one path that takes
everything, and after this it does.

The main-thread cost of reading a package (`unzipSync`, `readChart` and the
OPFS write all run in the click handler) is untouched here.
