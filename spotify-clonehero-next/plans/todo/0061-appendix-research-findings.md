# Appendix: interactive-tempo-map research findings (curated context)

**Purpose.** Plan 0061 (engine) and 0062 (UI) build on measurements from a
research phase in a sibling repository, `drum-to-chart`. **You (the
implementing agent) CAN read that repo — read access is fine, read-only, no
edits.** What you don't have is the accumulated interpretive context of the
person who ran that research: which of several appended blocks in the same
file is the final word, which numbers got corrected after being published,
and which files are, by design, a running ledger of *rejected* ideas. This
appendix exists to give you that interpretation up front — the findings,
numbers, and mechanisms your implementation decisions depend on, stated
authoritatively — plus a short annotated reading list if you want the
underlying depth. Treat the "Curated findings" section below as given; you
do not need to re-derive or re-measure it. Use the reading list only if you
want more context than this appendix provides, and read its annotations
about staleness before you draw conclusions from anything you find there.

## READ THIS BEFORE OPENING drum-to-chart: authoritative vs. historical

**`drum-to-chart` is a working research ledger, not a wiki of settled
truths — it is built to preserve superseded and refuted material
on purpose, right alongside the current state, with no deletion.** Finding
an old number, an abandoned lever, or a "DON'T-RUN" entry in that repo is
normal and expected; mistaking one for current guidance is the actual
hazard. Two concrete traps in the exact files this appendix draws from:

1. **`autoresearch-pipeline/program.md` contains THREE appended blocks for
   this research, in this order, and the middle one explicitly corrects the
   first:**
   - `# INTERACTIVE TEMPO-MAP PHASE` (the first block, ~line 2106) — its
     "supply true tempo" row reports `d_audio +0.032, d_keepable +1.47pp`
     with the verdict **"TRADE (barely > phase, costs audio)"**, and its
     product recommendation downgrades tap-tempo/half-double to
     **"CONDITIONAL... not an auto-fix."** — **this is now known to be an
     accidental measurement of the RESNAP op only** (the block predates the
     discovery that there were multiple candidate ops at all).
   - `# INTERACTIVE PHASE — CORRECTED 3-OP MATRIX` (~line 2157) — its own
     header says why it exists: *"measure each interaction under the
     product's THREE note-handling ops."* This block's RE-PREDICT row
     (`+0.0054` audio, `+2.84pp` keepable) is the number that supersedes the
     first block's TRADE verdict for the same interaction, and its
     "CORRECTED PRODUCT RECOMMENDATION" upgrades tap-tempo/half-double to
     **"BUILD."** **If you read only the first block, you will walk away
     with the wrong (superseded) recommendation.**
   - `# GUARDED RE-PREDICT` (~line 2205) — a further refinement layered ON
     TOP of the corrected block's RE-PREDICT number (a batch/automated-use
     variant), not a replacement of it. Both the corrected block's unguarded
     number and this block's guarded number are simultaneously valid, for
     two different invocation modes (interactive preview vs. automated
     batch) — this appendix's "Curated findings" table already reflects
     that distinction correctly.
   - **The curated findings below already resolve this** — they cite only
     the corrected/final numbers. If you go read `program.md` directly,
     read the corrected block (and everything after it), not the first one.
2. **`escalations.md` files (there is one per research phase —
   `autoresearch-tempo/escalations.md`, `autoresearch-pipeline/escalations.md`,
   `autoresearch-product/escalations.md`, `autoresearch-adt/escalations.md`)
   are DON'T-lists by design** — each one's own header says something like
   "AUTHORITATIVE DONT-LIST... a respawned agent MUST read this FIRST." Every
   entry is a **closed, rejected, or superseded direction** — reading one and
   treating an entry as "here's an idea to build" is backwards; the correct
   reading is "this was tried/considered and the answer was no, don't
   re-propose it." None of them are about the interactive-tempo-map ops this
   plan depends on (they're about the separate — and also research-adjacent
   but unrelated — grid-construction/threshold levers), but if you go looking
   for context near this work, don't mistake one of their entries for a
   live suggestion.

## Annotated reading list (optional depth; not required to implement 0061/0062)

| File (in `drum-to-chart`) | What to take from it |
| --- | --- |
| `autoresearch-pipeline/program.md`, the block headed `# INTERACTIVE PHASE — CORRECTED 3-OP MATRIX` (~line 2157) and everything below it in the file | The primary source for the "Curated findings" section below — the 3(4)-op measurements, the 13.3% figure, the guarded-vs-unguarded re-predict split. This is what to read for depth; the block ABOVE it (`# INTERACTIVE TEMPO-MAP PHASE`, ~line 2106) is the pre-correction version — see the warning above. |
| `wiki/autoresearch-tempo-grid.md` | The terminal-state summary of a **different, unrelated** research arc (stage 7-9 grid *construction* quality — DBA weight/tolerance retuning, kick/snare warp — the shipped baseline grid this plan's numbers are measured against, e.g. "audio-flow raw 0.3401"). Useful only for understanding why the baseline numbers in the curated findings look the way they do; says nothing about interactive editing ops. Do not confuse "grid construction quality" (this page) with "what happens to notes when the user edits the tempo map" (this appendix's actual subject). |
| `autoresearch-pipeline/PHASE_SUMMARY.md`, `autoresearch-tempo/PHASE_SUMMARY.md` | Terminal checkpoints for the same grid-construction arc as above — same caveat: unrelated to the interactive-editing ops, useful only for background on the shipped baseline. |
| `autoresearch-tempo/escalations.md`, `autoresearch-pipeline/escalations.md`, `autoresearch-product/escalations.md`, `autoresearch-adt/escalations.md` | **DON'T-read-as-current lists** — every entry is a closed/refuted direction in a different (grid-construction or model-training) research line. Not required reading for 0061/0062 at all; listed here only so that if you end up in this repo poking around for context, you recognize what these files are and don't misread an entry as live guidance. |
| `plans/2026-07-16-tempo-grid-ux.md` (drum-to-chart's own `plans/`, not this repo's) | The original design-of-record memo that first proposed the downbeat-nudge and half/double/tap-tempo levers (its own header marks it **"PARKED... NOT scheduled for execution"** as of 2026-07-16). 0061 §6/§7 and 0062 §8/§9 in this repo have since superseded and considerably extended this memo's UX sketches with concrete mechanics, data models, and measured numbers — treat it as the historical origin of the idea, not as a spec to implement against; where it and 0061/0062 differ, 0061/0062 (this repo) wins. |

## Curated findings

### What was measured, and how (context, not required reading)

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

### The four note-handling ops (three measured by the corpus study, one — KEEP-TICKS — a functional addition for authoring mode)

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
