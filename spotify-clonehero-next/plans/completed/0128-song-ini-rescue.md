# 0128 — Recover the charts Chrome will not let the scan read

Status: completed

## Why

A Windows user reported that /find-music finds none of their charts. The
report was root-caused after OneDrive, antivirus, extensions and enterprise
policy were each ruled out by test: Chrome's File System Access API refuses
to enumerate, read, or create a file that is named exactly `song.ini` (and
`.cfg`). It is a restriction in Chromium, not a fault of the machine.

The scan reads chart metadata from `song.ini` only
(`lib/local-songs-folder/scanLocalCharts.ts`). When the browser hides that
file, the folder gives no metadata, `pushChart` drops it, and the user sees
"0 installed charts" with no error. Every chart folder in the library
disappears the same way. Charts kept as `.sng` are not affected, because
their metadata is in the `.sng` header.

`<input type="file" webkitdirectory>` reads the same folder through the file
picker, which does not apply that restriction. So the data is available; only
the API the scan uses cannot get it.

## The decision

The scan keeps the File System Access API. When it finds a folder that holds
a chart file but gives no readable `song.ini`, it records that folder. If
there is at least one, /find-music offers one recovery: the user picks the
same Songs folder again in a `webkitdirectory` input, and the app reads the
`song.ini` of every recorded folder from that one selection.

One picker prompt for the whole library, not one per chart. A library with
2,000 blocked charts must not ask 2,000 times.

The recovered metadata is matched back to the scanned folders by the path
below the picked folder. `webkitRelativePath` and the scan path both start
with the name of the folder the user picked, so the segments after that name
identify the same folder in both.

The write side is not addressed. Extracting a downloaded `.sng` into a folder
must create a `song.ini`, which the same restriction blocks, and no
rename-based workaround exists. Download as `.sng`, which the app already
does by default, writes no `song.ini` and works.

## Scope

### 1. `lib/local-songs-folder/scanLocalCharts.ts`

- `LocalChartScanResult` gains `needSongIniRescue: BlockedChartFolder[]`.
  A folder is recorded when it holds a `.chart` or `.mid` file and the browser
  did not give the scan its `song.ini`: the entry was not in the listing, or
  opening or parsing it failed. A `song.ini` the scan did read is never
  recorded, whatever it holds, because a second reader gets the same file.
- `buildChart` is split out of `pushChart`, so the rescue can make the same
  `SongAccumulator` from a `File` instead of a handle.

### 2. `lib/local-songs-folder/songIniRescue.ts` (new)

`rescueSongInis(candidates, selection)` reads every `song.ini` in a
`webkitdirectory` selection, matches each one to a recorded folder by
relative path, and returns the charts it could build. A folder name that is
unique among the candidates also matches, so a user who picks the parent of
the Songs folder is not told the recovery found nothing.

### 3. `lib/local-songs-folder/index.ts`

- The scan response carries `needSongIniRescue` through.
- `recoverBlockedSongInis(candidates, selection)` writes the recovered charts
  to `local_charts` with `pruneMissing: false`, and reports the counts.

### 4. `app/find-music/FindMusicClient.tsx`

After a scan that recorded blocked folders, a toast that does not expire says
how many charts have no readable metadata, and offers "Recover chart info".
The action opens a hidden `webkitdirectory` input. The copy says that Chrome
labels the prompt "Upload", and that nothing leaves the browser.

### 5. `lib/local-songs-folder/scanDiagnostics.ts`

/debug/chart-scan is where a report of this kind arrives, and it could not
name this cause: it samples only folders that hold a `song.ini`, so a blocked
library reads as "no charts and no .sng files". It now samples a folder that
holds a chart file with no `song.ini` in the listing, counts those as
`chartsWithoutSongIni`, and says in the verdict that Chrome refuses a file
named `song.ini`.

### 6. Tests

- The scan records a blocked chart folder, and does not record a folder that
  holds no chart file.
- The rescue matches by relative path, matches by unique folder name, parses
  the metadata, and ignores a `song.ini` for a folder that is not a candidate.
- /find-music offers the recovery after such a scan, and writes what it
  recovers.
