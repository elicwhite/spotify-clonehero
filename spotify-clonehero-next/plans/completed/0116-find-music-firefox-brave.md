# 0116 — /find-music in Firefox and Brave

Status: completed

> Revised after a contrarian review. The first draft had a wrong
> `createWritable` table, proposed a `FileEntry[]` Spotify import that would
> buffer a 200 MB export into RAM, proposed a cast that would silently let a
> fake handle reach three real consumers, split the capability guards into a
> later phase than the code that needs them, and claimed an installed flag it
> cannot deliver. All corrected below. The review also cleared three premises:
> SQLocal works in Firefox, the installed flag is handle-free, and the Phase 3
> adapter surface is complete.

`/find-music` shows nothing but a warning in Firefox and Brave. The gate is
too wide: it tests one Chromium-only API and hides the whole page, including
every part that has no browser limit.

## What the gate is

`app/SupportedBrowserWarning.tsx` tests
`typeof window.showDirectoryPicker === 'function'`.
`FindMusicClient.tsx:737-879` wraps the entire page in that component.

Firefox does not ship the File System Access pickers. Brave is Chromium but
blocks the File System API by default
([brave-browser#20563](https://github.com/brave/brave-browser/issues/20563),
[#44411](https://github.com/brave/brave-browser/issues/44411), both open), so
a user-agent check would be wrong too — Brave fails the same feature test as
Firefox. Measured, not assumed: see Phase 0a.

## What really needs Chromium

| API | Site |
| --- | --- |
| `window.showDirectoryPicker` | `lib/local-songs-folder/index.ts:26` (Songs folder), `FindMusicClient.tsx:443` (Spotify history folder) |
| `handle.queryPermission` / `requestPermission` | `lib/local-songs-folder/index.ts:100-108` |
| Directory handle stored in `idb-keyval` | `lib/local-songs-folder/index.ts:40,88` |
| `createWritable()` on a **picked** handle | `lib/local-songs-folder/index.ts:314` (`moveToFolder`) only |

`index.ts:508` and `:555` also call `createWritable()`, but on
`backupRootDirHandle` — OPFS (`getBackupDirectory`, `:258-266`). Both work in
Firefox today.

## What does not

OPFS works in Firefox 111+ and in Brave. That covers `lib/local-db/client.ts`,
the SQLocal catalog, the OPFS backup directory in `downloadSong`, and the
`previews/` directory.

**SQLocal opens in Firefox — measured on production, not reasoned about.**
`next.config.js:70-86` sets `COOP: same-origin` and `COEP: credentialless` for
the whole site (only `/apple-music-connect` is carved out). sqlocal 0.14.2 uses
`@sqlite.org/sqlite-wasm` `oo1.OpfsDb` over `coincident`, which needs
`SharedArrayBuffer` and `Atomics.waitAsync`. Phase 0a confirms all of it and
opens the real database.

**The installed flag is handle-free.** It comes from the `local_charts` table
(`app/find-music/queries.ts:263-273`), which `upsertLocalCharts`
(`lib/local-db/local-charts/index.ts:50-60`) fills with artist, song, charter,
`modified_time` and the `song.ini` data. `handleInfo` is read only by
`lib/drum-fills` and `lib/sng/convert-folder-to-sng.ts`, neither
of which is on the `/find-music` path. The table lives in OPFS SQLite, so one
scan in Firefox keeps the flag across reloads, the same as in Chrome.

The Spotify library, Apple Music, the Chorus catalog, the ranking and the
table are `fetch` and Supabase only.

## Outcome

1. `/find-music` opens and works in Firefox and Brave.
2. A chart installs into the Songs folder where the browser allows it, and
   downloads as a normal file where it does not.
3. The installed flag is as accurate as the last scan, in every browser.
4. A user whose charts go to Downloads knows that their browser is the
   reason, and knows what to do with the file.

Outcome 3 is deliberately weaker than "the installed flag works". A browser
download lands in the OS Downloads folder, not in the scanned Songs folder, so
it does not and must not set the flag. The UI says "Downloaded", not
"Installed". Do not write an optimistic `local_charts` row: it would claim a
file the user may never move.

## Capability model

One module, `lib/file-access/capabilities.ts`, exports one function:

```ts
export function supportsDirectoryPicker(): boolean;
```

It is a feature test, never a browser test. Every branch below reads it.
`/find-music` is the only user of `SupportedBrowserWarning`, so Phase 1
deletes `app/SupportedBrowserWarning.tsx` and its `jest.mock` in
`app/find-music/__tests__/FindMusicClient.test.tsx`.

The module is app-wide, not under `lib/local-songs-folder/`, because plan
0159 uses the same test and the same notice on `/sng` and `/add-lyrics`.

## The download notice

When a file goes to Downloads because the browser cannot save into a picked
folder, the user must know two things: the browser is the reason, and the
file needs to be moved. One shared component,
`components/file-access/DownloadFallbackNotice.tsx`, says it. The component
owns the sentence that gives the reason; each tool gives only the folder and
the action:

```ts
interface DownloadFallbackNoticeProps {
  /** Where the file could not go, e.g. "your Songs folder". */
  folder: string;
  /** What the user does with the file, e.g. "Move each chart into your Songs folder, then scan again." */
  action: string;
  /** False when the user chose to download. The reason sentence is then left out. */
  browserIsReason: boolean;
}
```

It renders "Your browser cannot save files into {folder}. The files go to
your Downloads folder. {action}" The reason sentence is fixed in the
component, so no tool can change it. On `/find-music`:

> Your browser cannot save files into your Songs folder. The files go to
> your Downloads folder. Move each chart into your Songs folder, then scan
> again.

Rules for the copy:

- Say "your browser". The user must not think the site or their folder is
  the fault.
- Do not name the user's browser. The test is a capability test, and the
  page does not know which browser it is in.
- Do not say "Chrome-based". Brave is Chrome-based and fails the test.
- Say where the file goes and what to do with it, every time.

Where it shows:

| Place | What |
| --- | --- |
| Local-library card | The full notice, always visible when the picker is missing. |
| Install button | Label "Download" in place of "Install". Tooltip: the first sentence of the notice. |
| After each download | Toast: "Saved to Downloads. Your browser cannot save into your Songs folder." |
| First download in a session | The full notice in the toast, not the short one. |

In a browser that has the picker, the browser is never the reason, so the
reason sentence never shows there. A Chrome user who picks "Just download" in
the Phase 2 dialog still gets a file in Downloads, so the toast after each
download shows the notice with `browserIsReason: false`: the Downloads
sentence and the action, with no reason sentence.

## Phase 0 — Measurements before anything is committed

### 0a — Done (2026-08-20). Capability probe, both browsers

Run against `https://musiccharts.tools/find-music` over CDP (Brave 151) and
WebDriver BiDi (Firefox), not inferred from documentation.

| | Brave 151 | Firefox |
| --- | --- | --- |
| `showDirectoryPicker` | `undefined` | `undefined` |
| `showOpenFilePicker` | `undefined` | `undefined` |
| `showSaveFilePicker` | `undefined` | `undefined` |
| `navigator.storage.getDirectory` | function | function |
| `isSecureContext` | true | true |
| `crossOriginIsolated` | **true** | **true** |
| `SharedArrayBuffer` | function | function |
| `Atomics.waitAsync` | — | function |
| `input.webkitdirectory` | true | true |
| `DataTransferItem.webkitGetAsEntry` | — | true |

Brave blocks all three pickers while Chromium ships them, so it stays in
scope and the feature test is the correct gate.

Firefox notes worth keeping:

- `FileSystemFileHandle.prototype.createWritable` **is** present.
- `createSyncAccessHandle` is **not** on the main-thread prototype — Firefox
  exposes it to workers only. That is where SQLocal needs it, so it is fine,
  and it was verified rather than assumed: a blob worker on the live origin
  called `getDirectory()` → `getFileHandle(create)` →
  `createSyncAccessHandle()` → `write` / `flush` / `getSize` → `close` →
  `removeEntry`, and reported `getSize() === 5`.

**The real database opens in Firefox.** `window.getLocalDb()`
(`lib/local-db/client.ts:55`) ran on production: migrations applied and all 14
tables were created (`local_charts`, `chorus_charts`, `spotify_*`,
`apple_music_*`, `radar_dismissed`, …), and a `count(*)` over `local_charts`
returned. Open time: 22.3 s on a first-ever cold profile (wasm download plus
every migration), 2.6 s on a later page load against the existing database,
122 ms once the connection is cached in the page. No blocker; the cold number
is a one-time cost that Chrome pays too.

This removes the last total-blocker risk. Phases 1, 2 and 4 are unblocked.

### 0b — Done (2026-08-20). `webkitdirectory` cost. **Phase 3 is viable.**

Measured with `public/browser-probe.html` on two real libraries in both
browsers. The fear that drove this gate — that building a `File` for every
file would kill the tab — did not happen.

Large library: 184,157 files, 32,321 charts, all `song.ini`, 232.7 GB audio,
8 levels deep. Small library: 10,917 files, 1,680 charts (1,429 `song.ini` +
251 `.sng`), 19.2 GB, 3 levels deep.

| Large library | Chrome | Brave | Firefox |
| --- | --- | --- | --- |
| Tree build | 221 ms | 220 ms | 115 ms |
| Chart discovery | 14 ms | 17 ms | 15 ms |
| `song.ini` read, 32,321 charts | 3,721 ms | 4,249 ms | 6,849 ms |
| **Phase 3 work, summed** | **≈4.0 s** | **≈4.5 s** | **≈7.0 s** |
| JS heap | 12 MB | 35 MB | not exposed |
| Tab survived | yes | yes | yes |

| Small library | Chrome | Brave | Firefox |
| --- | --- | --- | --- |
| Tree build | 106 ms | 12 ms | 6 ms |
| Chart discovery | 9 ms | 2 ms | 1 ms |
| `song.ini` read, 1,680 charts | 105 ms | 70 ms | 156 ms |
| **Phase 3 work, summed** | **220 ms** | **84 ms** | **163 ms** |
| JS heap | 10 MB | 5 MB | not exposed |

**184,157 files cost 12 to 35 MB of JS heap.** That is the number that
settles it. Phase 3 goes ahead, and open question 3 (the drag-and-drop
fallback) is not needed.

**Chrome was included as a control, and it is the most useful column.** Chrome
has the picker and still runs the `webkitdirectory` path in 4.0 s against
Firefox's 7.0 s. Firefox is within 1.75× of the browser this feature was built
for, on a library four times larger than a typical one. The no-picker path is
not a degraded mode; it is the same work at a comparable price.

#### Two things the probe got wrong — do not quote them

**The "main-thread stall" figure is unusable.** It reported 3,003 ms for
Firefox's *small* library and 1,645 ms for the *large* one. A smaller tree
cannot stall longer than a bigger one, so the instrument is measuring
something other than enumeration — most likely timer behaviour while the
native picker is modal. The heartbeat cannot separate the browser's
pre-`change` work from the picker being open. No figure it produced is
evidence. Nothing here depends on it: the decision rests on the directly
timed work and the heap.

**The "total after change" figures are an artifact of the probe**, and Chrome
proved it. All three browsers report a total far above their own components:
25,849 ms (Chrome) and 28,672 ms (Brave) against a ≈4 s sum, while Firefox's
7,091 ms sits ~110 ms above its 6,979 ms sum. The only code in that gap is the
probe's audio-size loop, which touches `File.size` on all 184,157 files —
about 120 µs each in Chromium, consistent with size being resolved lazily per
file, and effectively free in Firefox. Chrome and Brave agreeing makes this
Chromium-wide rather than a Brave quirk.

**`scanLocalCharts` never reads the size of an audio file**, so Phase 3 does
not pay this. Record it as a trap anyway: cheap-looking metadata access over a
large `FileList` is not cheap in Chromium, and Phase 3's adapter must not
expose a `size` that invites it.

**`songIniBytesRead` in the recorded runs is wrong** — ignore that field. The
probe accumulated with `bytes += (await f.text()).length`, which reads `bytes`
*before* suspending, so 32 concurrent readers each added to the same stale
value and the last writer won. Found by a synthetic-tree run returning exactly
16 bytes for four files. Fixed, and the same tree now returns the correct 90.
Every file was still opened and read, so **the timings and the counts are
unaffected** and no conclusion changes.

#### Measurement is closed (repo owner's call, 2026-08-20)

Performance is satisfactory in all three browsers. No further measurement
gates Phase 3.

A handle-scan baseline in Chrome was built and then not run. It would have
answered "is `webkitdirectory` a regression against today's scan", which is a
sharper question than the one that was actually in doubt — and the numbers
already settle that one: a full scan of a 32k-chart library costs 4 to 7 s and
tens of MB in every browser, which is acceptable for work the user starts by
clicking a button. Precision past that point buys nothing.

Two loose ends closed by reasoning rather than by another run:

- **`.sng` header parsing** is not a cross-browser risk. The large library had
  0 `.sng` files and the probe only counted the small library's 251, so the
  cost is unmeasured — but `readSongIni(file.stream())` receives an ordinary
  `File` whichever way it was obtained, so it is the same code doing the same
  work at the same price as in Chrome today. Nothing about it varies with the
  picker.
- **Firefox resident memory** is unknown, because `performance.memory` is
  Chromium-only. Chrome's 12 MB and Brave's 35 MB for the same 184,157 files
  make a Firefox-specific problem unlikely, and the tab survived.
`scanLocalCharts.ts:6-9` caps concurrency at 32, and `:111-118` records why:
on a flat tree with 60k+ subdirectories, listing ahead of parsing starves the
parses. The handle scan opens only `song.ini` and `.sng` headers and never
materializes the multi-GB audio files.

`<input webkitdirectory>` inverts that. The browser enumerates the whole tree
and builds a `File` for every file before `change` fires — for a 15k-chart
library, 100k to 500k `File` objects, with no progress and no cancel. Chrome
also shows a "Upload N files?" confirmation naming the count.

Measure on a real library in Firefox: time to `change`, peak memory, and
whether the tab survives. If it does not, Phase 3 is dead and Firefox gets no
local scan — Phases 1, 2 and 4 still stand on their own.

Recipe: open `about:blank` in Firefox, paste an `<input type="file"
webkitdirectory>` into the console with a `change` listener that logs
`performance.now()` and `e.target.files.length`, pick the real Songs folder,
and watch `about:memory`. Open question 3 names the fallback if it fails.

## Phase 1 — Open the page, with the guards in the same change

Remove the `SupportedBrowserWarning` wrapper from `FindMusicClient` **and**
put `supportsDirectoryPicker()` on both unguarded entry points, in one change.
These are not separable.

`window.showDirectoryPicker` is `undefined` in Firefox, so calling it throws a
`TypeError`, and the catch at `index.ts:30-37` converts only `DOMException`
(`AbortError` / `NotAllowedError`) — a `TypeError` is rethrown. Without the
guards, a Firefox user who clicks:

- **"Pick Songs folder…"** (`FindMusicSidebar.tsx:620`) gets a toast reading
  `window.showDirectoryPicker is not a function`, then a
  `Sentry.captureException` (`FindMusicClient.tsx:563-574`).
- **Install** (`FindMusicTable.tsx:152-158`) reaches
  `getDefaultDownloadDirectory` (`index.ts:231-233`) and the same path, with a
  `chart_md5` tag on the Sentry event.

That trades an honest warning for unbounded Sentry noise. `runHistoryRefresh`
(`FindMusicClient.tsx:433`) already guards correctly; it is the pattern the
other two need.

Ship the Phase 5 copy for these two cards in this phase as well.

Done when: Firefox loads `/find-music`, connects Spotify, browses the catalog,
and produces no Sentry event from any control on the page.

## Phase 2 — Install falls back to a download

`/find-music` always calls with `asSng: true` (`FindMusicTable.tsx:155`), so
the artifact is one file.

**Destination resolution lives in the caller, not in `lib/`.** `downloadSong`
is a plain async function with no React dependency. A promise-returning React
dialog cannot be reached from there without dragging Radix into `lib/`. So:

- `downloadSong` gains a required `destination` of `'songs-folder'` (with the
  handle supplied) or `'browser-download'`. It never prompts and never calls
  `tryGetSongsDirectoryHandle`. `getDefaultDownloadDirectory` (`:235`) stops
  calling it too.
- A new hook, `useChartInstallDestination` in `app/find-music/`, owns the
  resolution and the dialog, and reads and writes the stored "Just download"
  choice.

Resolution:

| State | Result |
| --- | --- |
| No picker support | Download at once. No prompt. |
| Picker support, folder already granted | Install to the folder. No prompt. |
| Picker support, no folder yet | Dialog: **Select Songs folder** or **Just download**. |

"Just download" is remembered permanently in `localStorage` (repo owner's
call, 2026-10-10). The dialog does not come back. The choice applies only
while no Songs folder is set: a user who later picks a folder from the
local-library card installs into it with no prompt. The local-library card
keeps its "Pick Songs folder" action, so the folder feature stays
reachable.

**`'browser-download'` skips OPFS entirely.** Do not reuse the
`backups/` staging write. Chorus `.sng` files reach hundreds of MB; staging
would write a full copy to OPFS, hold a second full copy in a `Blob`, then
delete — against an origin quota the SQLocal catalog and `previews/` already
draw on, where a rejection surfaces as a generic install error
(`index.ts:558-561`). Stream `response.body` to an object URL and an anchor.
The OPFS round trip exists to make the folder install atomic; a browser
download has nothing to be atomic about.

Keep the `track()` call and add the destination to the event.

Show the download notice (see "The download notice") on every download in a
browser with no picker. This is the point where the user first sees a file go
somewhere they did not expect, so the reason must come with it.

Done when: Firefox downloads a `.sng` from the table with no OPFS write and
shows the notice;
Chrome with no folder selected shows the two-way dialog; Chrome with a granted
folder installs with no prompt, as it does today.

## Phase 3 — Scan the Songs folder without a picker

Ungated: Phase 0b measured this and it is fine. Budget ≈4 s in Chrome and
Brave and ≈7 s in Firefox for a 32,321-chart library, at 12 to 35 MB of heap
for 184,157 `File` objects. Show progress, and do not block the UI thread on
the `song.ini` pass.

`scanLocalCharts.ts` touches only `name`, `kind`, `entries()`, `getFile()`,
`file.text()`, `file.lastModified` and `file.stream()`. `readSongIni`
(`:285`) is stream-only and needs no seek. A `webkitdirectory` `File` supplies
every one of them.

**Widen the parameter; do not cast.** `scanLocalCharts.ts:58` takes
`FileSystemDirectoryHandle`, and `SongAccumulator.handleInfo.parentDir` is
typed the same (`:42`). A virtual tree cannot satisfy that interface, and
`as unknown as FileSystemDirectoryHandle` would let a virtual handle reach
`lib/drum-fills/scan/scanWorker.ts:155`,
`lib/drum-fills/practice/songLocator.ts:18` and
`lib/sng/convert-folder-to-sng.ts:50`, all of which call methods it does not
have. A comment is not a guard.

Instead: export `FolderSource` from `lib/chart-files/chart-package.ts` and
extend its `FolderFile` with a lazy `file(): Promise<File>`, which supplies
`text()`, `stream()` and `lastModified`. Widen `scanLocalCharts` to take a
`FolderSource`, and make `handleInfo.parentDir` a union that those three
consumers must narrow. The compiler then reports the three sites rather than
a user reporting them. Plan 0159 uses the same type for every folder path, so
there is one folder type, not two.

Build the tree lazily from `FileList` — keep the `File` objects, do not read
their bytes up front.

Two changes in `scanInstalledCharts` (`index.ts:163`):

- `pruneMissing` still applies. A `webkitdirectory` pick is a full library
  read, so a complete pass may prune.
- **Delete the `installedCharts.json` write** (`:187-195`). Open question 1 is
  answered: nothing in the repo reads that file. It is also already useless —
  `JSON.stringify(installedCharts)` (`:193`) serializes
  `handleInfo.parentDir`, a handle with no enumerable own properties, to `{}`.
  Keep the `lastScannedInstalledCharts` localStorage write (`:197`), which
  `__tests__/scan-persistence.test.ts` covers.

The scan is repeatable but not resumable: there is no handle to store, so a
re-scan needs a re-pick. The **results** persist in OPFS, so the installed
flag survives a reload with no re-pick. The card says so.

Done when: Firefox scans a Songs folder through the file input, the table
marks installed charts, and the flag is still right after a reload.

## Phase 4 — Spotify history import without a picker

`getAllSpotifyPlays` (`lib/spotify-sdk/HistoryDumpParsing.ts:63-105`) walks
`handle.values()`, checks `entry.kind !== 'file'` to reject a wrong folder
selection (`:66-70`), and calls `readJsonFile(entry)` (`:85`), which calls
`getFile()`.

**Do not use `FileEntry` from `lib/chart-files/entries.ts`.** That type is
`@eliwhite/scan-chart`'s `{fileName, data: Uint8Array}` (`entries.ts:16-20`),
and `readFileList` (`:93-98`) fills it eagerly with `arrayBuffer()`. An
Extended Streaming History export is routinely 50 to 200 MB of JSON across
dozens of files, read and discarded one at a time today. `FileEntry[]` would
hold every byte resident before the first `JSON.parse` — an out-of-memory
failure on the exact machines this unblocks.

Take `{name: string, kind: 'file' | 'directory', file(): Promise<File>}[]`
instead — lazy, and it keeps the subfolder guard. `webkitRelativePath` gives
the depth needed to synthesize `kind`, so the "Are you sure you selected your
Extended Streaming History?" message survives.

Accepting the account-data `.zip` directly is optional; the folder input alone
unblocks the feature.

Done when: Firefox imports a Spotify account-data folder, the play counts
reach the `spotify_history` table, and selecting the wrong folder still gives
the specific error rather than a generic one.

## Phase 5 — Say what the browser can do

Most of this copy ships in Phase 1 and Phase 2. What remains: in a browser with
no picker, the local-library card shows the download notice, offers the folder
input, and states that a re-scan needs the folder again:

> Your browser cannot keep access to this folder. Pick it again to scan again.

The install button reads "Download" in place of "Install", with a
"Downloaded" terminal state that does not claim the chart is installed.

All copy follows the rules in "The download notice": Simplified Technical
English, "your browser" as the reason, no browser names.

## Not in scope

`/drum-fills` keeps its own capability gate: it needs a Songs folder it can
keep across visits, and Web MIDI.

`/sng` and `/add-lyrics` get the same read-a-folder and
download fallback in plan 0159, with the same notice. This plan builds the
shared capability module and notice component first.

Safari is not a target. Its OPFS lacks `createWritable()` until far later than
15.2, and `lib/fileSystemHelpers.ts:7` depends on it.

## Test plan

- Unit: the `FileList` scan source builds the right tree from nested
  `webkitRelativePath` values, including a `.sng` at the top level, and reads
  no bytes until `getFile()`.
- Unit: `scanLocalCharts` over a `FileList` source gives the same
  `SongAccumulator` records as an equivalent handle fixture, `handleInfo`
  excluded.
- Unit: `useChartInstallDestination` — all three rows of the resolution table,
  plus a cancelled dialog leaving no partial write and no `track()` event.
- Unit: `downloadSong` with `destination: 'browser-download'` writes nothing
  to OPFS.
- Unit: the Spotify import over the lazy list, including the subfolder
  rejection and the missing-`ReadMeFirst.pdf` rejection.
- Component: `FindMusicTable` install button label and terminal state under
  both capability states.
- Component: `DownloadFallbackNotice` shows the reason sentence when the
  picker is missing, and leaves it out after "Just download" while it still
  shows the Downloads sentence and the action.
- Manual: Firefox and Brave, full pass — connect Spotify, scan, reload, check
  the installed flag, download a chart. Chrome regression pass: install with a
  granted folder must still be prompt-free.

## As built (2026-10-10)

Where the code differs from the phases above:

- **The hook is `useChartInstall`** (`app/find-music/useChartInstall.tsx`),
  not `useChartInstallDestination`. It owns the destination choice, the
  dialog and the per-chart button states, which moved out of
  `FindMusicTable`. The chart that opened the dialog is held in state, not
  in a promise.
- **"Just download" lives in `lib/local-songs-folder/downloadChoice.ts`**,
  beside the stored Songs folder, and `pickSongsDirectory` clears it. The
  button label reads it through `useSyncExternalStore`, so a folder picked
  later turns every "Download" back into "Install" at once.
- **`downloadSong` takes `{kind: 'folder', folder}` or
  `{kind: 'browser-download'}`** and returns `installed` or `downloaded`. It
  always writes a `.sng`: the folder-unpacking and replace modes had no
  caller and are gone. `getSongsDownloadFolder` makes the
  `musiccharts-dot-tools-downloads` folder inside a Songs folder.
- **The toast** is titled "Saved to your Downloads folder". The first
  download on the page shows the whole notice. Later downloads show only the
  reason sentence (no picker) or only the action ("Just download").
- **There is no `ScanSource` type, and no `ChartHandleInfo`.** `FolderSource`
  moved to `lib/file-access/folderSource.ts`, gained `kind` and `handle`, and
  its files give a `File` on request. `scanLocalCharts` takes a
  `FolderSource` and records each chart as a `ChartLocation`,
  `{parent, entry}`. `readChartLocation` reads any of them; only the
  folder-to-`.sng` converter needs `parent.handle`, and it narrows on it.
- **One scan entry point**, `scanSongsFolder(getFolder)`. The handle getters
  go through `songsFolderFrom`; without a picker the folder comes from
  `pickFolder`. `FindMusicClient` decides once whether the folder is kept and
  passes `localFolderKept` and an optional `onPickLocalFolder` to the cards.
- **`pickFolder`** (`lib/file-access/pickFolder.ts`) is the read-only folder
  chooser: picker where there is one, `webkitdirectory` input elsewhere. The
  Spotify history import uses it. Plan 0159 Phase 2 reuses it.

Verified in real browsers against the dev server, with a small fixture
history export and Songs folder:

- **Brave 151** (no picker), over CDP. The folder inputs got real
  directories through the DevTools file chooser. Import, scan, reload
  (flag kept), Download, tooltip and toast all worked.
- **Firefox 154** (no picker), over WebDriver BiDi. BiDi's `input.setFiles`
  refuses directories, so the folder was handed over as the `File` list a
  `webkitdirectory` input produces. Everything after the dialog was the real
  page code. Import, scan, Download (4.8 MB `.sng` saved) and toast all
  worked.
- **Chrome 154** (picker), with `showDirectoryPicker` answering with OPFS
  folders. The dialog, "Select Songs folder" (installed into the folder),
  and "Just download" (toast without the browser reason) all worked.

Known and left as is:

- Chromium browsers show their own "Upload N files to this site?" prompt for
  a `webkitdirectory` input. It says "upload" although nothing leaves the
  browser. The page cannot change it. Brave users see it; Chrome users
  never reach that input.
- Picking a Songs folder from the install dialog does not scan it. The
  stored folder is scanned on the next visit, or with Rescan.

## Open questions

1. ~~Does anything still read `installedCharts.json`?~~ Answered: no. Phase 3
   deletes the write.
2. ~~Should "Just download" be remembered longer than the session?~~
   Answered (2026-10-10): yes, permanently. See Phase 2.
3. ~~Is a drag-and-drop folder source needed instead?~~ Answered: no.
   `webkitdirectory` enumerates a 184,157-file library in every target browser
   without trouble, so the `webkitGetAsEntry()` fallback is not required.
