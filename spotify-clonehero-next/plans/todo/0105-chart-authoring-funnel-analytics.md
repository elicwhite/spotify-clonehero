# 0105 — Funnel analytics for the chart-authoring tools

Status: todo

The chart-authoring tools — `/add-lyrics`, `/drum-transcription`, `/tempo`,
`/guitar-difficulties`, `/drum-difficulties` — all end in the same place, the
chart editor. They are one functional group, separate from the discovery group
(`/find-music`). Only one of them reports
anything to analytics today.

Google Analytics, last 90 days:

| Route                  | Engagement | Users | Events        |
| ---------------------- | ---------- | ----- | ------------- |
| `/chart-editor`        | 360,714 s  | 23    | **none**      |
| `/tempo`               | 167,763 s  | 21    | **none**      |
| `/add-lyrics`          | 74,183 s   | 200   | 6 event types |
| `/drum-transcription`  | 46,570 s   | 13    | **none**      |
| `/guitar-difficulties` | 602 s      | 6     | **none**      |
| `/drum-difficulties`   | 0 s        | 1     | **none**      |

The chart editor holds more engagement time than any other page on the site,
from 23 people, and reports nothing. `/add-lyrics` is the only tool with a
funnel, and it is a good one: 53 users loaded a chart, 48 started an alignment
(91%), 36 completed (75%), 28 exported (58% end to end).

That funnel also shows the failure this plan must not repeat. 9 users hit
`add_lyrics_align_failed`, and all 47 failure events report `step: "unknown"`.
The field that was supposed to explain the failures never gets a real value.

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

**Extend the union** to cover the whole group:

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

## The funnel

| Step | Event                  | Fires from                        |
| ---- | ---------------------- | --------------------------------- |
| 1    | `tool_landing_viewed`  | each landing route                |
| 2    | `chart_opened`         | `TrackEditPage.handleChartLoaded` |
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

1. `components/assist/useAssistTaskRun.ts` — one shared place covering all
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

`ExportDialog.handleExport` fires `chart_exported` `{origin, format}`, format
being `sng` or `zip`.

Then remove the events the generic ones replace:

- `add_lyrics_align_started`, `add_lyrics_align_completed`,
  `add_lyrics_align_failed`, `add_lyrics_realign` → `assist_run_*` with
  `task: 'add-lyrics'`
- `add_lyrics_chart_loaded` → `chart_opened`
- `add_lyrics_exported` → `chart_exported`

Keep both for one release so the series overlap, then delete. Note in the
commit that the historical `add_lyrics_*` series ends on that date: a GA4
report spanning the cut shows a cliff that is not a real change in usage.

`sheet_music_*` stays. Sheet music is a consumption page, not part of this
group, and its events answer a different question.

## Stage 6 — register the dimensions

Event parameters are not reportable until they are registered as custom
dimensions in the GA4 admin UI. This is manual, and skipping it makes the
whole plan collect data no report can read.

Register `origin`, `entrypoint`, `task`, `step` and `reason` as dimensions,
and `durationMs` as a metric. `sourceFormat` and `format` already exist.

GA4 allows 50 event-scoped custom dimensions. 11 are used, so there is room.

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
- `track` never receives a chart name, file name, or artist.

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
