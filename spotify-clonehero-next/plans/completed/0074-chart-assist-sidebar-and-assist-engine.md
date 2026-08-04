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

**Amendment (as built):** "explicit, not a god object" is enforced by the
type system rather than by discipline. `AssistTaskDef<Result, Input>` is
parameterised on the task's own input and `start<Result, Input>(task,
input)` takes it, so there is no shared `AssistContext` for one task's
fields to accumulate in: `transcribe-drums` takes the ordering to run,
`add-lyrics` takes its lyrics plus a `vocals` union naming which of the
three resolution branches to take, `generate-tempo-map` takes the audio,
`generate-difficulties` takes the reduction input. A caller that omits
what a task needs no longer compiles, so none of the runtime
`require*(ctx)` throws exist. Shared contracts (`AssistAudio`,
`AssistTaskDef`, `AssistTaskKey`) live in `lib/assist/tasks/types.ts`,
one task per sibling file.

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
  resolving to effective volumes (`mixerBus.ts`, the single implementation
  of that policy, read by both the volume push and the row rendering);
  AI-separated stems (session-added from cache/separation) badged;
  drag-drop add triggers the padded-audio rebuild.
  - **Decided:** `/drum-transcription`'s `D` (solo drums) / `M` (mute
    drums) hotkeys are dropped rather than rebound. They addressed one
    hard-coded track from a page-specific panel; the mixer's per-row M/S
    buttons cover every track on every host, and a global hotkey that
    silently picks one row out of N is worse than no hotkey. Revisit only
    with a design for which row a bare keypress targets.
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
  "Keep as-is" acknowledgment writes an `ackStamp` the same way (through a
  dedicated reducer action rather than a command, so a dismissal neither
  lands on the undo stack nor discards the redo branch).
  Persistence is NOT free: `.chart`/`.mid` have no slot for doc-level
  metadata, so `/drum-transcription` mirrors the bag into its OPFS project
  metadata (`ProjectMetadata.assistProvenance`) on every autosave and
  re-attaches it at load, exactly as it already does for `audioAnchor`. A
  project with no persisted bag has its drum-transcription stamp seeded
  from the chart as loaded (its drums really were transcribed against the
  grid it ships with). `/tempo` and `/add-lyrics` (no persistence) lose it
  on reload, as they lose everything today.
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

- New capability flags: `showChartMatrix`, `showStemsMixer`, and
  `chartAssist` (`false | 'all' | 'tempo-and-silence' | 'lyrics-only'` —
  one field rather than a boolean plus a variant, so "hidden" has no
  variant to carry); presets updated (PREVIEW: none; TEMPO: tempo +
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

## Route model (owner decision, 2026-08-03)

The app's editor-adjacent routes are exactly these; `/guitar-edit`,
`/bass-edit`, and `/drum-edit` are deleted (their pinned-instrument
matrix variant and the Phase-3 multi-difficulty-pane amendment retire
with them):

- `/chart-editor`: select a folder/chart, open the editor with every
  instrument's highest difficulty visible (all Experts).
- `/drum-difficulties` (renamed from `/difficulties`): select a chart;
  error if it has no Expert drums; run lower-difficulty generation;
  open the editor with drums X/H/M/E visible. Supersedes the standalone
  comparison-grid UI on that route (see plan 0071, amended).
- `/guitar-difficulties`: same flow for guitar.
- `/drum-transcription`: separation + transcription pipeline, then the
  editor with only Expert drums visible.

Implemented as a route-consolidation pass between Phases 5 and 6.

Two consequences of the model, resolved as built:

- `MAX_HIGHWAY_PANES` is **4**, not 3. The difficulty routes land with one
  instrument's X/H/M/E all visible, and a cap of 3 would silently demote
  Easy to the overflow chip while its matrix cell read as visible. The
  Phase 3 spike measured 1-4 simultaneous panes at ~240 draw-loops/s with a
  flat worst-1% frame, so 4 is inside what was measured.
- The three deleted edit routes redirect permanently to `/chart-editor`,
  which adopts their OPFS namespaces (`drum-edit`, `guitar-edit`,
  `bass-edit`) as read/write legacy stores. Projects saved on those routes
  stay listed and a `?project=` link still resolves; no data is copied.
- The comparison surface Phase 4's amendment 1 pointed HOPCAT/Onyx at is
  gone with `/difficulties`. What went with it: `computeReductions.ts`
  (the comparison entry point) and the two export wrappers the deleted
  export dialogs called (`lib/drum-difficulty/exportChart.ts`,
  `lib/guitar-difficulty/exportChart.ts`) — generated tiers now reach a
  chart only through `GenerateDifficultiesCommand`. What stays:
  `lib/drum-difficulty/{hopcat,onyx}` and their adapters, as reference
  implementations of the upstream reducers with the parity tests that
  pin them to it. They have no production caller and are not expected to
  grow one.
- Both hosts that mount the editor from a chart package — `TrackEditPage`
  and `DifficultyGenerationFlow` — build their `ChartEditor` props through
  one module (`components/chart-editor/chartPackage.ts`): the click stem,
  the chart delay, the waveform PCM and sample rate, the export sources
  and the Chart Assist audio boundary. `TrackEditPageConfig` no longer
  carries per-route track selection (`findTrack` / `noTrackMessage` /
  `seedAllInstrumentsVisible` / `capabilities`): seeding every
  instrument's highest charted difficulty is the shell's only behavior.

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
  **Superseded (route model, 2026-08-03):** the amendment below described
  a pinned-matrix, multi-difficulty-pane behavior for `/guitar-edit`,
  `/bass-edit` and `/drum-edit`; those routes are deleted and the pinned
  `showChartMatrix` variant retired with them (see "Route model" section),
  so this amendment no longer applies to anything in the app.
  ~~**Amendment (Phase 3 as built):** section C's "single-instrument
  surfaces pin one visible track" is relaxed — `/guitar-edit`,
  `/bass-edit` and `/drum-edit` pin the matrix to their one instrument
  but may show up to `MAX_HIGHWAY_PANES` (3) difficulty panes of that
  instrument. That is what the matrix model already means everywhere
  else (visibility is per instrument+difficulty cell), and it is safe
  because note selection/hover ids are unconditionally track-qualified,
  so a `tick:type` id shared by Expert and Hard never resolves in both
  panes.~~ **Open question (deferred from Phase 3 review):** a vocals
  scope still replaces every note pane while the matrix shows its
  tracks lit, a presentation contradiction; resolving it (mutually
  exclusive picker vs a vocals row in the matrix) is a product
  decision, revisit alongside Phase 6.
- **Phase 4 — Difficulty generation.** Worker + seam, bass-on-guitar
  spot-check gate, commands + provenance, matrix buttons + recommendation
  card. Remaining Suite 5 cases, Suite 3 generate rows.

  **Amendment (Phase 4 as built):** the two owner-facing gates in Design
  D resolved as follows.
  1. _Drum algorithm._ Drums run `lib/drum-difficulty/ours` (the trained
     GBM, "Ours" v5) and nothing else, per plan 0071's conclusion ("Ship
     the trained GBM") and its export decision that only our model's
     version is ever written. HOPCAT/Onyx stay comparison-only on
     `/difficulties`.
  2. _Bass._ Bass ships **disabled**. The spot check the plan asks for
     could not be run: no chart in this repo has a bass track (all 20
     `lib/drum-difficulty/__fixtures__/reduction-*/notes.mid` are
     drums-only), and a synthetic bass part would test that the code
     runs, not that the guitar reducer produces musically sane bass.
     Applying the gate's own instruction for unacceptable quality to
     "quality could not be assessed", `runDifficultyGeneration` rejects
     bass with a typed `UnsupportedInstrumentError` before spawning a
     worker, and both the matrix bar and the Chart Assist card render
     disabled with that reason. Which instruments are refused lives in one
     place, `difficulty-client.ts`'s `GENERATION_DISABLED_INSTRUMENTS`,
     read by the run guard and by the UI (via
     `difficultyGenerationDisabledReason`), so re-enabling once a real bass
     chart is available to spot-check is emptying that set plus widening
     the worker request union in `difficulty-protocol.ts`.

  Also as built: generation is set-shaped, so an instrument charted with
  only part of Hard/Medium/Easy still gets a Generate bar (rendered
  under its cells) rather than no affordance at all. **Deferred:**
  provenance records only the source Expert stamp, so re-generating
  replaces hand edits in Hard/Medium/Easy with no per-tier warning; the
  disclosure lives in the Learn-more copy. Recording per-tier stamps at
  generation time would let the confirm name which tier has user edits.

- **Phase 5 — Stems mixer.** `usePaddedAudio` generalization to a stem
  list, mixer UI, AI-stem provenance, drop-to-add. Suite 6.
- **Phase 6 — Home screens.** `/add-lyrics`, `/tempo`, then
  `/drum-transcription` (runner re-expressed on the engine, OPFS
  bookkeeping preserved, resumability validated). Delete the four step
  machines; grep-gate: no `ProcessingStep[]` production outside
  `lib/assist/`. Suite 7.

  **Amendment (Phase 6 as built):** `runner.ts` is _shelled_, not
  rewritten. Its four orderings (upload, chart package, resume,
  regenerate) stay exactly as they are and remain the single pipeline
  implementation; the `transcribe-drums` task names which one a run
  performs and predicts its step list from the same OPFS existence checks
  that ordering makes. This is Design A's own "no fifth duplicate, and
  OPFS artifacts stay correct for later resumes" rule applied at the last
  phase too: re-authoring the persistence path would put the resumability
  the phase is meant to validate at risk for no user-visible gain. What
  the phase does deliver is what the grep-gate names — the four page-local
  step machines are gone and no `ProcessingStep[]` is produced outside
  `lib/assist/`.

- **Phase 7 - Prototype parity and editor density (owner request,
  2026-08-03).** The shipped sidebar accreted new sections around the old
  controls; the approved prototype's structure and density never fully
  landed. Scope:
  1. **DONE (task 7a).** **Sidebar order and content exactly per the prototype**: Chart
     Matrix -> Chart Assist -> Stems -> one Snap / Speed / Loop utility
     cluster at the BOTTOM (Snap dropdown 1/4..1/32 wired to grid
     division, speed stepper, A/B loop, cursor + add tools, undo/redo).
     Delete from the editor sidebar: the top A/B block, Grid row, Zoom
     row, Highway style toggle, Sheet music toggle, the old Tools
     palette, and the History section (undo/redo live in the utility
     cluster). Underlying state stays for capability-gated surfaces
     that still need it; the default editor surface stops rendering it.
  2. **DONE (task 7c).** **Editor density scope**: editor-rendering pages get a compact
     visual scale (type ~12-13px, tight paddings, dense cards) via a
     scoped mechanism (e.g. an editor-layout wrapper class adjusting
     the token scale), leaving /spotify, /sheet-music and all other
     pages exactly as they are. No global token changes.
  3. **DONE (tasks 7b + 7d).** **Compact editor header** per the prototype: one slim row - app
     icon, song title/artist/charter inline, Preview + Export on the
     right - replacing the tall site header + separate song row on
     editor pages only. Site navigation remains reachable (judge: icon
     links home).
  4. **DONE (task 7d, see "Parity decisions" below).** **Prototype parity audit**: systematic comparison of the live
     /chart-editor against the approved prototype (loading-inline.html)
     cataloguing every visual/structural difference EXCEPT highway and
     piano-roll contents; each diff either converges to the prototype
     or is recorded here with a reason.

  **Amendment (task 7a, sidebar restructure, as built):** three deliberate
  departures from a literal prototype read, each because the prototype is
  a design mock and the app has affordances it doesn't model:
  1. **NoteInspector kept, placed between Chart Assist and Stems.** The
     prototype has no equivalent panel — it never models note selection —
     but without it, selected-note detail (type, tick, flags, cymbal/
     technique toggles) has nowhere to go. Functional necessity, not a
     prototype miss.
  2. **bpm/timesig tools dropped rather than moved to an overflow.**
     Investigated what the piano roll already supports: its tempo-lane
     right-click context menu (`PianoRollTimeline.tsx`'s `buildTempoMenu`)
     already offers "Add tempo marker here" and "Insert time signature
     change here" — a real, shipped affordance, not a gap. The erase tool
     is dropped for the same reason (Delete/Backspace + the note context
     menu's "Delete note" already cover it). The section tool has no such
     equivalent — nothing else lets a user START a new section (existing
     sections can be dragged/renamed, but not created) — so it keeps a
     small icon button beside undo/redo in the utility cluster's tool row,
     per the plan's own fallback instruction.
  3. **Vocal Part picker kept**, rendered above Chart Matrix when the active
     scope is a multi-part vocal chart. Not in the prototype (which has no
     vocals-scope concept at all — vocals are a pinned piano-roll lane, not
     a matrix row) but still needed: without it there's no way to switch
     which vocal part's lyrics/phrases the piano roll shows.

  **Parity decisions (task 7d).** Every visual/structural difference found
  between the live editor and `loading-inline.html`, excluding highway and
  piano-roll contents. "Converged" changed the app to match the prototype;
  "recorded" kept the app's behavior, with the reason on the same line.
  - Section headings: converged. All four sidebar sections now share
    `SectionHeading` (11px uppercase, letter-spaced, muted), replacing the
    mix of 14px medium headings and one already-compact heading.
  - Section separators: converged. One hairline between sections, none above
    the first (`SIDEBAR_SECTION_CLASS`'s `first:` variants), since which
    section comes first depends on the page's capabilities.
  - Sidebar width: converged 256px -> 290px, the prototype's rail.
  - Matrix label column: converged 68px -> 78px.
  - Plain "Generate H · M · E" bar: converged to the prototype's accent-tinted
    dashed treatment; it reads as an offer, not a disabled placeholder.
  - Under-cell generate/re-generate bar: converged from full width to the
    prototype's H/M/E column span (`3 / 6`) and 20px height.
  - "Re-generate H · M · E (Expert changed)": converged to the prototype's
    plain "Re-generate H · M · E"; the amber treatment and the card's own
    note already say why.
  - Assist card actions: converged. The card's own buttons and "Learn more"
    share one row (`CardShell`'s new `actions` prop), instead of stacking
    "Learn more" on a row of its own.
  - AI provenance: converged. Card status lines carry the prototype's accent
    sparkle badge (`CardShell`'s `aiLabel`) rather than plain grey text.
  - Card icon tile: converged 24px -> the prototype's 22px.
  - Stems row layout: converged to the prototype's column rhythm (fixed
    82px name, flexible slider, fixed readout) from a fixed-width slider.
  - Stems M/S toggles: converged to 17px bordered toggles with solid active
    fills, red for mute and green for solo (the app had an amber solo).
  - Muted stem name: converged to the prototype's quiet grey; the alarm colour
    lives on the M toggle, so mute and solo-silenced rows read alike in the
    name and differ where the prototype differs them.
  - "double-click a slider to reset": converged from a paragraph under the
    rows to the prototype's slot in the section heading row.
  - Stem row glyphs: converged. A waveform per stem, a metronome on the click
    row, plus the prototype's dashed rule above that row.
  - A/B loop: converged to the prototype's one segmented A | B | clear
    control, from three loose buttons.
  - Utility cluster layout: converged to the prototype's three equal columns.
  - Transport speed: converged. The transport shows the prototype's plain
    "Speed 100%" readout at the right; the stepper exists once, in the
    sidebar. Both surfaces go through one hook (`usePlaybackSpeed`) for the
    value, the preset ladder and the write, so the `[` / `]` hotkeys and the
    sidebar stepper can no longer disagree.
  - Header song identity: converged to one line (title, artist, charter
    inline), which is what lets the header be a single 42px row.
  - Transport bar colour: recorded. The prototype's transport is dark because
    it is glued to the dark stage; the app's sits at the top of the light
    bottom panel with the piano roll, and inherits that surface. Same order
    (highway, transport, piano roll), app-appropriate chrome.
  - "Preview" header button: recorded (already found in task 7b). No preview
    affordance exists anywhere in the editor chrome, and inventing a dead
    button is worse than omitting it.
  - Every compact header is one 42px row: converged. There is a single row
    (`components/SiteChrome.tsx`'s `EditorHeaderRow`) and every editor screen
    fills it — see the header-shell amendment below.
  - Row overflow menu offers only Delete: recorded. The prototype's menu also
    repeats Generate/Re-generate, which the row's own bar already offers two
    pixels away.
  - Overflow "⋯" always visible: recorded. The prototype reveals it on row
    hover; a permanently visible control is reachable by touch and by
    keyboard without a hover state to discover.
  - Lyrics card has no "Placed · N phrases" status: recorded. The prototype
    mocks that count; the card would have to derive it from the doc, which is
    a behavior change rather than a visual one.
  - Solo-silenced hatch on the row, not the slider fill: recorded. The
    prototype hatches the fill; the app's shared `Slider` primitive would have
    to be forked to paint its fill, for a strictly cosmetic difference.
  - NoteInspector, Vocal Part picker, dropped bpm/timesig/erase tools:
    recorded above, in this phase's task-7a amendment.
  - Snap dropdown carries 1/64 and Free: recorded, a deliberate departure from
    the prototype's 1/4..1/32 mock list. `GRID_SHORTCUT_MAP` binds `Shift+6`
    to 1/64 and `Shift+0` to Free; if the dropdown omitted them, either
    hotkey would leave `state.gridDivision` with no matching item, blanking
    the trigger with no UI path back.
  - Column hint chips name this app's bindings, not the mock's: recorded.
    The prototype prints `G`, `-/+` and `[ ]`; the real bindings are
    `Shift+1`..`Shift+6` for snap and `[` / `]` for speed, and setting loop
    points has no hotkey at all, so that column shows no chip.
  - `Mod+3/4/5` (erase/bpm/timesig) hotkeys dropped with the tools:
    recorded. With those tools gone from the row, the bindings entered a
    mode with no button to light up and no discoverable exit.
  - Sheet-music pane and `state.zoom` are now unreachable: recorded as a
    functional deletion, not a capability gate. `showSheetMusicToggle` was
    the only dispatcher of `SET_SHOW_SHEET_MUSIC` and `showSheetMusic`
    defaults false, so `ChartEditor`'s notation pane — and `state.zoom`,
    whose only consumer is that pane — no longer render on /preview, which
    previously enabled the toggle. The reducer actions stay because
    restoring the pane behind a future surface is a UI change only. The pane
    itself is deleted from `ChartEditor` (branch, its two memos and the
    static `SheetMusic` import) rather than left wired to a flag that cannot
    become true — it was pulling VexFlow into every editor bundle.
  - Waveform highway mode is now reachable only from add-lyrics: recorded.
    `SET_HIGHWAY_MODE` is dispatched only by `AddLyricsClient`'s waveform
    pinning, so drum-edit/preview/tempo lost the toggle outright.
  - Auth/account controls absent on editor routes: recorded, pending owner
    sign-off. The editor header row renders only the app icon and the page's
    own content, so Log In and the `/account` link are unreachable without
    navigating home first.

  **Amendment (header shell and density scope, as restructured).** Both
  mechanisms were rebuilt after review; the shipped structure is:
  - **One header row, filled by the page.** `SiteChrome.tsx` renders exactly
    one `EditorHeaderRow` (42px: app icon + a content slot) on editor routes,
    and `EditorHeaderContent` puts a page's identity and actions into that
    slot with a portal (React context crosses portals, so the content still
    reads the editor's providers). `ChartEditor` and add-lyrics both fill the
    one row instead of rendering competing rows. Deleted with the previous
    shape: the header-ownership context, its provider, `useOwnsSiteHeader`,
    the separate `CompactSiteHeader`, and the frame at first paint where an
    editor route rendered both a site row and a page row. Outside the app
    shell (an embed, or a test rendering `ChartEditor` alone)
    `EditorHeaderContent` renders its own row, so the header is never
    missing; the grid keeps its `header` area for exactly that case, and
    collapses to 0 inside the shell — which is also the prototype's
    "head head" layout, header full-width above the full-height sidebar.
    `app/layout.tsx` passes the site nav (`components/SiteNav.tsx`, still a
    server component) into the client header as a prop, so reading the
    pathname does not push the nav into the client bundle.
  - **Density is scoped to the editor's lifetime, not to a route.**
    `useEditorDensity` (`components/chart-editor/hooks/`) sets
    `data-density="compact"` on the document root while at least one
    `ChartEditor` is mounted, ref-counted so overlapping mounts cannot drop
    it early. Root scoping is what reaches Radix's portalled Select menus,
    Dialogs and AlertDialogs — they render into `document.body`, outside any
    editor-owned wrapper, so the previous subtree class left every popover at
    full size. Lifetime scoping (rather than the header's route list) also
    keeps the compact scale off the pre-editor picker/search screens of
    `/tempo`, `/drum-transcription` and `/preview`, which are ordinary
    content pages. The hand-placed `.editor-density` classes are gone.
  - **Control heights are a token, not a specificity hack.** `Button`
    (default/sm/icon), `Input` and `SelectTrigger` read
    `h-[var(--ed-control-h, <standard value>)]`, so the scope compacts them
    by setting the variable and every other page computes exactly the height
    it did before. The `.editor-density button.h-10` descendant rules are
    gone. `--ed-*` spacing tokens are named by role (`--ed-pad-section`,
    `--ed-pad-card`, `--ed-gap-section`); per-element type sizes stay literal
    (they are one-off prototype values, not a shared scale).
  - **One playback-speed ladder.** `usePlaybackSpeed`
    (`components/chart-editor/hooks/`) owns the preset list, the current
    index, the guards and the audio-engine + reducer write. The sidebar
    stepper and the transport's `[` / `]` hotkeys are two surfaces on it, so
    the presets cannot be extended in one place only; a speed outside the
    list snaps to the nearest rung instead of deadening the stepper.

  Acceptance: side-by-side screenshots at matching viewport; suites
  updated (capability gates, layout tests); non-editor pages pixel-
  unchanged (spot screenshots).

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
