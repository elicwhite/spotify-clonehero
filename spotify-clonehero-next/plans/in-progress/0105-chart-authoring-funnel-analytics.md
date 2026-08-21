# 0105 — Funnel analytics for the chart-authoring tools

Status: in-progress

## Implementation notes

Stages 1 to 5 are built. Stage 6 is a manual change in the GA4 admin UI and
is the one outstanding item — until it is done the events are collected but
no report can read them.

**Where the events fire.**

| Event                  | Fires from                                              |
| ---------------------- | ------------------------------------------------------- |
| `tool_landing_viewed`  | `components/analytics/useToolLandingView.ts`, called by each of the five landing clients |
| `chart_opened`         | `TrackEditPage.handleChartLoaded`, the blank/audio starts, `DifficultyGenerationFlow.handleChartLoaded`, and each of the three tools' hand-off into the editor |
| `chart_open_failed`    | the same three, classified by `chartOpenFailureReason` / `ChartInspection.reason` |
| `assist_run_*`         | `useAssistRunner.start`                                  |
| `chart_exported`       | `ExportDialog.handleExport`                              |

**A code review changed the shape of two of these.** Recorded here because
both were silent failures that the tests as first written did not catch.

*An unpublished origin is now visible, not defaulted.* `selectChartOrigin`
returned `'chart-editor'` for a chart whose host had not published one — and
only `TrackEditPage` published it, so every export and every assist run from
the drum-transcription editor reported `chart-editor`. That is exactly the
outcome post-release check 3 exists to detect, and it was undetectable: the
wrong value is indistinguishable from the right one. The selector is now
`selectReportedOrigin` and returns `UNSET_ORIGIN` when nothing published, so
a host that forgets shows up as a hole. `EditorApp` publishes, and
`PreviewViewer` does not need to (`showExport: false`, `chartAssist: false`).

*The tools-applied observer was level-triggered.* A finished run's status
lingers for `TERMINAL_FLASH_MS`, and the runner outlives the component that
opens a project — so opening project B within that window recorded project
A's run onto B and overwrote B's real list. It now triggers on a run
REACHING success. Both stores carry the field, and the hook takes the
writer as an argument rather than one store.

**How `origin` reaches an in-editor run.** The plan assumed each call site
knew its own origin. Four of the seven do not: the Chart Assist cards, the
Chart Matrix row and the Add Lyrics dialog are all inside an editor that
could be holding any project. So the loaded project's origin is published
into editor state (`ChartEditorState.chartOrigin`, `SET_CHART_ORIGIN`,
`selectReportedOrigin`) as the project opens, and those surfaces read it from
there. `AssistRunContext` is a required third argument to `runner.start`, so
a new call site cannot compile without declaring both dimensions.

**`?from=` seeding is built but not yet load-bearing.** `parseProjectOrigin`
validates the parameter and `TrackEditInner` stamps every project it creates
with the result. Nothing sends a `from` yet, because no route redirects yet.
It is in place first on purpose: after the redirect change an unseeded origin
is unrecoverable.

**`chart_open_failed` distinguishes storage from parsing.** The `try` block
that opens a chart also creates the project and navigates, so a full disk
reported `parse-error` and would have overstated "users arriving with charts
we refuse". `storage-error` is a fourth reason, chosen by where the throw
came from rather than by re-reading the message.

**`songKey` reports a named sentinel for a chart with no song identity
yet.** Every new chart starts with the same two placeholder constants on
every machine, so hashing them would collapse every unnamed chart onto one
value and report one distinct chart. It sends `unnamed` instead — a value
GA4 certainly keeps and an analyst can count, unlike a blank.

**A second review pass changed four more things.**

*The `tools` parameter could not carry its own answer.* Sorted and joined,
the six task keys come to 106 characters and GA4 drops a value past 100 — so
the chart that used every tool, the single row "which tools ship together"
most wants, was the one row that would have lost the field. Each task now has
a short analytics id (`lib/analytics/tools-param.ts`); all six join to well
under the limit. Those ids are a wire format: changing one splits its history.

*Two surfaces could report a stale origin.* Reading the whole editor `state`
inside a `useCallback` made `state` a dependency that was not declared, so
the callback could hold a snapshot from before `SET_CHART_ORIGIN`. The origin
is now derived in render scope and the dependency is a primitive.

*`chart_opened` fired before the chart had opened.* The difficulty flow
reported it right after inspection, then could still fail building audio and
return the user to the picker with no event at all — overcounting step 2 and
hiding the failure. It now reports after the audio is built, and reports
`storage-error` when that fails, matching what `TrackEditPage` does.

*The tools observer moved off React's rendered view of the run.* It now
subscribes to the runner store directly, because a task that settles in
microtasks can coalesce `running` and `success` into one render and the edge
would be lost with it. It also unions against what it has already written, so
two runs finishing between renders extend the list instead of replacing it.

Two tests were proven false-passing by mutation and rewritten: the abort
guard's (its fixture honoured the signal, so it exercised the pre-existing
path) and the `storage-error` reason's (it never passed `chartAccepted`).

**A third review pass found one data-corruption path and a set of
false-passing tests.** Recorded because the pattern matters more than the
individual bugs: each round of fixes introduced new ones, and the tests
written alongside a fix were the least trustworthy part of it.

*`useProjectToolsApplied` was thought to be able to write one project's tools
onto another.* It could not: `TrackEditPage` gates the editor behind a
resolve tag, so any `projectId` change renders a spinner and unmounts the
editor before the new id reaches the hook. A fourth pass caught that the
guards added for it were unreachable, and they were deleted again. Both
hosts are now keyed by project id, which states that invariant rather than
leaving it incidental. What remains is the edge trigger and the union
against what the hook has already written — the runner is deliberately not
keyed, so both cover real races — and each is mutation-proved.

*`toolsParam` trusted persisted data.* `toolsApplied` is read back from
`metadata.json`, so a renamed or removed task key mapped to `undefined` and
joined as an empty segment — exporting `"lyrics,"`. Unknown keys are now
dropped, and the 100-character limit, id uniqueness and de-duplication are
asserted against the full key list rather than a hand-written example, so a
seventh task cannot pass silently.

*`storage-error` was thought to mean two different things.* It did not:
`prepareChartPackageAudio` deliberately tolerates a file that will not
decode — it drops the waveform and plays on — so the difficulty route's
catch is reached only when the audio pipeline itself fails to start, which
is the same class of device failure the other surface reports. The
`audio-decode-error` reason added for it was unreachable and has been
removed. A test now pins the real behaviour: an undecodable file still
counts as an opened chart.

`chart_opened` on that route also moved below the still-mounted check: a user
who leaves while the audio builds can never reach step 3, so counting them at
step 2 reads as drop-off.

**One verification item was not reachable as written.** "A superseded run
emits nothing" cannot be produced through the public API — the busy guard
refuses a second start, so `controllerRef` never moves while a run is in
flight and `isCurrent()` never goes false that way. The reachable case with
the same stakes is asserted instead: unmounting mid-run reports exactly one
terminal event, a cancellation, even though the task's own promise settles
afterwards.

**Step 2 is reported at each tool's hand-off, not by the editor.** `/tempo`,
`/add-lyrics` and `/drum-transcription` create the project themselves and
then navigate to `/chart-editor?project=…`. The editor cannot report that
arrival, because opening a project there is also what reopening one a week
later looks like — so each tool fires `chart_opened` where it hands over.
Reopening a finished project from a list deliberately reports nothing.

**Deliberately not instrumented.** `app/sng/SngClient.tsx` packages charts
without going through `ExportDialog`, so `chart_exported` does not count
every export the site can produce.

**The retirement in Stage 5 has not been done.** The `add_lyrics_*` events
still fire beside the new ones, which is what the plan asks for: keep both
for one release so the series overlap, then delete.

## The route change this plan is built for

The standalone routes are becoming landing pages that send the user to
`/chart-editor` on load. That is not yet true in the code — today `/tempo` and
`/drum-transcription` run the task on the route and hand off afterwards, and
`/add-lyrics`, `/guitar-difficulties` and `/drum-difficulties` never navigate
at all — but it is the model this instrumentation must survive.

It has a consequence that has to be designed for now, because it is very hard
to repair later:

**When every route redirects on load, the live route stops carrying any
information.** Every run happens on `/chart-editor`, so a report keyed on the
route says `chart-editor` for all of them, and the landing pages become
unmeasurable past their pageview. Worse, it is a silent loss: the numbers keep
arriving and simply mean nothing.

So this plan keys on provenance that is not the current URL.

## Provenance already exists

`lib/project-storage/types.ts` has a persisted field on every project:

```ts
export type ProjectOrigin = 'chart-editor' | 'drum-transcription' | 'tempo';
```

`/tempo` already writes `origin: 'tempo'` when it creates a project. This
survives the hand-off, so a chart made on `/tempo` stays attributed to `/tempo`
after the user is editing it at `/chart-editor`. It is the right dimension and
it is already on disk.

Two things must change for it to carry this plan.

**Extend the union** to cover the whole group. This part has since landed on
its own — `lib/project-storage/types.ts` already declares all six values — so
Stage 1 is now only the `from` seeding below:

```ts
export type ProjectOrigin =
  | 'chart-editor'
  | 'drum-transcription'
  | 'tempo'
  | 'add-lyrics'
  | 'guitar-difficulties'
  | 'drum-difficulties';
```

`projects.ts` has two different fallbacks for a missing `origin`
(`?? 'chart-editor'` and `?? 'drum-transcription'`). Leave them as they are —
they encode which store a legacy record came from — but never treat a project
written before this change as evidence about tool usage. It is a default, not
an observation.

**The redirect must carry the intent.** A landing page that redirects on load
sends the user to the editor with no chart yet, so the project is created at
`/chart-editor` and would be stamped `origin: 'chart-editor'`. Every landing
page would then attribute its own charts to the editor, which is exactly the
signal this plan exists to produce.

`/tempo` must redirect to `/chart-editor?from=tempo`, and the editor must seed
`origin` from that parameter when it creates a project. Without this the
redirect change silently destroys provenance for the whole group, and no
amount of later analysis recovers it.

## Every task has two entry points

A tool is not a page. Each can be started from its own surface and again from
inside the editor:

| Task                    | Landing surface                            | In-editor entry              |
| ----------------------- | ------------------------------------------ | ---------------------------- |
| `add-lyrics`            | `/add-lyrics`                              | Lyrics card → `AddLyricsDialog` |
| `generate-tempo-map`    | `/tempo`                                   | `TempoMapCard`               |
| `transcribe-drums`      | `/drum-transcription`                      | `DrumTranscriptionCard`      |
| `generate-difficulties` | `/guitar-difficulties`, `/drum-difficulties` | Chart Matrix row           |
| `generate-sections`     | **none**                                   | `SectionsCard`               |
| `add-leading-silence`   | **none**                                   | `LeadingSilenceCard`         |

Two tasks exist only in the sidebar. Their usage is invisible today and has no
landing-page figure to compare against, so nothing can say whether they are
load-bearing or dead weight.

Which cards appear varies by host: `capabilities.chartAssist` is one of `all`,
`tempo-and-silence`, `lyrics-only` or `false`. A card that is never shown
cannot be run, and a report blind to that reads the absence as disinterest.

## Three dimensions

- **`task`** — what ran. The existing `AssistTaskKey`.
- **`origin`** — which tool the chart came from. The persisted `ProjectOrigin`,
  not the current route.
- **`entrypoint`** — how this run was started: `landing`, `assist-card`,
  `matrix-row`, `dialog`.

`origin` and `entrypoint` answer different questions and neither substitutes
for the other. `origin` says the chart came from `/tempo`; `entrypoint` says
this particular run was started from the sidebar an hour into an editing
session. A chart with `origin: 'tempo'` accumulating `assist-card` runs is the
normal, healthy case, not a contradiction.

## Who exported it, and which chart

The three dimensions above say what ran and where it came from. They do not
say **who** ran it, or **how many distinct charts** one person took through
the funnel. Two more params on the export event answer both.

**`charter`** — the `charter` credit from `song.ini`, trimmed and cut to 100
characters. This is a name the charter writes about themselves and publishes
inside every chart they release, so it is a credit and not personal data. It
is the field that answers "which charters use the tool".

**`songKey`** — an opaque 16-character hash of the normalized artist and name
joined by a pipe, not the names themselves. The same song exported five times
gives the same key, so re-exports of one chart collapse to one funnel run.
The digest is shared from `lib/hash/fnv.ts`, which the editor's staleness
stamps use too.

Hash the song, keep the charter readable. The reason is asymmetry, not
caution: a readable song title buys nothing the hash does not, because the
question is "how many distinct charts", never "which songs". A readable
charter name buys the whole question. So the raw string is spent only where
it earns something.

Both params go on `chart_exported` only. Putting them on `assist_run_*` would
attach a chart identity to every step of every run, which is far more data for
an answer the export event already gives.

Do **not** send the song name, the artist, the album, or any file name. The
promise in `app/privacy/page.tsx` and the comment in
`app/RegionAwareAnalytics.tsx` both have to be updated for `charter` and
`songKey`, and neither survives a raw title.

## Which tools a shipped chart used

`assist_run_*` says which tasks were run. It does not say which tasks were run
on **the chart that shipped**: a user can run four tasks, abandon the chart,
open another and export it. Joining runs to exports through GA4 sessions is
guesswork.

A `tools` param on `chart_exported` removes the guess — a comma-joined,
alphabetically sorted list such as `add-lyrics,generate-difficulties`, well
inside GA4's 100-character value limit. One row per combination is exactly the
shape of the question "which tools ship together".

The source has to be persisted, not derived. `state.undoEntries[].command`
holds the applied commands, but that stack is capped at `UNDO_STACK_CAP` and
is empty after a reload, so a charter who works across two sessions would
export with a blank list — a silent undercount of the long, valuable sessions.
Instead, write a `toolsApplied: AssistTaskKey[]` set into the project metadata
beside `origin`, appended when a run reaches `success`. It is one field, in
the same record, written by the same runner that already fires
`assist_run_completed`.

## The funnel

| Step | Event                  | Fires from                        |
| ---- | ---------------------- | --------------------------------- |
| 1    | `tool_landing_viewed`  | each landing route                |
| 2    | `chart_opened`         | the editor's chart-entry surfaces, and each tool's hand-off |
| 3    | `assist_run_started`   | `useAssistRunner.start`           |
| 4    | `assist_run_completed` | `useAssistRunner.start`           |
| 5    | `chart_exported`       | `ExportDialog.handleExport`       |

Step 1 keeps working after the routes become redirects: a redirect-on-load
page can still fire its own event before navigating, and the gap between step
1 and step 2 becomes the landing page's true conversion rate — the number that
says whether a landing page earns its place.

A sidebar run is **not** a funnel of its own and must not be modelled as one.
The chart was already open, so steps 1 and 2 belong to whatever opened it, and
counting them again double-counts the same chart. The sidebar question is
second-order: of the users who reached the editor, how many ran each task, and
did it succeed. `assist_run_*` segmented by `entrypoint` answers that with no
funnel definition at all.

## Why three choke points are enough

`components/assist/useAssistRunner.ts` is the single place every long-running
operation passes through. It already holds the task key, the planned steps, a
step timer, and the terminal transition to `success`, `cancelled` or `error`.
Every tool reaches it — `AddLyricsClient`, `TempoClient` and
`DrumTranscriptionClient` through `useAssistRunnerControls`,
`DifficultyGenerationFlow` through `AssistRunnerProvider`.

`components/chart-editor/TrackEditPage.tsx` is the shared entry surface, and
`handleChartLoaded` already distinguishes the failure modes.

`components/chart-editor/ExportDialog.tsx` is the shared exit.

## Stage 1 — provenance

Extend `ProjectOrigin`. Add `from` handling to the editor so a redirect can
seed it, and have each landing page pass its own tool. This stage stands alone
and is worth landing before the redirect change, because after that change an
unseeded `origin` is unrecoverable.

## Stage 2 — event types

Add the five events to `lib/analytics/track.ts`, with `task`, `origin` and
`entrypoint` as their own params so none is a free string.

## Stage 3 — instrument the assist runner

The largest part of the value.

In `useAssistRunner.start`, beside the existing `store.setState` calls:

- `running` → `assist_run_started` `{task, origin, entrypoint}`
- `success` → `assist_run_completed` `{task, origin, entrypoint, durationMs}`
- `error` → `assist_run_failed` `{task, origin, entrypoint, durationMs, step}`
- `cancelled` → `assist_run_cancelled` `{task, origin, entrypoint, durationMs, step}`

`step` is the planned step active when the run ended, which the runner already
tracks in `plannedSteps`. This is the field `add-lyrics` has been sending as
`"unknown"` for 90 days, and here it costs nothing.

Do not send the error message. It can contain a file name, and file names are
user data.

### Threading `entrypoint` through

`runner.start` cannot infer the entrypoint, so each caller declares it. Seven
call sites in three groups:

1. `components/chart-editor/hooks/useAssistTaskRun.ts` — one shared place
   covering all
   four sidebar cards (`TempoMapCard`, `SectionsCard`,
   `DrumTranscriptionCard`, `LeadingSilenceCard`). It passes `assist-card` for
   all four, being the sidebar's own run helper.
2. `components/chart-editor/hooks/useDifficultyGeneration.ts` → `matrix-row`.
   `components/chart-editor/AddLyricsDialog.tsx` → `dialog`.
3. The landing clients — `AddLyricsClient`, `TempoClient`,
   `DrumTranscriptionClient`, `DifficultyGenerationFlow` → `landing`.

Make the parameter required. An optional one with a default silently labels
every future call site as whatever the default is, and a mislabelled run is
worse than an uncounted one: it lands in the wrong column and nothing looks
wrong.

## Stage 4 — entry and entry failures

In `TrackEditPage.handleChartLoaded`:

- success → `chart_opened` `{origin, sourceFormat}`
- failure → `chart_open_failed` `{origin, reason}`

`reason` is a closed set the code already branches on: `no-supported-track`,
`no-audio`, `parse-error`. This measures how many people arrive with a chart
the tool refuses — invisible today, and the most likely cause of a silent drop
between steps 1 and 2.

`handleCreateBlankChart` and `handleCreateChartFromAudio` fire `chart_opened`
with `sourceFormat` of `blank` and `audio`, so those entries are not counted
as drop-offs.

`DifficultyGenerationFlow` has its own picker and does not use
`handleChartLoaded`. Fire the same two events from its `inspectDroppedChart`
result so the difficulty tools report the same shape.

## Stage 5 — export, and retire the duplicates

`ExportDialog.handleExport` fires `chart_exported`
`{origin, format, charter, songKey, tools}`, format being `sng` or `zip`.
`cleanMetadata` at `components/chart-editor/ExportDialog.tsx:598` already
holds the charter, artist and name, so the whole payload is in scope at the
one line that starts the download.

`app/sng/SngClient.tsx` also packages charts and does not pass through this
dialog. Leave it uninstrumented and say so, rather than letting a reader
assume `chart_exported` counts every export the site can produce.

Then remove the events the generic ones replace:

- `add_lyrics_align_started`, `add_lyrics_align_completed`,
  `add_lyrics_align_failed` → `assist_run_*` with `task: 'add-lyrics'`
- `add_lyrics_chart_loaded` → `chart_opened`
- `add_lyrics_handed_off` → `chart_opened` with `origin: 'add-lyrics'`

`add_lyrics_realign` and `add_lyrics_exported` were in this list when the plan
was written and no longer exist. `/add-lyrics` stopped exporting: it hands the
chart to the editor, and `add_lyrics_handed_off` became the funnel's terminal
event in their place. Nothing to retire there — but note that the 28 exports
in the 90-day figures above were measured under the old shape, so they are not
comparable to `chart_exported` after this plan lands.

Keep both for one release so the series overlap, then delete. Note in the
commit that the historical `add_lyrics_*` series ends on that date: a GA4
report spanning the cut shows a cliff that is not a real change in usage.

`sheet_music_*` stays. Sheet music is a consumption page, not part of this
group, and its events answer a different question.

## Stage 6 — register the dimensions

Event parameters are not reportable until they are registered as custom
dimensions in the GA4 admin UI. This is manual, and skipping it makes the
whole plan collect data no report can read.

Register `origin`, `entrypoint`, `task`, `step`, `reason`, `charter`,
`songKey` and `tools` as dimensions, and `durationMs` as a metric.
`sourceFormat` and `format` already exist.

GA4 allows 50 event-scoped custom dimensions. 11 are used, so there is room.

`charter` and `songKey` are high-cardinality, and a GA4 standard report
buckets rare values of such a dimension into `(other)`. The counts stay
correct; the per-charter breakdown does not. To get the dedupe this plan is
for — distinct `(charter, songKey)` pairs per period — turn on the free GA4
to BigQuery daily export and run the count in SQL. Without it the UI gives
totals and top charters only.

## A pre-existing flake this work did not cause

`components/chart-editor/__tests__/track-edit-page-audio.test.tsx` fails
intermittently when run alongside the rest of `components/chart-editor`, on
`findByTestId('stem-row-drums')` timing out. It passes in isolation every
time.

Measured, not assumed: it still fails with this plan's tools-applied hook
disabled, with the `SET_CHART_ORIGIN` dispatch removed, and with every test
file this plan adds deleted. It fails MORE often without the `key` this plan
put on `TrackEditEditor` than with it. What this plan does contribute is
load: the fuller `components/chart-editor` run goes from one failure to two
with the new suites present.

It is a timing sensitivity in that suite, not a fault in this feature — but
it is worth fixing on its own, and it should not be read as this plan's
result either way.

## Verification

Jest covers the shared choke points, so assert on `track` calls rather than on
GA:

- `useAssistRunner` emits started, then exactly one terminal event, and the
  terminal event carries the active step.
- A superseded run emits nothing. The `isCurrent()` guard already suppresses
  its state writes and must suppress its events too, or a cancelled run
  inflates the completion count.
- `handleChartLoaded` emits `chart_open_failed` with each of the three
  reasons.
- A project created from `/chart-editor?from=tempo` gets `origin: 'tempo'`.
  This is the assertion that protects the redirect change.
- Every `runner.start` call site reports the entrypoint the table above
  assigns it. A test that walks the call sites is worth more than four
  separate assertions, because the failure this guards against is a **new**
  call site, not a changed one.
- `track` never receives a song name, artist, album or file name. `charter`
  and `songKey` on `chart_exported` are the only chart-derived values sent,
  and `songKey` is a hash. Assert the raw title is absent from the payload,
  not merely that some key is populated.
- Two exports of one chart send the same `songKey`, and editing the chart
  between them does not change it. A key derived from chart content instead
  of metadata would break dedupe exactly when the user edits, which is
  always.
- `toolsApplied` survives a project reload, so a chart edited across two
  sessions exports the full `tools` list.

After release, three checks against real data:

1. `assist_run_started` for `task: 'add-lyrics'` matches the retiring
   `add_lyrics_align_started` within noise. If they disagree the new
   instrumentation is wrong, and the old series is the one with 90 days of
   evidence behind it.
2. Every task reports at least one run from each entrypoint it is wired to. A
   task with `landing` runs but no `assist-card` runs means the sidebar path
   is mislabelled or unreachable, not that nobody wants it.
3. `origin: 'chart-editor'` does not swallow the group. If it grows while the
   other origins flatten after the redirect change ships, the `from` parameter
   is not being honoured.

## Two things this plan assumes

Analytics only loads outside the EEA, the UK and Switzerland — see
`app/RegionAwareAnalytics.tsx`. Every figure above is a subset of real
traffic. The funnel stays valid because the ratios come from one population;
the absolute counts are floors, not totals.

Count users, not events. `chart_downloaded` records 21,759 events from 136
users because it fires once per chart in a bulk download. Any event here that
could fire per item must instead fire once with a count.

## Take the baseline first

The per-route engagement table at the top stops being reproducible the moment
the routes become redirects: `/chart-editor` absorbs all of it, and the
comparison between tools is gone. Those figures are the only before-picture
that will ever exist, so keep them in this plan rather than re-deriving them
later.
