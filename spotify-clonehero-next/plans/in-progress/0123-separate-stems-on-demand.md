# 0123 — Separate stems on demand from the chart editor

Status: in-progress

## The problem

The editor shows AI-separated stems on the Stems mixer, but nothing in the
editor can *make* them. `useSeparatedStems` only reads back what some other
run already wrote into the fingerprint-keyed stem cache
(`lib/audio-pipeline/stem-cache.ts`), and the only writers are assist tasks
that separate as a side effect of doing something else:

| Writer                            | Separator   | Stems written             |
| --------------------------------- | ----------- | ------------------------- |
| `generate-tempo-map`, drum tasks  | BS-Roformer | `drums` + `vocals`, 44.1k |
| `add-lyrics` cache-miss fallback  | Demucs      | `vocals`, 16 kHz mono     |

So a user who opens a chart and never runs one of those features has no
isolated drums to check a fill against and no vocals under the lyrics row. A
user whose browser evicted the stem cache (plan 0120) silently loses them and
has no way back except re-running a feature they do not want.

## What is wanted

Two entry points, offered only when the separation would add something:

- the Stems mixer section in the left sidebar;
- the piano roll's waveform-row right-click menu.

Two options in each:

- **Good and fast** — Demucs (`htdemucs_fp32`, ~169 MB model).
- **Great and slow** — BS-Roformer (~336 MB model).

Constraints stated with the request:

- it must not change what gets exported;
- it must not change how the AI features resolve their own stems. A feature
  that wants the BS-Roformer stem and finds only the Demucs one re-separates
  with the one it needs, exactly as it does today.

## Both options must produce drums and vocals

`lib/lyrics-align/demucs-worker.ts` today decodes only `VOCALS_INDEX` out of
the model's four sources and returns 16 kHz mono, because vocal alignment is
all it was ever run for. Offered as "good and fast" beside a BS-Roformer
option that gives drums and vocals at 44.1 kHz stereo, a vocals-only fast
path would be an option that runs for a minute and, on a chart that only
lacks drums, adds nothing at all.

htdemucs already emits `['drums', 'bass', 'other', 'vocals']`; the worker
just never reads index 0. So the fast option extracts drums as well, and the
two options differ in quality and time, not in what they give you.

## The approach

### 1. Demucs worker: extract what the caller asks for

Per segment the worker copies one source's spectrogram, runs one iSTFT and
accumulates into one output buffer. Make that a loop over the wanted sources
(`drums` = 0, `vocals` = 3) with one output buffer each.

The request says what to send back:

```ts
interface DemucsSeparationRequest {
  drums?: boolean;      // 44.1 kHz stereo drums
  vocals?: boolean;     // 44.1 kHz stereo vocals
  vocals16k?: boolean;  // 16 kHz mono vocals (the aligner's input)
}
```

`vocals` and `vocals16k` are separate flags because they are separate
products of one extraction: alignment wants only the small one, and shipping
it the 44.1 kHz buffer as well would transfer ~85 MB it immediately drops.

`runDemucsInWorker` grows the request as an explicit argument rather than
defaulting, so every call site names what it is paying for. `add-lyrics` is
the only production caller and passes `{vocals16k: true}` — byte-identical
behaviour to today.

The model cache key and min-bytes are literals inside the worker. They move
to `lib/lyrics-align/model-urls.ts` beside a `hasDemucsModelCached()` probe
(mirroring `hasBeatThisModelCached`), so a step list can predict the download
and the probe cannot drift from what the worker actually fetches.
`hasRoformerModelCached()` joins `lib/tempo-map/models.ts`, whose constants
are already there.

### 2. A cache identity for full-rate Demucs stems

`DEMUCS_SEPARATOR_ID` describes 16 kHz mono vocals, and its own comment is
why: entries under one id are interchangeable, so 44.1 kHz stereo cannot go
there. Add

```
DEMUCS_STEREO_SEPARATOR_ID = `${MODEL_URLS.demucs}|drums|stereo|44100|fp32`
```

holding `drums` (gzip planar, like BS-Roformer's) and `vocals` (Opus 44.1 kHz
stereo, like BS-Roformer's).

A Demucs run also writes the 16 kHz mono vocals under the existing
`DEMUCS_SEPARATOR_ID`. It is about a megabyte, it is already computed, and it
means a later `add-lyrics` run hits the cache instead of separating again —
which is the "shouldn't impact the AI features" constraint met in the
direction that helps.

### 3. A `separate-stems` assist task

`lib/assist/tasks/separate-stems.ts`. Input `{audio, model: 'demucs' |
'roformer'}` — one task with a model arm rather than two tasks, so one run
card, one runner lock and one analytics id cover both.

- `roformer` arm delegates to `separateStems(bytes, {drums, vocals, signal})`,
  which already probes the cache, separates once and stores both. The
  returned buffers are dropped; the cache is the product.
- `demucs` arm decodes to 44.1k, runs the worker with all three flags, and
  stores the three entries above.

Steps: model download (predicted `cached` from the probes above), separation,
storing — reported through the same `AssistProgressSink` every other task
uses, so `AssistRunCard` renders it with no new renderer.

### 4. Keep it out of `toolsApplied`

`useProjectToolsApplied` records every successful run, and `toolsApplied`
feeds the `tools` parameter on `chart_exported` — "the tools the shipped
chart was built with". Separation writes no chart edit and changes no
exported byte, so recording it would misreport every export after it.

Add the set of tasks that change the chart to `lib/assist/tasks/types.ts` and
have the hook filter on it. `TOOL_ANALYTICS_ID` still gains a
`separate-stems` entry: it is `satisfies Record<AssistTaskKey, string>`, and
that map is what the tools-param test enumerates.

### 5. Which options to offer

`useSeparatedStems` already computes what the package itself lacks
(`wantDrums`, `wantVocals`) and probes for each. Extend its return from a bare
stem array to `{stems, offer}`, where a separator is offered when it does not
already hold every wanted stem — so a project carrying only the old 16 kHz
Demucs vocals can still be upgraded, in either direction, and a package that
ships its own drums and vocals offers neither.

Mixer probe order per stem, cheapest hash first and each computed only on a
miss: drums — BS-Roformer, then Demucs-stereo. Vocals — BS-Roformer, then
Demucs-stereo, then the 16 kHz mono entry.

### 6. Wiring

`TrackEditPage` owns the run (it has the runner, the audio loader and the
`offer`) and passes one `stemSeparation` object down. `ChartEditor` forwards
it to `LeftSidebar`/`StemsMixer` and to `PianoRollTimeline` — both are
rendered directly by `ChartEditor`, so no new context is needed. A host that
passes nothing (`ChartEditor` used bare, `/drum-transcription`'s `EditorApp`,
which separates on the way in) shows no affordance, matching the existing
"a card with no wiring is not rendered" convention.

- `StemsMixer`: a `CardAction` per offered option under the stem rows, and a
  `ConnectedAssistRunCard` scoped to `separate-stems` so progress and Cancel
  live where the stems will appear.
- `PianoRollTimeline`: `buildSourceMenu` appends the same items under the
  source radio list. The menu only starts the run; progress shows in the
  sidebar.

Nothing re-probes by hand: `separate-stems` joins `SEPARATING_TASKS` in
`useSeparatedStems`, which is what already puts a freshly separated stem on
the mixer without a reload.

## Out of scope

- `/drum-transcription`'s `EditorApp`.
- How `add-lyrics` and `generate-tempo-map` choose their stems.
- Export.

## Tests

- `demucs-worker-client`: the new request reaches the worker, and each
  requested buffer comes back.
- `separate-stems` task: step plan with and without a cached model, the
  roformer arm delegating to `separateStems`, the demucs arm's three cache
  writes, cancellation.
- `toolsApplied`: a successful `separate-stems` run is not recorded.
- `useSeparatedStems`: the offer rules, including the Demucs-16k-only case.
- `stems-mixer`: actions render only when offered.
- piano roll: the waveform menu carries the items.

## What is left

Everything above is implemented and covered by tests; `pnpm typecheck`,
`pnpm test` and ESLint/Prettier are clean.

One thing is not verified: the Demucs arm has never separated real audio.
The worker change is mechanical — the same per-segment iSTFT it already ran
for `VOCALS_INDEX`, now looped over the requested sources — but nothing has
confirmed that source index 0 sounds like drums, or measured what one run
costs. A 4-minute song now holds four song-length Float32 buffers (drums
L/R and vocals L/R, ~170 MB) plus the mono downmix, against the two the
vocals-only path held. BS-Roformer's own path allocates the same, so this is
not new for the app, but it is new for Demucs.

So the next session should run "Good and fast" on a real chart in the browser
and check three things: the drums row sounds like drums, the run finishes
without an out-of-memory kill, and a later `add-lyrics` run reports its
vocals step as cached.
