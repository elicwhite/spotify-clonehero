# 0071 — /difficulties: side-by-side drum difficulty-reduction comparison

Product page at `/difficulties`. User uploads a chart with an Expert drum
track. The page runs three difficulty-reducers — **Ours** (a trained GBM),
**HOPCAT** (C3toolbox port), **Onyx** (Reductions.hs port) — each producing
Hard/Medium/Easy, and renders all of it as a synced grid of highway previews
against one shared audio track. Comparison only in v1 — no export.

Layout (confirmed against the mock):

```
┌──────────────┬────────┬────────┬────────┐
│              │  Hard  │ Medium │  Easy  │
│   Expert     ├────────┼────────┼────────┤
│  (original,  │  Ours  │  Ours  │  Ours  │
│  full height)├────────┼────────┼────────┤
│              │ HOPCAT │ HOPCAT │ HOPCAT │
│              ├────────┼────────┼────────┤
│              │  Onyx  │  Onyx  │  Onyx  │
└──────────────┴────────┴────────┴────────┘
```

10 highways total (1 Expert + 9 reductions), one shared transport (play /
pause / seek / speed), all locked to the same audio.

## Decisions locked with Eli (2026-07-21)

- **Ship the trained GBM** (`reduction_probe.py`'s per-tier
  `HistGradientBoostingClassifier`), not a distilled deterministic rule.
  This is the reference plan's open "no-training-scope" question — resolved:
  ship it.
- **`era` feature hardcoded to `RB4`** for every uploaded chart (matches the
  eval's target methodology). No retraining.
- **v1 is comparison-only** — no reduced-chart export/download. (The
  reference plan's §5 UX section describes export; cut from v1 scope.)
- **Input: file upload only** (chart file/folder/.sng/.zip via the existing
  chart-picker), reusing the same picker pattern as `/tempo` and
  `/chart-review`. No "load from open project" integration.

## Source of truth (read in full before porting — do not re-derive from REAPER/Haskell)

All at `~/projects/drum-to-chart/analysis/hopcat_reduction_eval/`:

- `reduce_port.py` + `tests/test_reduce_port.py` — HOPCAT (`C3toolbox.py:reduce_5lane`, drums path).
- `onyx_reduce.py` + `tests/test_onyx_reduce.py` + `onyx_midi_io.py` — Onyx (`Reductions.hs:drumsReduce`/`drumsComplete`).
- `reduction_probe.py` — our GBM: `extract_song_features`/`featurize`/`build_matrix` (feature vector) + `train_tier_model` (the model to export).
- `editrate.py` — parity/scoring reference (`edit_rate`, `Note`, `notes_from_difficulty`).
- `PRODUCT_REDUCTION_PAGE_PLAN.md` — full narrative spec; this plan implements it with the scope cuts above.

**Non-negotiable parity mandate**: JS ports of HOPCAT/Onyx must reproduce the
Python ports' output note-for-note, **tick-exact** (see the exact-equality
rationale in §5 — no tolerance), on reference charts run through the real
production adapter (§4), not just on pre-parsed Python dumps. Preserve every
documented quirk (HOPCAT's always-truthy companion `or`, its absolute-tick
second pass; Onyx's Easy←Hard cascade) — do not "fix" them, we are
reproducing the tools as deployed.

## Architecture

### 1. Raw chart data — no new parser needed

`@eliwhite/scan-chart`'s `ParsedChart` (via `readChart`/`parseChartFile` in
`lib/chart-edit/`) already carries ticks **and** `msTime` on notes, tempos,
time signatures, sections, star-power (OD) phrases. Feed the reducers off
`chart.trackData[...].noteEventGroups`, `chart.tempos`, `chart.timeSignatures`,
`chart.resolution`, `chart.sections`, `chart.starPowerSections` directly.
`lib/chart-edit/bar-derivation.ts` (`deriveBeatGrid`, `deriveTimeSignatures`)
already builds measure/downbeat boundaries — reuse it instead of
reimplementing `MeasureMap`/`build_measures` from scratch where its output
shape fits; where the reducers need tick-exact measure-relative positions
matching the Python ports bit-for-bit, port `MeasureMap`/`mbt()` faithfully
regardless (parity beats reuse here — see mandate above).

Disco-flip regions and tom markers: **resolved** (adapter phase, 2026-07-21).
scan-chart does NOT preserve the raw `[mix N drums*]` text events or 110-112
tom-marker spans in `ParsedChart` (verified in scan-chart's
`notes-parser.ts:resolveDrumModifiers`) — it consumes them once and exposes
only the resolved per-note tom/cymbal + disco flags. A native `compute_pro`
port from `ParsedChart` is therefore impossible (the raw region markers are
gone) AND unnecessary — scan-chart resolves tom/cymbal/disco identically to
Onyx's own `compute_pro`, independently corroborated by Onyx's own AMBIGUITY
#4. **Onyx's TS port consumes scan-chart's resolved lanes directly**
(`adapter/toOnyxInput()`'s `resolvedGems`), not raw markers. HOPCAT's port
still needs pitch-encoded gems + reconstructed disco text-events (see §4 —
the adapter brackets each run of flip-flagged notes into a synthetic
marker span since the original marker ticks aren't recoverable from
`ParsedChart`; validated by the full-corpus differential, §5).

### 2. Reducers: `lib/drum-difficulty/`

```
lib/drum-difficulty/
  types.ts                # RawNote{tick,msTime,lane,...}, ReducedTiers{hard,medium,easy}
  measureMap.ts            # tick-based MeasureMap/mbt(), ported from reduce_port.py
  rational.ts              # exact tick-ratio arithmetic for Onyx (bigint numerator/denominator; no floats)
  hopcat/
    reduceNotes.ts          # remove_notes, remove_kick, single_snare, unflip_discobeat, simplify_roll
    reduce.ts               # reduce_5lane_drums orchestrator + DEFAULT_CONFIG
    __tests__/              # ported from tests/test_reduce_port.py
  onyx/
    computePro.ts
    drumsReduce.ts           # keep_snares/keep_kit/keep_kicks/make_easy family/ensure_od_notes
    reduce.ts                # drums_complete orchestrator
    __tests__/               # ported from tests/test_onyx_reduce.py
  ours/
    featurize.ts             # port of extract_song_features/build_matrix — must match Python exactly, feature-for-feature
    model.ts                 # tree-ensemble evaluator (sum leaf values -> logit -> sigmoid); fetches JSON from public/models/drum-difficulty/ at runtime, not bundled
    reduce.ts                # per-tier predict -> keep/drop -> reconstruct tier from kept Expert notes
    __tests__/
  __fixtures__/              # anonymized parity fixtures, see below
  __tests__/parity.test.ts   # cross-checks all three reducers' TS output against Python fixtures
```

### 3. Model training + export (Python side, `drum-to-chart` repo) — DONE (2026-07-21)

`export_model.py` ran successfully: 2756 songs (2259 corpus + 555 RB4-staging,
58 deduped), 4,199,725 Expert notes, NaN-free feature matrix asserted, full
200-tree/12200-node models per tier. Sanity check against
`reduction_probe.py`'s held-out songs: the shipped full-corpus model scores
in-sample (expectedly slightly better, never worse) than the split-trained
reproduction of the reported P1 numbers (hard 0.167 vs 0.174 reported,
medium 0.211 vs 0.219, easy 0.342 vs 0.350) — the "ship the GBM" call still
holds for the actual shipped artifact. sklearn **1.9.0** pinned; leaf values
already include the learning-rate shrinkage (JS must NOT re-multiply);
traversal is NaN→`missing_go_to_left`, else left iff `value <= num_threshold`;
no categorical splits. Self-test (pure-Python JSON evaluator vs
`clf.predict_proba`) matched exactly (0.0 diff) over 3000 sampled rows/tier.

**Load-bearing quirk for the JS featurizer**: `feature_names.json` (43 names)
has `section_prechorus` at BOTH index 28 and 29 — a faithful artifact of
`build_matrix`'s `SECTION_KEYWORDS` matching both `"pre-chorus"` and
`"prechorus"` as separate one-hot columns that happen to always be equal.
The TS `featurize.ts` port must reproduce this exact 43-wide vector
including the duplicate column, or every tree's `feature_idx` misaligns.

Model JSON schema per tier (in `public/models/drum-difficulty/{hard,medium,
easy,feature_names}.json`, fetched at runtime, ~5.3MB total): `{sklearn_version,
tier, baseline, learning_rate, leaf_values_include_learning_rate: true,
n_features, n_trees, n_nodes, trees: [{nodes: [{is_leaf, leaf_value,
feature_idx, num_threshold, missing_go_to_left, left, right}]}]}`.

`export_model.py` and its `out/models/` output still need to be copied into
`~/projects/drum-to-chart/analysis/hopcat_reduction_eval/` — no agent
(including the main session) can write there due to an OS-level (macOS
seatbelt) restriction confining writes to this repo; Eli needs to run that
copy himself.

**UNPAUSED (2026-07-22): v2 exported and imported.** The v1 model above was
a placeholder; drum-to-chart has now shipped a v2 "RELANE" model, which is
a materially different (more capable) design — see the new §3b below for
the v2 spec, which supersedes the v1 spec kept afterward for historical
reference. Phase 6 ("TS: Ours") is now active.

### 3b. v2 "RELANE" model — imported (2026-07-22)

v2 is not a keep/drop-only classifier — per tier it's **two kinds of head**:

- **Survive head** (binary, same tree/JSON shape as v1's keep/drop model):
  keep iff `sigmoid(raw) >= threshold` (0.5 for all three tiers currently;
  `manifest.json`'s `survive_thresholds`).
- **Relane heads** (multiclass, one per lane **family** — `cymbal:
[hihat, open-hat, crash, ride]`, `tom: [high-tom, mid-tom, floor-tom]`):
  for a KEPT note whose original lane is in a family, that family's head
  predicts which lane in the family it should land on (kick/snare/other
  never reach a relane head — fixed lane, survive-only). **Crucially, Ours
  can move a surviving note to a different lane; HOPCAT/Onyx never do**
  this — Ours never changes a note's _time_, only whether it survives and
  (for cymbal/tom notes) which lane it lands on. That makes tick↔render
  reconstruction simpler than HOPCAT/Onyx's tick480 domain: a surviving
  note keeps its ORIGINAL tick/msTime always; only its lane may change.
- **Chord-merge decode** (after both heads run): group surviving
  cymbal/tom notes by `(ms, family, final_lane)`; if a group has >1 member
  (the relane heads sent two originally-different notes to the same lane
  at the same instant), keep only the highest-relane-confidence one.
  Non-family survivors (kick/snare/other) are never deduped.

**Feature vector (`feature_names_v2.json`, 53 columns)**: v1's 43 columns
(same order, same `section_prechorus`-appears-twice quirk) PLUS 10 new
`chord_has_<lane>` flags (one per `LANE_VOCAB + ["other"]`) taken from the
Expert chord at the note's own tick — whether each lane is _present in the
same chord_, not just this note's own lane. The JS featurizer must
reproduce this exact 53-column vector, in this exact order.

**Model files** (`public/models/drum-difficulty/v2/`, ~37MB total, fetch
lazily): `survive_{hard,medium,easy}.json` (same schema as v1's per-tier
files, plus a `threshold` field), `relane_{cymbal,tom}_{hard,medium,easy}.json`
(schema: `{sklearn_version, lanes_list, classes_, baseline, learning_rate,
leaf_values_include_learning_rate, n_features, n_classes, n_iterations,
n_nodes, class_trees}` — `class_trees[j]` is the tree ensemble for output
column `j`), `feature_names_v2.json`, `manifest.json` (the authoritative
decode spec — read it in full, it's short and precise).

**The one subtlety that already caused a real bug on the Python side**
(per `manifest.json`'s own decode notes, dated 2026-07-21): a relane
head's multiclass columns are ordered by `classes_`, which **skips any
lane never seen as a relane target in training** — column `j` predicts
`lanes_list[classes_[j]]`, NOT `lanes_list[j]`. Indexing `lanes_list[j]`
directly silently shifted every cymbal decode by one lane in the Python
export script until caught. **The JS evaluator must apply the same
`classes_` indirection** — this is exactly the kind of bug this plan's
parity-testing discipline exists to catch, so it needs its own explicit
unit test, not just an end-to-end fixture pass that might not exercise the
skipped-class case.

**Math** (`manifest.json`): survive = `sigmoid(baseline + sum(leaf
values))`, leaf values already include the learning rate (don't
re-multiply, same as v1). Relane = `softmax` over `raw[j] = baseline[j] +
sum(class_trees[j] leaf values)` for each column `j`, `argmax` for the
predicted class, map through `classes_` to get the real lane.

Below is the original v1 spec, kept for historical reference (v2 above
supersedes it as the model this plan actually builds against):

`reduction_probe.py` currently trains models in-memory for eval only — it
never persists them, and its `train_tier_model` fits on the **held-out
train/test split**, not the full corpus. New script `export_model.py` (same
directory):

1. Train each tier's `HistGradientBoostingClassifier` on the **full**
   available corpus (not the held-out split — this is a shipped artifact,
   not an eval), with `era` fixed/available as `RB4` for feature parity but
   trained on the real era distribution (era is still a real signal in
   training data; only _inference_ on user charts hardcodes RB4).
2. **Sanity-check the exported model**, not the eval one: re-run
   `reconstruct_and_score`/`editrate` for the full-corpus model against the
   same held-out songs `reduction_probe.py` already reports numbers for, and
   confirm the edit-rate is in the same ballpark. The "ship the GBM" call
   was made on `reduction_probe.py`'s numbers; those belong to a
   differently-trained model than the one we ship — verify they don't
   diverge before trusting them.
3. Walk each tier's fitted estimators (`clf._predictors`, sklearn's internal
   tree structure for `HistGradientBoostingClassifier` — **private API,
   pin the exact sklearn version** in a comment/requirements pin since this
   layout has changed across releases) and dump per-tree nodes
   `{feature_idx, num_threshold, missing_go_to_left, left, right,
leaf_value}` + baseline/init score to JSON (include `missing_go_to_left`
   even though our features should never be NaN — **assert no NaNs in the
   training/inference feature matrix** rather than silently relying on it).
   Write `hard.json`/`medium.json`/`easy.json` + a `feature_names.json` (the
   exact `NUMERIC_FEATS`/lane/section/era column order from `build_matrix`).
4. Copy the three model JSONs into
   `spotify-clonehero-next/lib/drum-difficulty/ours/models/`. **Fetch them
   lazily at runtime** (`fetch()` + `public/`, not a static TS import) —
   3 tiers × ~200 trees of JSON is plausibly 1–3MB and has no business in
   the initial JS bundle.

The JS `model.ts` evaluator is a small (~30 line) tree-sum + sigmoid, no
runtime dependency — spelled out in the reference plan §4a.

### 3c. v3 "rb4_best" model — imported (2026-07-22), replaces v2 — DONE

Eli: "The model has been updated with more features and exported at
`out/models/rb4_best/`. Ingest it and get it running, replacing our current
model." Source: `~/projects/drum-to-chart/analysis/hopcat_reduction_eval/`
(`export_model_rb4best.py`, pinned snapshot `scratch_rb4_export/
train_pinned_16b2fe0.py`, `consistency_metric.py`), model pickle
`autoresearch-reduction/cache/models/m_08b9f91735e6dcf7.pkl` (commit
`16b2fe0`, sklearn 1.8.0). v3 adds three NEW pieces on top of v2's
survive→relane→chord-merge decode, all now ported to TS:

1. **AUG_FEATS v7** (9 new columns, `featurize.ts`): `aug_dist_backbone_ms`
   (nearest kick/snare distance), `aug_density_ratio` (local density /
   song median), `aug_samelane_{prev,next}_ms` (same-lane neighbor gaps),
   `aug_chord_priority` (count of same-tick notes in a more-important lane),
   `aug_density_{100,1500}ms` (multi-scale note density — per NOTE, not
   per-unique-tick, unlike `local_density_500ms`), `aug_beat_frac`
   (off-beatness), `aug_lane_frac_500ms` (local lane prominence). Appended
   after `chord_has_*`; feature vector is now 59 columns
   (`feature_names_v3.json`).
2. **Position-invariance**: `position_in_song`/`section_progress`/
   `section_frac` dropped from their ORIGINAL column positions (not from the
   end — every column after them shifts index vs v2). Rationale: an
   identical Expert groove should featurize identically regardless of where
   in the song it sits, which canonicalization (below) depends on.
3. **FAMILY-NMS** (`reduce.ts`'s `reduceOursTier`): among still-surviving
   cymbal/tom notes, greedy non-max-suppression by survive probability
   (highest first) — drop any other surviving family note within
   `family_nms_gaps_ms[tier]` of an already-kept one (`manifest.json`:
   `hard: off, medium: 180ms, easy: 250ms`). Runs on the survive mask BEFORE
   chord-merge dedup.
4. **Canonicalization** (new module `consistencyMetric.ts`, port of
   `consistency_metric.py`): force every instance of a repeated Expert-chart
   groove (same notes, modulo tempo/measure position) to reduce identically,
   using the reducer's own modal (majority-vote) reduction for that groove.
   Needs a full measure clock (`buildMeasureClock`, with the Python's
   `BOUNDARY_EPS_BEATS` floating-point guard ported exactly — real charts
   with many tempo events can otherwise land an exact repeat on different
   measure/tick buckets instance to instance) and groove clustering
   (`expertGrooveClusters`/`reducedGrooveByMeasure`). Runs per-tier, after
   chord-merge. `OursOutNote`'s diagnostic fields (`originalLane`/`family`/
   `relaned`/`confidence`) are synthesized (not tracked) for donor-copied
   notes, since Python's own `canonicalize()` carries only `(ms, lane)` too
   — only `(tick, lane)` is asserted on.

**Model files**: `public/models/drum-difficulty/v3/` (~37MB, same file
names as v2 — `survive_{tier}.json`/`relane_{cymbal,tom}_{tier}.json` —
plus `feature_names_v3.json` and `manifest.json`; v2 directory removed, v1's
orphaned `hard.json`/`medium.json`/`easy.json`/`feature_names.json` also
removed as dead weight). `model.ts`'s tree evaluator (`evalTree`/
`surviveProba`/`relanePredict`) needed **zero changes** — same JSON schema
as v2, only the decode pipeline around it changed.

**Parity fixtures**: `expected-ours.json` regenerated for all 20 fixtures
via a fresh script (`export_model_rb4best.json_reduce_song` +
`consistency_metric.canonicalize`, run against `prepare.py`'s pinned
`_extract_song_features_v2` chart-only rows — the SAME self-tested,
bit-exact-vs-sklearn functions the export script itself validates with, not
a from-scratch reimplementation). **20/20 fixtures × 3 tiers tick-exact on
the first attempt** — no bugs found in the port this time (contrast with
HOPCAT/Onyx, where the deep source-fidelity review each caught a real bug
invisible to fixture parity alone; the aug-feats/NMS/canonicalization math
here is comparably intricate, so a similar opus-level review against
`train_pinned_16b2fe0.py`/`consistency_metric.py` is a reasonable next step
if Eli wants the same confidence bar, though not yet requested for v3).

### 3d. v4 "591ab4a" model — imported (2026-07-22), replaces v3 — DONE

Eli: "A new model has been exported." Source: same
`~/projects/drum-to-chart/analysis/hopcat_reduction_eval/` repo,
`export_model_591ab4a.py` (pinned snapshot `scratch_rb4_export/
train_pinned_591ab4a.py`), **same cached model pickle**
`m_08b9f91735e6dcf7.pkl` (`model_cache_key` unchanged from v3 — v4 is a
DECODE-ONLY change, no retrain). Adds two new **groove-pooling** steps, both
keyed off the same repeated-Expert-groove clusters canonicalization already
computes (`consistencyMetric.ts`'s `expertGrooveClusters`/measure clock,
`GROOVE_TPQ` promoted from module-private to exported so `reduce.ts` can
reuse it):

1. **SURVIVE-POOL** (`reduce.ts`'s `groovePoolProba`): for notes in a
   repeated-groove measure, replace each note's survive probability with
   the MEAN probability across every instance of its `(groove_cluster,
tick_in_measure, lane)` — computed BEFORE thresholding. A free variance
   reduction (pre-canon inconsistency dropped from 0.066 in v3 to 0.0036 in
   v4, since repeats now agree more often before canonicalize() has to
   force them to).
2. **RELANE-POOL** (`reduce.ts`'s `groovePoolLane`): for FAMILY (cymbal/tom)
   notes, override the relaned `finalLane` with the CONFIDENCE-WEIGHTED
   MODAL lane across every instance of its `(groove_cluster,
tick_in_measure, SOURCE lane)` — every family row in a cluster casts a
   confidence-weighted vote regardless of its own survive status (a
   non-surviving row's default `own-lane, conf=1.0` still counts). Ties
   keep the first-encountered (lowest row-index) candidate, matching
   Python's `max()` over dict-insertion order.
3. **Decode reorder**: family-NMS now runs BEFORE relane predict (v3 had it
   after) — only post-NMS survivors get relaned. Order is now: survive →
   survive-pool → threshold → family-NMS → relane → relane-pool →
   chord-merge → canonicalize.

**Model files**: `public/models/drum-difficulty/v4/` (~36MB pure-JSON tree
dump, same schema as v3 — `model.ts`'s evaluator needed zero changes again).
`feature_names.json` confirmed byte-identical to v3's (feature vector
unchanged). **20/20 fixtures × 3 tiers tick-exact on the first attempt**,
regenerated via a sibling script reading the real `export_model_591ab4a`
pipeline. v3 directory removed.

Also fixed, along the way (found while debugging an unrelated Harmonix-row
feature, not part of the model port itself): a metadata-loss bug in
`lib/chart-edit`'s `readChart()` — the `iniChartModifiersOverride` branch
re-parsed the chart file directly via `parseChartFile()`, whose `metadata`
reflects only what the source file itself embeds (nothing for `.mid`
files), silently discarding the correctly ini-merged `metadata` from the
initial `parseChartAndIni()` call. Affected every caller passing an
override (`/difficulties`, `/tempo`, drum-transcription, the chart editor).

### 3e. v5 "591ab4a" packed-binary artifact — imported (2026-07-22) — DONE

Eli: "drum-to-chart released a new version, without onnx, and a very
different approach. Integrate it." Source:
`analysis/hopcat_reduction_eval/PRODUCT_INTEGRATION.md` +
`pack_model.py`/`dump_reduced_for_parity.py` in the same repo. **Not a new
model** — same trees as v4 (`model_cache_key` unchanged, `08b9f91735e6dcf7`)
and the same decode pipeline (§3d, untouched) — only the shipped artifact
format changed: a custom packed-binary tree encoding (~1.9MB raw / ~0.8MB
gzip) replacing v4's pure-JSON dump (~36MB), read by a hand-written
byte-level evaluator instead of `JSON.parse`. No ONNX.

Format (`model.ts`'s `parseSurviveBin`/`parseRelaneBin`,
`PRODUCT_INTEGRATION.md` §3): each split's raw fp64 feature threshold is replaced by
HistGBM's own internal `bin_threshold` — a 0-255 bin index, since every
feature was already discretized to ≤256 bins at training time. This means a
raw feature vector must be **re-binned** into bin indices via each
feature's ascending bin-edge table (`rebin()`, `searchsorted(edges, x,
side='left')`, clamped to 255) before tree traversal — getting `side='left'`
wrong silently produces a different, still-plausible-looking traversal. Leaf
values are stored as fp16 (a few KB more per head would buy fp32, not
needed — the packer's own verification found max `|Δproba|` ≈ 7.4e-5 across
~18,700 real rows, far below the 0.5 threshold's margin in every case they
checked). `survive_threshold` (0.5) now lives in `manifest.json`, not the
per-tier model file (the packed `SURV` header carries no threshold field).

**Model files**: `public/models/drum-difficulty/v5/` (`survive_{tier}.bin`,
`relane_{cymbal,tom}_{tier}.bin`, `manifest.json`, `feature_names_v5.json`
— confirmed byte-identical to v4's). `reduce.ts` (the decode orchestrator)
needed **zero changes** — only `model.ts`'s internal representation
(`TreeNode.bin_threshold` instead of `num_threshold`, added `binEdges` to
`SurviveModel`/`RelaneModel`) and its byte-level parsing/loading changed.

**Parity fixtures**: `expected-ours.json` regenerated for all 20 fixtures
from the SHIPPED packed `.bin` files directly (a plain-Python
re-implementation of `pack_model.py`'s `rebin`/`traverse_packed`, since
importing that module re-runs its whole packing script as a side effect),
through the same `train_pinned_591ab4a` decode helpers
`export_model_591ab4a.json_reduce_song` uses. **19 of 20 fixtures are
tick-exact identical to the pre-packing v4 fixtures; `reduction-15`/hard has
one single-note difference** — a kick note's pooled survive probability is
`0.49999987` under the fp64 model vs `0.50000495` under the fp16-packed
model, a ~5e-6 gap (an order of magnitude below the packer's own ~7.4e-5
noise floor) that happens to straddle 0.5 by chance; `canonicalize()`'s
majority vote then propagates that one flip to every instance of its
repeated-groove cluster. Confirmed via a targeted diagnostic (comparing
pooled `survive_proba` from both the fp64 JSON model and the fp16 packed
model across every row of that fixture) that this is the sole cause and
that it's inherent fp16 quantization noise, not a TS-port bug — see
`model.ts`'s doc comment and `MANIFEST.md`'s `expected-ours.json` section.
Since v5 ships the packed model, its own output is the fixtures' ground
truth going forward. Full suite: 184/184 `lib/drum-difficulty` tests green,
typecheck clean.

**Browser verification not completed this round**: the `claude-in-chrome`
tool's Chrome instance could not reach `localhost:3000` at all (confirmed
it reaches the open internet fine — `example.com` loads — while every
`/difficulties` navigation, including a fresh tab and a cache-busted URL,
returned "Frame with ID 0 is showing error page"; curl from the shell
confirmed the dev server itself was serving the real page correctly).
Likely a routing gap between that Chrome instance and this sandbox, not an
app bug. Confidence for this ingestion rests on the test-suite parity
result above (184/184, 20/20 fixtures vs. the actual shipped packed model)
rather than a live UI check.

### 3f. `drum-reducer-reference` cross-check + `portableExp` — DONE (2026-07-22)

Eli: a new sibling project,
`~/projects/drum-to-chart/drum-reducer-reference`, packages the SAME
`591ab4a` model as a standalone, from-scratch Python + JS reference
implementation (README/SPEC.md/DETERMINISM_CONTRACT.md, 99 real-song +
3 synthetic-edge-case fixtures, both languages proven bit-identical).
Asked to explore whether it's sufficient for our needs and whether we
should swap over to it.

**Verdict: don't swap — sync selectively.** Confirmed byte-identical
`.bin`/`manifest.json`/`feature_names.json` via `shasum` (same
`model_cache_key`), and its `featurize.js`/`decode.js`/`backend_model.js`
are architecturally identical to our own
`model.ts`/`reduce.ts`/`featurize.ts` (same NODE_STRUCT, same rebin, same
9-step decode) — confirming our earlier v5 port was byte-format-correct.
Replacing our port wholesale would be pure churn; it also uses Node `fs`
directly (not browser-portable) where we already fetch `ArrayBuffer`s.

Diffing against its `DETERMINISM_CONTRACT.md` (a formal tie-break spec for
every decode step that can compare two notes as equal) initially looked
like 4 real bugs in our port: FAMILY-NMS ordering, relane-pool's modal
vote, chord-merge dedup, and canonicalize's modal reduction all use
`(ms, lane_index)`-based tie-breaks in that spec, vs. our port's
plain-stable-sort/insertion-order tie-breaks. **Changing our TS to match
that spec regressed 2 of our 20 real-song fixtures** — reading the ACTUAL
deployed script (`train_pinned_591ab4a.py`/`consistency_metric.py`, not
`drum_reducer`) confirmed why: its `apply_family_nms`/`cand_from_predictions`
use Python's stable `list.sort` (ties keep row-index order),
`groove_pool_lane` uses `max(dict.items(), key=...)` (first-max-in-
insertion-order), and `consistency_metric._modal_reduction` uses
`Counter.most_common` (first-encountered wins) — none of which match
`DETERMINISM_CONTRACT.md`'s independently-designed rules. **All 4 changes
were reverted**; the pre-existing tie-breaks were already correct. Full
writeup (why each one is right) is in `MANIFEST.md`'s `expected-ours.json`
section — read that before ever touching these tie-breaks again.

**Adopted `portableExp.ts`** (`lib/drum-difficulty/ours/portableExp.ts`,
ported from `portable_exp.{py,js}`): a fixed fdlibm-style `exp` replacing
`Math.exp` in `model.ts`'s sigmoid/softmax. Justified independently of the
tie-break question — `Math.exp` isn't guaranteed bit-identical across
browser engines, so two users could reduce the identical chart differently
whenever a score lands within a few ULP of a decode threshold. Verified
bit-exact against the real Python `portable_exp.py` over 8000+ grid values
(`ours/__tests__/portableExp.test.ts`). Incidentally, this also fixed the
one previously-documented `reduction-15`/hard fp16-boundary discrepancy —
**all 20 fixtures are now tick-exact**.

**One-time 102-song diagnostic** (not committed — 99 of those songs are
real, copyrighted tracks, out of scope per the fixture-anonymization
policy): ran the real production decode over all 99 real + 3 edge-case
`drum-reducer-reference` charts and diffed against that repo's own
`parity_fixture.json`. Result: **0.004% note-level divergence** (10 notes
out of 252,336, across 2 of 102 songs) — fully consistent with, and
explained by, the tie-break difference above; not a correctness issue.

**Committed as new permanent regression tests**: the 3 synthetic edge-case
charts (`edge-empty-groove-measures`, `edge-midsong-ts-change`,
`edge-no-backbone` — generic section names, no real song identity, safe to
commit) as `lib/drum-difficulty/ours/__fixtures__/referenceEdgeCases/`,
exercised via a new `referenceEdgeCases.test.ts` that calls
`featurizeSong`/`reduceOurs` directly (these charts have no native `.mid`
tick, so assertion is on `(ms, lane)`, matching how the reference project's
own fixtures compare). Expected output generated by the real
`train_pinned_591ab4a` script, not blindly trusted from the reference
project (whose tie-breaks can genuinely differ) — though all 3 happen to
agree with it exactly. Full suite: 195/195 `lib/drum-difficulty` tests
green (up from 184), typecheck clean, lint clean; full project suite
2149/2184 passed (only the pre-existing, unrelated `better-sqlite3`
native-binding failures in `lib/drum-fills`).

**This was the highest-risk correctness code in the feature**, not the TS
algorithm ports themselves, and it's now built at `lib/drum-difficulty/`
(`types.ts`, `measureMap.ts`, `rational.ts`, `adapter/`), typechecked, and
unit-tested (42 tests green). Key decisions locked:

- **Tick rescale to 480 TQN for HOPCAT** (hardcoded `CORRECT_TQN = 480`,
  never rescales internally — no analogue in the Python port since real RB
  `notes.mid` is always 480): `Math.round`, nearest tick, ties up. Exact on
  every power-of-two/triplet grid position at the common 192 resolution
  (192→480, 96→240, 48→120, 64→160 all land exactly); genuinely off-grid
  ticks land within ±0.5 tick, far inside HOPCAT's 20-tick tolerance. Onyx's
  port needs no such rescale (exact ticks-per-beat-relative rationals, no
  hardcoded constant).
- **Onyx consumes scan-chart's resolved lanes** (see §1 — raw disco/tom
  markers aren't recoverable from `ParsedChart` and resolved lanes are
  provably equivalent). **HOPCAT gets pitch-encoded gems** + disco
  text-events _reconstructed_ by bracketing each run of flip-flagged notes
  (start at the first flipped note, end one tick past the last) — this is
  note-position-faithful but the synthetic marker's own tick may differ
  from the original file's marker tick; the full-corpus differential (§5)
  validates this doesn't affect reduced output.
- **Both non-pro-drums variants rejected**: legacy 5-lane-only AND non-pro
  4-lane (all-toms, no cymbal markers) both fail `AdapterResult` with
  `reason: 'not-pro-drums'` + a `drumType` discriminator field for
  UI-specific copy — neither maps cleanly to the ports' tom/cymbal-resolved
  gem model, and accepting either would silently mis-map. See Error
  handling below.

`AdapterResult = {ok:true, chart: RawDrumChart} | {ok:false, reason:
'no-drums'|'no-expert-track'|'no-notes'|'not-pro-drums', drumType?}`.

### 5. Parity fixtures (anonymized, per project convention)

Per `[[project-fixture-anonymization]]`: never commit real song/artist
names or audio. Select ~20 varied charts from the existing eval corpus
(`~/projects/drum-to-chart/analysis/hopcat_reduction_eval/out/parsed/`) —
include a disco-flip song, a multi-time-signature-change song, an odd-meter
song, per the reference plan's §6. **Fixtures must exercise the real
production path**: start from each chart's _original chart/MIDI file_, run
it through `readChart` → the adapter (§4) → each TS reducer inside Jest, and
compare against the Python ports' output _on that same original file_
(not against pre-dumped `out/parsed/` JSON — that only validates the
reducers in isolation and was the actual gap this review caught: the
adapter, including the tick-rescale policy, must be in the tested path).
For Ours specifically: fixture predictions must come from the **exported,
full-corpus-trained model** (§3), not `reduction_probe.py`'s in-memory
held-out-split model — generate Ours fixtures only after §3 lands.

**Tolerance: exact tick equality, not ±1.** HOPCAT's grid divisions are all
powers of two (exact in float64, and JS numbers are float64 — identical
operation order gives identical results); Onyx's port is exact rational
arithmetic by construction ("no epsilon: beats are always exact rationals").
A ±1-tick fudge factor has no legitimate source in either port and would
mask a systematic translation bug (e.g. a `bisect_right`/`bisect_left`
off-by-one) that happens to stay within tolerance on the curated fixtures.
If a specific comparison genuinely needs slack, document why at that
callsite instead of a blanket tolerance.

**Pre-merge gate beyond the committed fixtures**: before merging the HOPCAT
and Onyx ports, run a one-off (uncommitted, local-only — no anonymization
burden since nothing is pushed) differential script over the **entire**
existing eval corpus already sitting at `.../out/parsed/`, comparing TS vs
Python output on every chart, not just the 20 curated ones. Rare-input
quirks (zero-length measures, overlapping OD phrases, disco flips mid-roll)
live in the corpus's long tail, not in a hand-picked sample — this matches
the standing project convention of testing all available data before
calling a port done. The 20 committed fixtures remain the ongoing CI
regression net; the full-corpus run is a one-time pre-merge check.

**Gate the page on all of the above passing — a mismatch is a JS port or
adapter bug, not "close enough."**

### 6. Multi-viewport highway rendering — the main technical risk — DONE (2026-07-21)

**Verdict: GO, and now fully built, not just spiked.** Production code:
`lib/preview/highway/multiCell.ts` (`createHighwayGrid(canvasContainer,
cells) → {ready, resize, destroy}` — one shared `WebGLRenderer`, one fixed
canvas, one `setAnimationLoop`, per-cell scissored viewports), `cell.ts`
(extracted reusable `buildHighwayCell()`/`loadCellTextures()`/
`createHighwayClippingPlanes()`, behavior-preserving — `setupRenderer`'s own
signature/return/behavior is unchanged, `prepTrack` now just delegates to
it), `multiCellLayout.ts` (pure `computeCellViewport()`/`cellTextureKey()`,
12 unit tests). The spike (`__spike__/spikeCell.ts`) is gone, superseded;
`app/difficulties/spike/page.tsx` is now a real 1/2/4/6/9/10-cell scale
test harness with an FPS meter.

**Validated in-browser at real scale**: 10 cells sustain 60fps paused and
during playback, single canvas, no WebGL context loss, console clean,
perfect cross-cell sync through play/seek, fixed-canvas scroll re-aligns to
scrolled DOM cells with off-screen cells skipped. Every item on the
spike-stage "not yet tested" list (scroll technique, texture sharing,
full-scale perf) came back clean. **Regression-checked**: `/sheet-music`
and the drum-transcription editor both load/animate/sync correctly with a
clean console after the `setupRenderer`/`prepTrack` extraction.

**Handoff notes for page integration (phase 8)**: mount `createHighwayGrid`
in a `useEffect`, `destroy()` in cleanup (idempotent, safe pre-ready); pass
ONE shared `AudioManager` to all cells; the canvas is `position: fixed` so
grid-cell divs need real heights (the canvas doesn't drive host layout);
section/BPM/TS marker elements aren't seeded into cells yet (renderers are
registered, cells are notes-only like the spike was) — wire via
`chartToElements` when the page needs labels.

Original spike-stage notes below, superseded by the above but kept for
the rationale:

- `prepTrack`'s scene-building already decomposes cleanly into a reusable
  `buildCell()`-shaped unit **without touching `setupRenderer`'s public API**
  — every piece it uses (`getHighwayTexture`, `createHighway`,
  `loadAndCreateHitBox`, `loadNoteTextures`, `NoteRenderer`, `MarkerRenderer`,
  `SceneReconciler`, `trackToElements`, `padLaneColors`, `schemaForTrack`) was
  already an independently importable unit; `prepTrack` itself is glue.
- Confirmed in-browser at 2 AND 4 simultaneous cells: correct independent
  per-cell state (each cell showing the right notes for its own time
  offset), no gutter bleeding between cells, no console errors, no visual
  corruption. Two window resizes produced no crash and no ResizeObserver
  feedback-loop errors.
- One real gotcha found: the highway background texture's scrolling
  `offset.y` mutation is cell-state — cells at different time offsets must
  NOT share one `THREE.Texture` instance (or must re-set `offset.y`
  immediately before each cell's own render, since renders within a frame
  are sequential). Animated note textures CAN still be shared across cells
  using the same instrument/tomStyle.
- `MarkerRenderer`'s static cache turned out to be a benefit, not a hazard
  (dedupes identical section labels across cells); clear it once per grid
  teardown, not per cell.
- Still not yet validated at real 10-cell scale (only 2/4 tested), and the
  full production `multiCell.ts` (scroll-with-fixed-canvas technique,
  texture sharing, the 6-existing-page regression check) is not yet built —
  this was the spike, not the full implementation.

Original spec below, for the full build:

Every existing highway consumer (`lib/preview/highway/index.ts`
`setupRenderer`) creates its own `THREE.WebGLRenderer` + canvas + independent
`requestAnimationFrame` loop (confirmed: no shared-context pattern exists
anywhere in this codebase today; `chart-review`'s preload queue tops out at
2 concurrent instances, only 1 ever animating). Browsers cap concurrent
WebGL contexts around 8–16 — 10 fresh contexts on one page is unproven and
risks context loss on weaker GPUs, plus 10× texture loads and 10 independent
rAF loops.

Build a **shared-renderer, single-canvas** mode instead (matches "ideally in
one canvas"), as new code alongside (not replacing) `setupRenderer`:

- `lib/preview/highway/multiCell.ts`: `createHighwayGrid(canvasContainerRef,
cells: {chart, track, audioManager, config}[])`. Creates **one**
  `THREE.WebGLRenderer` on **one** canvas and **one** `renderer.setAnimationLoop`.
  Each cell gets its own `Scene`/`PerspectiveCamera`/`SceneReconciler`/
  `NoteRenderer`/texture manager (i.e., everything `prepTrack` builds today,
  reused as-is), but does NOT own a renderer or call `setAnimationLoop`
  itself. The shared loop, once per frame, iterates cells and per cell:
  `renderer.setViewport(x,y,w,h)`, `renderer.setScissor(x,y,w,h)`,
  `renderer.setScissorTest(true)`, updates that cell's camera aspect to
  `w/h`, runs the same per-frame body `animation()` already has in
  `setupRenderer` (texture tick, highway scroll offset, `reconciler.updateWindow`,
  overlays), then `renderer.render(cell.scene, cell.camera)`.
- Refactor `setupRenderer` minimally to expose the reusable pieces
  (`prepTrack`'s scene-building, the per-frame `animation()` body) as
  functions `multiCell.ts` can call per cell, rather than duplicating that
  logic. Keep `setupRenderer`'s existing public API and behavior unchanged
  for its ~6 existing callsites (sheet-music, chart-review, drum-transcription,
  tempo, drum-fills, add-lyrics) — this is additive, not a rewrite.
- Texture loads (`getHighwayTexture`, note textures) can be cached/shared
  across cells that use the same instrument/tomStyle instead of loading 10×
  — do this once the grid renders correctly; don't block correctness on it.
- **Per-frame clear**: with scissor test on, per-cell clears don't touch the
  gutters between cells — do one full-canvas, scissor-off `renderer.clear()`
  at the top of every frame, then scissor-on renders per cell, or stale
  pixels trail in the gutters.
- **Scroll**: the grid is very likely taller than one viewport. A single
  canvas can't scroll with the page and stay pixel-aligned to 10 different
  DOM cells — use the standard technique of a `position: fixed` (or
  viewport-sized, non-scrolling) canvas layered under/behind the grid, with
  each cell's viewport rect recomputed every frame from that cell's DOM
  element's `getBoundingClientRect()` relative to the canvas. Cells that
  scroll out of view get skipped (viewport height/width ≤ 0) rather than
  rendered off-screen.
- **`MarkerRenderer`'s static texture cache** (`MarkerRenderer.clearTextureCache()`,
  called from every `setupRenderer.destroy()`) is module-scope and shared —
  10 cells share one cache. The grid's teardown must clear it exactly once
  for the whole grid, not once per cell; any future per-cell disposal path
  must not call `clearTextureCache()` or it nukes the other 9 cells' marker
  textures. Document this explicitly at the callsite.
- **Texture sharing is a launch requirement for `AnimatedTextureManager`,
  not a nice-to-have.** It pre-decodes every animated-texture frame into
  per-instance `ImageBitmap` caches; 10 independent copies of the same
  drum-instrument texture set is a real memory cliff on top of 10 scenes'
  geometry. Share one `AnimatedTextureManager`/texture-load result across
  cells that use the same instrument + `tomStyle` from the start, not as a
  follow-up optimization.
- **Spike first, at real scale**: before committing to the full build,
  prototype with 2 cells sharing one renderer and verify visually
  (chrome-devtools MCP) that viewport/scissor isolation, independent scroll
  speed, and independent note positions all work correctly — then **also**
  spike all 10 cells' actual fill-rate/frame-rate\*\* on a representative
  (non-top-tier) machine before committing further engineering time; 2-cell
  scissor correctness says nothing about whether 10 scenes of transparent
  sprites sustain frame rate, and dpr-2 canvas size on a large display can
  brush against `MAX_RENDERBUFFER_SIZE`. Also verify resizing the container
  recomputes all 10 viewports without the ResizeObserver feedback issue
  `setupRenderer` already works around (`index.ts:112-121`).
- **Regression check on existing highway consumers**: extracting the
  per-frame body out of `setupRenderer`'s closure (it currently mutates 8+
  closure variables — `waveformSurface`, `gridOverlay`, `overlayState`,
  `lyricsOverlay`, `highwayMode`, `classicHighwayMesh`, etc. — this is a
  real restructuring, not a thin wrapper) touches the shared entrypoint for
  6 existing pages (sheet-music, chart-review, drum-transcription, tempo,
  drum-fills, add-lyrics). After the refactor, manually verify (chrome-devtools
  MCP) that at least sheet-music and drum-transcription still load, animate,
  and have a clean console — this is an explicit acceptance item below, not
  assumed safe by "the public API is unchanged."
- **Fallback** (only if the spike shows `setupRenderer`'s internals don't
  decompose cleanly, or shared-scissor rendering has a hard visual/perf
  problem at 10-cell scale): 10 independent `setupRenderer` instances, each
  in its own small canvas, but only the currently-hovered/focused cell's
  `startRender()` runs a live animation loop (others render one static frame
  at the current audio position on seek/pause, following `chart-review`'s
  active/preloaded-but-not-animating pattern). Flag this fallback to Eli
  before taking it — it's a materially different UX (only one cell moving
  at a time) from what was asked.

### 7. Audio sync — no new infrastructure needed

`AudioManager` has no subscribe/pubsub API; the existing pattern everywhere
in this codebase is "hand the same instance to every consumer, each polls it
in its own per-frame loop" (confirmed in `drum-transcription`'s
`EditorApp.tsx`, `ChartEditor.tsx`). Build **one** `AudioManager` for the
uploaded chart's audio, pass that single reference into the shared grid's
per-cell `getElapsedMs`/`chartTime` reads. Play/pause/seek/speed controls
call methods on that one instance; all 10 cells pick it up next frame
automatically. No context/state-propagation needed.

### 8. Error handling — explicit, not hand-waved

None of these should blank the page or silently mis-render:

- **No audio in the uploaded chart**: the transport/`AudioManager` flow
  assumes audio exists. Detect at upload and show an explicit "this chart
  has no audio" error state instead of constructing a broken `AudioManager`.
- **No Expert drum track**: detect and show an explicit error before
  attempting any reduction.
- **Non-pro-drums (legacy 5-lane-only) charts**: HOPCAT/Onyx both assume a
  tom/cymbal-resolved pro-drums taxonomy. Detect and show an explicit
  "pro-drums charts only" message rather than mis-mapping through either
  port's gem model (see adapter §4).
- **A single reducer throwing on a pathological chart** must not blank the
  whole grid — catch per-reducer/per-tier, show that one cell as an error
  state, leave the other 9 rendering.

## Page

```
app/difficulties/
  page.tsx                  # metadata + dynamic ClientPage
  DifficultiesClient.tsx     # upload -> compute 9 reductions -> grid + transport
  ReductionGrid.tsx          # 4x3 CSS grid, mounts createHighwayGrid cells
  components/
    TransportBar.tsx         # play/pause/seek/speed, shared across all 10
```

Reused: `components/chart-picker/*` (upload), `lib/chart-edit` (`readChart`),
`AudioManager`, `components/ui/*`.

Flow: drop a chart → parse via `readChart` → build one `AudioManager` from
its audio → run HOPCAT/Onyx/Ours reducers against the parsed Expert track
(9 reduced `Track`s) → mount the 10-cell shared-renderer grid → transport bar
drives the one `AudioManager`.

## Implementation phases

1. **Python: model export** (`drum-to-chart` repo) — `export_model.py`,
   trains on the full corpus, sanity-re-scores the exported model against
   `reduction_probe.py`'s held-out songs, produces the three tree-dump
   JSONs + feature-name manifest. Independent, can run in parallel with
   everything else.
   2a. **Python: HOPCAT/Onyx parity fixtures** (`drum-to-chart` repo) — pick
   ~20 anonymized reference charts (original files, not pre-parsed JSON),
   dump HOPCAT/Onyx expected outputs. Independent, parallel with (1).
   2b. **Python: Ours parity fixtures** — same charts, `featurize()` +
   exported-model predictions. **Depends on (1)** (must use the shipped
   full-corpus model, not `reduction_probe.py`'s held-out-split model).
2. **TS: scan-chart → reducer adapter** (`lib/drum-difficulty/adapter/`) —
   tick-rescale policy (incl. non-480 `.chart` charts), lane/marker
   reverse-mapping, pro-drums detection. Its own unit tests. Blocks (4)-(6)'s
   end-to-end parity tests (they run through this adapter, not raw
   pre-parsed fixtures) but can be built in parallel with (1)/(2a)/(2b) and
   with (7).
3. **TS: HOPCAT port** — FULLY DONE (2026-07-21), including the raw-MIDI
   bypass that closed the last two gaps (2247/2247 full-corpus tick-exact).
   `lib/drum-difficulty/hopcat/` built, all quirks preserved. **Reducer
   proven tick-exact independent of the adapter**: fed `reduce_port.py`'s
   own raw input for all 20 fixtures, TS output matched Python exactly on
   Hard/Medium/Easy, 20/20. Ported unit tests (8) all pass.
   End-to-end (real `readChart` → adapter → reducer) parity: Hard 19/20,
   Easy 18/20, Medium 8/20 exact — every divergence traced to the
   **adapter**, not the reducer, across three causes:
   (a) double-kick notes emitted at pitch 96 instead of 95 — **fixed**
   (same bug pattern the Onyx port independently found and fixed in its
   own projection);
   (b) HOPCAT's `remove_kick('p')` needs to know when a raw 110-112
   tom-marker note-on coincides tick-for-tick with a kick+other chord.
   **Fixed the adapter's approach, but the remaining gap is a genuine,
   confirmed scan-chart data-loss limitation, not something more adapter
   cleverness can close.** The transition-based reconstruction (marker
   note-ON synthesized at each lane's first cymbal→tom flag transition,
   using only data the adapter already has) is a large, corpus-validated
   win over the original "one marker per tom gem" approach — full-corpus
   adapter-path differential (all 2247 charts, production path):
   **1171/2247 fully exact** vs 968/2247 before (note-diffs 6,624 vs
   33,231). Hard/Easy are unaffected by this (Hard uses no `remove_kick`);
   the remaining Medium-tier divergence (12-14/20 fixtures) has a confirmed
   root cause: whether a run of consecutive tom gems was authored in the
   original MIDI as ONE long marker span (note-on once) or as separate
   short spans (note-on per gem) is **provably indistinguishable** in
   scan-chart's per-note tom/cymbal output — both authoring styles produce
   an identical flag sequence, confirmed by direct comparison against raw
   MIDI marker spans. No note-position heuristic can recover which one it
   was. **Same root cause as (c) below** — both need the real marker/span
   tick data that scan-chart's resolved output discards during parsing.
   **Resolved (2026-07-21) — Eli's call: bypass scan-chart for HOPCAT
   entirely**, rather than patch the scan-chart fork or accept the
   approximation. HOPCAT's Python reference itself never goes through a
   chart-resolution layer — `midi_io.py` reads the raw `notes.mid` directly.
   Mirror that: for `.mid`-sourced uploads, parse the raw MIDI bytes
   directly with `@geomitron/midi-file` (already a transitive dependency
   via scan-chart — add it as a direct dependency) to extract exactly the
   `Note`/`TextEvent` lists `reduce_port.py` expects (tom markers 110-112,
   disco text events, roll/swell markers — all at their real ticks, no
   scan-chart resolution step at all), used ONLY for HOPCAT's input. Onyx
   and Ours keep consuming the scan-chart-resolved path unchanged (Onyx's
   port already proved scan-chart's resolution matches Onyx's own
   `compute_pro` exactly on all 20 fixtures — no analogous gap there).
   **Built and validated, fully closes the gap**: `lib/drum-difficulty/
adapter/hopcatRawMidi.ts` (`parseRawMidiForHopcat(midiBytes) →
HopcatInput`) is a direct port of `midi_io.py`'s `read_drum_song` using
   `@geomitron/midi-file` (added as a direct dependency), reading the
   `PART DRUMS` track's raw note/text events with no scan-chart resolution
   step at all. **20/20 fixtures tick-exact on Hard/Medium/Easy — zero
   ADAPTER_LIMITED carve-outs — and the full-corpus differential (all 2247
   charts) is also 2247/2247 tick-exact on all three tiers.** Both
   remaining gaps (tom-span authoring ambiguity, disco end-boundary) are
   completely eliminated for `.mid`-sourced uploads. **Scope**: this path
   applies only when the source has an actual `notes.mid` (the common
   real RB/CH case); `.chart`-text-only uploads (no `notes.mid`) keep using
   the existing scan-chart-derived adapter with its narrower, documented
   ADAPTER_LIMITED carve-outs — a much smaller-scoped caveat than the
   general HOPCAT-Medium limitation this replaces. Onyx/Ours are unaffected
   (Onyx already matched exactly via scan-chart's resolved lanes).
   (c) `unflip_discobeat`'s window is end-inclusive in the original; the
   real disco-region end-marker tick is discarded by scan-chart and does
   not reliably coincide with any derivable note position — three
   reconstruction heuristics were tried (extend past last flip; snap to
   next red/yellow; snap to next note any-lane) and each fixed some
   fixtures while breaking others, so this was reverted to the
   minimal-blast-radius original behavior. Residual: 1/20 fixtures, 2 notes
   at Hard (small cascade at Medium/Easy). Same root cause as (b) — a
   lossy raw-MIDI-marker→scan-chart reconstruction, fixable only by
   scan-chart preserving the real marker tick upstream.
   **Full-corpus differential (§5's pre-merge gate) — DONE, clean**:
   reducer (bypassing the adapter, same raw-input method used for the 20
   fixtures) run against ALL 2257 corpus charts at
   `~/projects/drum-to-chart/analysis/hopcat_reduction_eval/out/raw_mid/`:
   **2247/2247 tick-exact on Hard/Medium/Easy, zero divergences.** The other
   10 are excluded for reasons unrelated to the reducer (7 unparseable MIDI
   that `reduce_port.py` itself can't read either; 3 malformed-disco charts
   that raise the same `ValueError` in both the Python port and this TS
   port — and can't even occur via the real adapter path, since its disco
   reconstruction only ever emits well-formed start/end pairs). **The
   reducer itself is proven correct at full corpus scale.** The two
   lossy-reconstruction cases above (b, tom-marker; c, disco-boundary) were
   subsequently fully eliminated by the raw-MIDI bypass — see (b)'s update.
   4c. **Original-source review (HOPCAT)** — the TS port in (4) was built
   against `reduce_port.py`, itself a port of the original REAPER/C3toolbox
   source. That's a port-of-a-port: any transcription slip in `reduce_port.py`
   silently propagates, and the fixture-based parity tests in (4) only prove
   the TS matches the Python port, not that either matches the true
   original. DONE (2026-07-22, after a first attempt stalled/died and was
   relaunched). Verdict: the TS port is a faithful transcription of
   `reduce_port.py` throughout (consistent with the 2247/2247 corpus
   result) — with ONE real, material divergence between `reduce_port.py`
   and the true original that the TS inherited:
   - **`simplify_roll` is a no-op in the actual deployed C3toolbox.py**
     (category b, HIGH impact). Two chained bugs in the original: `count_notes`
     (`C3toolbox.py:282`) sorts a dict's _string_ keys by their 2nd
     character rather than by note count (so "most common pitch" is
     arbitrary), and `simplify_roll` (`:2485-2486`/`:2513-2516`) then takes
     the first CHARACTER of that pitch string as an int, which never
     matches a real 60-100 MIDI pitch — `note_template` stays empty, the
     function bails via `continue`. Roll/Cymbal-Swell-marked regions in
     real deployed HOPCAT therefore stay full-density (already exempt from
     quantization). `reduce_port.py` silently fixed this and implements the
     _intended_ working simplification instead; this TS port inherited that
     fix. Invisible to the corpus/fixture parity suite (both compare
     against the already-"fixed" Python reference). **Eli's call
     (2026-07-22): keep the improved (working) behavior rather than
     reproduce the original's dead-code no-op** — documented as the one
     deliberate exception in `hopcat/reduceNotes.ts`'s `simplifyRoll` doc
     comment (every other HOPCAT quirk on this page stays as-deployed).
   - AMBIGUITY #1 (`unflip_discobeat`'s undefined `mute` reference) —
     **resolved**: confirmed via full-file grep that `mute` is never a
     module global anywhere in `C3toolbox.py`, so the branch reads an
     undefined name in the real deployed tool (latent dead/buggy code).
     The port's "skip the window" reading is a safe, defensible resolution.
   - AMBIGUITY #2 (the always-truthy companion-note `or`) — **confirmed
     faithful, not a bug**: the port reproduces the original's actual
     deployed behavior (always true unless first/last note) exactly, which
     is what matters even though the source line looks like an unfinished
     typo.
   - Two other original-only quirks noted as immaterial/pre-approved: the
     "overwrite existing tiers?" prompts (port always regenerates, faithful
     for the Expert-only input model this plan already assumes) and a
     positionally-swapped-but-unused numerator/denominator field in the
     original's measures array (never read by the reduce path).
   - Everything else spot-checked hard against the real source
     (`remove_notes`'s asymmetric two-pass tolerance logic, `remove_kick`/
     `single_snare`'s exact tick-coincidence checks, `mbt`/measure
     construction, the full cascade orchestration, and — despite having had
     the least prior scrutiny — `hopcatRawMidi.ts` against `midi_io.py`)
     is faithful.
4. **TS: Onyx port** (exact rational tick arithmetic, no floats) + unit
   tests ported from `test_onyx_reduce.py` + end-to-end parity test (exact
   equality) against (2a)'s fixtures, plus the same full-corpus differential
   check.
   5c. **Original-source review (Onyx)** — DONE (2026-07-22, after a first
   attempt stalled/died and was relaunched). Found ONE real bug (category
   b: a Python-port bug the TS faithfully inherited, invisible to every
   existing test) and resolved two of the plan's open ambiguities against
   true source:
   - **Bug (fix in progress)**: the Haskell collision windows use truncated
     ("monus") subtraction — `posn -| padding`, clamped to zero, since
     `U.Beats` is non-negative (`Reductions.hs:468/482/491`). The Python
     port and this TS port (`onyx/drumsReduce.ts`, `keepSnares`/`keepKit`/
     `keepKicks`) both use ordinary subtraction instead, which can go
     negative. Effect: a note within `padding` beats of the chart's very
     start, with a kept note at exactly beat 0, gets incorrectly dropped
     (should survive — the clamped-to-zero window is open and excludes
     beat 0 itself). The port's OWN unit tests encoded the wrong expected
     values, proven wrong by re-deriving the correct answer from the real
     Haskell semantics. **Invisible to the fixture parity suite** since
     `expected-onyx.json` was generated by the Python port, which has the
     identical bug — a clean example of the port-of-a-port gap this review
     step exists to catch. Low blast radius (only the first ~2 beats of a
     chart) but real. Fix dispatched: clamp the window's lower bound to
     zero at all three call sites, correct the two wrong test expectations,
     and — since this makes the TS port MORE correct than the Python
     reference — document (not revert) any fixture whose Python-generated
     expectation turns out to depend on the bug, rather than keeping the
     port wrong to stay green against a buggy reference.
   - **AMBIGUITY #2 (measure-map beat units) — CONFIRMED CORRECT** against
     `FeedBack/Load.hs:142-145` and `Common.hs:467-475`: beats are quarter-
     note-scaled, exactly as assumed.
   - **AMBIGUITY #4 (tom/disco status membership) — CONFIRMED CORRECT**
     against `Guitar.hs:61-78`'s `applyStatus`/`compareStatus`. Also noted:
     `computePro.ts` is dead code in production (Onyx consumes scan-chart's
     pre-resolved `resolvedGems` directly) — what actually matters is
     scan-chart's resolution matching Onyx's, asserted on one corroborating
     song, not exhaustively verified, but not a port bug per se.
   - **AMBIGUITY #3 (ensureODNotes coincident-chord tie-break) — still
     unresolved**, genuinely unverifiable without running real Haskell
     (depends on `RTB.T`'s internal coincident-event ordering). Confirmed
     low blast radius (only the lane of a single reinserted note, only when
     a whole OD phrase was emptied by reduction AND its earliest surviving
     position is a chord — both rare).
   - Minor/cheap: `ensureOdNotes` appends reinserted notes at the array's
     end rather than in sorted position (Haskell returns time-sorted);
     doesn't affect the parity suite's multiset comparison but could affect
     other consumers assuming tick-sorted input — folded into the same fix.
   - Everything else (priority ranking, `keepKit`'s cymbal/tom collapse
     rules, the Hard←Expert/Medium←Hard/Easy←Hard cascade, `makeEasy`'s
     per-section branching, all `Rational` arithmetic) checked line-by-line
     against the real Haskell and is faithful.
5. **TS: Ours** — DONE (2026-07-22), v2 RELANE model (see §3b). Two parallel
   sub-phases both landed clean:
   - **Fixtures**: `expected-ours.json` written for all 20 fixtures
     (97,800 rows total), produced by re-running the real Python v2 decode
     (`extract_song_features_v2` → survive → per-family relane w/
     `classes_` indirection → chord-merge dedup) and verifying it note-for-note
     against the actual exported-model decode path. Surfaced two things
     worth knowing: (a) Ours retains far more of Expert than HOPCAT/Onyx
     (40-90% vs both other reducers' much sparser output) — a property of
     the model, not a bug; (b) the Expert input set Ours features against
     includes double-kick notes (unlike Onyx, which drops them as an
     Onyx-specific quirk) — the TS featurizer needed to match this.
   - **TS build**: `lib/drum-difficulty/ours/{featurize,model,reduce}.ts` +
     tests. `featurize.ts` reproduces the 53-column vector exactly
     (including the duplicate `section_prechorus` column and hardcoded
     `era=RB4`), pulling tempo/section ms from `ParsedChart.msTime` (the
     same scan-chart-computed values the Python fixtures were generated
     from, avoiding any ms-domain drift). `model.ts` implements both the
     binary survive-head path and the multiclass relane-head path,
     **with a dedicated unit test proving the `classes_` indirection is
     handled correctly** (constructed with the real shipped cymbal head's
     actual `classes_=[0,2,3]`, which genuinely skips a lane) — not just
     end-to-end fixture coverage, since a skipped-class bug might not
     otherwise be exercised. `reduce.ts` implements the full survive→
     relane→chord-merge-dedup pipeline; surviving notes keep their
     original tick/msTime always (Ours never re-times a note, only drops
     or relanes it). **20/20 fixtures pass tick-exact** through the real
     production path (readChart → adapter → featurize → reduce, models
     loaded exactly as the browser will fetch them). 39 tests total,
     typecheck clean.
   - **Wired into the page (2026-07-22), browser-validated by both the
     implementing agent and independently by the main session**: `runOurs`
     in `computeReductions.ts` (whole-reducer try/catch isolation, same as
     HOPCAT/Onyx), `oursNotesToTrack` in `toRenderableTrack.ts` (no
     tick-rescale needed — Ours notes carry their original tick/msTime),
     `DifficultiesClient.tsx`'s hardcoded paused placeholder replaced with
     the real Ours row. Async model load (~37MB) handled by prefetching on
     page mount so it's normally already resolved by upload time; HOPCAT/
     Onyx (synchronous) never wait on it; a per-cell "Loading model…"
     state covers the race where a chart is uploaded before the fetch
     resolves. **All 10 highways now render live with zero placeholders**;
     playback/seek keep every cell in lock-step; console clean.
   - **Upgraded to v3 "rb4_best" (2026-07-22)** — see §3c. Same wiring
     (`runOurs`/`oursNotesToTrack`/`loadOursModels` call sites unchanged;
     only `model.ts`'s `MODEL_BASE` path and the decode pipeline inside
     `reduce.ts` changed), re-validated in-browser: fresh network trace
     shows only `models/drum-difficulty/v3/*` requests (200s), console
     clean, all 10 highways render with real notes, playback stays in
     lock-step. 20/20 fixtures tick-exact on the first attempt (see §3c).
     This completes the entire plan (modulo the model still being subject
     to future upstream updates from drum-to-chart).
6. **Page + integration** — DONE (2026-07-21). Built and browser-validated:
   `lib/drum-difficulty/toRenderableTrack.ts` (new reducer-output→renderable
   `Track` converter — both reducers normalize to a shared `tick480` domain,
   converted via `sourceTick = tick480 * resolution / 480` + `tickToMs`;
   HOPCAT's raw pad-color output gets tom/cymbal reconstructed via a
   step-function read of the Expert source, a render-only detail, not
   parity-tested data), `lib/drum-difficulty/computeReductions.ts`
   (upload→parse→validate→run both reducers), `app/difficulties/page.tsx` +
   `DifficultiesClient.tsx` + `ReductionGrid.tsx` +
   `components/TransportBar.tsx`. Layout matches the mock exactly (tall
   Expert column left, 3×3 grid Hard/Medium/Easy × Ours/HOPCAT/Onyx to the
   right); Ours row renders as a "Coming soon" placeholder in the correct
   grid position. Browser-validated: upload → full grid renders, playback/
   seek move all cells in lock-step, HOPCAT/Onyx reduction density
   correctly decreases Hard→Medium→Easy with correct tom/cymbal textures,
   console clean, no-audio error state shows an explicit message instead of
   a broken `AudioManager`. Non-pro-drums rejection and per-cell
   reducer-throw error states are wired (using `AdapterResult`'s typed
   rejection reasons, and per-tier try/catch) but not yet browser-tested
   (no ready fixture) — worth exercising before considering §8 fully closed.
   179/180 test suites pass (1 pre-existing, unrelated better-sqlite3
   native-binding failure in this sandbox). Not committed yet.

   **Post-launch bug pass (2026-07-22)**: Eli found three issues using the
   live page, all fixed and re-verified in-browser. (1) Every cell
   background was white instead of black — the shared renderer's
   full-canvas clear was fully transparent with no per-cell opaque fill;
   fixed in `multiCell.ts` by keeping the full-canvas clear transparent
   (gutters/header stay page-colored) but doing a scissored opaque-black
   clear inside each cell's own viewport. (2) The Expert column was far too
   narrow for its height (~0.36 aspect vs the 3x3 cells' ~1.0), so the
   perspective camera's squeezed horizontal FOV made the highway floor look
   tiny/cut off — fixed in `ReductionGrid.tsx` by widening the Expert
   column's grid-template share to match `rows.length` (3fr instead of
   1.15fr), matching its aspect to the other cells. (3) The Expert cell
   appeared unsynced with the audio/other cells — investigated and
   confirmed NOT a data or timing bug (Expert's `msTime` and the
   reconstructed reducer tracks' `tickToMs` agree to float epsilon; all
   cells share one `audioManager` and the same validated
   `SceneReconciler.updateWindow` path); it was a visual symptom of (2)'s
   camera distortion. Verified independently after the fix: the same chord
   pattern crosses the strikeline at matching relative positions across
   Expert/HOPCAT/Onyx during playback.

7. **Multi-viewport highway grid** (`lib/preview/highway/multiCell.ts`) —
   spike with 2 cells for scissor/viewport correctness, then a _separate_
   spike at full 10-cell scale for frame rate/fill-rate on a representative
   machine, before committing to the full build. Can start in parallel with
   (3)-(6); only needs a `Track`/`ParsedChart`, not the reducers themselves
   (dev against the original Expert track duplicated 10× until the reducers
   land). Include the regression check on existing highway consumers
   (sheet-music, drum-transcription at minimum) as part of this phase, not
   deferred to integration.
8. **Page + integration** — `/difficulties` page wiring upload → adapter →
   reducers → grid → transport, plus the error-handling states (§8: no
   audio, no Expert track, non-pro-drums, per-cell reducer failure).
   Depends on (3)-(7) all landing.
9. **Browser validation** (chrome-devtools MCP, per CLAUDE.md) — console
   clean, all 10 highways render and stay in sync through play/pause/seek,
   WebGPU/WebGL gating as applicable, error states verified.

(2a)/(2b) depend on (1) as noted above; (4), (5), (6), (7) are independent
of each other (given (3) exists) and can run as parallel implementation
agents; (8) integrates.

10. **Optional 4th "Harmonix" row (2026-07-22) — DONE.** Eli: "If the user
    selects a chart that is charted by harmonix, we need to make our 3x3
    grid a 3x4 grid, and the rows from top down should be ours, harmonix,
    hopcat, onyx. Seeing the harmonix difficulties is helpful." Detection is
    a case-insensitive CONTAINS check on `metadata.charter` (Eli: "song.ini
    charter including harmonix, but not equal to harmonix") — real-world
    charter fields vary ("Harmonix Music Systems"), so an exact-match check
    (the precedent in `lib/chartSelection/comparisonTests.ts`) would miss
    them. When matched AND the chart's own Hard/Medium/Easy drums tracks are
    all present in `parsedChart.trackData`, those tracks are shown directly
    as a fourth grid row — real ground truth, not a reducer output, so no
    conversion is needed (`ParsedChart['trackData'][0]` already **is** the
    `Track` type the highway grid consumes).
    - `computeReductions.ts`: `isHarmonixCharter` (exported, unit-tested) +
      `findHarmonixTiers` add `harmonixTiers: Record<Tier, Track> | null` to
      `ReductionModel`.
    - `DifficultiesClient.tsx`: `harmonixTierCells` wraps each authored tier
      directly as a `{kind:'highway', track}` cell; `rows` conditionally
      splices in `{name:'Harmonix', cells}` between Ours and HOPCAT.
    - `ReductionGrid.tsx` needed **zero layout changes** — row count was
      already fully derived from `rows.length` (grid template + Expert's
      row-span), not hardcoded to 3.
    - **Found and fixed a real, pre-existing bug while wiring this up**:
      `lib/chart-edit/index.ts`'s `readChart(files, iniChartModifiersOverride)`
      (used by `/difficulties`, `/tempo`, drum-transcription, and the chart
      editor — anywhere that passes an override, e.g. `{pro_drums: true}`)
      was silently discarding every song.ini-sourced metadata field (charter,
      artist, name, delay, song_length, …) on the re-parse branch:
      `parseChartFile`'s own `metadata` only reflects what the source FILE
      embeds (nothing at all for `.mid`), and the override branch replaced
      the correctly ini-merged `parsedChart.metadata` from the first
      `parseChartAndIni` call with that emptier reparsed one. Fixed by
      capturing and re-attaching the ini-merged metadata after the reparse.
      Verified via the existing `lib/chart-edit` suite (279 tests, no
      regressions) and the full project suite (2137 passed; only failure is
      a pre-existing unrelated `better-sqlite3` native-binding issue in
      `lib/drum-fills`, confirmed unrelated).
    - Browser-verified with a scratch-only test fixture (a copy of
      `reduction-01-with-audio.zip` with `song.ini`'s `charter` flipped to
      `Harmonix` — not committed; the real anonymized fixture keeps
      `charter=Anonymous`): the 4th row renders with correct labels
      ("Harmonix · Hard/Medium/Easy"), real notes, black backgrounds, and
      stays in lock-step with the other three rows through playback.

## Acceptance

- Upload a chart with an Expert drum track → all 10 highways render:
  original Expert (tall, left) + 3×3 (Ours/HOPCAT/Onyx × Hard/Medium/Easy).
- One transport bar controls play/pause/seek/speed for all 10 in lock-step.
- End-to-end parity tests green (original chart file through the real
  adapter, not pre-parsed Python dumps): JS HOPCAT/Onyx outputs match
  Python ports **exactly** (tick-exact, no tolerance) on all fixture charts;
  JS feature vectors + GBM predictions (using the exported, full-corpus
  model) match Python's on the same charts.
- One-time full-corpus differential (HOPCAT + Onyx, TS vs Python) run and
  clean before merging those ports, not just the 20 committed fixtures.
- Jest unit tests ported from `test_reduce_port.py`/`test_onyx_reduce.py`
  pass in TS.
- Sustains ≥30fps during playback across all 10 cells on a stated
  representative (non-top-tier) dev machine.
- Explicit, non-blank UX for: no audio, no Expert track, non-pro-drums
  chart, and a single reducer/cell failing (the other 9 still render).
- Regression-checked: sheet-music and drum-transcription (at minimum) still
  load, animate, and have a clean console after the `setupRenderer`
  extraction.
- chrome-devtools MCP: console clean, no WebGL context-loss errors, no
  visible desync between cells after a seek.
