# Appendix: interactive-tempo-map research findings (self-contained)

**Purpose.** Plan 0061 (engine) and 0062 (UI) cite measurements from a research
phase that ran in a different repository (`drum-to-chart`,
`autoresearch-pipeline/program.md` commits `18be5b7`/`bb6b077`/`c5bbd0d`,
harness `interactive_probe.py`). **An implementer working only in this repo
cannot open those files.** This appendix restates every finding those plans
depend on as an established fact, with enough mechanism to make correct
micro-decisions without access to the research repo. Treat everything below
as given — it does not need to be re-derived or re-measured to implement
0061/0062. The commit hashes are kept only as historical provenance, not as a
pointer you need to follow.

## What was measured, and how (context, not required reading)

The research asked: when a chart's tempo map is corrected after notes
already exist, what should happen to the notes? It built oracle-input
simulations (a corpus of ~1022 songs with real ground-truth tempo maps) that
mimic a user supplying partial tempo information (a downbeat tap, a
half/double bit, a tap-tempo capture) and re-scored the resulting charts
against two axes: **audio-flow edit rate** (how far notes sit from the
recording's actual drum hits — lower is better) and **keepable-%** (whether
the resulting chart's tempo map is a clean map the user would keep as-is,
vs. a mess they'd throw out and remap by hand). Three candidate ways of
updating notes when the tempo map changes were compared head-to-head on the
same corpus, holding the *new* tempo map fixed and varying only what happens
to already-placed notes.

## The three (four, with authoring mode) note-handling ops

| Op | What happens to a note | Where it's the right default |
| --- | --- | --- |
| **KEEP-MS** | Note keeps its absolute wall-clock position (`msTime`); its tick is recomputed under the new tempo map (`swapSynctrack`'s existing mechanism). | User hand-edits to the tempo map (nudging a marker, retyping a section's BPM) — see 0061 §3a class (a). |
| **BOUNDED RESNAP** | Note's tick is re-quantized to the new lattice (bounded by the existing ~40ms abstain band) — its `msTime` moves to wherever that new tick lands. | Fallback only, when RE-PREDICT's input (decoded onsets) is unavailable — see 0061 §3a class (b) fallback. Never a first-choice default. |
| **RE-PREDICT** | Note is re-derived from scratch: the corrected tempo map is re-fit to the song's raw drum-onset detections (not to the note's *current* position), then the onset is re-quantized through the corrected lattice. | Structural corrections that change what the lattice *means* — half/double-time flip, meter change — see 0061 §3a class (b) primary path. |
| **KEEP-TICKS** ("glued to grid") | Note keeps its tick; its `msTime` is recomputed from the new tempo map (plain `retimeChart`, no re-quantization at all). | Authoring-mode toggle (0062 §9) — the user is treating the tempo map as ground truth and wants notes to ride it, e.g. when hand-authoring a chart to a trusted click track. **Never a default for a transcribed (audio-flow) chart** — see 0061 §3a's updated table. |

### Why KEEP-MS is not a universal default (the core finding)

A tempo map can be locally wrong in two different ways, and they call for
different fixes:

- **A small, local error** (a marker's exact ms position is off by a few
  tens of ms) — the *lattice's meaning* (which beat is which, how many
  beats per bar) is still correct. Here, notes are already sitting at their
  correct audio positions; only the local tick-to-ms conversion needs a
  tweak. **KEEP-MS is exactly right**: it doesn't move the notes, it just
  updates which tick each note's existing audio position maps to.
- **A structural error** (the whole song was transcribed at half or double
  the true tempo, or the meter is wrong) — every note's *tick* was assigned
  under a wrong-shaped lattice. The note's stored `msTime` is still the
  correct raw audio position, but the **note's relationship to bar/beat
  structure is wrong throughout**, not locally. If you fix the lattice and
  then run KEEP-MS, you get a chart where notes sit at the right audio time
  but land on garbage subdivisions relative to the *new*, correct lattice —
  because the old snap decision (made against the old, wrong lattice) is
  frozen into each note's position. **RESNAP** (re-quantizing the existing
  `msTime` to the new lattice) does fix the label but was measured to *also*
  drag notes off their true onsets, because it's rescaling stale
  quantization rather than re-deriving from the source audio evidence.
  **RE-PREDICT** fixes this by throwing away the stale note positions
  entirely and re-deriving each note fresh from the raw onset detections
  through the corrected lattice — the onset detections themselves never
  encoded the wrong lattice, so re-quantizing *them* (not the notes) avoids
  compounding the old error.

### Measured numbers (1022-song research corpus; the numbers cited elsewhere in 0061/0062 trace to these)

All deltas are relative to the shipped baseline chart (no interactive
correction applied).

| Interaction | Op | Δ audio-flow edit rate | Δ keepable-% | Note |
| --- | --- | --- | --- | --- |
| Downbeat tap → bar relabel | any (op-invariant) | ≈ 0 (+0.0002) | **+1.17pp** corpus-wide, **+4.19pp** on the worst-scoring 191-song cohort | Op-invariant because bar relabel is not a note op at all (see below) — same result no matter which of the other three ops a *different* edit on the same song would use. |
| Structural correction (half/double, meter) | KEEP-MS | 0.0000 (by construction) | +1.47pp | Keeps old quantization; label-only fix. |
| Structural correction | RESNAP | +0.032 (**worse**) | +1.47pp | Same keepable gain as keep-ms, but drags notes off onsets — strictly dominated by re-predict below. |
| Structural correction | **RE-PREDICT** | **+0.0054** (≈neutral) | **+2.84pp** | The winner: re-fits to onsets through the corrected lattice. Also measured much better on a groove-similarity-to-ground-truth metric (a phase-invariant rhythm-pattern check) than either KEEP-MS or RESNAP. |
| Structural correction | RE-PREDICT, **guarded** (batch/automated use, no live preview) | **−0.004** (better than baseline) | +1.27pp | A guard reverts to KEEP-MS on any song where re-predict's own note-to-onset fit would get worse (tolerance 0.5 units on the internal note-fit measure) — trades away roughly half the unguarded keepable gain in exchange for a hard guarantee of no regression on any individual song. This certification is the one piece of the research **not yet fully signed off** — treat any *automatic* (non-preview) invocation of re-predict as gated on it landing. |
| Full dense ground-truth tempo map (theoretical ceiling, not achievable from sparse taps) | — | −0.13 (much better) | +8pp | Cited only to show headroom; no sparse user gesture reaches this — it requires per-beat human tempo knowledge, out of scope for any of these features. |

**Op-sensitivity (the 13.3% figure):** on the structural-correction class,
KEEP-MS and RE-PREDICT were compared song-by-song. On about **13.3% of
songs** the two ops' resulting audio-flow scores disagree by more than 0.01
(a threshold chosen to mean "a difference a listener/editor would likely
notice") — mostly a bimodal split (roughly half the disagreeing songs get
much better under re-predict, the other half get worse, because an
octave/meter correction is occasionally applied to a song that didn't
actually need it, a false-fire the guard above exists to catch). This is
the set 0061 §3a's op-disagreement check is built to surface to the user
rather than silently picking one op.

### Bar relabel moves nothing (why it's outside the op question)

A downbeat/bar-1 correction — the user identifies that a *different* beat
than the one currently labeled "beat 1" is the true downbeat — does not
require deciding between KEEP-MS/RESNAP/RE-PREDICT/KEEP-TICKS at all. No
beat's time changes, no note's time changes. Only the **numbering** (which
existing beat is bar 1, hence all subsequent bar/beat labels) rotates by an
integer number of beats. This is why the measured result is "op-invariant" —
there is no op, in the note-remapping sense, for this interaction. It is a
pure relabeling of the existing beat grid.

## Cross-reference table (which plan section maps to which finding)

| 0061/0062 section | Finding above it depends on |
| --- | --- |
| 0061 §3a (op table) | The four-op table and the KEEP-MS-preserves-wrong-lattice mechanism. |
| 0061 §3a (op-disagreement check) | The 13.3% figure. |
| 0061 §3a (guarded batch path) | The guarded RE-PREDICT row (−0.004 / +1.27pp) and its certification-pending status. |
| 0061 §6 (bar relabel) | "Bar relabel moves nothing" + the +1.17pp/+4.19pp row. |
| 0061 §7 (half/double + tap-tempo) | The structural-correction rows (KEEP-MS vs RESNAP vs RE-PREDICT) and the 13.3% figure. |
| 0062 §9 (glue toggle) | The KEEP-TICKS row (added to the framework specifically to give the "glued to grid" toggle position engine semantics — this row did not exist in the original research's three-op comparison; it's the authoring-mode case, not something the corpus study measured, and doesn't need to be — it's a pure functional definition, not a claim requiring measurement). |
