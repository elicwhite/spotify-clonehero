# 0107 — Format-faithful projects, and every tool page hands off to `/chart-editor`

Status: in-progress

`/tempo` and `/drum-transcription` end the same way: they write an OPFS project,
then they send the user to `/chart-editor?project=<id>`. The landing page is the
entry ramp. The editor is the destination.

Three tool pages do not do this. `/add-lyrics`, `/drum-difficulties`, and
`/guitar-difficulties` render `<ChartEditor>` inline, hold the chart in React
state, and end at a Download button. Nothing is written to OPFS. A reload loses
the work. The project list does not show the chart. The user cannot continue with
the other assist tasks on the same chart.

The handoff cannot be added first, because the project store is not yet safe to
hand a chart to. Phase A makes it safe. Phase B does the handoff.

## The gap

| Page | Client | End state |
| --- | --- | --- |
| `/tempo` | `app/tempo/TempoClient.tsx:299` | `router.push('/chart-editor?project=…')` |
| `/drum-transcription` | `app/drum-transcription/DrumTranscriptionClient.tsx:186,259` | `router.push` / `router.replace` |
| `/add-lyrics` | `app/add-lyrics/AddLyricsClient.tsx:646` | inline `<ChartEditor>`, download only |
| `/drum-difficulties` | `components/difficulty-generation/DifficultyGenerationFlow.tsx:501` | inline `<ChartEditor>`, download only |
| `/guitar-difficulties` | same shared flow | inline `<ChartEditor>`, download only |

`/preview` is out of scope. It is a read-only viewer (`PREVIEW_CAPABILITIES`,
`app/preview/PreviewViewer.tsx:41`), not a tool that produces a chart.

The handoff itself is small. There is no store, no context, and no blob channel.
A page calls `createProject(...)` (`lib/project-storage/opfsProjectStore.ts:200`),
then it pushes the id in the query string. `TrackEditPage.tsx:166` reads
`searchParams.get('project')` and `:220-256` resolves it.

**Every assist task these three pages run already exists in the editor.**
`lib/assist/tasks/` holds `add-lyrics.ts` and `generate-difficulties.ts`. Lyrics
are reachable from `sidebar/LyricsCard.tsx`. Difficulty generation for a fresh
chart is reachable from the Chart Matrix row's "Generate H · M · E" bar
(`sidebar/ChartMatrixRow.tsx:8-11`, `hooks/useDifficultyGeneration.ts:4-7`),
which covers guitar as well as drums
(`lib/chart-editor-core/trackInventory.ts:8`; bass generation ships disabled by
design). `sidebar/DifficultyGenerationCard.tsx:4-8` is the *staleness* card and
renders only after a generation exists — it is not the fresh entry point. The
three pages are a second, worse host for a task the destination already runs.

---

# Phase A — the project store must be format-faithful

A project is the app's durable copy of the user's chart. It must not quietly
change the chart's format, and an export that does change it must say what that
costs. This is a repo-wide rule, not an `/add-lyrics` concern — `/tempo` breaks
it today.

## A1. Store the source chart file verbatim

`createProject` (`lib/project-storage/opfsProjectStore.ts:246`) writes
`notes.chart` and nothing else. At `:268` it sees `notes.mid` in `allFiles`,
**skips writing the bytes**, and still pushes a manifest entry claiming
`storedIn: 'root'`. `readChartText` (`:420`) and the re-export paths (`:546`,
`:562`, `:613`) are all `.chart`-only.

The data this costs is not cosmetic. The scan-chart `.chart` writer emits vocals
as `E "phrase_start"` / `E "lyric …"` text events only, and the reader rebuilds
them with `length: 0` and no pitch. A `.mid` chart that goes through a project
loses vocal note pitches, phrase lengths, harmony parts, `rangeShifts` and
`lyricShifts`. `/tempo` forces this on every MIDI input today
(`app/tempo/TempoClient.tsx:277`, `format: 'chart'`).

Work:

- Add `chartFileFormat: ChartFileFormat` to `ProjectMetadata`
  (`opfsProjectStore.ts:39` region). `sourceFormat` is the *package* format
  (zip/sng/folder) and is not the same thing.
- Write the source chart file under its own name: `notes.mid` for a MIDI source,
  `notes.chart` otherwise. Stop the `:268` special case from lying in the
  manifest.
- Teach `readChartText` and the re-export paths to read whichever file the
  metadata names.
- Migrate on read, not with a schema bump: a project with no `chartFileFormat`
  is `'chart'`. Every project that exists today genuinely is.
- Delete `TempoClient.tsx:277`'s `format: 'chart'` and its workaround comment.

## A2. Tell the user what an export format costs

`ExportDialog` already has the warning. `:638-668` renders the chart-file select
and the lossy note whenever `sourceChartFormat` or `chartFormatSelectable` is
set. The only caller that sets either is
`app/drum-transcription/components/EditorApp.tsx:808`. `TrackEditPage`'s
`<ChartEditor>` (`:1114-1149`) passes neither, so on `/chart-editor` the select
does not render, no format is badged as the source, and the file is silently
renamed by `chartPackageFileName` (`ExportDialog.tsx:597`).

Work:

- Thread the project's `chartFileFormat` from `TrackEditPage` into
  `sourceChartFormat`, and set `chartFormatSelectable`.
- The existing warning text at `:655-668` is generic ("some .mid-only data may
  not survive"). Make it name what actually goes: for `.mid` → `.chart`, vocal
  pitches, phrase lengths, and harmony parts. That sentence is the reason this
  phase exists.
- Keep the user's original filename for an export whose format is unchanged.
  `chartPackageFileName` has no override today; add one.

## A3. `ProjectOrigin` gains two values

`lib/project-storage/types.ts:16` is a closed union:
`'chart-editor' | 'drum-transcription' | 'tempo'`. Add `'add-lyrics'` and
`'difficulties'`.

This is a typecheck break, not an additive change:
`components/project-list/ProjectList.tsx:37` declares
`Record<ProjectOrigin, string>` with exactly three entries, and `pageOrigin`
(`:46`, `:113`) needs a decision. Other readers to check before landing:
`DrumTranscriptionClient.tsx:242` (filters its list by origin),
`lib/project-storage/projects.ts:87,109,315`,
`lib/drum-transcription/storage/opfs.ts:97,167,231,267`.

## A4. `createProject` must accept the provenance it is given

`ProjectMetadata` has `audioAnchor` (`:49`) and `assistProvenance` (`:66`), but
`createProject`'s options (`:200-220`) accept neither. `TrackEditPage` only ever
mirrors provenance into metadata on autosave (`:625`) and restores it on load
(`:679-681`).

This matters for Phase B: the difficulty flow's staleness stamp lives in the
doc's `assistProvenance` (computed at `DifficultyGenerationFlow.tsx:183`, applied
at `:325-329`). A project created without it opens with
`selectDifficultyStale` (`lib/chart-editor-core/selectors.ts:111-124`) reading it
as never-generated, and the user's freshly generated tiers look ungenerated.

Add both to `createProject`'s options.

---

# Phase B — the handoff

## B1. One shared helper

There is no shared helper today. `TempoClient.tsx:286-299` and
`TrackEditPage.tsx:298-311` each write their own `createProject` + `router.push`,
with different field sets.

Add `createProjectAndOpen(...)` in `lib/project-storage/`. It must:

- Take the **full** `writeChartFolder(doc)` output as `allFiles`, not
  `chartDocToFolderFiles` (`lib/chart-edit/folder-files.ts:23-36`), which
  `.find`s `{chart, ini}` and discards album art, video, and background art.
- Compute canonical audio bytes with `chartPackageAudioBytes`
  (`components/chart-editor/chartPackage.ts:173`) so the stem fingerprint matches
  what `/chart-editor` derives.
- Resolve and persist `stemFingerprint`, so separated stems stay warm.
- Pass through `chartFileFormat`, `audioAnchor`, and `assistProvenance` (A1, A4).
- Return the new project id. **It does not navigate.** The router push stays at
  the call site; a helper that navigates hides the page's control flow and is
  harder to test.

Migrate `/tempo` to it in this step. `/tempo` already works and has a passing
test of the exact assertion (`app/tempo/__tests__/TempoClient.test.tsx:304-335`),
so it proves the helper.

`GenerationCandidate` (`DifficultyGenerationFlow.tsx:101-109`) keeps none of
`sourceFormat`, `originalName`, or `sngMetadata` — `inspectDroppedChart` reads
`loaded` and discards it. Carry them on the candidate before B3 can call the
helper.

## B2. The editor must be able to hold what these pages produce

Two blockers, both in `TrackEditPage`.

**A lyrics-only chart cannot open.** There are two throw sites, not one:
`:688-698` on project open, and `:272-277` in `handleChartLoaded` for the drop
zone. Both use `NO_SUPPORTED_TRACK_MESSAGE` (`:90`) when the chart has no
guitar, bass, or drums track. The scope seed at `:699-715` is conditional, but a
vocals scope has `kind !== 'track'` so the branch always fires and
`config.defaultScope` can never win. Make the vocals scope a legal opening scope
when no instrument track exists. Note `ChartMatrix` has no vocals row by design
(`sidebar/ChartMatrix.tsx:6-7`), so the scope must be reachable another way.

**The vocals waveform is not wired.** The lyrics row's background waveform comes
from `lyricsWaveData` / `lyricsWaveChannels` (`ChartEditor.tsx:64-66`, forwarded
at `:464-465`). The only supplier is
`app/drum-transcription/components/EditorApp.tsx:135,531` (`vocalsStemPcm`).
`TrackEditPage.tsx:1114-1149` passes neither. `useSeparatedStems.ts:33` already
pulls `VOCALS_STEM` from the cache, but only into the mixer and playback path.
Route it into the lyrics row as well.

The stem cache key must match, or this is a permanent miss. `/add-lyrics`
fingerprints `pickSongFile(chart).data` (`AddLyricsClient.tsx:146-155`, used at
`:338`); `/chart-editor` fingerprints `chartPackageAudioBytes(audioFiles)`
(`chartPackage.ts:173-191`), which mixes multi-stem packages down and re-encodes.
Switch `/add-lyrics` to `chartPackageAudioBytes` for the run itself, so one key
serves both.

## B3. Convert `/drum-difficulties` and `/guitar-difficulties`

Both routes share `components/difficulty-generation/DifficultyGenerationFlow.tsx`,
so one change covers both. The file header (`:15-16`) and `:458-460` both state
that no OPFS project backs it; delete those statements with the behavior.

- Replace the `{editor, loaded}` arm of `FlowState` with a handoff: call the B1
  helper with `origin: 'difficulties'` and the doc's `assistProvenance`, then
  push.
- Delete the inline `<ChartEditor>` at **`:501-518`** (the component ends at
  `:521`).
- **Do not delete `:458-475`.** Those lines are a comment, `useEditorKeyboard()`,
  `loadAudioFiles`, and `useChartPackageEditor` inside `GeneratedChartEditor`.
  The provider stack is at **`:191-205`**, and the *run* path depends on it:
  `useChartEditorContext().dispatch` (`:234`, `:315`, `:330-342`),
  `useAssistRunnerContext()` (`:235`, `:319`), `useAudioServiceContext()`
  (`:236`, `:314`). Removing it stops generation working.
- `CHART_PACKAGE_ASSIST_DISABLED_REASONS.leadingSilence` (`:483-484`) is declared
  because this flow plays package audio unpadded. `TrackEditPage` pads through
  `usePaddedAudio` / `audioAnchor` and declares no disabled reason
  (`chartPackage.ts:198-206`). The handoff **removes** the limitation. Record it
  as a gain; do not carry the flag over.
- `components/difficulty-generation/__tests__/DifficultyGenerationFlow.test.tsx`
  asserts the inline editor at `:301`, `:332`, `:346` (guitar), `:362`
  (chart-delay and click-stem playback), `:401` (cancel applies nothing), `:420`
  and `:437` (AudioManager teardown on leaving the editor). All need rework in
  this step.

These go first. They already use the chart-package host boundary
(`useChartPackageEditor`, `prepareChartPackageAudio`), so they are closest to the
destination, and they carry no MIDI or vocals risk.

## B4. Convert `/add-lyrics`

Last, because it depends on every part of Phase A and on both blockers in B2.

- Keep `status: 'idle' | 'loading-chart' | 'input' | 'processing' | 'error'`
  (`AddLyricsClient.tsx:83-89`; `'error'` is used at `:310`, `:390`, `:683`,
  `:723`). Delete `'done'` only — the run now ends in a navigation.
- After `handleAlign` (`:314`) succeeds, apply the syllables with
  `applyAlignedLyricsToDoc`, call the B1 helper with `origin: 'add-lyrics'`, the
  source `chartFileFormat`, and the resolved `stemFingerprint`, then push.
- Delete the editor build effect (`:439-527`), `EditorHeaderRow` (`:563-606`),
  the inline `<ChartEditor>` (`:646-657`), `handleDownload` (`:400-432`), and
  `app/add-lyrics/export-chart.ts` if nothing else imports it. Note
  `app/add-lyrics/__tests__/export-chart.test.ts` exists.
- Delete the intro modal and its `localStorage` key
  `add-lyrics:editor-intro-shown-v1` (`:494`). The editor's own onboarding takes
  over.
- **Do not delete `ADD_LYRICS_CAPABILITIES` or `DEFAULT_VOCALS_SCOPE.`** They are
  capability fixtures across the editor suite: `chart-matrix.test.tsx:36,131`,
  `multi-pane-highway.test.tsx:33,41,617-618`,
  `generate-difficulties-command.test.ts:20,167-171`,
  `replace-drum-track-command.test.ts:9,239`,
  `highway-shared-chrome.test.tsx:38`, `reducer.test.ts:24,398-400`.
  `components/chart-editor/affordances.ts:11` names `/add-lyrics` in a comment
  that should be reworded, not removed.

## B5. Page chrome and analytics

**`SiteChrome`.** `components/SiteChrome.tsx:48-52` gives `/add-lyrics`,
`/drum-difficulties`, and `/guitar-difficulties` the compact header and the
editor gutter `px-3 pb-3`, justified at `:38-40` by "every page that mounts
`ChartEditor` somewhere in its tree". After conversion they mount no editor and
the file's own rule at `:42-44` says landing pages carry the regular nav. Move
them. `components/__tests__/SiteChrome.test.tsx:84-85` asserts
`/add-lyrics/anything` is an editor route and must change with it.

**Analytics.** `lib/analytics/track.ts:54-66` types six add-lyrics events.
Phase B4 deletes the emitters of `add_lyrics_exported` (`:400-432`) and
`add_lyrics_realign` (`:591`). `add_lyrics_exported` is the funnel's terminal
event; removing it silently makes every `/add-lyrics` run look unconverted. Name
the replacement here — the handoff itself is the new terminal event. Leave the
wider vocabulary rework to plan 0105.

**OG images.** `/add-lyrics` has `opengraph-image.tsx`; `/drum-difficulties` and
`/guitar-difficulties` have none. Nothing to preserve for the latter two.

**Run UI.** The pages render `components/assist/ConnectedProcessingView`, not
`components/ProcessingView` directly. Both stay.

---

## Storage growth

Neither `/add-lyrics` nor the difficulty pages write anything to OPFS today. A
`/add-lyrics` user working on somebody else's chart currently pays zero storage;
after conversion every run copies the whole package — often tens of megabytes —
into OPFS permanently.

The app has no quota check, no `navigator.storage.estimate()`, no
`persist()` request, and no eviction anywhere. The only way to reclaim space is
the project list's delete button.

This plan accepts the growth, because it is the pattern `/tempo` and
`/drum-transcription` already set and the durable project is the point. It does
**not** accept it silently: quota handling is a real gap that this plan makes
larger, and it gets its own plan. If `createProject` can fail on a full disk,
the handoff must show that failure rather than navigate to a broken project.

## Verification

- `pnpm test`, `pnpm typecheck`, `pnpm lint` clean after every step.
- A `.mid` chart taken through `/tempo` and re-exported as `.mid` keeps its
  vocal pitches, phrase lengths, and harmony parts. This is a live bug today and
  is the single clearest proof Phase A worked.
- Exporting that chart as `.chart` shows a warning that names what is lost.
- Each of the five tool pages ends on `/chart-editor?project=…`.
- Reloading the editor after a handoff keeps the work. This is the user-visible
  win.
- A chart run through `/add-lyrics` shows its aligned syllables, with the vocals
  waveform behind them.
- A chart run through `/drum-difficulties` shows generated Hard, Medium, and Easy
  tiers in the chart matrix, not flagged stale.
- `/guitar-difficulties` does the same for a guitar chart.
- The project list shows a labelled project for each of the three converted
  tools.
- `/add-lyrics`, `/drum-difficulties`, and `/guitar-difficulties` render the
  regular nav, not the compact editor header.

## Out of scope

- Deleting the three landing pages. They are the discovery route for their tool
  and they stay. Only the editor they render goes.
- `/preview`, which is a viewer.
- Merging the two OPFS layouts. `drum-transcription` keeps its own directory
  shape and its own `EditorApp` render path.
- OPFS quota handling and eviction.
- Plan 0105's analytics rework, beyond naming the replacement terminal event.
