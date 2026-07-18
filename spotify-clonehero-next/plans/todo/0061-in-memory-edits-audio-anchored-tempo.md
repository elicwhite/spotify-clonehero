# Plan 0061: In-memory edits + audio-anchored tempo remapping

> **Refines:** 0035 (edit-path performance) and 0039 (upstream scan-chart primitives).
> 0035's "Best" option (replace the round trip with a local recompute) is adopted
> here as the baseline, not the stretch goal. 0039 remains the eventual home for
> the primitives; this plan ships them in-repo first.
> **New over 0035/0039:** tempo edits become *audio-anchored* — notes keep their
> ms position and are re-ticked, instead of keeping ticks and sliding in ms.
>
> **REVISED 2026-07-18 (audit, Eli directive).** Decision 3 below ("tempo edits
> are audio-anchored," universal) is **superseded by §3a "Three note-handling
> ops"** — the drum-to-chart interactive-tempo-map research (`program.md`
> commits `18be5b7`/`bb6b077`/`c5bbd0d`, harness `interactive_probe.py`) found
> that audio-anchoring (keep-ms) is right for *some* tempo-map edit classes and
> measurably wrong for others. §3a is the new decision framework; the original
> Decision 3 text is kept below, marked superseded, for provenance. Two new
> feature specs (§6, §7) are folded in per Eli's directive: downbeat-tap
> bar-relabel and user-invoked half/double with re-predict.

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

### 3a. REVISION: three note-handling ops, chosen by edit class (2026-07-18)

**Why Decision 3 needed revising.** Decision 3 made keep-ms (audio-anchoring)
the universal response to any tempo-map mutation. The interactive-tempo-map
research (drum-to-chart `autoresearch-pipeline/program.md`, commits
`18be5b7` / `bb6b077` / `c5bbd0d`; harness `interactive_probe.py`) measured
three distinct note-handling ops against real charts and found the *right*
op is a property of **why** the tempo map changed, not a universal:

- **(1) KEEP-MS** — notes keep `msTime`, re-tick via `swapSynctrack` (Decision
  3's mechanism, unchanged). Audio-exact by construction, but **preserves the
  old grid's quantization error** — if the old lattice was wrong, keep-ms
  fossilizes that wrongness into the notes' relationship to the new lattice.
- **(2) BOUNDED RESNAP** — re-quantize note ticks to the new lattice (bounded
  by the existing abstain band). Measured **harmful** when the old grid was
  actually right (moves correct notes off their onsets for no gain) and, for
  the octave-correction case specifically, only fixes the tempo *label* while
  still moving notes off onsets (+0.032 audio cost measured, `bb6b077`).
- **(3) RE-PREDICT** — re-run the grid-conditioned snap pipeline from
  **decoded onset times** (not from stored `msTime`), so notes are freshly
  snapped through the corrected lattice. Measured **winner** for structural
  lattice corrections (octave/half-double): +2.84pp keepable, groove much
  better (`ivall` −0.052), audio ≈neutral (+0.0054), vs. resnap's +0.032
  audio cost for the same +1.47pp keepable gain (`bb6b077`). The mechanism:
  wrong-lattice ms-times carry the wrong lattice's quantization baked in;
  re-predicting from raw onsets re-fits to the audio instead of rescaling a
  stale fit.

**The decision framework (replaces Decision 3 as the universal rule):**

| Edit class | Default op | Why |
| --- | --- | --- |
| **(a) User hand-edits to tempo** (nudge a marker, retype a section's BPM, drag a tempo-map point) | **KEEP-MS** (Decision 3's mechanism survives, scoped to this class) | The user is correcting the map around notes — possibly ones they've already hand-placed or hand-fixed. Audio-anchoring is right: don't second-guess a correction the user just made by moving their notes. |
| **(b) Structural corrections that change lattice meaning** (half/double-time flip, meter change) | **RE-PREDICT** from preserved decoded-onset times, guarded (see below) | The old ms-times were quantized on a wrong lattice; keep-ms fossilizes that error into the corrected chart. Re-predict re-snaps from the source onsets through the corrected lattice — this is what the research measured as the winning op for this class specifically, not a general preference for re-predict over keep-ms. |
| **(c) Bar relabel** (downbeat/bar-1 tap) | **NO NOTE OP** | Rotates bar-line *numbering* only; beat times and note times are untouched. Not a note-remapping decision at all — see §6. |

**In-memory mechanics for (b):** re-running snap must read from the
**decoded onset times**, not the snapped `msTime` on existing note events —
`msTime` already encodes the old (wrong) lattice's quantization, so
re-snapping ms-time-derived onsets reproduces resnap's failure mode, not
re-predict's win. **This requires decoded onset times to be retained
somewhere the in-memory edit path can read them.**

**Decoded-onset retention: audited, does NOT currently exist — new
requirement.** Traced the pipeline (`lib/drum-transcription/pipeline/
chart-builder.ts`, `runner.ts`, `storage/opfs.ts`): `RawDrumEvent[]` (each
with a raw `timeSeconds`, pre-snap) is the in-memory decoded-onset data the
research calls for, but it is **discarded after `buildChartDocument`
returns** — only `synctrack.json` (the tempo map) and `confidence.json`
(per-note confidence, keyed by the already-snapped tick) are persisted by
`runner.ts`; neither `ChartDocument` nor `ParsedChart` carries a field for
it, and no `decoded-onsets.json` (or equivalent) exists in
`storage/opfs.ts`'s `CHART_FILE_BASENAMES`. **Spec'd addition:**
- Persist `RawDrumEvent[]` (or the minimal `{tick /* pre-edit, for drift
  detection */, timeSeconds, drumClass, confidence}` subset) alongside
  `confidence.json` as a new per-project artifact (`decoded-onsets.json`),
  written once at transcription time by `runner.ts`, read-only thereafter.
- `ChartDocument` (or a sibling loaded alongside it, matching how
  `confidence.json` is loaded today) carries a reference to this data so
  `lib/chart-edit`/`lib/tempo-map` can re-run the (b)-class re-predict path
  without re-transcribing.
- **Scope limit:** decoded onsets exist only for the audio-flow (transcribed)
  path. A hand-authored or existing-chart-imported project has no decoded
  onsets — for those, class (b) has no RE-PREDICT option and **falls back to
  RESNAP** (still better than keep-ms for a structural correction, per the
  research's op ordering) with a UI disclosure that the audio-flow-only
  re-predict path isn't available. Do not synthesize decoded onsets from an
  existing chart's own note times — that's circular (it would "re-predict"
  from the very ms-times the correction is trying to fix).

**Op-sensitivity → user-facing choice (per Eli directive).** Re-predict and
keep-ms materially disagree (`|Δaudio| > 0.01`) on ~13.3% of songs
(`bb6b077`). The op choice is surfaced to the user **only** on that
disagreement set, never as a default modal on every tempo edit:
1. Compute both ops' resulting note ms-times (cheap: both are pure functions
   of the current decoded onsets / stored ms-times and the new sync track,
   no re-transcription).
2. Diff: for each note, `|keepMsResult.msTime - repredictResult.msTime|`.
   Aggregate (e.g. median or p90 across the track) against a threshold
   (calibrate against the corpus's audio-flow-edit-rate sensitivity implied
   by the `|Δaudio| > 0.01` cut — a concrete ms threshold needs a quick
   corpus pass before shipping; do not hand-pick one without checking it
   against real edit deltas).
3. Below threshold: apply the class's default op silently (no dialog).
   Above threshold: show both results (e.g. an A/B preview toggle) and let
   the user pick — this is the *product*-level realization of "keep-or-reject
   IS the guard" from §7 below.

**Guarded batch/automated path.** When re-predict runs without a live user
preview (e.g. a "fix this song" batch action, not an interactive tap), guard
it with the shipped post-snap note-ms guard (tol 0.5, revert to keep-ms on
note-worsening) — measured all-axes-safe: +1.27pp keepable, audio −0.004
(`c5bbd0d`). **Certification of this guard is running in parallel
(drum-to-chart pipeline-loop-10) — mark any app-side automated re-predict
path as gated on that certification landing**, not shippable off this plan's
audit alone.

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
Uses `buildTimedTempos`/`tickToMs` (already in `lib/drum-transcription/timing`;
consider moving to `lib/chart-edit` to fix the dependency direction).

### 2. Helper-level invariant (push model)

- Event-level mutators (`addDrumNote`, note moves, `addSection`, lyric/phrase
  moves…) compute the touched event's `msTime`/`msLength` from the tempo table
  at mutation time. Cache the timed-tempo table per chart revision if profiling
  says it matters (it won't for <10k events).
- `addTempo`/`addTimeSignature`/tempo-move/tempo-delete do NOT just retime —
  they trigger the audio-anchored remap (below). No more `msTime: 0`
  placeholders anywhere.

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
1. Build the new (structurally-corrected) synctrack.
2. If decoded onsets are available for this project: re-run the audio-flow
   snap pipeline (`chart-builder.ts`'s onset→tick→`snapGroupToGrid` path,
   with its abstain band) against the new synctrack, using the retained
   `RawDrumEvent`-shaped decoded onset times as input — **not** the notes'
   current `msTime`. This reproduces the +2.84pp keepable / audio-neutral
   result (`bb6b077`); reusing `msTime` here reproduces resnap's measured
   worse result instead, so this is not an interchangeable implementation
   detail.
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

**Op-disagreement check** (§3a): computed once per tempo-map mutation, cheap
(both candidate note-time sets already exist from the ops above) — see §3a
for the surfacing rule.

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
  save/load/`decoded-onsets.json` byte-identically; a hand-authored/imported
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

Implements UX #2 of `plans/2026-07-16-tempo-grid-ux.md` (drum-to-chart repo,
"Downbeat nudge / bar-1 anchor" — promoted to top tier there for the same
reason it's specced here: grid failures are dominated by phase/origin, not
tempo shape). Cross-reference that plan for the surrounding UX family
(triage badge, beat-flash) this sits alongside.

**Interaction:** the user taps a waveform position (or clicks an existing
beat marker) and says "this is beat 1." No new tempo values, no BPM math —
this is a **bar relabel**, per §3a class (c): it rotates which beat is
labeled the downbeat by an integer number of beats; it does **not** move any
beat or note in time.

**Mechanics (matches `interactive_probe.py`'s `rephase_global`, the research
reference implementation for this op — reimplement in TS against the app's
`Synctrack`/`TempoSegment` types, do not port the Python):**
1. Snap the raw tap position to the **nearest existing beat** (not downbeat)
   — forgiving of up to ±50ms tap imprecision (measured-safe jitter band in
   the research; the probe's `jitter_ms`-perturbed anchor runs stayed
   op-invariant, i.e. audio-neutral, under this band).
2. Compute `p = ` that beat's index mod the time signature's numerator — the
   phase offset between the tapped beat and the current bar-1 assignment.
3. If `p == 0`, no-op (the user tapped an already-correctly-labeled
   downbeat).
4. Otherwise: re-anchor `origin_ms`/tick-0 to the tapped beat, rewrite
   `timeSignatures` so the bar boundary lands there, and **drop or rewrite**
   any tempo/TS markers between the old and new origin so the numbering is
   consistent from the new bar-1 forward (`rephase_global`'s `origin_ms`
   splice, `interactive_probe.py:118-165`, is the reference for this
   bookkeeping). Beat times and note times are **untouched** — this is the
   one edit class in this whole plan with no note-retiming step at all.
5. Undoable via the existing command/undo stack (one `EditCommand`, one
   snapshot) — no special-casing needed since no note data changes.

**Verification affordance:** wire to the beat-flash overlay from
`plans/2026-07-16-tempo-grid-ux.md`'s lever #7 (playback flashes beat lines
on the waveform) so the user can confirm the new bar-1 lands on the snare/
downbeat before committing — that plan specs the flash as "essential glue,"
which applies directly here since a bar relabel has no other visible note
movement to confirm against.

**Measured value (informs priority, not a ship gate for this spec):** +1.17pp
keepable corpus-wide, +4.19pp on the worst-191 cohort, op-invariant (same
result regardless of which of the three §3a ops a *different* tempo edit on
the same song would use) — the highest value-per-build-effort lever measured
in the phase (`18be5b7`, `bb6b077`).

**Property tests:** add to §5's list — a tap at phase `p=0` is a no-op
(byte-identical doc); a tap at phase `p≠0` changes zero note/lyric/section
tick-vs-msTime relationships (assert every note's msTime is bit-identical
pre/post); undo restores the exact pre-tap doc.

## 7. Feature spec: user-invoked half/double (+ tap-tempo) with re-predict (new, Eli directive 2026-07-18)

Implements UX #5/#6 of `plans/2026-07-16-tempo-grid-ux.md` ("Tap-tempo → fit
→ replace" and "Half/double-time (octave) toggle"). Where that plan scoped
these as independent light/medium levers, this spec unifies them behind one
control and one default op (RE-PREDICT, §3a class (b)) per the research's
finding that re-predict — not a rescale — is what makes tempo-supply pay off.

**Interaction — one control, two ways to invoke it:**
- **×2 / ÷2 button:** one click, no new tempo values supplied — the
  half/double bit alone (research: `octave_flip`/`octbit_guarded` in
  `interactive_probe.py`).
- **Tap-tempo (optional, supplies the general non-octave case):** user taps
  ~4 beats; fit constant BPM + phase from the taps (research: `twotap_global`
  — two taps suffice for period + phase; more taps refine it). Covers the
  non-power-of-2 ratio errors (1.2–1.4×) an octave bit alone cannot reach —
  the research's `ratiofix`/`repredict_ratio` is the reference for "user
  supplies the true tempo" generally, of which the octave button is the
  one-bit special case.

**Default op: RE-PREDICT with preview.**
1. User invokes the control (button or tap capture).
2. Compute the corrected-lattice synctrack (octave rescale, or the
   tap-derived constant-BPM+phase fit for the general case).
3. Run the class-(b) re-predict path (§3, "Class (b)") to produce a
   candidate re-snapped chart from decoded onsets.
4. **Show the user the re-predicted chart as a preview** (before/after
   toggle or side-by-side, consistent with existing chart-editor preview
   idioms) — the user accepts or rejects. **Accept-or-reject IS the guard**
   for this interactive path; do not also apply the automated note-ms guard
   here (it would silently discard user-visible improvements the guard's
   coarse threshold doesn't understand as well as the user looking at their
   own chart does). This is the "+2.84pp keepable, groove much better, audio
   near-neutral" class measured in `bb6b077` — the *unguarded* number,
   because in-product the guard is unnecessary when a human is the one
   accepting.
5. On accept: commit as one undoable `EditCommand` (one snapshot, same
   pattern as every other tempo mutation in this plan).
6. On reject: discard the candidate, chart unchanged, no snapshot pushed.

**Non-interactive/batch path (e.g. a future "auto-fix common issues" batch
action, not user-driven tap/click):** uses the guarded op from §3a/§3
("Guarded batch path") instead of preview-accept — +1.27pp keepable, audio
−0.004, all-axes clean (`c5bbd0d`), but **certification is running in
parallel (drum-to-chart pipeline-loop-10) and gates shipping this path** —
build the plumbing now, leave it feature-flagged off until certification
lands.

**Pipeline call surface:** re-predict (step 3) is a call into the existing
`warpGridReach`/`ks-warp.ts` machinery (the same windowed KS-warp the
audio-flow pipeline already runs at transcription time) followed by the
existing snap stage (`chart-builder.ts`'s onset→`snapGroupToGrid` path) —
**reuse both verbatim**, do not fork a second warp/snap implementation for
the interactive path. This is the same reuse principle Decision 3 already
established for `swapSynctrack`/`snapGroupToGrid`, extended to the new op.

**Op-choice dialog trigger:** per §3a's op-disagreement check — for this
control specifically, the check almost always fires (a half/double or
tap-tempo invocation is exactly the class-(b) structural-correction case the
~13.3% disagreement rate was measured on), so in practice this control
usually **is** the "show both, let the user pick" path rather than a silent
default — the preview in step 4 already serves that purpose, so no separate
dialog is needed here specifically (the accept/reject preview subsumes the
op-choice UI for this one entry point; the separate dialog in §3a is for
edits that don't already have a preview step, e.g. a hand-typed BPM change
that happens to land in the disagreement set).

**Requires:** decoded-onset retention (§3a) — this control has no
audio-flow onsets to re-predict from on a hand-authored/imported project;
falls back to RESNAP (§3, Class (b) step 3) with a disclosure, same as the
general class-(b) fallback.

**Property tests:** add to §5's list — preview-accept commits exactly the
previewed candidate (no drift between preview and commit); preview-reject
leaves the doc byte-identical to pre-invocation; the batch/guarded path is
feature-flagged off by default (test asserts the flag gates the call, not
just that the guard logic exists).

## Phases

1. **Retime primitive + placeholder eradication.** `retimeChart`, event-level
   helpers set their own timing, property-test harness. Round trip still on —
   tests prove parity first.
2. **Cut the round trip.** Choke point simplification; delete
   `rebuildChartDocument`; verify editor flows in-browser (drag, paint-erase,
   undo/redo, autosave, export).
3. **Tempo remap, class (a) KEEP-MS.** Wire hand-edit tempo/TS commands to the
   §3 class-(a) sequence; section whole-note policy; collision nudge; UI
   verification on a real project (edit BPM mid-song, confirm notes stay on
   the audio).
4. **Decoded-onset retention (new, §3a).** Add `decoded-onsets.json`
   persistence in `runner.ts`; load path alongside `confidence.json`; the
   hand-authored/imported no-onsets case is the explicit "falls back to
   RESNAP" path, not an unhandled gap.
5. **Tempo remap, class (b) RE-PREDICT + op-disagreement check (new, §3a).**
   Wire structural-correction commands to the §3 class-(b) sequence (re-run
   `warpGridReach` + snap from decoded onsets); implement the disagreement
   check and calibrate its ms threshold against a quick corpus pass before
   shipping any user-facing dialog built on it.
6. **Bar relabel (new, §6).** Tap-to-beat snapping (±50ms), phase-rotation
   origin/TS rewrite, beat-flash verification wiring. No dependency on 4/5 —
   can ship independently and first, per its measured value-per-effort.
7. **Half/double + tap-tempo with re-predict, preview UI (new, §7).**
   Depends on phase 5 (re-predict) and phase 4 (decoded onsets) for the
   audio-flow path; the RESNAP fallback for onset-less projects can ship
   without waiting on those if sequencing demands it. Guarded batch variant
   is built but feature-flagged off pending the parallel certification
   (drum-to-chart pipeline-loop-10).
8. **(Deferred, tracked in 0039)** upstream primitives into the scan-chart
   fork; revisit 0035's preview-path if per-edit cost is still visible in
   profiling after the round trip is gone (it likely isn't).

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
  automated re-predict path is NOT yet certified (parallel drum-to-chart
  work) — shipping it un-flagged before that lands would ship an unguarded
  claim on top of a guard whose false-negative rate isn't fully
  characterized. The preview/accept-reject path (§7) sidesteps this since a
  human is the guard, but any *automatic* invocation of re-predict must stay
  behind the certification gate.
- **Decoded-onset staleness (new, §3a):** if a user re-transcribes a project
  (re-runs the audio-flow pipeline), the retained decoded onsets must be
  regenerated too, or class-(b) re-predict will re-snap against stale onsets
  that no longer match the current note data — treat decoded-onset
  regeneration as part of the re-transcription flow, not an independent
  artifact that can silently drift from the chart it's paired with.
