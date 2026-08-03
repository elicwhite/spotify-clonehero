# 0074 — Chart Assist sidebar, shared assist engine, and inline pipeline loading

> Revised once after adversarial review (2026-08-02). The first draft's
> "Current state" section claimed plan 0067 was outstanding; it is completed
> and per-row command targeting ships today, which collapsed a whole phase.
> The review also forced: an explicit `affectedTracks` command-interface
> change, defined staleness-under-undo semantics, a resolution to the
> Phase-1-vs-runner duplication contradiction, an explicit engine data-flow
> and cancellation contract (atomic cache writes), and a real multi-highway
> fallback. Findings and their dispositions are folded in below.

## Context

Prototype rounds (2026-08-02, session artifacts: `final-consolidated.html` +
`loading-inline.html`) landed on an approved design for the chart editor's
left sidebar and its relationship to the highway area and piano roll. The
approved model:

- **Chart Matrix**: rows = instruments in the chart (Guitar/Bass/Drums, no
  Vocals row), columns = X/H/M/E. One interaction: clicking a charted cell
  toggles that track's visibility in the highway area and piano roll
  (filled = visible, white/grey = hidden). No focus concept: every visible
  track is simultaneously editable. No note counts, no badge legend;
  provenance lives in tooltips. Lower difficulties exist only as a set:
  a single "Generate H·M·E" button spans the H/M/E columns when absent; a
  "Re-generate H·M·E" button appears under the cells when the Expert chart
  changed after generation (mirrored by a Chart Assist recommendation card);
  a per-instrument overflow menu offers "Delete H·M·E difficulties"
  (set-only, confirm). "+ Add instrument" below the matrix (Guitar/Bass/
  Drums only).
- **Chart Assist**: unordered feature cards (Tempo map, Add leading silence,
  Drum transcription, per-instrument difficulty regeneration recommendation,
  Lyrics/Vocals), each with a one-sentence explanation and a Learn more
  modal. Amber call-to-action state when a recommendation fires (leading
  silence detector, staleness). No pipeline/wizard ordering.
- **Inline loading treatment**: when an assist action runs the ML pipeline,
  the triggering card expands in place into a step list (ProcessingView
  style: per-step progress, gated ETA, detail line, durations, cancel, no
  overall ETA). The rest of the editor stays interactive; only the affected
  track's matrix cells and piano-roll row lock with a processing treatment.
- **Stems mixer**: one row per stem (real charts ship e.g. song/guitar/
  rhythm/drums/vocals.ogg), volume slider + mute/solo with true solo-bus
  semantics, AI-separated stems badged, drop-a-file-to-add-a-stem row, and
  the click (metronome) volume as the last row.
- **Utilities**: Snap dropdown (1/4..1/32), playback speed, A/B loop,
  cursor+add tools, undo/redo. No zoom, no highway style, no sheet music
  toggle.
- **Responsive**: below a wide breakpoint, the piano roll spans the full
  window under everything (today's behavior); at >=1440px the sidebar is
  full-height with highways + piano roll stacked to its right.
- Vocals: not in the matrix; surfaced in Chart Assist and always present as
  a pinned piano-roll lane when the chart has vocals.

The product identity is machine-assisted charting. The pipeline behaviors
the design must support (owner's words, 2026-08-02):

- Drum transcription without a tempo map: separate audio (or load from the
  separated cache) -> generate tempo map (or use the existing map if it was
  hand-written) -> transcribe drums.
- Tempo generation: separate audio (or load from cache) -> beat-track.
- Add lyrics: if we already separated with BS-Roformer, use that cached
  vocals stem; otherwise separate the merged audio with Demucs to get
  vocals. (This composes plan 0066's unified cache with plan 0070's
  Demucs revert. Note: repeat aligns on the standalone page with no cached
  roformer vocals still re-run Demucs every time — 0070's accepted trade,
  unchanged here; the card copy should not promise otherwise.)
- These runs must render loading consistently whether progress appears in a
  Chart Assist card, or on the home screens of `/add-lyrics` and
  `/drum-transcription` before dropping into the editor. One implementation:
  same steps, same math, same worker placement in every flow.

## Current state (re-verified against the code after review, 2026-08-02)

Shared, reusable, keep:

- `components/ProcessingView.tsx` — the one shared loading renderer
  (steps, gated ETA, detail, durations, error/cancel). All flows feed it.
- `lib/audio-pipeline/{decode-audio,stem-cache,separate-stems}.ts` (plans
  0066/0070) — canonical decode recipe, fingerprint-keyed OPFS stem cache
  (`computeStemFingerprint(originalBytes, ROFORMER_SEPARATOR_ID)`), and
  `separateStems(audioBytes, {drums?, vocals?}, onProgress?)`.
  Load-bearing detail the engine design must respect: `separateStems`
  internally fingerprints, cache-probes, DECODES ONLY ON MISS, separates,
  and stores both stems — decode is not an externally visible stage on
  this path. `loadStem`/`loadStemOpus` return null on miss/corruption.
- Worker discipline: all ML inference runs in Web Workers. Injectable
  `createWorker` seams exist on `separate-stems.ts`, `demucs-client.ts`,
  and `spawnWorkerPool`; `lib/tempo-map/pipeline-client.ts` LACKS one
  (gap fixed in Phase 1).
- **Per-track command targeting already ships** (plan 0067, completed
  2026-07-20; `plans/completed/0067-schema-threading-note-mutation.md`):
  `AddNoteCommand(note, trackKey, schema)` (`commands.ts:349`),
  `DeleteNotesCommand` (`:397`), and the stacked piano roll resolves the
  target per clicked row (`PianoRollTimeline.tsx:2076`, with per-row
  trackKey threaded through drag/marquee/place). What does NOT yet ship:
  the highway pane is still single-track bound to `activeScope`
  (`HighwayEditor.tsx:437-444`), and keyboard-only note entry still
  resolves from scope.
- `lib/drum-difficulty/` (HOPCAT/Onyx/ours + 20 golden fixture songs) and
  `lib/guitar-difficulty/` (ONNX reducers, models in
  `public/models/guitar-reduction-v1/`) — production-quality, tested,
  wired only to the standalone `/difficulties`/`/guitar-difficulties`
  tools.
- `EditorSession` + capability gating + the `EditCommand` pattern;
  `ReplaceLyricsCommand`, `RepredictTempoCommand`,
  `CommitTempoCandidateCommand` are the precedents for applying pipeline
  results as undoable commands.

Duplicated or missing, the heart of this plan:

- **Four hand-rolled step-state machines** produce `ProcessingStep[]`
  independently: `app/drum-transcription/components/pipelineToSteps.ts`,
  `app/tempo/TempoClient.tsx`, `app/add-lyrics/AddLyricsClient.tsx`,
  `components/chart-editor/AddLyricsDialog.tsx`.
- `lib/drum-transcription/pipeline/runner.ts` hand-codes three
  orchestrations of the decode -> separate -> tempo-map -> transcribe
  sequence (run / runFromChart / resume, sharing `separateDrumsStep` and
  `ensureSynctrack`; `regenerateProject` delegates to `resumePipeline`),
  with per-stage OPFS resumability checks and hand-authored progress range
  tables.
- **No cancellation anywhere** (verified: zero AbortSignal in
  `lib/audio-pipeline`, `lib/tempo-map`, `lib/lyrics-align`,
  `lib/drum-transcription`): ProcessingView's Cancel abandons the UI but
  in-flight workers keep burning GPU.
- **No in-editor re-run**: drum transcription applies only via
  `SET_CHART_DOC` before the editor mounts; "Regenerate" unmounts the
  whole `EditorApp`. No `EditCommand` replaces a drum track or tempo map
  from a fresh in-session run.
- `AudioManager` takes N stems at construction but is construct-once;
  `usePaddedAudio` supports exactly one secondary stem. The mixer is the
  concrete N-stem need plans 0066 deferred generalization for.
- Selection state is two decoupled pieces (`activeScope`,
  `visibleTrackKeys`) with no reconciliation.
- `EditCommand.entityKinds` declares kinds only (`'note' | 'tempo' | ...`,
  `commands.ts:199-206`) — no instrument/difficulty. Commands hold
  `trackKey` privately but the interface does not expose it. Per-track
  staleness therefore requires an interface change (below), not free
  derivation.

## Design

Two architectural centers: a shared **assist engine** (pipeline
orchestration + progress + cancellation, defined once) and the **sidebar
redesign** built on it.

### A. Assist engine — `lib/assist/`

One module owns: what an assist task is, which stages it reports, how
progress is rendered, and how cancellation works. UI (inline card, home
screen) only ever consumes `AssistRunState`.

**Honest scoping (review finding 5):** for the separation-backed tasks,
the engine's per-stage value is a progress-and-cancellation shell over
functions that already internally handle fingerprint/cache/decode. The
engine therefore does NOT pretend decode is a stage it controls:

- Step lists are task-defined _reporting_ units mapped from the wrapped
  functions' progress callbacks (the proven `pipelineToSteps.ts` range
  approach, moved to `lib/assist/run-to-steps.ts` and made the single
  implementation). A step can be annotated `cached` (rendered as
  instantly-done with a "cached" note) when the underlying probe says the
  work won't run.
- Cheap existence probes are added to `stem-cache.ts`:
  `hasStem(fingerprint, name)` / `hasStemOpus(fingerprint, name)`
  (directory-entry checks, no decode) — used for step-list prediction and
  skip annotations, never as a second cache authority: the wrapped
  function's own probe remains the one that decides.

```ts
interface AssistTaskDef<Result> {
  key:
    | 'transcribe-drums'
    | 'generate-tempo-map'
    | 'add-lyrics'
    | 'generate-difficulties'
    | 'add-leading-silence';
  title: string;
  // Predict the step list for this run (may consult existence probes /
  // project state). Purely presentational; recomputed at start.
  planSteps(ctx: AssistContext): Promise<PlannedStep[]>;
  // One implementation call. Receives a progress sink and the signal.
  run(
    ctx: AssistContext,
    signal: AbortSignal,
    progress: AssistProgressSink,
  ): Promise<Result>;
}

interface AssistRunState {
  task: AssistTaskKey;
  steps: ProcessingStep[]; // the EXISTING ProcessingView contract
  status: 'running' | 'success' | 'cancelled' | 'error';
  error?: string;
}
```

**Data-flow contract (`AssistContext`)** — explicit, not a god object:

- `ctx.audio`: `{originalBytes: Uint8Array}` plus a lazily-populated
  `pcm44k?: {left, right}` slot filled by whichever wrapped function
  decodes first and needs to hand PCM onward. Ownership rule: any
  Float32Array handed to a worker client that transfers it is treated as
  consumed; callers that need it afterwards copy first (the existing
  `pipeline-client.ts` echo-back convention is preserved where the worker
  returns the stem — the transcribe step consumes the echoed stem, exactly
  as `runner.ts` does today). Each task's `run` is a linear async
  function, so ownership is auditable in one place per task instead of
  smeared across a generic stage graph.
- `ctx.project?`: optional OPFS project handle (present for
  drum-transcription flows; absent for /tempo, /add-lyrics standalone).
- `ctx.chart?`: the in-editor `ChartDocument` + revision info when run
  from the editor.

**Task compositions:**

- `transcribe-drums` (in-editor, Phase 1): a shell around the EXISTING
  `regenerateProject`/`resumePipeline` — the engine contributes the step
  adapter and cancellation only; `runner.ts` remains the single pipeline
  implementation until Phase 6 (review finding 4: no fifth duplicate, and
  OPFS artifacts stay correct for later resumes). The result applies via
  `ReplaceDrumTrackCommand` instead of remounting `EditorApp`.
- `generate-tempo-map`: wraps `runTempoPipelineFromPcm` (which may
  separate internally or receive a stem). The
  `tempo-track-equivalence.test.ts` invariant is untouched.
- `add-lyrics`: one vocals-resolution implementation with an internal
  branch — roformer vocals present in the unified cache (probe, then
  `loadStemOpus`) -> resample to 16k mono (`resampleTo16kMono`, the
  in-editor dialog's shipping path) -> align; else -> Demucs
  (`runDemucsInWorker`) -> align. Both the `/add-lyrics` home screen and
  the in-editor dialog call this one function; step lists and math are
  identical by construction.
- `generate-difficulties`: new worker (D below).
- `add-leading-silence`: wraps plan 0064's machinery; near-instant, still
  engine-run for uniform treatment.

**Cancellation contract (review finding 6):**

- `runAssistTask` takes an `AbortSignal`; wrapped clients gain an optional
  `signal` parameter that terminates their worker and rejects with
  `AbortError`. This touches the public signatures of `separateStems`,
  `runSeparationInWorker`, `runDemucsInWorker`, `runTempoPipelineFromPcm`,
  and the transcriber client — acknowledged as the bulk of the Phase 1
  diff. `pipeline-client.ts` also gains the missing `createWorker` seam.
- Mid-inference `worker.terminate()` is safe (worker-owned WebGPU device
  dies with the worker; models are OPFS-cached).
- **Atomic cache writes**: `stem-cache.ts` writes become
  write-temp-then-rename (the gate pattern `runner.ts` already uses for
  chart/confidence ordering), so cancel/terminate mid-store can never
  leave a truncated entry that later "hits" corruptly. Suite 1 includes a
  cancel-mid-store test asserting the cache is fully absent or fully
  valid afterward.
- Finalize/apply runs only on full success; cancel applies nothing.

### B. Loading UI — one renderer, two shells

- `components/assist/AssistRunCard.tsx`: inline treatment for sidebar
  cards (compact ProcessingView grammar, success flash, cancel).
- `ProcessingView` (unchanged) remains the full-page shell for the home
  screens.
- `components/assist/useAssistRunner.ts`: owns the AbortController and
  `AssistRunState`; `{state, start, cancel}`; one active run per runner.
  In-editor it lives in a provider beside `ChartEditorProvider`.
- **Progress ticks must not re-render the world** (prototype lesson,
  twice): `AssistRunState` lives in its own `useSyncExternalStore` store;
  only the run card and the busy-marked matrix/piano-roll row headers
  subscribe.

### C. Sidebar redesign — `components/chart-editor/sidebar/`

- `ChartMatrix.tsx` — the approved matrix. `visibleTrackKeys` becomes the
  single user-facing selection state; `SET_TRACK_VISIBILITY` the only
  selection action. `activeScope` is demoted to an internal
  "last-interacted track" (Note Inspector, keyboard entry), set by
  interaction, never by a picker. `TrackScopePicker`/`DifficultyPicker`
  are deleted; single-instrument surfaces pin one visible track.
- `ChartAssist.tsx` — cards (Tempo map, Add leading silence with
  detector-driven call-to-action, Drum transcription with staleness,
  per-instrument difficulty regeneration recommendation, Lyrics/Vocals),
  each with a one-sentence explanation + Learn more modal (prototype
  copy). Cards mount `AssistRunCard` inline when their task runs.
- `StemsMixer.tsx` — rows from `AudioManager.trackNames` + session stem
  metadata; volume via `setVolume`; mute/solo as a mixer-state solo bus
  resolving to effective volumes; AI-separated stems (session-added from
  cache/separation) badged; drag-drop add triggers the padded-audio
  rebuild.
- `UtilityCluster.tsx` — Snap dropdown (1/4..1/32 wired to
  `SET_GRID_DIVISION`), speed, A/B loop, cursor+add tools, undo/redo.
  Zoom/highway-style/sheet-music leave the default surface (state remains
  for capability-gated surfaces).
- Layout: `ChartEditor.tsx` becomes a named-areas CSS grid with the
  > =1440px full-height-sidebar mode.

**Editing model residue (review finding 1 — most of this shipped in
0067):** remaining work is (a) multi-pane highway with per-pane track
targeting (each pane parameterizes the interaction hooks with its track),
(b) keyboard-entry targeting from last-interacted track, (c) picker
removal. All land with the matrix in Phase 3.

**Staleness model (reworked per review findings 2-3):**

- `EditCommand` gains `affectedTracks?: ReadonlySet<TrackKeyId>` in its
  interface (alongside `entityKinds`). Commands that hold a `trackKey`
  expose it; `BatchCommand` unions its children; tempo/section/lyric
  commands leave it empty (their kinds carry the meaning). This touches
  every command class in `commands.ts` — it is called out as its own task
  in Phase 2, not assumed free.
- **Revisions are content-derived, not monotonic counters** (finding 3:
  counters desync under undo/redo). `EditorSession` maintains, per track
  and for the tempo map, a cheap content stamp: a running hash updated on
  apply/undo/redo from the affected portion of the doc (implementation
  detail: hash of the track's serialized events; tempo = hash of
  SyncTrack). Staleness = `currentStamp != recordedStamp`. Undoing back
  to the generation-time content makes staleness disappear, matching user
  intuition; undoing PAST the generation command removes the generated
  tracks and their recorded stamps together because...
- **Generation provenance lives inside `ChartDocument` metadata**, so it
  rides undo/redo snapshots atomically with the tracks it describes:
  `doc.assistProvenance = {difficulties: {[instrument]: {sourceStamp}},
drumTranscription: {tempoStamp}, ...}`. `GenerateDifficultiesCommand`
  writes tracks + provenance in one command; undo restores both. The
  "Keep as-is" acknowledgment writes an `ackStamp` the same way.
  Persistence comes free wherever the doc/project persists; `/tempo` and
  `/add-lyrics` (no persistence) lose it on reload, as they lose
  everything today.
- Leading-silence detector: pure function over chart + audio anchor
  (first-BPM outlier vs second marker, or early audio onset), reusing
  plan 0064's machinery.

### D. Difficulty generation integration

- New worker `lib/assist/difficulty-worker.ts` wrapping
  `lib/drum-difficulty/computeReductions` (default algorithm: pending plan
  0071's comparison conclusion — confirm with owner at phase start) and
  `lib/guitar-difficulty/reduce` (ONNX). Injectable `createWorker` seam.
- **Bass reuse of the guitar reducer is an experiment, not a decision**
  (review finding 9): the guitar ONNX models have never been validated on
  bass. Phase 4 starts with a fixture-based spot check; if quality is
  unacceptable, bass generation ships disabled with a tooltip rather than
  shipping bad charts.
- `GenerateDifficultiesCommand` applies all tiers + provenance as one
  undoable command; `DeleteLowerDifficultiesCommand` removes them as one.
  Both declare `affectedTracks` and entity kinds.
- Matrix buttons and the assist recommendation card start the same
  `generate-difficulties` task (same inline card, cancellation, worker
  guarantee).

### E. Home screens on the engine

- `/add-lyrics`: replace `ALIGN_STEPS`/`TIER2_STEPS` with the engine's
  `add-lyrics` task; the page automatically uses cached roformer vocals
  when present (new behavior, owner-specified). Tier-2 fallback is a
  second run with a variant step list.
- `/tempo`: swap `initialSteps()`/`updateStep` for `generate-tempo-map`.
- `/drum-transcription`: LAST. `runner.ts`'s orchestrations are
  re-expressed as engine task compositions with the OPFS bookkeeping kept
  as a thin project layer (stages persist artifacts exactly where they do
  today; resumability = the same OPFS existence checks). Until this
  phase, `runner.ts` remains the single implementation and the engine
  only shells it (A above) — one pipeline implementation at all times.

### F. Chart Editor remains a reusable component

- New capability flags: `showChartMatrix`, `showChartAssist`,
  `showStemsMixer`; presets updated (PREVIEW: none; TEMPO: tempo +
  leading-silence cards only; ADD_LYRICS: lyrics card only;
  single-instrument edit pages: matrix constrained to their instrument).
  `leftPanelChildren`/`headerExtra` stay; drum-transcription's bespoke
  sidebar extras fold into the shared sections and are deleted from
  `EditorApp`.

### G. Testing strategy (react-testing-library, behavior-first)

Ground rules: query by role/accessible name; assert visible outcomes;
`FakeWorker` doubles via the `createWorker` seams (no jest.mock where a
seam exists); `fake-opfs.ts` for storage; jest fake timers for ETA/
durations; fixture builders extended with a multi-instrument chart.

Behavior suites:

1. **Assist engine (lib)**: composition per task (cache hit annotates the
   step as cached and skips work; hand-written tempo map skips
   tempo-mapping; roformer cache routes add-lyrics away from Demucs —
   proven by the Demucs FakeWorker never spawning; Demucs runs on miss);
   cancellation mid-stage terminates the worker, applies nothing;
   **cancel-mid-store leaves the stem cache fully absent or fully valid**;
   progress mapping (worker ETA passthrough, EMA fallback, monotonic step
   index); error propagation.
2. **AssistRunCard / inline treatment (RTL)**: card expands into the step
   list on run; sibling cards stay interactive; affected matrix cells +
   row header disable; cancel restores idle; success flash clears the
   staleness prompt.
3. **Chart Matrix (RTL)**: cell toggle adds/removes highway pane and
   piano-roll row; absent-difficulties instrument shows the spanning
   Generate button; generation fills cells (toggleable, AI-marked);
   Re-generate appears only after a real Expert edit driven through the
   UI; delete-set confirm removes H/M/E together; Add instrument offers
   only absent instruments.
4. **Multi-pane highway interaction (RTL + hooks)**: with two panes
   visible, hover/click in each pane targets its own track (assert via
   rendered selection/note outcomes); pane count caps with overflow
   indicator. (Replaces the first draft's suite that re-tested shipped
   per-row piano-roll targeting.)
5. **Staleness (RTL + reducer)**: tempo edit -> transcription
   recommendation; Keep-as-is dismisses until next change; Guitar Expert
   edit -> Re-generate bar + card; re-generate clears; **undo back to
   generation-time content clears staleness; undo past
   GenerateDifficulties removes tracks AND provenance together; redo
   restores both**; project save/reload round-trips provenance through
   the persisted doc.
6. **Stems mixer (RTL)**: slider drives the AudioManager stub's volume
   record (the stub is the audio boundary); solo dims others and
   restores; explicit mute survives solo churn; AI badges; drop-add
   creates a row. Playback interaction: A/B loop and transport stay
   usable while a track is locked by a run.
7. **Home screens (RTL)**: `/add-lyrics` cache-hit never spawns Demucs;
   miss does; `/drum-transcription` upload renders the same step labels
   as the in-editor re-run for shared stages; resume-after-interrupt and
   regenerate still work post-migration.
8. **Capability regression (RTL)**: per-surface section snapshots
   extending `capability-gates.test.tsx`.

## Phasing

Six phases (review finding 7 re-slice), each independently shippable and
green (`pnpm typecheck && pnpm test && pnpm lint` + browser validation).

- **Phase 1 — Assist engine as a shell + real cancellation.**
  `lib/assist/` (run-to-steps adapter, AbortSignal threading through the
  worker clients incl. the new `pipeline-client.ts` seam, atomic cache
  writes in `stem-cache.ts`, existence probes), `useAssistRunner`,
  `AssistRunCard`. Consumers: in-editor Regenerate (shelling
  `regenerateProject` — runner stays the only pipeline implementation)
  and `AddLyricsDialog`. `ReplaceDrumTrackCommand` lands here so
  regenerate stops remounting `EditorApp`. Suites 1-2.
- **Phase 2 — `affectedTracks` + content-stamp revisions + Chart Assist
  (tempo/transcription staleness only).** The command-interface change
  across `commands.ts` is this phase's first task. Assist section ships
  with Tempo map, Add leading silence (detector), Drum transcription,
  Lyrics cards; difficulty recommendation card explicitly deferred to
  Phase 4. `ReplaceTempoMapCommand`. Suite 5's tempo/transcription/undo
  cases, Suite 8 update.
- **Phase 3 — Chart Matrix + multi-highway + no-focus UX.**
  GPU measurement spike FIRST (3-4 `HighwayPreview` instances on a real
  chart; acceptance: 60fps on the dev machine, no context loss). Fallback
  levers if it fails, in order: lower pane cap; shared preloaded
  textures; demand-render (full-rate RAF only for the interacted pane).
  (The first draft's one-canvas/scissor fallback is withdrawn — review
  finding 8: it rewrites `setupRenderer`'s per-canvas assumptions and is
  a bigger project than the feature.) Then: matrix, visibility-only
  selection, per-pane interaction targeting, keyboard-entry targeting,
  picker deletion, responsive grid. Suites 3-4.
- **Phase 4 — Difficulty generation.** Worker + seam, bass-on-guitar
  spot-check gate, commands + provenance, matrix buttons + recommendation
  card. Remaining Suite 5 cases, Suite 3 generate rows.
- **Phase 5 — Stems mixer.** `usePaddedAudio` generalization to a stem
  list, mixer UI, AI-stem provenance, drop-to-add. Suite 6.
- **Phase 6 — Home screens.** `/add-lyrics`, `/tempo`, then
  `/drum-transcription` (runner re-expressed on the engine, OPFS
  bookkeeping preserved, resumability validated). Delete the four step
  machines; grep-gate: no `ProcessingStep[]` production outside
  `lib/assist/`. Suite 7.

## Non-goals

- No visual redesign of the piano roll or highway rendering itself; the
  adaptive row-density idea is tracked separately (spawned task,
  2026-08-02).
- No new separator, no `StemSeparator` interface (0066/0070 stand). The
  add-lyrics rule is a cache-read branch, not a model-selection
  abstraction. No Demucs-output cache (0070's accepted trade stands).
- No server-side or non-OPFS storage.
- No change to export, review tools, or the standalone
  `/difficulties`/`/guitar-difficulties` pages.
- No mobile layout beyond the two-breakpoint behavior.

## Risks

- **The engine adds less than it appears for separation-backed tasks** —
  the wrapped functions already own cache/decode/progress. Accepted and
  embraced: the engine's non-negotiable deliverables are cancellation,
  one steps adapter, and one implementation per pipeline; if a task's
  "stages" are one opaque call with progress mapping, that is fine. If
  Phase 1 finds even the shell shape fighting the code, the fallback is
  explicitly: cancellation threading + shared adapter + sidebar UI, no
  task abstraction.
- **Multi-pane GPU cost unmeasured** — spike gate at Phase 3 start,
  fallback levers above.
- **Bass difficulty quality unvalidated** — spot-check gate, ship-disabled
  fallback.
- **`runner.ts` migration last** — resumability semantics preserved;
  resume-after-interrupt + regenerate in the Phase 6 browser checklist.
- **Roformer-cached vocals on the standalone page** — owner-specified;
  alignment-confidence spot check on 2-3 known-good songs in Phase 6
  (same protocol as 0066/0070).
- **In-progress plan collisions** — 0064 (leading silence: consumed here)
  and 0071 (difficulty algorithm choice: consumed at Phase 4 start).
  Sequencing notes added to both.

## Done when

- The approved sidebar (matrix, assist cards, mixer, utilities) is live on
  `/chart-editor` with all prototype interactions, and every other surface
  renders its capability-appropriate subset with no regression.
- One assist engine drives every pipeline run; the four step machines are
  deleted; no `ProcessingStep[]` production outside `lib/assist/`.
- Cancel actually stops workers (browser-validated), and a cancelled or
  crashed run can never leave a corrupt stem-cache entry.
- Drum transcription, tempo generation, lyrics alignment, and difficulty
  generation each run from their Chart Assist card and (where applicable)
  their home screen with identical steps and identical math.
- The RTL suites pass; `pnpm typecheck && pnpm test && pnpm lint` green;
  per-phase browser validation checklists completed.
