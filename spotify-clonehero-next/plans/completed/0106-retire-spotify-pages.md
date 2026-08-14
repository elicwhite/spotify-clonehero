# 0106 — Retire `/spotify` and `/spotifyhistory`, put Find Music on the home page

Status: completed

`/find-music` covers what the two Spotify pages do. It reads the Spotify library
(`useSpotifyLibraryUpdate`), imports an extended-streaming-history dump
(`tryProcessSpotifyDump`), scans the local Songs folder, holds the Chorus mirror,
and adds Apple Music, recommendations, saved filters, and per-source status. The
two older pages are duplicate, less capable ways in — and they are the only two
tools the home page offers for "find charts for the music I know".

This plan deletes them, redirects their URLs, deletes what only they used, and
replaces their two home-page cards with one Find Music card.

**The deletion is also the audit.** Each page is read feature by feature before
any file is removed, and every capability is either found in `/find-music`,
ported, or written down as a deliberate loss. A capability nobody can point at
in Find Music is a gap, and a gap stops the deletion of the code that provides
it. Phase 1 does that work; Phase 2 does not start until Phase 1 signs off.

Sign-off is concrete: whoever runs Phase 1 edits *this file* — it moves to
`plans/in-progress/` when claimed, per the `claim-plan` skill — striking each
confirmed row and replacing each gap with its resolution. The plan that reaches
`completed/` is the record of what was checked. A gap resolved as "accept" needs
a sentence saying why; a gap resolved as "fix" needs that fix written into Phase
2, or its own plan number.

## Phase 1 — parity audit

The inventory below comes from reading `app/spotify/app/Spotify.tsx` (645),
`app/spotifyhistory/SpotifyHistory.tsx` (549), and their shared table
`app/SpotifyTableDownloader.tsx` (811) against `app/find-music/`. Confirm each
row in the running app — not by reading only — with a local DB that has Spotify
library, history, and a scanned Songs folder in it.

### Confirmed present in `/find-music`

| Capability of the old pages | Where it lives now |
| --- | --- |
| Spotify library import (playlists, albums, saved) | `runLibraryRefresh` → `useSpotifyLibraryUpdate` |
| Extended-streaming-history import | `runHistoryRefresh` → `tryProcessSpotifyDump` |
| Local Songs folder scan, partial-scan warning | `runLocalScan` → `getLocalScanWarning` |
| Chorus mirror refresh with progress | `useChorusChartDb`, catalog card |
| Charts grouped under a song, expandable per charter | `FindMusicTable` expanded rows |
| Per-chart install state, download into the Songs folder | `FindMusicTable` download column |
| Hide songs already installed | `install: 'hide-installed'` filter |
| Instrument filter, requiring all picks on one chart | `chartHasInstruments` |
| Play count shown and sortable | `playCount` cell, `MusicSort` `plays` |
| Last-updated shown and sortable | `formatDate(chart.modifiedTime)`, sort `updated` |
| Preview a track before downloading | `MusicPreviewButton` |
| Which playlists and albums a song came from | evidence tooltip (`Spotify playlists` / `Spotify albums`) |
| Works signed out apart from Spotify itself | history import and local scan call `activateSourceAccess`, not an auth gate |

### Differences that are the design, not gaps

Found by the audit, reviewed, kept. They are written down so nobody re-opens
them, and so the next person knows they were seen rather than missed.

- **Drums means four-lane pro.** The old table badged drums for any drum type;
  Find Music badges and filters four-lane pro only
  (`app/find-music/types.ts`, plan 0101). Five-lane and plain four-lane charts
  show no drums. That is the product decision, not a shortfall of the port.
- **One chart per upload group.** `currentChorusChartsCte`
  (`app/find-music/queries.ts:84-104`) keeps the newest `modified_time` per
  `group_id`; the old pages listed every revision. Showing one chart from a
  group is what is wanted.
- **Playlist owner and album artist leave the table, not the database.**
  `SourceRenderer` paired each playlist name with `owner_display_name` and each
  album with `artist_name`; Find Music's evidence tooltip shows names only. The
  table is the wrong place for those fields. They stay in `spotify_playlists`
  and `spotify_albums` for a planned Spotify-card filter that excludes chosen
  playlists from mattering — so **do not drop those columns** as part of this
  cleanup, even though nothing renders them once the old table is gone.
- **Narrower sorting.** The old table combined sorts across artist, song,
  `# Plays`, Last Updated, and charter; Find Music sorts on one key from
  score/plays/artist/song/updated, with no charter option. Fine.
- **The dev loader mock goes.** `SpotifyLoaderMock.tsx` (213 lines,
  `?mockLoader=1`, dev-only — `Spotify.tsx:132` returns false in production)
  mocked a loading UI that Find Music does not have. Delete it, do not port it.

### Gaps to fix

1. **Charter names render with their markup.** The old table stripped Unity
   rich-text through `removeStyleTags(value || '')`
   (`app/SpotifyTableDownloader.tsx:259`). `FindMusicTable.tsx:796` renders
   `{chart.charter}` raw, and so does the aria-label at :806. The mirror stores
   charters unstripped (`lib/local-db/chorus/index.ts:57`), and real ones carry
   markup — `lib/ui-utils.test.ts:4` uses `<color=#AEFFFF>Aren Eternal</color> &
   Geo`. A bug, and `removeStyleTags` is already imported across the app. Fix it
   with a test.
2. **The Songs folder is not rescanned on load.** `/spotify` scanned the local
   library as part of its one-button flow. Find Music scans only when the user
   clicks the card: `tryScanForInstalledCharts` has one caller, `runLocalScan`
   (`FindMusicClient.tsx:531`). It should also run on load when a Songs folder
   handle is already stored, so install state is current without being asked
   for.

   The catalog half of that flow already works this way: the load effect enables
   source access when `localDbExists()` and calls `loadCatalog`
   (`FindMusicClient.tsx:367-407`), so an existing OPFS database refreshes
   Chorus on its own.

   Only handle acquisition needs new code. `scanInstalledCharts(handle,
   onProgress)` is already exported (`lib/local-songs-folder/index.ts:126`) and
   is what `tryScanForInstalledCharts` calls once it has a handle. What cannot
   be reused is the acquisition: `tryGetSongsDirectoryHandle` falls through to
   `promptForSongsDirectory()` when nothing is stored (`:97`), and
   `getCachedSongsDirectoryHandle` calls `requestPermission` when the stored
   permission is not granted (`:71-80`) — both need a user gesture and neither
   belongs in a load effect. Add a `queryPermission`-only variant beside
   `getCachedSongsDirectoryHandle` (`:47`) that returns the handle only when
   permission is already `granted` and null otherwise, then feed it to the
   existing `scanInstalledCharts`. A user who has never picked a folder must see
   no prompt.
3. **Found while implementing.** `clearAllData` and `clearAllCharts` used
   `recalculateTrackChartMatches` as their way of emptying
   `spotify_track_chart_matches`. Removing the recompute outright would have
   left Spotify track ids behind after a user cleared their data, so both now
   delete from the table directly. The recompute is gone; the privacy contract
   is not.

### Non-gaps worth recording

- `song_length`, `album_art_md5`, `group_id`, and `has_video_background` are
  selected by both old queries and rendered by neither page. Nothing is lost.
- The history page's "Login with Spotify for Previews" is not an access gate —
  it buys previews only, which is what Find Music's Spotify card does.
- Find Music does not need the old page's cached-dump shortcut: an imported
  history lives in the `spotify_history` table, which `getFindMusicSongs` reads
  directly, so a returning user sees it with no picker at all. The OPFS copy of
  the same data goes — see "The history dump cache" below.

## Phase 2 — delete

Sequencing, because several steps break the tree on their own: repoint every
reference *before* deleting what it points at. `chart-editor-layout.test.tsx`
before `app/spotify/`; the redirect test rows with the `next.config.js` rows;
both halves of the `chart_downloaded.source` union in one edit. Phases 2 and 3
land as one commit — a tree with the pages deleted but the home page still
linking to them is not a state worth having in history.

Whole directories:

- `app/spotify/` — `page.tsx`, `WelcomeCard.tsx`, `opengraph-image.tsx`, and
  `app/` (`page.tsx`, `Spotify.tsx`, `SpotifyLoaderCard.tsx`,
  `SpotifyLoaderMock.tsx`, `SignInWithSpotifyCard.tsx`,
  `LocalScanLoaderCard.tsx`, `UpdateChorusLoaderCard.tsx`, `__tests__/`).
- `app/spotifyhistory/` — `page.tsx`, `SpotifyHistory.tsx`,
  `opengraph-image.tsx`, `__tests__/`.

Files that lose their last non-test caller with them:

- `app/SpotifyTableDownloader.tsx` — imported only by `Spotify.tsx` and
  `SpotifyHistory.tsx`. Find Music has `FindMusicTable`.
- `components/SpotifyPreviewButton.tsx` — imported only by
  `SpotifyTableDownloader`. Find Music uses `components/MusicPreviewButton` over
  `components/music-preview/`, which is a separate implementation.
- `app/find-music/__tests__/SpotifyPreviewButton.test.tsx` — 572 lines against
  the deleted component, testing no Find Music code despite its location.
  **Read it before deleting it.** It renders the real `AudioProvider` thirteen
  times; every other suite injects a fake context value
  (`components/__tests__/MusicPreviewButton.test.tsx:49`,
  `MusicPreviewController.test.tsx:49`, `FindMusicTable.test.tsx:762`) or mocks
  the module (`app/__tests__/ContextProviders.test.tsx:15`). Delete it as-is and
  `app/AudioProvider.tsx` — the shared single-playback state machine — has no
  tests at all. Port the provider-level cases into a suite that belongs to
  `AudioProvider`, then delete the file.
- `lib/spotify-sdk/SpotifyFetching.ts` → the `useTrackUrls` hook (line 385) only.
  **Do not follow it into `getTrackUrls` (line 333).** That helper is shared with
  `resolveSpotifyTrackUrls` (line 362), which is what
  `components/music-preview/useMusicPreviewController.ts` — Find Music's live
  preview path — calls. Deleting it takes previews out with it.
### The history dump cache

`lib/spotify-sdk/HistoryDumpParsing.ts` keeps a second copy of the imported
history in OPFS as `spotifyHistoryDump.json`, beside the `spotify_history` table.
`getSpotifyDumpArtistTrackPlays` reads it, and — when `hasSpotifyHistory()` says
the database is empty — backfills the table from it (`:47-56`). Its only caller
is `/spotifyhistory`.

Both copies of the data go. Two stores of the same facts, one silently
repairing the other, is a bug source, not a safety net: whichever is stale wins
by accident. The database is the store. If the history is missing, Find Music
shows its "Choose history folder" card and the user picks the folder again,
which is the ordinary path and the one every other source already takes.

So delete:

- `getSpotifyDumpArtistTrackPlays` and its module-scope `deserialize` (`:102`).
- The OPFS half of `cacheArtistTrackPlays` (`:83, 93`) and its `serialize`
  (`:118`). The function keeps its `upsertSpotifyHistory` half — that is the
  write that matters — so it is a narrowing, not a deletion. Rename it to say
  so.
- The `writeFile` import (`:1`) and the `hasSpotifyHistory` import (`:3`).
  `readJsonFile` stays; `:149` reads the user's dump files with it.
- `hasSpotifyHistory` (`lib/local-db/spotify-history/index.ts:62`), which loses
  its only caller.
- In `lib/spotify-sdk/__tests__/history-import.test.ts`: the `writeFile` entry
  in the `jest.mock` factory (`:6-9`), its import (`:13`), its
  `mockResolvedValue` (`:56`), and the `hasSpotifyHistory` mock (`:2`). Leaving
  the import behind fails `pnpm lint`, not just a test —
  `unused-imports/no-unused-vars` is an error (`eslint.config.mjs:26`).
- The optional marker on `upsertSpotifyHistory`'s `stats` parameter
  (`lib/local-db/spotify-history/index.ts:13-20`). It is optional only because a
  history restored from the OPFS cache had counts but no timestamps; with the
  cache gone the single caller (`HistoryDumpParsing.ts:96`) always passes stats.
  Make it required and delete the comment that explains the old case. Same for
  the `ArtistTrackPlays` comment at `HistoryDumpParsing.ts:10-14`, which
  describes the type as what the cache file stores.

Delete the stale `spotifyHistoryDump.json` once, so the file does not sit in
users' OPFS forever holding a copy of their listening history that nothing
reads. Removing data the app no longer uses is the point of this cleanup, not a
side effect of it. Two details decide whether this works:

- There is no OPFS remove helper — `lib/fileSystemHelpers.ts` exports only
  `writeFile`, `readJsonFile`, and `readTextFile`. It is
  `(await navigator.storage.getDirectory()).removeEntry('spotifyHistoryDump.json')`
  with `NotFoundError` swallowed, which is the common case and not an error.
- Run it unconditionally in Find Music's load effect
  (`FindMusicClient.tsx:367-394`), **not** inside the `existingDatabase` branch.
  A user whose history only ever lived in that file has no local database, and
  the branch would skip exactly the person whose data needs clearing.

The two deleted page suites also encode contracts won by completed plans 0095
and 0097 — a Chorus outage reaching the user but not Sentry, a second click
ignored while the folder picker is open, a scan that finishes after another task
failed leaving the retry visible. Find Music covers the first
(`FindMusicClient.test.tsx:292`) and neither of the others.

Fourteen tests die in total — seven in each suite. Read both files and decide
each contract, rather than only the three named above. The ones with a live
subject in Find Music:

- "shows one aggregate warning for a partial local scan" (`Spotify.test.tsx:139`)
  guards `getLocalScanWarning`, which `FindMusicClient.tsx:542` still calls.
  Port it.
- "does not start background work when folder selection is canceled" (`:157`)
  and "reports a folder acquisition failure without starting background work"
  (`:174`) describe the picker-cancel path that gap 2 is about to touch. Port
  them against `runLocalScan`.
- "returns to the start action when Spotify refresh rejects" (`:115`) and
  `SpotifyHistory.test.tsx:71, 88, 109, 127, 151` describe page states that no
  longer exist. Record them as gone.

Deleting `SpotifyTableDownloader` also strands dependencies. It is the only
importer of `@tanstack/react-table` (with its `TableMeta` augmentation at
`:57-63`), and `@types/react-table` looks dead already — remove both from
`package.json` after checking. `react-virtual` stays: `FindMusicTable.tsx:22`
and `app/drum-fills/components/VirtualCardGrid.tsx:4` still use it.

`public/assets/spotify/logo_black.png` and `logo_white.png` are referenced only
by `app/spotify/app/SignInWithSpotifyCard.tsx:12-13` and become orphans. Delete
them. (`icon_black.png` and `icon_white.png` beside them are already
unreferenced; leaving them is a separate mess, not this plan's.)

Nothing else in `lib/spotify-sdk/` dies: `useSpotifyLibraryUpdate`,
`onPlaylistCacheUpdated`, `resolveSpotifyTrackUrls`, and the auth plumbing all
have Find Music callers. `lib/og/tokens.ts:41-42` (`spotify`, `spotifyInk`) also
survives the two og-image deletions — `app/find-music/opengraph-image.tsx:38,41`
still uses both. Re-grep each candidate after the page deletions rather than
trusting this list — it was written before the files moved.

### The match table becomes a pure write

`spotify_track_chart_matches` has exactly one reader: `Spotify.tsx`. Find Music
matches on normalized artist/name inside its own queries and never touches it.
Once `/spotify` is gone, `recalculateTrackChartMatches` (`lib/local-db/queries.ts`)
still runs on every Spotify library save (`lib/local-db/spotify/index.ts:140`)
and at four points in the Chorus upsert path (`lib/local-db/chorus/index.ts`),
recomputing a full cross-join over a ~94K-row mirror that nothing reads.

Deleting the writes is in scope: one call in `lib/local-db/spotify/index.ts:140`
and four in `lib/local-db/chorus/index.ts` (lines 210, 218, 281, 295 — two of
them inside transactions), plus the table wipe at `chorus/index.ts:275`. All six
go, not just the obvious one — and with them the now-unused imports at
`chorus/index.ts:14` and `spotify/index.ts:10`, or lint fails.

Only three of those recomputes cost anything. `recalculateTrackChartMatches` is
insert-only, and the calls at `:218` and `:295` run just after `chorus_charts`
is emptied, so they insert nothing. The real work is at `chorus/index.ts:210`,
`:281`, and `spotify/index.ts:140`.

`recalculateTrackChartMatches` itself cannot simply be deleted:
`lib/local-db/migrations/007_add_track_chart_matches.ts:56` imports it to
backfill the table it creates, and migrations must keep running for a browser
whose database is older than 007. Either leave the function in place with the
migration as its only caller, or inline its query into 007. Do not rewrite the
migration's effect — a shipped migration is history.

Dropping the table needs a new migration against existing databases, so it may
land as a follow-up plan — but do not leave the recompute wired up in the
meantime; that is the expensive half. `app/find-music/__tests__/queries.*.test.ts`
create the table in their fixture schema; those `CREATE TABLE` lines go when the
table does.

### Redirects

`/spotify` and `/spotifyhistory` are linked from the home page and indexed. Add
three permanent redirects to `next.config.js` beside the plan-0074 block:

| source | destination |
| --- | --- |
| `/spotify` | `/find-music` |
| `/spotify/app` | `/find-music` |
| `/spotifyhistory` | `/find-music` |

Add the same rows to `__tests__/redirect-config.test.ts`, which asserts on the
array `next.config.js` returns. Its docblock (`:1-11`) explains the redirects as
plan 0074's route model; extend it to name this plan too, so the header still
describes the file.

`app/auth/spotify/page.tsx:15` sends a signed-in user to `/spotify` when no
`next` param is given. Point that at `/find-music`, so the login round-trip does
not land on a redirect.

## Phase 3 — home page

`app/page.tsx` has five cards. Delete "Spotify Library Scanner" (`/spotify`) and
"Spotify History (advanced!)" (`spotifyhistory`); add one Find Music card first
in the grid — it is the tool the page's own opening paragraph describes.

- Title `Find Music`, with the `New` badge the other recent tools carry.
- The description has to absorb both deleted cards' promises: charts on Chorus
  for the music in a Spotify or Apple Music library, for a listening history,
  and recommendations from what is already played.
- `href="/find-music"`. Existing links in this file are inconsistently rooted
  (`href="spotifyhistory"` vs `href="/spotify"`); write the new one rooted.
- Use `CardContent`, not `CardFooter` — the two deleted cards disagree, and
  `CardContent` is what the other three use.
- Drop two now-unused imports, not one: `RxExternalLink` (used only by the
  Spotify History card, line 97) and `CardFooter` (used only by the Spotify
  Library Scanner card, line 81). `unused-imports/no-unused-imports` is an
  error, not a warning (`eslint.config.mjs:24-25`), so a missed one fails lint.
  The link to Spotify's privacy page is not lost: `FindMusicWelcome` carries its
  own.

## Analytics

Delete two event types from the `AnalyticsEvent` union
(`lib/analytics/track.ts:21-27`): `spotify_instrument_filter_changed` and
`spotify_hide_downloaded_toggled`. Their only emitter is
`SpotifyTableDownloader`. An unused union member does not fail typecheck, so
nothing will remind you — do it in the same edit as the deletion.

`chart_downloaded.source` keeps a `'spotify' | 'spotify_history'` union whose
only producers are the deleted pages. Replace both with `'find_music'` and pass
it from `FindMusicTable.tsx:158`, which sends `'unknown'` today — so every Find
Music download is currently unattributed.

That union is declared twice. `lib/analytics/track.ts` has one copy and
`downloadSong`'s `options.source` (`lib/local-songs-folder/index.ts:348-364`)
has a hand-kept duplicate; `FindMusicTable` passes through the second. Change
only `track.ts` and the call site fails to typecheck. Change both — and extract
the union to a named type in `track.ts` that `downloadSong` imports, so the next
edit cannot drift. Update the hard-coded fixtures in
`lib/local-songs-folder/__tests__/download-song.test.ts` (lines 93, 195).

While extracting it, note that `'sheet_music'` and `'karaoke'` have no producers
either: the only two `downloadSong` call sites in the repo are
`SpotifyTableDownloader.tsx:736` and `FindMusicTable.tsx:153`. They are
forward-declarations, as the comment at `track.ts:7-10` says. Leave them and let
0105 settle it; just do not describe the union as fully live.

`app/find-music/__tests__/FindMusicTable.test.tsx:41` mocks `downloadSong`
without asserting its arguments, so nothing would catch a silent return to
`'unknown'`. Add that assertion with the change — otherwise the verification
step below is manual forever.

This is a rename inside a field that is about to be dead, not the funnel rework:
plan 0105 replaces this whole vocabulary with one shape and a `tool` dimension.
Do the minimum here. Historical GA4 rows keep their old `source` values, which
is correct — the pages that produced them will not exist.

## Other references to fix

- `components/chart-editor/__tests__/chart-editor-layout.test.tsx` imports
  `@/app/spotify/WelcomeCard` at line 98 to prove a non-editor page is not
  marked compact. Repoint at another light non-editor component —
  `app/privacy/page.tsx` is plain JSX with no client dependencies, which is what
  the test's own comment asks for. The same file also sets
  `mockPathname = '/spotify'` at line 178 and names the route in comments at
  95-96; fix all of them, not just the import.
- `components/__tests__/SiteChrome.test.tsx` uses `/spotify` as its "not an
  editor route" pathname fixture (lines 18, 43, 109, 135). The assertions do not
  depend on the route existing, but a fixture naming a deleted page misleads the
  next reader. Repoint at `/find-music`.
- `app/globals.css:152` names `/spotify` in the density-scope comment as an
  example of a page that never mounts an editor. Swap the example.
- `plans/in-progress/0101-find-music-instrument-parity.md` — deliverable 13
  (line 190), the acceptance criterion at 211, and the problem statement at
  57-59 (which cites `Spotify.tsx:340` and `SpotifyHistory.tsx:371`) all become
  moot. 0101 is *in progress* and belongs to someone; agree the edit with them
  rather than rewriting an active plan underneath them. Fold this plan's gap 1
  finding into its drum-type discussion if it is still open.
- `plans/todo/0105-chart-authoring-funnel-analytics.md:8` — the discovery group
  is `/find-music` alone.
- `plans/todo/0090-selector-unification.md:112` — drop the
  `app/spotifyhistory/SpotifyHistory.tsx:173` cell from the
  `showDirectoryPicker` inventory; the other two call sites stand.
- `plans/in-progress/0099-design-system-convergence.md:188-189` — remove the two
  og-image rows.

Completed plans record what happened and are not edited.

## Verification

- `pnpm test`, `pnpm typecheck`, `pnpm lint` clean. Typecheck is what catches a
  missed import of a deleted module.
- Every Phase 1 row confirmed in the running app, and every gap resolved in
  writing.
- `/spotify`, `/spotify/app`, `/spotifyhistory` each land on `/find-music`.
- Home page shows the Find Music card and neither Spotify page.
- A download from `/find-music` reports `chart_downloaded` with
  `source: 'find_music'`.
- A Chorus refresh and a Spotify library save no longer recompute
  `spotify_track_chart_matches`, and a browser with a pre-007 database still
  migrates cleanly.
- Track previews still work on `/find-music` — the check that `getTrackUrls`
  survived the `useTrackUrls` deletion.
- Grep for `spotifyhistory`, `app/spotify/`, `SpotifyTableDownloader`, and
  `SpotifyPreviewButton` returns only plan text. Exclude `.claude/worktrees/` —
  it holds a second checkout of the whole app, including these files, and will
  otherwise make the check look failed.
- A chart by a charter with rich-text markup renders the plain name (gap 1).
- With a Songs folder already chosen, opening `/find-music` rescans it without
  being asked; with no folder ever chosen, opening it prompts for nothing
  (gap 2).
- `spotifyHistoryDump.json` is gone from OPFS after a visit, and importing a
  history no longer creates it.

## Out of scope

- Building anything new in Find Music, beyond the two fixes the audit requires
  (gaps 1 and 2). Any further gap gets its own plan and lands before this one
  deletes the code it replaces.
- The Spotify-card filter that would exclude chosen playlists from mattering.
  This plan only makes sure the columns it will need survive.
- `/account`'s Spotify connection UI, `/auth/spotify`'s form, and the rest of
  `lib/spotify-sdk/`. Spotify as a source stays; only these two pages go.
- Dropping the `spotify_track_chart_matches` table itself, if the migration is
  split out.
- Plan 0105's analytics rework.
