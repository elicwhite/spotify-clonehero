# 0119 — Change the local Songs folder

Status: completed

## Why

A user asked in Discord where the web app shows the folder it treats as the
local Songs folder. There is no such display, and no way to point the app at a
different folder once one is picked.

`lib/local-songs-folder/index.ts` stores the picked handle in idb-keyval under
`songsDirectoryHandle`. `tryGetSongsDirectoryHandle()` returns that handle and
shows the picker only when there is none, so the Find Music card's "Rescan"
reads the first folder the user ever picked, for as long as the browser keeps
the handle. Clearing site data is the only escape.

## The decision

The Local Songs Folder card gets an overflow ("three dots") item,
**"Choose a different folder…"**, that always opens the picker and rescans.

The folder **name** is not shown. The File System Access API exposes only
`handle.name`, never a path, and a bare `Songs` answers the user's question
badly enough to be worth leaving out.

The Spotify History card is unchanged. It has no stored handle —
`runHistoryRefresh` opens the picker on every press and each import replaces
every `spotify_history` row — so re-picking a folder is already its only
behavior.

## Scope

### 1. `lib/local-songs-folder/index.ts`

- Add `pickSongsDirectory()`: always calls `showDirectoryPicker({id:
  'clone-hero-songs', mode: 'readwrite'})`, writes the handle to idb-keyval,
  replaces `currentSongDirectoryCache`, and returns null when the user cancels
  or the browser refuses.
- `promptForSongsDirectory()` keeps its `alert('Select your Songs directory')`
  and delegates the rest to `pickSongsDirectory`. The alert stays because that
  path shows a picker the user did not ask for — a download on another page
  needing a folder. It is not repeated for a picker the user chose from a menu.
- `tryGetSongsDirectoryHandle()` becomes the choice between the two ways of
  getting a folder, and nothing else. Both halves it used to do itself — an
  extra cache check, an extra cache write — are done by the functions it calls.

**One scanner instead of three.** `tryScanForInstalledCharts`,
`scanGrantedSongsDirectory`, and a proposed `scanPickedSongsDirectory` have the
same body and differ only in how they get a handle. They collapse into
`scanSongsDirectory(getHandle, onProgress)`, and the choice of folder becomes
the caller's argument: `tryGetSongsDirectoryHandle` (stored, else picker),
`pickSongsDirectory` (picker always), `getGrantedSongsDirectoryHandle` (stored
or nothing). A null result always means "no scan happened", never "the scan
failed".

### 2. One writer for the stored handle

`app/drum-fills/hooks/useLibraryScan.ts` called `showDirectoryPicker` and
`idbSet('songsDirectoryHandle', …)` itself, bypassing the module cache in
`lib/local-songs-folder`. A user who picked a folder on /drum-fills and then
opened /find-music without a reload got the previous handle from the cache.
The hook now resolves the folder through `lib/local-songs-folder`, which makes
that module the only writer of the key.

**The `NEEDS_PICKER` sentinel goes with it.** `startLibraryScan` used to look up
the handle itself and throw a string-compared sentinel error when it found none,
which the hook caught, ran the picker inside, and recursed on — a retry loop
that also flickered `scanning` off and on. The hook now resolves the folder
before the scan starts, so `startLibraryScan` takes a required
`directoryHandle`, `NEEDS_PICKER` and the hook's `initialHandle` parameter are
deleted, and the scan has one outcome to report instead of two exits.

### 3. `FindMusicClient.tsx`

`runScan` takes the handle getter rather than a whole scanner. `runLocalScan`
and `runPickLocalFolder` are the same call with a different getter, so both go
through one `runRequestedScan`.

### 4. Card UI — `FindMusicSidebar.tsx` and `FindMusicWelcome.tsx`

`SourceCard` and `SetupCard` took an `overflowActionLabel` / `onOverflowAction`
pair that had to be supplied together, and rendered it as **destructive** —
right for Apple Music's "Disconnect and clear", wrong for a folder change, and
a trap for the next benign action anyone adds.

Both take one `CardOverflowAction` object instead (`app/find-music/types.ts`):
`{label, onSelect, tone?: 'destructive'}`. The pairing guard becomes a single
null check, red is opt-in, and the "is there a folder yet" condition is written
once per card rather than once per prop.

The item goes on the sidebar card and on the welcome card. Both are reachable:
the welcome screen renders while a user has charts scanned but no taste source.

### 5. Stale rows after a folder change

`scanInstalledCharts` prunes rows for charts it did not find, but only when the
scan is `complete`. A `partial` scan of a **new** folder leaves the old folder's
charts in `local_charts`. The existing partial-scan warning
(`getLocalScanWarning`) already says charts were skipped and existing rows were
kept. That stays: the alternative — wiping the index before a scan that may fail
— trades a stale row for a lost index.

Out of scope, and worth its own plan: /drum-fills keys stored fills by
`parentDir.name/fileName` (`lib/drum-fills/scan/scanWorker.ts`), so a folder
change can resolve a fill against a same-named chart in the new folder.

## Tests

- `lib/local-songs-folder`: `pickSongsDirectory` ignores the cached handle,
  stores the picked one, and shows no alert; a cancelled pick returns null and
  leaves the stored handle alone. Each test loads the module fresh so the
  handle cache cannot leak between them.
- `FindMusicClient`: the folder-change action always scans through the picker
  and never through the stored folder.
- `FindMusicSidebar` / `FindMusicWelcome`: the Local card renders an actions
  menu whose item calls `onPickLocalFolder`; Apple Music's item stays
  destructive.
