# Plan 0061: In-memory edits + audio-anchored tempo remapping

> **Refines:** 0035 (edit-path performance) and 0039 (upstream scan-chart primitives).
> 0035's "Best" option (replace the round trip with a local recompute) is adopted
> here as the baseline, not the stretch goal. 0039 remains the eventual home for
> the primitives; this plan ships them in-repo first.
> **New over 0035/0039:** tempo edits become *audio-anchored* — notes keep their
> ms position and are re-ticked, instead of keeping ticks and sliding in ms.
>
> **REVISED 2026-07-18 (audit, Eli directive).** Decision 3 below ("tempo edits
> are audio-anchored," universal) is **superseded by §3a "Four note-handling
> ops"** — research findings (self-contained restatement in
> `plans/todo/0061-appendix-research-findings.md` — read that first if you're
> new to this plan; it does not require any file outside this repo) found
> that audio-anchoring (keep-ms) is right for *some* tempo-map edit classes and
> measurably wrong for others. §3a is the new decision framework; the original
> Decision 3 text is kept below, marked superseded, for provenance. Two new
> feature specs (§6, §7) are folded in per Eli's directive: downbeat-tap
> bar-relabel and user-invoked half/double with re-predict.
>
> **MERGED 2026-07-18 with plan 0062 (piano-roll timeline UI).** 0062 is the
> UI surface for everything in this plan's §3a/§6/§7 — see 0062 for the
> panel, and see this plan's new "§8. Merged build order" for the combined,
> implementable phase graph. Where 0062 introduced concepts this plan didn't
> have (a fourth note-handling op, a downbeat-flag data store), they're
> folded into §3a/§3b below rather than left as a separate, conflicting
> model.
>
> **REVISED per adversarial review 2026-07-18 (Eli-resolved).** Substantive
> fixes integrated in place: RE-PREDICT is defined as the full KS-warp
> re-fit + snap, with the corrected tempo map an *output* of the op (§3,
> §3a, §7 — §7's "Pipeline call surface" is canonical); `DownbeatFlags`
> carries the time-signature denominator and both §3b derivations run in
> denominator-scaled beat units; §6's rephase is whole-song; tempo values
> are format-quantized at edit time (§2); decoded-onset retention covers
> every `confidence.json` write site incl. `resumePipeline`, plus
> `regenerateProject` cleanup (§3a); `pendingTempoCandidate` is the one
> preview channel for all tempo gestures, with invalidation rules (§7);
> the pure bar-derivation module is split out of phase 6 into the §8 build
> order's Group A (`61-6a`), which also repoints the highway `GridOverlay`.

## Context

Every edit command currently runs `writeChartFolder → parseChartFile` in
`useExecuteCommand` (`components/chart-editor/hooks/useEditCommands.ts:42-62`)
before the result reaches state/renderer/undo. The round trip exists solely to
populate derived fields — mutators leave `msTime: 0` placeholders
(`lib/chart-edit/helpers/tempo.ts`).

Investigation findings (2026-07-18):

- Commands are already pure in-memory clone+mutate; only the choke point
  round-trips. Undo/redo replay stored post-rebuild snapshots (no reparse).
- Autosave/export serialize independently via `writeChartFolder` — untouched by
  removing the edit-loop round trip.
- `ChartDocument = {parsedChart, assets}`; `chartBytes`/`format`/
  `iniChartModifiers` live on `parsedChart`. `chartBytes` is only consumed by
  the load-time modifier-override reparse in `readChart`.
- `lib/tempo-map/swap-synctrack.ts` already implements audio-time-preserving
  re-ticking under a new tempo map, including group-aware quantization via the
  shared `lib/tempo-map/quantize-grid.ts` quantizer and an abstain band
  (`DEFAULT_SNAP_TOLERANCE_MS`).

## Decisions (user, 2026-07-18)

1. **ChartDocument/ParsedChart is the primary data backing.** Edits must not
   require a serialize→reparse round trip.
2. **Push model:** the consistency invariant lives in the `lib/chart-edit`
   helpers — after any helper call, the chart's derived timing is correct.
   (This also fixes non-editor callers like the pipeline chart builders.)
   The choke point stops doing timing work entirely.
3. **Tempo edits are audio-anchored.** *(SUPERSEDED 2026-07-18 — see §3a below.
   Kept verbatim for provenance: this was right as the DEFAULT for one edit
   class, wrong as a universal rule.)* Editing the tempo grid must NOT move
   already-placed notes in wall-clock time. Notes are re-ticked from their
   preserved `msTime` under the new map, using the **existing** transcription
   quantizer (`snapGroupToGrid` + abstain band via `swapSynctrack`), not a new
   snap policy.
4. **Markers:** lyrics (and vocal phrases) stay audio-anchored like notes.
   Sections snap to the grid — nearest whole note to their old audio position.
   Time signatures are grid entities (tick-anchored by definition).
5. **Collisions** (two same-pad notes re-ticking onto one tick): nudge apart
   (+1 tick on the later note), never merge.
6. **Safety net: property tests only.** Per-mutator Jest tests asserting
   `parse(write(chart)) ≅ chart` (round-trip idempotence over the fields we
   maintain). No runtime shadow validation.

### 3a. REVISION: four note-handling ops, chosen by edit class (2026-07-18, extended for 0062's glue toggle)

**Why Decision 3 needed revising.** Decision 3 made keep-ms (audio-anchoring)
the universal response to any tempo-map mutation. Research findings (fully
restated, with mechanism and numbers, in
`plans/todo/0061-appendix-research-findings.md`) measured three distinct
note-handling ops against real charts and found the *right* op is a property
of **why** the tempo map changed, not a universal. A **fourth op is added
here** (not part of the original research corpus study, but needed to give
0062 §9's "glued to grid" toggle engine semantics — see the appendix's
cross-reference table for why this one doesn't need a corpus measurement to
justify: it's a functional definition, not an empirical claim):

- **(1) KEEP-MS** — notes keep `msTime`, re-tick via `swapSynctrack` (Decision
  3's mechanism, unchanged). Audio-exact by construction, but **preserves the
  old grid's quantization error** — if the old lattice was wrong, keep-ms
  fossilizes that wrongness into the notes' relationship to the new lattice.
- **(2) BOUNDED RESNAP** — re-quantize note ticks to the new lattice (bounded
  by the existing abstain band). Measured **harmful** when the old grid was
  actually right (moves correct notes off their onsets for no gain) and, for
  the octave-correction case specifically, only fixes the tempo *label* while
  still moving notes off onsets (+0.032 audio cost measured — see appendix).
- **(3) RE-PREDICT** — re-run the **full grid-conditioned pipeline** from
  **decoded onset times** (not from stored `msTime`): the windowed KS-warp
  re-fits drift against the onsets with the user's corrected grid as its
  *incumbent* starting grid, then notes are freshly snapped through the
  warped lattice. The committed tempo map is the **warped result**, not the
  user's supplied correction verbatim — the supplied correction is the
  warp's input, and re-running the warp at the correct octave is part of
  what was measured (snap-only against the supplied lattice was NOT
  measured and would forfeit the drift re-fitting that made re-predict
  win). Measured **winner** for structural lattice corrections
  (octave/half-double): +2.84pp keepable, groove much better, audio
  ≈neutral (+0.0054), vs. resnap's +0.032 audio cost for the same +1.47pp
  keepable gain (full numbers in the appendix). The mechanism:
  wrong-lattice ms-times carry the wrong lattice's quantization baked in;
  re-predicting from raw onsets re-fits to the audio instead of rescaling a
  stale fit. §7's "Pipeline call surface" is the canonical description of
  what this op runs in app terms.
- **(4) KEEP-TICKS** ("glued to grid", new, 0062 §9) — notes keep their
  **tick**; `msTime` is recomputed from the new tempo map via plain
  `retimeChart` (no re-quantization step at all — this is the *simplest* of
  the four ops, a strict subset of `retimeChart`'s existing job). This is
  the authoring-mode op: the user trusts the tempo map and wants notes to
  ride it, e.g. hand-charting to a click track. **Never a default for a
  transcribed (audio-flow) chart's structural corrections** — it is an
  explicit user *mode toggle* (0062 §9), never something §3a's edit-class
  table below selects automatically.

**The decision framework (replaces Decision 3 as the universal rule):**

| Edit class | Default op | Why |
| --- | --- | --- |
| **(a) User hand-edits to tempo** (nudge a marker, retype a section's BPM, drag a tempo-map point) | **KEEP-MS** (Decision 3's mechanism survives, scoped to this class), **unless the glue toggle (0062 §9) is set to "glued to grid," in which case KEEP-TICKS** | The user is correcting the map around notes — possibly ones they've already hand-placed or hand-fixed. Audio-anchoring is right by default: don't second-guess a correction the user just made by moving their notes. The glue toggle is an explicit opt-out for authoring workflows. |
| **(b) Structural corrections that change lattice meaning** (half/double-time flip, meter change) | **RE-PREDICT** from preserved decoded-onset times, guarded (see below); **falls back to RESNAP** when no decoded onsets exist for this project (never KEEP-TICKS — the glue toggle only applies to class (a), see 0062 §9's note on this) | The old ms-times were quantized on a wrong lattice; keep-ms fossilizes that error into the corrected chart. Re-predict re-snaps from the source onsets through the corrected lattice — this is what the research measured as the winning op for this class specifically, not a general preference for re-predict over keep-ms. |
| **(c) Bar relabel** (downbeat/bar-1 tap) | **NO NOTE OP** | Rotates bar-line *numbering* only; beat times and note times are untouched. Not a note-remapping decision at all — see §6 and §3b (downbeat-flag store). |

**Glue toggle scope note (reconciling with 0062 §9):** 0062 §9 describes the
toggle as applying "to marker drags and marker deletes symmetrically" — both
of those are class (a) edits (a marker drag/delete is a hand-edit to the
tempo map, not a structural correction). The toggle therefore only ever
switches KEEP-MS ↔ KEEP-TICKS; it has no effect on class (b)'s
RE-PREDICT/RESNAP choice, which is governed entirely by decoded-onset
availability. This was an open ambiguity between the two plans — resolved
here as the only reading that keeps class (b)'s measured result (RE-PREDICT
beats RESNAP) meaningful regardless of the user's authoring-mode preference.

**In-memory mechanics for (b):** re-running snap must read from the
**decoded onset times**, not the snapped `msTime` on existing note events —
`msTime` already encodes the old (wrong) lattice's quantization, so
re-snapping ms-time-derived onsets reproduces resnap's failure mode, not
re-predict's win. **This requires decoded onset times to be retained
somewhere the in-memory edit path can read them.**

**Decoded-onset retention: audited, does NOT currently exist — new
requirement, now specified concretely (schema + exact call sites).** Traced
the pipeline (`lib/drum-transcription/pipeline/chart-builder.ts`,
`runner.ts`, `storage/opfs.ts`): `RawDrumEvent[]` (`lib/drum-transcription/
ml/types.ts`, shape `{timeSeconds: number; drumClass: DrumClassName;
midiPitch: number; confidence: number}`, one per detected onset, pre-snap)
is the in-memory decoded-onset data the research op needs, but it is
**discarded after `buildChartDocument`/`buildChartDocumentFromExistingChart`
return** — only `synctrack.json` (the tempo map) and `confidence.json`
(per-note confidence, keyed by the already-snapped tick) are persisted;
neither `ChartDocument` nor `ParsedChart` carries a field for it, and no
`decoded-onsets.json` exists in `storage/opfs.ts`'s `CHART_FILE_BASENAMES`.

**Concrete spec:**
- New type in `lib/drum-transcription/ml/types.ts` (or `lib/tempo-map/
  types.ts` — either is fine, pick based on which module owns the read
  side once §3 class (b) is wired):
  ```ts
  export interface DecodedOnsetsFile {
    /** Schema version; bump on any shape change so a load-time check can
     * detect and discard an incompatible/stale file rather than
     * misinterpreting it. */
    version: 1;
    /** Which flow produced these onsets — 'audio' (buildChartDocument,
     * fresh predicted synctrack) or 'chart' (buildChartDocumentFromExisting
     * Chart, onto the user's own synctrack). Both flows call the ML
     * transcriber and produce real onsets; only a NEVER-transcribed project
     * (hand-authored from empty, or an imported chart whose drum track was
     * never (re-)transcribed by this app) has none. */
    flow: 'audio' | 'chart';
    onsets: Array<{
      timeSeconds: number;
      drumClass: DrumClassName;
      midiPitch: number;
      confidence: number;
    }>;
  }
  ```
- Persist via the existing `writeProjectJSON(projectId, 'decoded-onsets.json',
  data)` helper (`lib/drum-transcription/storage/opfs.ts`), at the SAME point
  `confidence.json` is written today in `runner.ts` — i.e. immediately after
  `buildConfidenceData`, before `writeProjectBinary` for the chart file.
  **The rule is "every site that writes `confidence.json`," not a fixed
  count** — today that is THREE write sites: `runPipeline` (~:521),
  `runPipelineFromChart` (~:685), and `resumePipeline` (~:822, which has
  its own full transcribe→build path inside its `if (!hasChart)` block).
  All three transcribe real onsets. Missing `resumePipeline` would be a
  *silent* failure: the null-loader semantics below would make a resumed —
  but genuinely transcribed — project degrade to the RESNAP fallback with
  a wrong "never transcribed" disclosure. (An earlier draft said "both
  call sites," scoping to two; that undercounted.) Additionally,
  `regenerateProject` does not write `confidence.json` itself (it deletes
  derived artifacts via `REGENERATED_ARTIFACT_FILES` and delegates to
  `resumePipeline`) — add `'decoded-onsets.json'` to
  `REGENERATED_ARTIFACT_FILES` so a regeneration can't leave stale onsets
  paired with a fresh chart.
- Read path: a sibling loader next to wherever `confidence.json` is loaded
  today for the editor (same directory/module), returning
  `DecodedOnsetsFile | null` (null = no file on disk, meaning this project
  was never transcribed by this app).
- **Corrected scope limit (was: "audio-flow only" — WRONG, fixed here):**
  decoded onsets exist for **any project where the ML transcriber ran**,
  which is both `buildChartDocument` (fresh audio-flow chart — invoked from
  BOTH `runPipeline` and `resumePipeline`'s own transcription block) and
  `buildChartDocumentFromExistingChart` (drums added/replaced onto a
  user-supplied chart, via `runPipelineFromChart`) — every one of those
  write sites already has `RawDrumEvent[]` in
  scope at the point `confidence.json` is written. The only case with **no**
  decoded onsets is a chart that never went through transcription at all
  (a hand-authored chart, or an imported chart whose drum track was
  hand-written/imported rather than transcribed). For that case, class (b)
  has no RE-PREDICT option and **falls back to RESNAP** (still better than
  keep-ms for a structural correction, per the research's op ordering) with
  a UI disclosure that the audio-derived re-predict path isn't available.
  Do not synthesize decoded onsets from an existing chart's own note times
  — that's circular (it would "re-predict" from the very ms-times the
  correction is trying to fix).

**Op-sensitivity → user-facing choice (per Eli directive).** Re-predict and
keep-ms materially disagree (measured as more than a 0.01 movement on the
research's internal audio-fit score) on ~13.3% of songs (see appendix). The
op choice is surfaced to the user **only** on that disagreement set, never
as a default modal on every tempo edit:
1. Compute both ops' resulting note ms-times. KEEP-MS is a pure function of
   the stored ms-times and the supplied sync track (cheap). RE-PREDICT is
   **not** — the supplied correction is only the warp's incumbent input,
   and the final sync track is an *output* of the op (§7's canonical
   description), so producing its candidate means actually running the
   windowed KS-warp + snap. No re-transcription is involved, but it is not
   free; that's acceptable because this check only runs on class-(b) edits
   (see the corrected scope in §3's "Op-disagreement check").
2. Diff: for each note, `|keepMsResult.msTime - repredictResult.msTime|`.
   Aggregate (e.g. median or p90 across the track) against a threshold.
3. Below threshold: apply the class's default op silently (no dialog).
   Above threshold: show both results (e.g. an A/B preview toggle) and let
   the user pick — this is the *product*-level realization of "keep-or-reject
   IS the guard" from §7 below.

**UNRESOLVED — needs Eli, do not guess (workflow-readiness pass, 2026-07-18):
the concrete ms threshold for step 2.** The research's 0.01 figure is on an
internal audio-fit score computed over the whole 1022-song research corpus,
not a per-note ms value this app can compute directly from a single edit.
There is no existing corpus/fixture in *this* repo an implementing agent can
run to calibrate a translated ms threshold, and picking one by feel risks
either an annoying dialog on nearly every structural edit (threshold too
low) or a silently-wrong auto-pick on real disagreement cases (threshold too
high). **v1 workaround that sidesteps needing this number at all:** per §7's
resolution below, the only class-(b) entry point in this build (the
half/double + tap-tempo control) already always previews before committing
— so in v1, this threshold is unused (see §7's "Op-choice dialog trigger").
Wire the diff/threshold check as dead code behind a feature flag, defaulted
off, and leave the actual number as an open Eli decision for whenever a
non-previewed class-(b) entry point is added (e.g. a future batch "fix
common issues" scanner).

**Guarded batch/automated path — BLOCKED (certification completed 2026-07-19,
verdict: not deployable as specced).** The certification finished and the
result changes this section's premise. The note-ms guard alone (tol 0.5) is
**proven insufficient**: a wrong octave bit produces a denser grid that
*trivially improves* note-fit, so the guard passes charts whose groove is
destroyed (measured: 78% of abuse cases pass, groove damage uncontained up to
+0.81). The only guard combination that contains misuse in both abuse
directions (×2 and ÷2, both measured) is note-ms AND a one-sided
groove-regularity gate — but that groove gate is computed against ground-truth
charts and **cannot run at inference**. Therefore:

- The batch path is **feature-flagged off, reason: "blocked on a deployable
  groove proxy"** — not "pending certification." Do not build it.
- The blocker is measured **soft**: a no-GT proxy (onsets-per-beat density
  change + beat-phase concentration on the decoded onsets) separates abuse
  from correct flips at ~93% best-split accuracy — a production proxy is a
  plausible future research deliverable, at which point BOTH abuse directions
  must be re-certified against the proxy (recorded requirement in the research
  repo's certification block, drum-to-chart
  `autoresearch-pipeline/program.md`, commit be7b117).
- The **interactive path is unaffected and fully certified**: with a live
  preview, the user is the containment (keep-or-reject), no automatic guard
  is needed, and the unguarded re-predict numbers (+2.84pp keepable class)
  apply. This plan's §7 preview flow is the certified design.

### 3b. Downbeat-flag store (new, unifying 0061 §6 with 0062 §8)

**Reconciliation note.** 0062 §8 introduced a "downbeat flag" model (beats
carry a flag; bar lines/numbering/TS events are all *derived* from the
flags) as the storage model behind its downbeat-marking context menu. This
plan's §6 (bar relabel) was drafted independently and described the same
operation directly in terms of rewriting `origin_ms`/`timeSignatures`. These
are reconciled here as **one canonical source of truth**: the downbeat-flag
store is the data model; §6's phase-rotation (the tap/rephase gesture) and
0062's per-beat mark/unmark context-menu gesture are both **operations on
that one store**, not two independent mechanisms that happen to produce
similar results.

**Data model:**
```ts
/** The canonical source of truth for bar structure. Bar lines, bar
 * numbering, the bar.beat position readout, and the persisted TS events
 * are all DERIVED from this — never mutated independently of it. */
interface DownbeatFlags {
  /** Ascending entries, one per beat flagged as a downbeat (i.e. bar 1 of
   * some bar). Tick 0 is always present (beat 0 is always a downbeat —
   * 0062 §8's invariant). Each entry carries the time-signature
   * DENOMINATOR in effect for the bar it starts: scan-chart's TS events
   * are {tick, numerator, denominator}, and the beat unit is
   * denominator-scaled — `resolution * 4 / denominator` ticks per beat
   * (exactly the rule the highway's GridOverlay and
   * lib/drum-transcription/timing.ts already use). A tick-only model
   * cannot represent 6/8 vs 3/4 and would corrupt any /8 chart on the
   * save derivation below. */
  downbeats: Array<{tick: number; denominator: number}>;
}
```
This does not need to be a new persisted file — it is **derivable** from the
chart's existing `timeSignatures` array on load and **re-derivable back into
`timeSignatures`** on save/write (see "Derivation rules" below). Keep it as
in-memory-only state (`ChartEditorContext`, alongside `gridDivision`/
selection/etc. per 0062's "Architecture and integration" section) computed
once on chart load and invalidated whenever a downbeat-affecting op runs.

**Derivation rules (both directions, in denominator-scaled beat units):**
- **Load (`timeSignatures` → `DownbeatFlags`):** walk the TS event list in
  tick order; between consecutive TS events (numerator `N`, denominator
  `D`), the beat unit is `resolution * 4 / D` ticks and a downbeat falls
  every `N` such beats starting from the TS event's own tick. Each emitted
  entry records `D` as its denominator. Concatenate.
- **Save (`DownbeatFlags` → `timeSignatures`):** for each `downbeats[i]`,
  the beat unit is `resolution * 4 / downbeats[i].denominator`; the
  **derived numerator** is the number of such beats to `downbeats[i+1]`'s
  tick (or, for the last entry, the existing trailing numerator). Emit one
  TS event `{tick, numerator, denominator}` per index where the derived
  `(numerator, denominator)` pair differs from the previous entry's (0062
  §8's "chips render... at each point where the derived meter changes" —
  this is the same computation, just also used to build the persisted
  array, not only the UI chips). The denominator is carried through, never
  synthesized — this is what makes the round trip lossless for /8 meters.
- A **newly marked downbeat** (0062 §8's context-menu op) inherits the
  denominator of the nearest preceding TS event (equivalently, of the
  preceding `downbeats` entry) — marking a downbeat never invents a new
  beat unit.

**Operations on the store (both write `downbeats`, nothing else):**
- **§6's phase-rotation (tap "this is beat 1"):** described in §6 below —
  re-anchors which existing beats are flagged, in bulk, over the **whole
  song** (see §6's mechanics for why whole-song, not forward-only).
- **0062 §8's per-beat mark/unmark context menu:** a single-beat toggle —
  add or remove one entry in `downbeats` (sorted insert / filtered
  removal; a new entry inherits its denominator per the rule above). This
  is the finer-grained sibling operation to §6's bulk rephase — and the
  right tool for a genuinely *local* bar-structure change (it creates a
  meter change by definition), where §6's tap fixes a *global* phase
  mislabel. Both mutate the same array, so a mark/unmark done via the
  context menu and a later bulk rephase via §6's tap gesture compose
  correctly (neither can leave the store in an inconsistent state, because
  there is only one state).
- Both operations trigger a `timeSignatures` re-derivation (above) as part
  of the same command, so the persisted chart is never out of sync with
  the in-memory flag store.

## Defaults for unanswered questions (revisit before implementing)

- **Ownership:** implement `retime`/remap in `lib/chart-edit` + `lib/tempo-map`
  now, shaped to match 0039's `recomputeDerived(parsedChart, ranges?)`
  signature so upstreaming into the scan-chart fork later is mechanical.
- **Instrument scope:** drums/vocals/markers only. Timing recompute covers all
  tracks, but semantic derivation (guitar HOPO/chords) stays parser-only; any
  future guitar-editing command family opts back into a rebuild.

## Design

### 1. Timing primitives (lib/chart-edit)

```ts
/** Recompute msTime/msLength for every event at/after fromTick, from the
 *  chart's own tempos + resolution. fromTick=0 → full retime. */
retimeChart(parsedChart, fromTick?: number): void   // in-place on a cloned doc
```

Covers: tempos, timeSignatures, noteEventGroups (+lengths), starPower/solo/
freestyle/flex sections, chart sections, endEvents, vocal notePhrases + lyrics.
Uses `buildTimedTempos`/`tickToMs` from `lib/drum-transcription/timing.ts` (a
single file, not a directory) — **that file is the canonical tick↔ms home**
for these primitives and for 0062's shared beat-ms cache; note
`lib/chart-utils/tickToMs.ts` is a second existing home to be reconciled
(one implementation, one callsite update) during the shared-module
extraction. Consider moving the canonical file to `lib/chart-edit` to fix
the dependency direction.

### 2. Helper-level invariant (push model)

- Event-level mutators (`addDrumNote`, note moves, `addSection`, lyric/phrase
  moves…) compute the touched event's `msTime`/`msLength` from the tempo table
  at mutation time. Cache the timed-tempo table per chart revision if profiling
  says it matters (it won't for <10k events).
- `addTempo`/`addTimeSignature`/tempo-move/tempo-delete do NOT just retime —
  they trigger the audio-anchored remap (below). No more `msTime: 0`
  placeholders anywhere.
- **Format-quantized tempo values (invariant):** the chart formats quantize
  BPM on write — `.chart` to milli-BPM (scan-chart's writer does
  `Math.round(bpm * 1e3)`), `.mid` to integer µs/beat — so a BPM derived
  from an arbitrary ms gap (e.g. a dragged marker, `Δbeats / Δms`) is
  almost never representable, and storing it raw would make every
  downstream event's ms drift on write→parse, breaking §5's round-trip
  test and 0062 §7's local-drag invariant (neighbour-ms residue bounded by
  one quantization step and non-accumulating — a quantized BPM being the
  source of truth, exact bit-identity is unattainable, so the guarantee is
  a bounded, non-drifting residue, not zero movement). Therefore: any
  mutator that writes or derives a BPM **quantizes it to the document's
  format-representable value at edit time** and recomputes all ms
  (marker, notes, everything downstream) from the *quantized* value. The
  in-memory doc is then serialization-exact by construction; the only
  user-visible effect is a one-time sub-ms snap of the dragged marker
  itself.

### 3. Tempo remap (op selected per §3a)

On any tempo-map mutation, first classify it per §3a ((a) hand-edit, (b)
structural correction, (c) bar relabel — (c) skips this whole section, see
§6). Then:

**Class (a) — KEEP-MS (Decision 3's mechanism, scoped to this class):**
1. Build the new synctrack from the mutated `tempos`/`timeSignatures`.
2. Run `swapSynctrack(chart, newSync, {quantizeNotes: true})` semantics against
   the doc — notes keep `msTime`, get new ticks via the shared quantizer with
   abstain band; chords re-tick as one group (already guaranteed by
   `snapGroupToGrid` group handling).
3. Sections: re-tick to the **nearest whole-note gridline** to their old audio
   position (new policy — `swapSynctrack` currently preserves exact section
   times; add a section policy option rather than forking the function).
4. Lyrics/phrases: exact audio-time re-tick (raw path, no quantize).
5. Collision post-pass: same-type notes that landed on one tick → nudge the
   later one +1 tick (repeat until free). Preserve note count always.
6. Finish with `retimeChart` so every event's msTime matches its final tick
   (snapped/nudged notes move by sub-tolerance amounts; abstained notes by
   sub-ms rounding only).

**Class (b) — RE-PREDICT (new, §3a; requires decoded-onset retention, §3a):**
1. Build the structurally-corrected synctrack (octave rescale / tap fit).
   This is the *warp's incumbent input*, not the final map.
2. If decoded onsets are available for this project: re-run the **full**
   audio-flow pipeline — the windowed KS-warp (`warpGridReach`) with the
   corrected synctrack from step 1 as its incumbent grid, re-fitting drift
   against the onsets at the corrected octave, then `chart-builder.ts`'s
   onset→tick→`snapGroupToGrid` snap path (with its abstain band) against
   the **warped** lattice — using the retained `RawDrumEvent`-shaped
   decoded onset times as input, **not** the notes' current `msTime`. The
   committed tempo map is the warped output. This — warp included — is
   what reproduces the +2.84pp keepable / audio-neutral result
   (`bb6b077`); snap-only against the step-1 lattice was not what was
   measured, and reusing `msTime` reproduces resnap's measured worse
   result instead, so neither is an interchangeable implementation
   detail. §7's "Pipeline call surface" is the canonical app-terms
   description.
3. If decoded onsets are unavailable (hand-authored/imported chart, no
   audio-flow provenance): fall back to bounded RESNAP (step 2 of the
   class-(a) sequence above, i.e. `swapSynctrack` with `quantizeNotes: true`
   against the *new* lattice) plus a UI disclosure that re-predict wasn't
   available.
4. Steps 3-6 of the class-(a) sequence (sections, lyrics, collisions,
   `retimeChart`) apply identically regardless of which of steps 2/3 ran.
5. Non-interactive/batch invocations of this op MUST apply the post-snap
   note-ms guard (tol 0.5, revert-to-keep-ms-on-worsen) per §3a's "guarded
   batch path" — certification pending, gate app-side automated use on it
   landing. Interactive/preview invocations (§7) use accept/reject as the
   guard instead and do not need the note-ms guard.

**Op-disagreement check** (§3a): computed once per **class-(b)** mutation
only — class (a) has no re-predict candidate to disagree with, and the
13.3% disagreement figure was measured on the structural-correction class.
The keep-ms candidate is cheap; the re-predict candidate is the class-(b)
op's own output (warp + snap, already run). §3a has the surfacing rule;
per §7's resolution the check is feature-flagged dead code in v1 anyway.

`swapSynctrack` lives in `lib/tempo-map` and consumes its own `Synctrack`/
`TempoSegment` types — the editor integration should adapt at the boundary, not
duplicate the re-tick logic.

### 4. Choke point

`executeCommand` becomes `command.execute(doc)` — no rebuild call. Reconciler
push, undo snapshotting, autosave, export all unchanged. `chartBytes` is
documented as "bytes as loaded" (stale after first edit; only used by
`readChart`'s load-time modifier override).

### 5. Property tests (the only safety net)

For every mutator and every command (including `BatchCommand` chains, the
tempo remap, and the collision nudge):

- `writeChartFolder(doc)` → `parseChartFile` → compare against the in-memory
  doc: ticks identical; msTime within float tolerance; flags/groups identical.
  Because of §2's format-quantization invariant, tempo values must survive
  the round trip **exactly** (no BPM value may change on write→parse) —
  "float tolerance" covers arithmetic rounding only, not format drift.
- **Format-quantization test (new, §2):** a tempo edit to an arbitrary ms
  position produces a doc whose `beatsPerMinute` values are already
  format-representable for the doc's format (`.chart` milli-BPM, `.mid`
  integer µs/beat); write→parse changes no tempo value and shifts no
  downstream marker's ms.
- Tempo-remap-specific: notes' msTime before vs after edit differs only by
  quantize-within-tolerance or nudge amounts; note count preserved; chords
  never split across ticks; lyrics' msTime unchanged; sections land on
  whole-note gridlines.
- **Op-classification tests (new, §3a):** a hand-edit-classified mutation
  (single marker nudge, section BPM retype) always resolves to KEEP-MS; a
  structural mutation (octave/meter flip via §7's control) always resolves to
  RE-PREDICT when decoded onsets are present, RESNAP when absent; a bar
  relabel (§6) never touches note ticks or msTimes, only bar/TS numbering.
- **Decoded-onset-retention test (new, §3a):** a project built through the
  audio-flow pipeline round-trips its decoded onsets through
  save/load/`decoded-onsets.json` byte-identically; a project transcribed
  via `resumePipeline`'s own transcription path also has the artifact (the
  third write site — asserting this catches the silent-degradation bug);
  `regenerateProject` deletes the artifact along with the other derived
  files (`REGENERATED_ARTIFACT_FILES`); a hand-authored/imported
  project has no decoded-onset artifact and class-(b) edits on it visibly take
  the RESNAP fallback (assert on the disclosure/flag, not just the note
  result).
- **Op-disagreement threshold test (new, §3a):** a synthetic fixture pair
  constructed to differ by more than the calibrated ms threshold trips the
  user-facing choice path; a pair differing by less does not (silent default
  op).
- **Guard tests (new, §3a/§7):** the post-snap note-ms guard reverts a
  synthetic re-predict result that worsens note_ms beyond tol 0.5 to the
  keep-ms result, and leaves an improving result untouched.
- Real-chart edge-case fixtures per existing convention
  (`feedback_unit_tests_for_edge_cases`).

## 6. Feature spec: downbeat tap / bar-1 anchor (new, Eli directive 2026-07-18)

The bulk-rephase operation on the §3b `DownbeatFlags` store. (Originally
scoped, before the 0061/0062 merge, as its own tempo-grid-ux design idea;
that framing is now fully superseded by §3b's unified data model — no
external document is needed to implement this.)

**Interaction:** the user taps a waveform position (or clicks an existing
beat marker) and says "this is beat 1." No new tempo values, no BPM math —
this is a **bar relabel**, per §3a class (c): it rotates which beat is
labeled the downbeat by an integer number of beats; it does **not** move any
beat or note in time.

**Mechanics (operates on the §3b `DownbeatFlags` store — reimplement fresh
against this repo's `Synctrack`/`TempoSegment` types; there is no existing
implementation to port):**
1. Snap the raw tap position to the **nearest existing beat** (not downbeat)
   — forgiving of up to ±50ms tap imprecision (this jitter band was
   measured safe/audio-neutral by the research corpus study — see the
   appendix). "Beat" here and throughout is the **denominator-scaled beat
   unit** of the TS region containing the tap (`resolution * 4 / D` ticks
   per beat, per §3b) — not unconditionally a quarter note.
2. Compute `p = ` that beat's index (in that region's beat units, counted
   from the region's TS event) mod the region's numerator — the phase
   offset between the tapped beat and the current bar-1 assignment.
3. If `p == 0`, no-op (the user tapped an already-correctly-labeled
   downbeat).
4. Otherwise: rewrite `DownbeatFlags.downbeats` over the **whole song** —
   rotate the entire flag lattice so the tapped beat is a downbeat and
   every `N`th beat (per-region numerator/denominator preserved) from it,
   in both directions, is flagged (§3b's "phase-rotation" operation).
   **Whole-song, not forward-only, deliberately:** the research tested
   exactly this — phase error is constant across a song (k-section taps
   bought zero over one tap; a start-anchored rotation equaled the
   oracle-best anchor), because the ±few-beat mislabel is a global
   property of how the tracker locked on, not a mid-song event.
   Forward-only rotation would fabricate a meter-change TS event at the
   tap boundary that no measured song exhibits. The genuinely-local
   instrument already exists separately: 0062 §8's per-beat mark/unmark
   context-menu flag, which creates a meter change by definition and is
   the right tool for the rare true mid-song case. Re-derive
   `timeSignatures` from the updated store per §3b's save-direction rule
   so the persisted chart stays consistent. Beat times and note times are
   **untouched** — this is the one edit class in this whole plan with no
   note-retiming step at all.
5. Undoable via the existing command/undo stack (one `EditCommand`, one
   snapshot) — no special-casing needed since no note data changes.

**Verification affordance:** no separate "beat-flash" feature is needed —
0062 §4's grid rendering already draws downbeat/bar lines at the brightest
tier, extending through the tempo lane to the ruler and faintly through the
waveform row. That rendering, which updates live as `DownbeatFlags` changes,
IS the verification affordance: the user sees the new bar-1 line land on
(or off) the snare hit in the waveform row before/after tapping. No new
component is required.

**Measured value (informs priority, not a ship gate for this spec):** +1.17pp
keepable corpus-wide, +4.19pp on the worst-191 cohort, op-invariant (same
result regardless of which of the four §3a ops a *different* tempo edit on
the same song would use) — the highest value-per-build-effort lever measured
in the research (see appendix).

**Property tests:** add to §5's list — a tap at phase `p=0` is a no-op
(byte-identical doc); a tap at phase `p≠0` changes zero note/lyric/section
tick-vs-msTime relationships (assert every note's msTime is bit-identical
pre/post) and emits **no new TS event at the tap position** (whole-song
rotation, no fabricated boundary meter change); undo restores the exact
pre-tap doc; the resulting `DownbeatFlags`/`timeSignatures` pair
round-trips through §3b's load/save derivation without drift — including
fixtures with non-/4 denominators (6/8, 7/8) and mixed-meter charts, which
must survive load→save byte-identically (denominators preserved, never
rewritten as /4 equivalents).

## 7. Feature spec: user-invoked half/double (+ tap-tempo) with re-predict (new, Eli directive 2026-07-18)

Unifies "tap-tempo → fit → replace" and "half/double-time (octave) toggle"
(originally scoped as two independent levers before the 0061/0062 merge)
behind one control and one default op (RE-PREDICT, §3a class (b)) per the
appendix's finding that re-predict — not a rescale — is what makes
tempo-supply pay off. **0062 defers the buttons for this control to this
plan's phase 7 landing** — see "Panel hosting contract" below for what the
panel needs to expose in the meantime.

**Interaction — one control, two ways to invoke it:**
- **×2 / ÷2 button:** one click, no new tempo values supplied — the
  half/double bit alone.
- **Tap-tempo (optional, supplies the general non-octave case):** user taps
  ~4 beats; fit constant BPM + phase from the taps (two taps suffice for
  period + phase; more taps refine the fit — this is a standard tap-tempo
  fit, not novel math). Covers the non-power-of-2 ratio errors (1.2–1.4×)
  an octave bit alone cannot reach.

**Default op: RE-PREDICT with preview.**
1. User invokes the control (button or tap capture).
2. Compute the corrected-lattice synctrack (octave rescale, or the
   tap-derived constant-BPM+phase fit for the general case). This is the
   **warp's incumbent input** — not the map that gets committed.
3. Run the class-(b) re-predict path (§3, "Class (b)") — KS-warp re-fit
   with step 2's lattice as incumbent, then snap from decoded onsets — to
   produce a candidate chart. The candidate carries the **warped tempo
   map**, not step 2's lattice verbatim.
4. **Show the user the re-predicted chart as a preview** — including the
   warped grid itself (the gridlines the user evaluates are the candidate
   map's, since that is what accepting commits) — (before/after
   toggle or side-by-side, consistent with existing chart-editor preview
   idioms) — the user accepts or rejects. **Accept-or-reject IS the guard**
   for this interactive path; do not also apply the automated note-ms guard
   here (it would silently discard user-visible improvements the guard's
   coarse threshold doesn't understand as well as the user looking at their
   own chart does). This is the "+2.84pp keepable, groove much better, audio
   near-neutral" class from the appendix — the *unguarded* number, because
   in-product the guard is unnecessary when a human is the one accepting.
5. On accept: commit as one undoable `EditCommand` (one snapshot, same
   pattern as every other tempo mutation in this plan). "Commit exactly
   the previewed candidate" includes the warped tempo map — accept must
   not re-run the op or re-derive the map.
6. On reject: discard the candidate, chart unchanged, no snapshot pushed.

**Non-interactive/batch path (e.g. a future "auto-fix common issues" batch
action, not user-driven tap/click):** uses the guarded op from §3a/§3
("Guarded batch path") instead of preview-accept — +1.27pp keepable, audio
−0.004, all-axes clean (appendix), but **certification is running in
parallel (a separate ongoing effort outside this repo, no known landing
date) and gates shipping this path** — build the plumbing now, leave it
feature-flagged off until a future plan update lifts the flag.

**Panel hosting contract (new, resolves 0062's deferred-to-0061-§7 note
concretely).** 0062 says the panel "will host their buttons when 0061 phase
7 lands" without specifying the interface. Concretely, phase 7 needs the
panel (and `ChartEditorContext`) to expose:
- A **button/gesture slot** in the tempo lane (0062 §1's tempo-lane band)
  for the ×2/÷2 control and a tap-tempo capture affordance (visual design
  deferred to implementation; functionally, two entry points that each
  call into phase 7's op).
- A **pending-candidate state** on `ChartEditorContext` (view-local state,
  per 0062's "Architecture and integration" section — not a new store).
  **`pendingTempoCandidate` is the ONE preview channel for ALL tempo
  gestures** — not just this §7 control: a class-(a) marker drag's
  in-flight remap preview (0062 §7, invariant 5 of 0062's "Two views, one
  store") flows through the same field, so there is exactly one mechanism
  by which both views render uncommitted tempo geometry:
  ```ts
  interface PendingTempoCandidate {
    /** Which op produced the candidate: 're-predict' (this §7 control),
     * 'resnap' (its no-onsets fallback), or 'keep-ms'/'keep-ticks' (a
     * class-(a) marker drag in flight, per the glue mode). */
    op: 're-predict' | 'resnap' | 'keep-ms' | 'keep-ticks';
    /** The full candidate ChartDocument produced by running that op —
     * NOT yet committed. */
    doc: ChartDocument;
  }
  // On ChartEditorContext (or its state shape), alongside selection/hover/etc:
  pendingTempoCandidate: PendingTempoCandidate | null;
  ```
  When non-null, **both the highway and this panel render from
  `pendingTempoCandidate.doc` instead of `state.chartDoc`** (a preview
  overlay, not a committed state change) — this is the mechanism behind
  step 4's "before/after toggle" and behind live marker drags. An accept
  action (or drag release) commits `pendingTempoCandidate.doc` as the new
  `state.chartDoc` via one `EditCommand` and clears the pending state; a
  reject action just clears the pending state.
  - **Per-view fidelity during a marker drag:** the panel renders the
    candidate at full fidelity every frame (under KEEP-MS on a ms x-axis
    this is cheap — notes don't move, only gridlines/labels do;
    KEEP-TICKS is a plain `retimeChart`, also cheap). The highway (tick
    x-axis: every note moves) MAY throttle or defer the full note re-tick
    to release if per-frame `chartToElements`→reconciler cost demands it —
    but after release/accept it must render the committed doc immediately;
    it is never acceptable for either view to show stale committed
    geometry once the gesture has ended.
  - **Invalidation (hard rule):** any command dispatch, undo/redo, or
    chart reload that occurs while `pendingTempoCandidate` is non-null
    first clears/rejects the pending candidate before proceeding — the
    candidate is derived from a `state.chartDoc` that is about to change,
    and rendering or committing it afterward would desync the views from
    the undo stack.
- The op-choice dialog (§3a) does **not** need a separate UI surface for
  this control (see "Op-choice dialog trigger" below) — no additional
  hosting requirement beyond the pending-candidate mechanism above.

**Pipeline call surface (CANONICAL definition of the re-predict op —
§3/§3a defer to this):** re-predict (step 3) is a call into the existing
`warpGridReach`/`ks-warp.ts` machinery (the same windowed KS-warp the
audio-flow pipeline already runs at transcription time), **re-invoked with
the octave/tap-corrected grid as its incumbent input** — the warp re-fits
drift against the kick/snare onsets at the correct octave — followed by the
existing snap stage (`chart-builder.ts`'s onset→`snapGroupToGrid` path)
onto the freshly-warped lattice. Both stages are already ported; no new
math. **Reuse both verbatim**, do not fork a second warp/snap
implementation for the interactive path, and do not substitute a
snap-only variant (that op was not what the research measured — see §3a).
This is the same reuse principle Decision 3 already established for
`swapSynctrack`/`snapGroupToGrid`, extended to the new op.

**Op-choice dialog trigger — resolved concretely (workflow-readiness pass):**
this control is, in this build, the **only** entry point that can produce a
class-(b) structural correction (0062 doesn't expose direct TS-numerator
editing — its time-signature chips are read-only derived output per §3b,
and the only class-(b) trigger anywhere in 0061/0062 is this §7 control).
Since this control's step 4 already always shows a preview before
committing, **§3a's standalone op-choice dialog has no live trigger in v1**
— it never needs to render, because the preview already IS the op choice
(the user is looking at the RE-PREDICT result and can reject it, which is
equivalent to picking KEEP-MS/RESNAP). Do not build a separate dialog
component for v1. §3a's diff/threshold machinery stays spec'd (and
feature-flagged off, per §3a's "UNRESOLVED" note) purely so a *future*
class-(b) entry point without a preview step (e.g. a batch scanner) has
something to wire into later — it is not live UI work for this plan.

**Requires:** decoded-onset retention (§3a) — this control has no
audio-flow onsets to re-predict from on a hand-authored/imported project;
falls back to RESNAP (§3, Class (b) step 3) with a disclosure, same as the
general class-(b) fallback.

**Property tests:** add to §5's list — preview-accept commits exactly the
previewed candidate (no drift between preview and commit); preview-reject
leaves the doc byte-identical to pre-invocation; the batch/guarded path is
feature-flagged off by default (test asserts the flag gates the call, not
just that the guard logic exists).

## Phases (0061 engine only — see §8 below for the merged 0061+0062 sequencing an implementer should actually follow)

1. **Retime primitive + placeholder eradication.** `retimeChart`, event-level
   helpers set their own timing, property-test harness. Round trip still on —
   tests prove parity first.
2. **Cut the round trip.** Choke point simplification; delete
   `rebuildChartDocument`; verify editor flows in-browser (drag, paint-erase,
   undo/redo, autosave, export).
3. **Tempo remap, class (a) KEEP-MS (+ KEEP-TICKS).** Wire hand-edit tempo/TS
   commands to the §3 class-(a) sequence, including the KEEP-TICKS variant
   for the glue toggle (0062 §9) — KEEP-TICKS is a strict subset of
   `retimeChart` (phase 1), so it can land as soon as phase 1 is done, ahead
   of the rest of this phase if useful; section whole-note policy; collision
   nudge; UI verification on a real project (edit BPM mid-song, confirm
   notes stay on the audio).
4. **Decoded-onset retention (new, §3a).** Add the `DecodedOnsetsFile`
   persistence (concrete schema in §3a) in `runner.ts` at **every site
   that writes `confidence.json`** (`runPipeline`, `runPipelineFromChart`,
   `resumePipeline`), plus `'decoded-onsets.json'` in
   `REGENERATED_ARTIFACT_FILES`; load path alongside `confidence.json`;
   the never-transcribed no-onsets case is the explicit "falls back to
   RESNAP" path, not an unhandled gap.
5. **Tempo remap, class (b) RE-PREDICT + op-disagreement check (new, §3a).**
   Wire structural-correction commands to the §3 class-(b) sequence (re-run
   `warpGridReach` + snap from decoded onsets). The disagreement-check
   plumbing is built but feature-flagged off per §3a's "UNRESOLVED" note (no
   live UI trigger in v1 — see §7's resolution).
6. **Bar relabel + downbeat-flag store (new, §6 + §3b).** The `DownbeatFlags`
   **store** and its editing operations: the per-beat mark/unmark operation
   (0062 §8) and §6's bulk phase-rotation tap gesture — both share the one
   store, so build them together. The **pure derivation module** (§3b's
   load/save derivation, `timeSignatures` ⇄ downbeats/bars, denominator-
   aware) is NOT part of this phase — it is split out as `61-6a` in §8's
   build order (Group A, prerequisite of 0062's read-only panel, and the
   task that repoints the highway `GridOverlay` onto it). This phase
   consumes that module. No dependency on phases 4/5.
7. **Half/double + tap-tempo with re-predict, preview UI (new, §7).**
   Depends on phase 5 (re-predict) and phase 4 (decoded onsets) for the
   audio-flow path; the RESNAP fallback for onset-less projects can ship
   without waiting on those if sequencing demands it. Guarded batch variant
   is built but feature-flagged off pending the parallel certification (no
   known landing date — see §3a). The `pendingTempoCandidate` hosting
   contract (§7) can be stubbed into the panel earlier (see §8) since it's
   pure plumbing, independent of this phase's op logic.
8. **(Deferred, tracked in 0039)** upstream primitives into the scan-chart
   fork; revisit 0035's preview-path if per-edit cost is still visible in
   profiling after the round trip is gone (it likely isn't).

## 8. Merged build order (0061 engine + 0062 UI) — the sequencing an implementing agent should actually follow

0062's own "Phasing (suggested)" section (its phases 1–4) is gated in part on
0061's phases; this section is the single combined graph, since a workflow
needs one ordered/parallelizable plan, not two separate ones that
cross-reference each other. Node names below match each plan's own numbering
(`61-N` = this plan's "Phases" list above; `62-N` = 0062's "Phasing"
section).

**Group A — parallel, no prerequisites (start immediately):**
- `61-1` Retime primitive.
- `61-4` Decoded-onset retention (pure `runner.ts`/storage plumbing —
  doesn't touch the edit path at all, so it has no real dependency on
  anything else in either plan).
- `61-6a` **Bar-derivation module (split out of `61-6`):** the pure,
  denominator-aware `timeSignatures` ⇄ downbeats/bars derivation (§3b's
  two rules) as a shared non-React module — no store, no editing ops. Per
  the no-duplication rule, this task also **repoints the highway's
  `lib/preview/highway/GridOverlay.ts` bar/TS gridline derivation onto
  the module in its own commit** (extract + update the original callsite
  first) — satisfying 0062's "one derivation" invariant before any second
  consumer exists.
- `62-1` Read-only panel (layout, grid/notes/waveform rendering, zoom/pan,
  scrub, ruler section flags incl. click-to-seek, catch-up follow) — uses
  only pre-existing `tickToMs`/`buildTimedTempos` **plus `61-6a`'s
  derivation module for bar lines** (its one 0061-side prerequisite;
  without it, 62-1 would have to duplicate the derivation or draw
  `tick % (4*RES)` bars, both forbidden). Everything else in 62-1 can
  start immediately; only the grid-rendering slice waits on `61-6a`,
  which is small.

**Group B — depends on Group A:**
- `61-2` Cut the round trip (needs `61-1`).
- `62-2` Note editing (shared selection, drag/marquee/delta-snap, lane
  rules, context menu, click-to-add/erase parity) — needs `62-1` only, no
  0061 dependency; can run fully in parallel with all of 0061.

**Group C — depends on Group B:**
- `61-3` Class (a) KEEP-MS (+ KEEP-TICKS) remap (needs `61-2`).
- `61-6` Bar relabel + downbeat-flag store (needs `61-6a`; landing after
  `61-2` is **preferred order, not a gate** — its ops (single-array
  mutation + TS re-derivation, no note retiming) run fine through the
  existing rebuild choke point if it lands first. It has no data
  dependency on `61-3`/`61-4`/`61-5` and can run in parallel with
  `61-3` — or ahead of `61-2` if that unblocks `62-3` sooner).

**Group D — depends on Group C (and, for `62-3`, on Group A's `62-1`/`62-2`
already being done):**
- `61-5` Class (b) RE-PREDICT + op-disagreement plumbing (needs `61-3` for
  the shared steps-3–6 sequence, and `61-4` for decoded onsets).
- `62-3` Tempo/downbeat editing UI (marker render + drag + menus, downbeat/TS
  chips, glue toggle) — needs `62-1`+`62-2` (panel + note editing exist) AND
  `61-3` (class-(a)/KEEP-MS+KEEP-TICKS engine, for marker drag + the glue
  toggle) AND `61-6` (downbeat-flag store, for the mark/unmark context menu
  and TS-chip derivation). This is 0062's own stated gate ("0061 phases
  1–3"), refined here to the two specific engine phases it actually needs
  (`61-3`, `61-6`) rather than "phases 1–3" generically.

**Group E — depends on Group D:**
- `61-7` Half/double + tap-tempo preview UI (needs `61-5` + `61-4`). The
  `pendingTempoCandidate` plumbing and the tempo-lane button/gesture slot
  (§7's "Panel hosting contract") can be stubbed in during `62-3` — they're
  pure interface, no logic — so `61-7`'s actual op work is the only thing
  gated here; the panel-side slot doesn't have to wait.

**Group F — depends on Group D/E, no strict ordering between these two:**
- `62-4` Polish (resizable height persistence, anchor-fraction setting
  surface, section dragging, perf pass) — needs `62-3` done; independent of
  `61-7`.
- `61-8` Deferred upstream work (0039) — no urgency, can land whenever.

**Summary for a scheduler:** four independent tracks start simultaneously
(`61-1`, `61-4`, `61-6a`, `62-1` — the last gated only on `61-6a` for its
grid-rendering slice); 0062's note-editing track (`62-2`) never touches
0061 at all and can finish anytime before `62-3`; the two plans converge at
`62-3`, which is the single pinch point needing both `61-3` and `61-6`
landed — and since `61-6`'s only hard prerequisite is `61-6a` (the `61-2`
edge is preferred order, not a gate), `61-3` (via `61-1`→`61-2`) is the
true critical path to `62-3`; everything downstream (`61-5`, `61-7`,
`62-4`) is the tail.

## Risks

- **Serializer-normalization drift:** state only the parser used to normalize
  (sort order, dedupe, clamps) can now persist until export. Property tests
  must cover every mutator; a mutator without a test is the bug class.
- **`swapSynctrack` option creep:** section policy + collision nudge belong as
  options/post-passes so /tempo's existing behavior stays byte-identical.
- **Undo across remaps:** snapshots make this safe (whole-doc restore), but a
  future invertible-undo (0035 phase 8) must treat tempo remap as
  non-invertible-in-closed-form and keep snapshots for it.
- **Re-predict without certification (new, §3a/§7):** the guarded batch/
  automated re-predict path is NOT yet certified. Tracked in
  `drum-to-chart`'s own task list as item #117, "INTERACTIVE TEMPO-MAP
  phase" (in progress as of this plan's writing); check that item's status,
  or `autoresearch-pipeline/STATUS.md` in that repo, before assuming
  certification has landed — do not infer landing from the presence of the
  measured numbers in this plan's appendix (those numbers are the
  measurement, not the certification). Shipping the batch path un-flagged
  before certification lands would ship an unguarded claim on top of a
  guard whose false-negative rate isn't fully characterized. The
  preview/accept-reject path (§7) sidesteps this since a human is the
  guard, but any *automatic* invocation of re-predict must stay behind the
  certification gate.
- **Decoded-onset staleness (new, §3a):** if a user re-transcribes a project
  (re-runs the audio-flow pipeline), the retained decoded onsets must be
  regenerated too, or class-(b) re-predict will re-snap against stale onsets
  that no longer match the current note data — treat decoded-onset
  regeneration as part of the re-transcription flow, not an independent
  artifact that can silently drift from the chart it's paired with.
  Concrete mitigation (spec'd in §3a): `'decoded-onsets.json'` goes into
  `runner.ts`'s `REGENERATED_ARTIFACT_FILES` so `regenerateProject`
  deletes it before delegating to `resumePipeline`, which then rewrites it
  at its own transcription site.
