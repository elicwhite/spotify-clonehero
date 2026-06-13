# 0045 — Drum Fills: groove-based practice, practice-page layout, performance pass

Follow-up to plan 0044 (`plans/completed/0044-drum-fills-practice.md`). Three workstreams
plus general cleanup.

## 1. Groove-based practice

Today you find fills by browsing/filtering and clicking one. Add the inverse, pedagogically
stronger entry point: **pick a groove, then drill that groove with many different fills** —
the "same beat, rotate the fills" practice that builds real-time fill vocabulary.

- **Groove fingerprinting & persistence.** `lib/drum-fills/detection/grooveModel.ts`
  already fingerprints bars. Compute a canonical groove fingerprint for each detected
  fill's preceding-groove span and persist it: migration `011_groove_fingerprint` adds
  `groove_fingerprint` (+ index) to `fills`; scan pipeline populates it. Existing rows:
  backfilled on next rescan (scan takes ~30s); UI shows a "rescan to enable Grooves"
  hint when the column is empty.
- **Groove clusters.** Exact-fingerprint grouping first; then a similarity bucket
  (fingerprint with velocity/ghost details stripped, hat-class collapsed) so "the d-beat
  groove" clusters across songs, not just within one. Both stored/derivable; queries in
  `lib/local-db/drum-fills/` return clusters with fill counts, tempo range, songs, and
  taxonomy spread. Pure clustering logic in `lib/drum-fills/` with Jest tests.
- **Grooves view.** New tab alongside Library/Today: list of groove clusters (sorted by
  fill count), each with a rhythm sketch of the groove, fill count, tempo range, example
  songs. Selecting one starts a **Groove Session**: the groove loops continuously
  (isolated synth mode at user BPM, or song-context for same-song fills) and fills from
  the cluster rotate in — sequential or shuffled, "next fill" shown one bar ahead
  (reuse/generalize the roulette machinery, which is this exact loop minus the
  same-groove constraint). MIDI scoring per fill attempt as in normal practice; attempts
  recorded against each fill so SRS still benefits.

## 2. Practice page layout (no page scroll)

On large screens the practice page must NOT scroll vertically. Match `/sheet-music`
(`SongView.tsx`): the page is a fixed viewport-height flex layout; the **sheet-music pane
scrolls internally**; the Clone Hero highway gets a stable, fully-visible container (it
renders incorrectly when the page scrolls / its container is clipped). Audit
`PracticeView.tsx`, `page.tsx`/`ClientPage.tsx`, Today queue and Groove Session screens:
header + HUD + controls fixed, highway fixed, notation `overflow-y: auto`. Verify at
1280×800 and 1920×1080 via chrome-devtools (`resize_page`, screenshots): no body scrollbar,
highway canvas sized correctly.

## 3. Performance pass

Measure first (chrome-devtools performance trace + React profiling where useful), then fix
top offenders. Known suspects from the 0044 build:

- **Library grid renders all 7,796 FillCards** (sketch previews are lazy but DOM nodes are
  not). Virtualize the grid (windowing — check repo for an existing virtualization dep
  before adding one; a small hand-rolled windowing hook is acceptable) or paginate.
- **Filtering** recomputes over the full fill list — memoize, precompute filter columns,
  push taxonomy filtering into SQL where indexes exist.
- **DB**: verify indexes cover the actual query shapes (taxonomy filters + srs join,
  due_at); batch sizes on scan writes.
- **Practice render loop**: no per-frame allocations/re-renders driven by
  `audioManager.currentTime` polling; hit-flash feedback must not re-render React per
  frame (push to renderer / imperative refs per the hybrid-interaction rule).
- **Scan worker**: confirm parsing stays off the main thread and progress posts are
  coalesced.

Targets: library view interactive < 1s after load with full DB; filter changes < 100ms;
practice view steady-state with no dropped frames during playback; scroll at 60fps.

## 4. Cleanups / small improvements (do alongside)

- Filter state persists in URL search params (shareable, survives reload).
- Scan toast vs grid count mismatch (7991 vs 7796): report deduped count in the toast.
- FillCard shows last-practiced / attempt count.
- Loading skeletons for library grid and practice view chart-load.
- Keyboard nav in the grid (arrows + enter to open practice).

## 5. Fill quality gate + cross-song dedupe (user feedback 2026-06-12)

Two library-quality problems observed in real use:

- **Degenerate "fills".** Detection flags spans that are just a single crash hit (one-shot
  accents/pushes — explicitly excluded by the agreed fill definition). Add a substance
  gate in `detectFills.ts`: a fill must have ≥3 onsets AND meaningful rhythmic content
  beyond the landing hit (e.g. ≥2 onsets before the final downbeat, deviation span ≥ a
  quarter bar). A crash(+kick) alone on a downbeat, or crash-only bars, must not qualify.
  Tune via the spot-check harness against the real library; add unit tests for the
  excluded shapes (single crash, crash+kick push, lone flam).
- **Cross-song duplicates.** 0044 dedupes identical fills within a song only. Add a fill
  similarity key (analogous to the groove similarity key: canonical fill fingerprint with
  dynamics stripped) and group the Library view by it by default: one card per unique
  pattern with an instance-count badge ("in 37 songs"), expandable to the per-song
  instances; toggle for the old ungrouped view. Practicing a grouped card picks a
  representative instance (prefer one whose song audio is available / median tempo) and
  lets the user switch instance. SRS/mastery applies per pattern-group, with attempts
  still recorded against the concrete fill instance.

Both require a rescan to take effect on existing data (same "rescan" hint pattern as
grooves; detection changes mean fill rows are replaced per song on rescan anyway).

## 6. Fill difficulty ladder per groove (user feedback 2026-06-12)

Within a groove cluster, order fills as a gradual simple→complex progression so the user
starts with easy fills over a groove and climbs.

- **Continuous difficulty score** (replaces reliance on the coarse 1–5 complexity for
  ordering; keep complexity for filtering). Computed in `classify.ts`, stored on `fills`
  (`difficulty_score REAL`, populated on rescan). Components, roughly weighted and
  documented in code: onset count; peak hit rate in notes/sec at the fill's actual tempo
  (a 16th run at 180bpm ≫ at 90bpm); subdivision level and mixing (8ths < 16ths <
  triplets < mixed); voice variety (distinct lanes/classes used) and voice-switch rate
  (linear movement around the kit); syncopation/off-grid onsets; ornaments (flams,
  ghosts, accents); fill length. Normalize to 0–100. Unit tests: hand-built fills with
  known ordering (e.g. 4 quarter snare hits < 8th tom run < 16th tom run < mixed-triplet
  linear fill) must sort correctly, and tempo must matter.
- **Ladder mode in Groove Session**: fills in the cluster sorted by difficulty_score
  (dedupe-grouped per section 5 — one rung per unique pattern); start at the lowest
  unmastered rung; advance after N passing attempts (reuse the pass criteria), step back
  on repeated fails. UI shows the ladder (rungs with scores, current position, mastered
  rungs checked). Persist per-cluster progress: `groove_ladder_progress`
  (similarity key, current rung fill ref, updated_at) — new table in the same migration
  as the section-5 work.
- Library/Grooves UI: difficulty score visible on cards (small number/bar), sortable.

## 7. Product/UX revisit (final phase — after 1–6 are built)

Step back from the accumulated feature set (library, filters, Today queue, practice modes,
grooves, sessions, ladder, dedupe groups) and redesign the flow around the actual learning
loop instead of tabs-per-feature. Questions to answer against the real, working UI:

- What is the primary entry point for a practice session? A drummer opening the tool wants
  "what should I practice right now" answered immediately — the ladder + SRS queue should
  probably BE the home surface, with library/grooves as the exploration layer behind it,
  not peers of it.
- Is the groove the primary organizing object rather than the fill? The pedagogy
  (sections 1, 6) says groove → ladder of fills; the current IA says fill-list-first.
- Where do the four practice modes live? Mode pickers inside PracticeView vs. the mode
  being implied by the journey (ladder rung → speed trainer → song context as graduation).
- Progress visibility: is there one place that shows the learning arc (grooves started,
  rungs climbed, fills mastered, due reviews) that motivates return visits?
- Reduce choices at each step; defaults over configuration.

Method: audit the built product in the browser (screenshots of every surface), write a
short UX critique + proposed IA/flow (in this plan doc as an appendix), then implement the
restructure. This may legitimately move/merge views built in earlier phases — prefer a
coherent flow over preserving phase-1..6 structure. No new heavy features in this phase;
it is recomposition, navigation, defaults, and progress surfacing.

## Constraints (unchanged from 0044)

No backend; no zustand; heavy work in workers; reuse before reimplementing (extract with
original-callsite update, no re-export shims); Jest tests for all new business logic
(clustering, queries, windowing math); browser-validate with chrome-devtools MCP; one-way
state push to highway renderer; no dispatch inside setState updaters; tsc strict clean.

## Build order

1. Groove lib + migration + queries (tests; rescan backfill path)
2. Grooves view + Groove Session UI
3. Practice-page layout fix (all practice surfaces)
4. Performance pass (measure → fix → re-measure) + cleanups
5. Validation: full tests/lint/tsc, browser validation incl. resize checks, rescan to
   backfill groove fingerprints, spot-check still sane

## Appendix: UX audit & new IA (2026-06-12)

### Audit — surfaces as built

Walked every surface at 1280×800 with the real library loaded (6,255 grouped
patterns / 7,786 instances, 4,214 groove clusters; MIDI not connected).

- **Home = Library.** Landing on `/drum-fills` drops you into the fill library:
  a giant filter panel (subdivision, length, mastery, voicing, complexity slider,
  tempo slider, search), a Grouped/All-instances toggle + sort, and a virtualized
  grid of pattern cards. Top-right has three peer buttons: Grooves, Today,
  Roulette. The MIDI/calibration row sits inside the library above the filters.
- **Grooves.** A (non-virtualized) grid of groove clusters with rhythm sketches,
  fill/song counts, tempo ranges, subdivision spread, "Drill groove". Reached only
  via the top-right button from the library.
- **Groove Session.** Header (sketch + counts) + Rotate|Ladder toggle. Rotate is
  the roulette constrained to one groove; Ladder shows the rung sidebar
  (difficulty-ordered, "Rung 1 of 94") + a PracticeView. Four practice modes
  (Song loop / Isolated synth / Speed trainer / Roulette) are always present as a
  tab strip inside PracticeView regardless of how you arrived.
- **Today.** Drops straight into a PracticeView walking a 20-item queue (due
  reviews first, then new fills) with a "Today queue — 1/20" strip. No overview of
  what's due or why before you start.
- **Roulette.** Random-fill rotation; a peer entry point with no pedagogical
  framing.
- **Practice (from a library card).** Same PracticeView with an added instance
  switcher. Four-mode tab strip on top.
- **Calibration / MIDI.** Lives only as a row inside the Library; "Calibrate" is
  disabled until MIDI connects.

### Critique against the learning loop

1. **The library is the home, but it answers the wrong question.** A returning
   drummer opens the tool to learn "what should I drill right now," and instead
   gets a 6,255-card catalogue with eight filter controls. The SRS queue (Today)
   and the ladders — the things that actually drive progression — are buried one
   click away behind generic toolbar buttons. Hypothesis 1 (practice-first home)
   is unmet.
2. **The fill is the primary object; the groove is secondary.** The pedagogy
   (§1, §6) is groove → ladder of fills, but the IA leads with a flat fill list
   and treats Grooves as a sibling tab. Hypothesis 2 (groove as primary object)
   is inverted.
3. **Modes are a menu, not a journey.** Every PracticeView shows all four modes as
   equal tabs even inside a Ladder (where Isolated synth is the right default) or a
   song-launched practice (where Song loop is). The mode should be implied by how
   you got there; the tab strip re-asks a question the journey already answered.
   Hypothesis 3 unmet.
4. **No single progress surface.** "Mastered/Learning/New" exists per card and
   "Due" shows inside a HUD mid-practice, but nothing aggregates grooves started,
   rungs climbed, fills mastered, or due counts. Nothing motivates return visits.
   Hypothesis 4 unmet.
5. **Too many coordinate peers.** Library, Grooves, Today, Roulette are four
   equal-weight entry points with overlapping purpose (Today and Roulette are both
   "just start practicing"; Roulette is also a mode inside every session). Choice
   overload at the top; the plan asks for defaults over configuration.

Where the audit refines the hypotheses: the **library should not disappear** — it
is a genuinely useful exploration/search layer and the only place to find a
specific song's fill. It should move _behind_ the practice-first home as a
"Browse" layer, not be deleted. Roulette is redundant as a top-level peer (it is a
session mode); fold it away as a "Surprise me" affordance, not a tab.

### Proposed IA

Three surfaces instead of four peers, with practice front-and-center:

1. **Home (practice-first).** The default landing surface. Three stacked sections,
   no filters:
   - **Due now** — count + a primary "Start review" button launching the Today
     queue (SRS). Empty state: "All caught up."
   - **Continue climbing** — the grooves with saved ladder progress (active
     ladders), each a resume card (groove sketch, "Rung k of N", continue).
   - **Suggested groove** — the top unstarted groove cluster (most fills) as the
     "start something new" path → groove ladder. Plus a small "Surprise me"
     (roulette) link.
   - A compact **progress strip** at the top: grooves started · rungs climbed ·
     fills mastered · due today. One place for the learning arc.
2. **Grooves (explore).** The groove grid, now reachable as a secondary nav item
   ("Explore grooves"). Selecting one opens the Groove Session. This is the
   groove-centric exploration layer.
3. **Library (browse).** The existing filtered/virtualized fill catalogue, demoted
   to a "Browse all fills" secondary nav item for search/specific-song lookups.
   Keeps grouped default + filters + virtualization intact.

Navigation: a single lightweight top nav — **Home · Grooves · Library** — replaces
the asymmetric per-view button set. MIDI/calibration moves to a small persistent
status chip in the header (reachable everywhere, primary nowhere).

Journey-implied mode defaults (no new modes, just defaults + de-emphasis):

- Ladder rung and groove-rotate already pass `initialMode`; keep it and make the
  four-mode tab strip a collapsed "Change mode" disclosure inside PracticeView so
  the implied default leads and configuration is one click away, not in your face.
- Today/SRS launches in Song loop (real audio) by default.

Default journeys:

- **First-run** (no fills yet): Home shows a single "Scan your library" call to
  action (capability-gated). After scan → "Calibrate your MIDI" nudge → Home
  populated with a Suggested groove → first groove ladder.
- **Returning** (has progress): Home leads with Due now + Continue climbing so the
  next action is one click, with Suggested groove as the explore path.

What merges / moves / disappears:

- **Today** → folded into Home's "Due now" (TodayQueue component reused as the
  review runner; no standalone tab).
- **Roulette** as a top peer → **disappears**; reachable as "Surprise me" on Home
  (RouletteSession reused).
- **Library** → demoted from default to the "Library" nav item (unchanged
  internally).
- **Grooves** → kept, promoted conceptually as the explore surface.
- New **Home** surface + **progress summary** query (`getProgressSummary`) and an
  **active-ladders** query (`getActiveLadders`) added read-side; no new heavy
  features.
- PracticeView's four-mode strip → collapsible "Change mode" disclosure.

This is recomposition only: every practice/session/grid/highway component is
reused; the change is the top-level shell (`ClientPage`), a new Home component, two
read-side queries, and the mode-strip de-emphasis.
