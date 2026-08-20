# 0117 — Landing pages for `/drum-difficulties` and `/guitar-difficulties`

Status: completed

`/drum-difficulties` and `/guitar-difficulties` are bare tool flows. Each one
renders `DifficultyGenerationFlow` and nothing else: no hero, no account of
what the reducer does, no measurements, no trust facts, no social card for
`/guitar-difficulties`. `/chart` links to both pages, so a reader arrives with
the sequence in mind and lands on a drop zone.

Both pages get the landing shell, the same way `/tempo` and
`/drum-transcription` have it: `page.tsx` keeps the metadata, a
`landing/<Name>Landing.tsx` client component composes the primitives, and the
existing flow is passed in as `toolEntry`.

## Scope

- Three complete landing-page variants per route, each shipped as real code
  and viewable in the browser.
- A hero illustration per variant, owned by the route directory.
- An `opengraph-image.tsx` for each route.
- A `metrics.ts` per route holding every number with its provenance.

## Where the numbers come from

- Drums: `~/projects/reduce-drum-chart-difficulties` — `README.md`,
  `data/reference_scores.tsv`, recomputable with `tools/eval_quality.py`.
  99 rb4_test songs, edit_rate against the corpus's own reductions.
- Guitar: `~/projects/drum-to-chart/autoresearch-guitar-reduction/` —
  `5FRET_INSTRUMENT_COMPARISON.md` (sealed test, 177 lead-guitar songs,
  `ours_e101baa`, which is the model this app ships) and
  `GUITAR_REDUCTION_ONNX.md`.

## Revision round (2026-08-18)

Decisions from the first review, applied to all variants on both routes:

- No comparison tables and no competitor figures anywhere on the pages. Only
  this tool's self-describing measurements survive, as stat chips with full
  provenance, described as comparisons with "the hand-charted Hard, Medium,
  and Easy for the same song".
- The pages never name the corpus the rules were fit to or measured against,
  in copy, tooltips, or `metrics.ts` strings.
- No download-size trust facts.
- No "What you'll review" section; each lede carries one plain statement that
  the output is a first pass finished in the editor. Variant C is now the
  handoff-led layout (`HandoffLanding`) instead of review-led.
- The hero cascade animates each tier as a copy of the row above dropping
  down with notes removed, never adding a note or color a higher row lacks.

Every figure carries `script`, `measuredOn`, and `asOf`. A figure that has not
been re-confirmed against the shipped artifact is marked provisional on the
page.

## Revision round 3 (2026-08-18)

Variant A is the converged layout. Changes applied to variant A on both
routes; variants B and C are untouched reference material and may now
diverge from A.

- The lede is one plain sentence: "This tool automatically adds Hard,
  Medium, and Easy \<instrument\> parts from the Expert track." No hedges
  appended. The not-one-shot statement moved to the tool-entry intro
  (`entryIntroFirstPass`), so it still lands in the first screenful.
- The caption is: "Above: each tier reduces from the higher difficulty,
  based on a set of comprehensive rules."
- The cascade illustration keeps its original layout (one row per
  difficulty, one gem per column), with one behavior change: only the
  notes that survive into the next tier slide down during a drop; dropped
  notes do not travel. (A realistic-colors redraw was tried and reverted
  on feedback within this round.)
- Everything below the tool entry is replaced by one section, "The rules
  each tier is built on": a table-like list of the measurements the model
  reads (one rule per row, short name plus what it looks at, closed with
  the honest remaining count — "and 51 more" of drums' 59, "and 88 more"
  of guitar's 96 per the shipped manifest), then the fixed decode as a
  four-step flow. The scoring stage is named as a trained model (drums) /
  a neural network (guitar); the decode as fixed steps. Sources:
  reduce-drum-chart-difficulties `SPEC.md` (features and nine-step
  decode) and the guitar workstream's `GUITAR_REDUCTION_ONNX.md` plus the
  shipped `public/models/guitar-reduction-v1/manifest.json` and
  `lib/guitar-difficulty/{features,reduce}.ts`.
- Per feedback, the rules section carries no statement that anything was
  fit to, trained on, measured against, or matched to released charts,
  in copy or tooltips. That ruled out every measurement chip for A (their
  provenance is defined by the hand-charted comparison), so A states no
  figures; the per-tier edit rates and the repeat-consistency figure
  remain on variant B with their provenance.

Two follow-ups within the round, both `/guitar-difficulties` variant A:

- The guitar cascade draws one sustain in the piano roll's visual
  language (narrower rounded tail in the lane color at reduced alpha,
  painted before heads, per `components/chart-editor/piano-roll/draw.ts`).
  After two follow-up revisions it is a single mid-bar note with a clear
  span (nothing overlaps the tail on any row), whose per-tier lengths
  follow the reducer's real rules: a one-slot tail on Expert and Hard
  (inside the next-note-on-fret cap), a plain hit on Medium (the one-beat
  gap rule leaves 12 - 8 - 4 = 0 slots), and dropped entirely at Easy.
- Two copy corrections from review: the guitar "known defect" solo-
  boundary sentence was deleted everywhere (A's rules section, B's
  measurements intro, and the metrics provenance) because the source is a
  whole-run diagnostic (3 occurrences across 531 song-tiers in the sealed
  benchmark), not per-chart behavior; and the drum copy's two "There is
  no neural network on this page" sentences were cut per style-guide §3,
  leaving the positive mechanism description.
- All guitar-side copy now says "a trained model" / "the model", matching
  the drum page's canonical phrasing; "neural network" and bare "network"
  are gone from the guitar config (variants A, B, and C strings alike).
  The guitar OG card and route metadata never named an architecture, so
  they are unchanged.

## Single-variant consolidation (2026-08-18)

Eli settled on variant A for both routes. The pages are single-variant now:

- Deleted: `MeasurementsLanding.tsx`, `HandoffLanding.tsx`, `variants.ts`,
  `illustrations/TierDensityStrip.tsx`,
  `illustrations/ReviewPassIllustration.tsx`, both
  `landing-preview/[variant]/` routes (they 404 now), and both routes'
  `landing/metrics.ts` (nothing referenced them once B and C were gone).
- `DrumDifficultiesClient` / `GuitarDifficultiesClient` lost the `variant`
  prop and render `PipelineLanding` directly. `types.ts` is collapsed to
  what the surviving page reads: plain `heroTitle` / `heroLede` /
  `illustrationCaption` / `entryIntro` fields plus the `rules` block; the
  `LandingVariant` union, per-variant maps, `steps`/`stepsIntro`,
  `howItWorksProse`, `measurements`/`measurementsIntro`, `tierEditStats`,
  and `handoffParagraphs` are gone.
- With B and C deleted, no measured figure is stated anywhere on either
  live page: the per-tier edit rates (drums 14.0/15.7/23.9, guitar
  32.2/49.4/63.7), the drum Easy retention figures (102.5%, 93.3%), and
  the 0.63% repeat-consistency figure left with `metrics.ts`. The
  "fit to / trained on officially authored" provenance framing is gone
  from the codebase's landing copy entirely, per Eli's earlier decision.

## Inlining, OG cards, and the /chart band (2026-08-18)

- The config indirection is gone: `app/*/landing/config.tsx` and the
  standalone `components/difficulty-generation/landing/types.ts` are
  deleted. The shared layout is now
  `components/difficulty-generation/landing/DifficultyLanding.tsx`
  (renamed from `PipelineLanding`), which declares its prop types in the
  same file; each route's client component calls it with literal JSX.
  The two strings identical on both routes ("Start a chart" and "The
  rules each tier is built on") live in the layout; the empty per-rule
  stats slot was dropped rather than carried as an unused prop. The
  rendered text of both routes was diffed before and after the move and
  is byte-identical.
- Both `opengraph-image.tsx` cards were redrawn as still frames of the
  current hero canvas: one gem per column, each tier a strict subset,
  and on guitar the single mid-bar sustain (tail on Expert and Hard,
  plain hit at Medium, dropped at Easy), restating the canvas's
  `DRUM_SPEC`/`GUITAR_SPEC`. Titles, eyebrows, and `alt` already matched
  the current hero copy and are unchanged. `pnpm jest lib/og` green;
  both cards rendered and inspected.
- `/chart`'s "Step 3 · Difficulties" band now renders
  `ReductionCascadeCanvas` with `instrument="guitar"` (the same
  cross-route reuse its tempo and drum-notes bands use, per plan 0112);
  `app/chart/illustrations/DifficultyLadder.tsx` is deleted. No canvas
  size accommodation was needed at the band's width. The band's
  "automated for years" sentence had already been removed by the time of
  the swap, so its copy matches the tool pages' framing.

## Shared OG cascade shapes (2026-08-18)

Eli's review found the two cards' note shapes wrong and inconsistent: the
guitar gems were near-pills (radius 8 on a 34×16 rect), the drum gems a
different rect (radius 5), and neither matched the square-ish, softly
rounded gems `ReductionCascadeCanvas` draws. The fix is one shared
definition, not per-card patching:

- `lib/og/reduction-cascade.tsx` now owns the picture. `CASCADE_SHAPES`
  restates the canvas's drawing constants (gem width 0.62 of a slot capped
  at 15px, height 0.34 of a row, corner radius 2.5px, tail 0.76 of the head
  at alpha 0.78 with corner `min(3, tailH/3)` — canvas CSS px at its
  desktop `sm:h-44` size, scaled by the card row height / 44), and
  `OgReductionCascade` renders the four rows. A route file supplies only
  its rows: lane colors per slot plus sustain lengths.
- Both `opengraph-image.tsx` route files keep their `DRUM_SPEC` /
  `GUITAR_SPEC` restatements as data and render `OgReductionCascade`.
- A drift guard in `lib/og/__tests__/og-routes.test.ts` pins each
  `CASCADE_SHAPES` value to the literal expression in
  `ReductionCascadeCanvas.tsx` (and the `sm:h-44` row-height baseline),
  the same arrangement that pins `OG_LANES` to the stylesheet.
- Scope is the two difficulty cards only. The drum-transcription card is
  deliberately a different picture (a multi-lane highway) and was left
  alone, as were the sheet-music staff and other cards.

`pnpm typecheck`, `pnpm lint`, and the full Jest suite green; both cards
rendered and compared against the live hero canvas.

## Adversarial-review follow-up: de-fork the landing styling (2026-08-19)

Eli noticed `/add-lyrics`'s chart drop target had no entry card while the
difficulty pages did, and that fixing it needed a hand-written `pt-6`. A
review sweep found the pattern systemic. This pass extracted the shared
pieces; each converged difference is named below.

New primitives (all guarded where a string is owned):

- `components/landing/ToolEntryCard.tsx` — the tool-entry card
  (`description?`, `footnote?`, children). Owns `w-full` and the
  header/no-header padding. Adopted by `/tempo`, `/drum-transcription`,
  `DifficultyGenerationFlow`, and `/add-lyrics`. **Converged:** the
  difficulty and add-lyrics cards were 456px wide (no `w-full`, shrink-to-fit
  under the section's `items-center`); all four now render 668px like
  `/tempo`. `/add-lyrics` also gains the card the review started from.
- `components/landing/CardGrid.tsx` — `CardGrid`/`CardGridCell`, the
  `gap-px … bg-border` hairline grid (three authors before). Adopted by
  `StepFlow` (documented denser `gap-2 p-4` cells), the drum-transcription
  fixes grid, and `/why`. Visual no-op, verified by cell padding probes.
- `components/landing/Prose.tsx` — `LandingProse`, the section body
  paragraph at the intro's `text-sm sm:text-base` ramp. **Converged:** the
  add-lyrics wav2vec2 note and drum-transcription's "This tool can start…"
  paragraph were a step smaller (14px at desktop) than the intros around
  them; both now render 16px like `DifficultyLanding`'s `rulesAfter`.
- `components/landing/heroCanvasFrame.ts` — `heroCanvasFrameClass()` with
  height as the one knob: `standard` (h-32/sm:h-40; tempo, add-lyrics,
  /chart's LyricSyllables) and `tall` (h-36/sm:h-44; drum-transcription,
  difficulties). Visual no-op; the split is now documented.
- `components/DestructiveNotice.tsx` — the destructive callout container
  (three authors before: difficulty entry banner, both save-failed panels).
  Visual no-op.
- `Eyebrow` grew an `as` prop. **Converged:** `DifficultyLanding`'s `dt`
  labels and "and N more" line were a third mono-label voice
  (12px/`tracking-wide`); they now use the system's 11px/0.18em through
  `Eyebrow`, keeping `text-foreground` on the terms. The `-mt-3` patch was
  measured dead (space-y-6 overrode it; gap 24px before and after) and is
  gone.
- `SectionDropZone.onAudioFile` is now optional. **Converged behavior:**
  `/add-lyrics` and both difficulty routes now accept a chart drop anywhere
  on the entry section, like `/tempo` and `/drum-transcription`; an audio
  drop on a chart-only section gets a chart-only rejection toast.
- The difficulty entry stack and add-lyrics entry now return fragments so
  `ToolEntrySection`'s `gap-6` owns the rhythm (**converged:** add-lyrics'
  error paragraph spacing goes 12px → 24px in its rare error state).
- The hero caption shared character-identically by both difficulty routes
  moved into `DifficultyLanding`. Title/lede/entryIntro stay inlined at the
  call sites per the earlier decision; instrument-word interpolation was
  deliberately NOT introduced — the routes own the copy that differs.

Skipped: unifying the banner-vs-bare-paragraph error split (finding 6's
other half). Converging on the banner needs new title copy, owned by the
style guide and in another agent's hands this session; the split is
recorded under "Destructive treatments" in `docs/design-system.md`.

Guardrails added for the two new owned strings (canvas frame, card grid),
verified to fail on reintroduction. `ToolEntryCard` has contract tests for
the header/no-header padding. Docs updated: `docs/design-system.md` and the
`landing-pages` skill's `references/primitives.md`.

Verified in-browser at 1280/375 × light/dark across `/`, `/chart`, `/why`,
`/tempo`, `/drum-transcription`, `/add-lyrics`, `/drum-difficulties`,
`/guitar-difficulties`: untouched pages are height-identical at 1280;
geometry probes (card widths, cell paddings, canvas sizes, dt metrics,
dl-to-close gap) match before/after except the convergences named above.

## Rules this plan does not restate

`docs/landing-page-style-guide.md` governs the copy, the `landing-pages` skill
governs the structure, and the `og-images` skill governs the cards.

## Review rounds (2026-08-19)

Three adversarial review rounds ran over the finished work; every finding was
fixed in the round that followed it.

- Round 1 (11 findings): a false repeat-consistency guarantee on the guitar
  page, stale route metadata, the "only removes" invariant the reducers do not
  hold, and systemic forked styling across the family.
- Round 2 (6 findings): a "runs on the CPU" trust line contradicted by the
  WebGPU execution provider, both rule-list remainders overcounted, the
  separation step wrong for charts that already ship vocals, and drift-guard
  escapes.
- Round 3 (16 findings): the guitar "only probabilities" and tap claims, the
  editor-opens-on-vocals claim, the drum lane vote missing from the steps, and
  four documentation seams left by earlier rounds.

The `lib/og` drift guard was tightened twice, and now pins the tail geometry
per corner and each card's note pattern to the canvas's own specs. The
`/add-lyrics` card and hero share `syllableAlignModel.ts` rather than
restating the data; `/chart`'s lyric illustration reads from it too.

Two decisions are still open with Eli: whether the hero caption's "reduces
from the higher difficulty" should say the tiers derive from Expert, and
whether `/add-lyrics` gains a named failure mode or the style guide is amended
to match its absence.
