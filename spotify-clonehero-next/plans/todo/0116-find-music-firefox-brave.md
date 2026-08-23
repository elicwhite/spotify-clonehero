# 0116 — /find-music in Firefox and Brave

Status: todo

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
`/chart-review`, `lib/drum-fills` and `lib/sng/convert-folder-to-sng.ts`, none
of which is on the `/find-music` path. The table lives in OPFS SQLite, so one
scan in Firefox keeps the flag across reloads, the same as in Chrome.

The Spotify library, Apple Music, the Chorus catalog, the ranking and the
table are `fetch` and Supabase only.

## Outcome

1. `/find-music` opens and works in Firefox and Brave.
2. A chart installs into the Songs folder where the browser allows it, and
   downloads as a normal file where it does not.
3. The installed flag is as accurate as the last scan, in every browser.

Outcome 3 is deliberately weaker than "the installed flag works". A browser
download lands in the OS Downloads folder, not in the scanned Songs folder, so
it does not and must not set the flag. The UI says "Downloaded", not
"Installed". Do not write an optimistic `local_charts` row: it would claim a
file the user may never move.

## Capability model

One module, `lib/local-songs-folder/capabilities.ts`, exports one function:

```ts
export function supportsDirectoryPicker(): boolean;
```

It is a feature test, never a browser test. Every branch below reads it.
`SupportedBrowserWarning` keeps its current meaning for the tools that really
need the picker; `/find-music` stops using it.

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

- **"Pick Songs folder…"** (`FindMusicSidebar.tsx:617`) gets a native
  `alert('Select your Songs directory')` (`index.ts:51`), then a toast reading
  `window.showDirectoryPicker is not a function`, then a
  `Sentry.captureException` (`FindMusicClient.tsx:547-561`).
- **Install** (`FindMusicTable.tsx:152-158`) reaches
  `getDefaultDownloadDirectory` (`index.ts:236-237`) and the same path, with a
  `chart_md5` tag on the Sentry event.

That trades an honest warning for unbounded Sentry noise. `runHistoryRefresh`
(`FindMusicClient.tsx:433`) already guards correctly; it is the pattern the
other two need.

Ship the Phase 5 copy for these two cards in this phase as well.

Done when: Firefox loads `/find-music`, connects Spotify, browses the catalog,
and produces no Sentry event and no `alert()` from any control on the page.

## Phase 2 — Install falls back to a download

`/find-music` always calls with `asSng: true` (`FindMusicTable.tsx:155`), so
the artifact is one file.

**Destination resolution lives in the caller, not in `lib/`.** `downloadSong`
is a plain async function with no React dependency, which is exactly why
`promptForSongsDirectory` uses a synchronous `alert()` (`index.ts:51`). A
promise-returning React dialog cannot be reached from there without dragging
Radix into `lib/`. So:

- `downloadSong` gains a required `destination` of `'songs-folder'` (with the
  handle supplied) or `'browser-download'`. It never prompts and never calls
  `tryGetSongsDirectoryHandle`. `getDefaultDownloadDirectory` (`:235`) stops
  calling it too.
- A new hook, `useChartInstallDestination` in `app/find-music/`, owns the
  resolution and the dialog, and holds the session flag.

Resolution:

| State | Result |
| --- | --- |
| No picker support | Download at once. No prompt. |
| Picker support, folder already granted | Install to the folder. No prompt. |
| Picker support, no folder yet | Dialog: **Select Songs folder** or **Just download**. |

"Just download" is remembered for the session only, so the offer to install
comes back on the next visit.

**`'browser-download'` skips OPFS entirely.** Do not reuse the
`backups/` staging write. Chorus `.sng` files reach hundreds of MB; staging
would write a full copy to OPFS, hold a second full copy in a `Blob`, then
delete — against an origin quota the SQLocal catalog and `previews/` already
draw on, where a rejection surfaces as a generic install error
(`index.ts:558-561`). Stream `response.body` to an object URL and an anchor.
The OPFS round trip exists to make the folder install atomic; a browser
download has nothing to be atomic about.

Keep the `track()` call and add the destination to the event.

Done when: Firefox downloads a `.sng` from the table with no OPFS write;
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

Instead: declare a structural `ScanSource` type covering exactly the surface
above, widen `scanLocalCharts` to take it, and make `handleInfo.parentDir` a
union that those three consumers must narrow. The compiler then reports the
three sites rather than a user reporting them.

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

Most of this copy ships in Phase 1. What remains: in a browser with no picker,
the local-library card offers the folder input and states that a re-scan needs
the folder again, and the install button reads "Download" in place of
"Install", with a "Downloaded" terminal state that does not claim the chart is
installed.

Copy stays in Simplified Technical English and does not name browsers, since
the test is a capability test.

## Not in scope

`/chart-review`, `/drum-fills`, `/sng` and the folder-to-`.sng` converter all
depend on live handles for reading and writing user files. They keep
`SupportedBrowserWarning` as it is.

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
- Manual: Firefox and Brave, full pass — connect Spotify, scan, reload, check
  the installed flag, download a chart. Chrome regression pass: install with a
  granted folder must still be prompt-free.

## Open questions

1. ~~Does anything still read `installedCharts.json`?~~ Answered: no. Phase 3
   deletes the write.
2. Should "Just download" be remembered longer than the session? A persisted
   choice removes a prompt but hides the folder feature from a user who
   dismissed it once.
3. ~~Is a drag-and-drop folder source needed instead?~~ Answered: no.
   `webkitdirectory` enumerates a 184,157-file library in every target browser
   without trouble, so the `webkitGetAsEntry()` fallback is not required.
