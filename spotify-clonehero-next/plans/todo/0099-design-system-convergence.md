# 0099 — Design system convergence: landing pages, dashboard shells, OG images

Status: todo

Owner ask, verbatim:

> "We need to separate out, make into a design system, and align different pages
> that currently have a lot of similarities.
>
> Landing pages / marketing: /drum-transcription, /tempo, the null state on
> /find-music.
>
> Dashboard layouts: /chart-editor, /find-music, /sheet-music (although this one
> is intentionally less dense and has more spacing).
>
> Open Graph Images: all of them.
>
> We should make these use consistent components so that our patterns are the
> same, and we don't introduce new bugs."

**Scope honesty up front.** This is three separable programs of work that happen
to share a motivation. They are written as one plan with three tracks because the
audit that opens the plan covers all three at once, but each track lands
independently and can be deferred without blocking the others. Recommended order
is Track A (OG) → Track B (marketing) → Track C (dashboards), lowest risk first.

The goal is **consolidation, not redesign**. Every migration in this plan is
expected to be a visual no-op except where the audit records a difference as a
deliberate decision. "We don't introduce new bugs" is the acceptance bar, so the
before/after screenshot matrix in Phase 0 is load-bearing, not decoration.

---

## 1. What already exists

There is a partial design system. The plan extends it rather than inventing a
parallel one.

| Layer | Where | Used by |
| --- | --- | --- |
| Color/radius tokens | `app/globals.css` `:root` (shadcn set: `--background`, `--card`, `--primary`, `--border`, `--radius`, `--sidebar-*`) | everything |
| Editor surface + density tokens | `app/globals.css` `--ed-surface*`, `--ed-text-label`, `--ed-gap-section`, `--ed-pad-card`, `--ed-pad-section`, `--ed-control-h*`, `:root[data-density='compact']` | `/chart-editor` only |
| Highway lane colors | `app/globals.css` `.landing-lanes` + `components/landing/lanes.ts` (`LANE_VARS`, `LANE_PROPERTIES`, `LANE_FALLBACKS`) | landing canvases |
| Editor layout grid | `app/globals.css` `.chart-editor-grid` (named areas: header/sidebar/main/bottom, two breakpoints) | `/chart-editor` only |
| Landing primitives | `components/landing/`: `Eyebrow`, `LandingSection`, `TrustLine`, `StepFlow`, `StatChip`/`InlineStat`/`StatCell`, `SectionDropZone` | `/drum-transcription`, `/tempo` |
| Site chrome | `components/SiteChrome.tsx` (`SiteHeader` + `SiteMain`), `components/SiteNav.tsx`, `components/CompactSiteHeader.tsx` | all routes |
| OG helper | `lib/og/tool-og-image.tsx` (`createToolOgImage`, `OG_SIZE`, a `COPY` map keyed by `ToolOgKind`) | `/drum-transcription`, `/tempo` only |
| UI kit | `components/ui/` (shadcn) | all routes |
| Copy rules | `docs/landing-page-style-guide.md` | landing pages |

`docs/landing-page-style-guide.md` governs **copy**. This plan produces its
structural sibling; it must not restate or contradict the copy rules, and where
a component encodes a copy rule (e.g. `TrustLine` exists because trust signals
are "stated, not decorated", §7) the component doc comment should cite the guide
section rather than re-argue it.

---

## 2. The problem, with evidence

### 2a. Landing pages: two near-clones and one dialect

`app/drum-transcription/landing/DrumTranscriptionLanding.tsx` (287 lines) and
`app/tempo/landing/TempoLanding.tsx` (191 lines) are the same page with
different content:

- **`ExternalLink` is defined twice, character-identical**
  (`DrumTranscriptionLanding.tsx:28-38`, `TempoLanding.tsx:24-34`), including
  the focus-ring class string.
- **The page shell string is duplicated**:
  `landing-lanes w-full max-w-4xl space-y-12 py-8 sm:py-12` in both.
- **The hero block is duplicated**: `Eyebrow` → `h1.max-w-3xl.text-3xl…sm:text-5xl`
  → lede `p.max-w-2xl…sm:text-lg` → `TrustLine` → canvas → mono caption. Only
  the canvas component (`EditPassCanvas` vs `BeatGridCanvas`) and the strings
  differ.
- **The comparison table is duplicated**, ~90 lines each
  (`DrumTranscriptionLanding.tsx:170-262`, `TempoLanding.tsx:121-164`), with the
  same `font-mono text-[11px] uppercase tracking-[0.14em]` header cells, the same
  `border-border/60 last:border-b-0` row rules, and the same `StatCell` usage.
  The drum version adds row-group header rows; the tempo version doesn't.
- **The footer CTA is duplicated**: identical `scrollToStart` callback, identical
  `div.flex.flex-col.items-start.border-t.border-border.pt-8` + `Button`, and both
  target `id="start"` on their `LandingSection`.
- **The tool-entry section is duplicated**: same `LandingSection id="start"`,
  same `mx-auto flex w-full max-w-2xl flex-col items-center gap-6` wrapper, same
  `toolEntry: ReactNode` prop contract.
- Both wrap in `TooltipProvider delayDuration={150}`.

Divergence already exists and is probably unintentional:
`TempoLanding.tsx:111-115` renders a `LandingSection` with `{null}` children,
which still emits the `mt-6` body div. Whether an intro-only section is a
supported variant is undecided.

`app/find-music/FindMusicWelcome.tsx` (471 lines) is a **third dialect** of the
same thing and shares no component with the other two:

| | drum-transcription / tempo | find-music welcome |
| --- | --- | --- |
| Width | `max-w-4xl` | `max-w-5xl` |
| Vertical rhythm | `space-y-12`, `py-8 sm:py-12` | ad-hoc `mt-8`/`mt-5`/`mt-4` |
| Section | `LandingSection` (rule + h2 + intro) | inline `section` + `h3.text-sm` + `p` |
| Heading level | `h1` | `h2` (it lives inside a dashboard) |
| Eyebrow | `Eyebrow` | a bordered pill with a `LockKeyhole` icon (`:283`) |
| Trust signals | `TrustLine` | a `ShieldCheck` callout box (`:298`) — which the style guide's §7 "no shield icons" rule appears to prohibit |
| Cards | none | local `SetupCard` (`:93`), `OutcomePanel` (`:206`), `StatusDot` (`:66`) |

`app/sng/components/SngLanding.tsx` (117 lines) is a **fourth** dialect. The
owner did not name it, but it must appear in the audit so the decision to
include or exclude it is recorded rather than accidental.

### 2b. Dashboards: three unrelated shells, one of them fighting the layout

`/chart-editor` — `components/chart-editor/ChartEditor.tsx:318`. A named-areas
CSS grid (`.chart-editor-grid`, `app/globals.css:119-174`) over four regions
(header/sidebar/main/bottom) with a `>=1440px` rearrangement. Consumes the
`--ed-*` density tokens. Header row is `EditorHeaderRow`.

`/find-music` — `app/find-music/FindMusicClient.tsx:670`. Hand-rolled:
`grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)] lg:grid-cols-[292px_minmax(0,1fr)]`
(`:718`), its own `header.border-b.px-3.py-3.md:px-5` (`:671`), its own mobile
sidebar-in-a-`Sheet` (`:686`), its own main-pane padding `p-4 md:p-5` (`:736`).
The sidebar rail is `292px`; the editor's is set in `globals.css`.

**The negative-margin escape hatch is the concrete bug risk.**
`FindMusicClient.tsx:670` opens with `-m-4 w-[calc(100%+2rem)]` and `pt-12 sm:pt-0`.
That exists only to cancel `SiteMain`'s `p-4` (`components/SiteChrome.tsx`),
because `SiteMain` gives editor routes `px-3 pb-3` and everything else `p-4`, and
`/find-music` is not in `EDITOR_ROUTES`. The route list drives *both* which header
renders *and* how much padding `<main>` has; a dashboard that wants the full site
nav but no gutter has no way to say so, so it subtracts the gutter back out with
a hard-coded `2rem` that silently breaks if `p-4` ever changes.

`/sheet-music` — `app/sheet-music/page.tsx` → `app/sheet-music/Search.tsx`. A
third structure again. The owner states its lower density is **intentional**, so
it is a density variant of a shared shell, not an outlier to normalize away.

### 2c. OG images: nine files, two systems, several copies of the same constants

| Route | File | System |
| --- | --- | --- |
| default | `app/opengraph-image.tsx` (74) | bespoke |
| `/drum-transcription` | `app/drum-transcription/opengraph-image.tsx` (9) | `lib/og/tool-og-image.tsx` |
| `/tempo` | `app/tempo/opengraph-image.tsx` (9) | `lib/og/tool-og-image.tsx` |
| `/find-music` | `app/find-music/opengraph-image.tsx` (200) | bespoke |
| `/sheet-music` | `app/sheet-music/opengraph-image.tsx` (140) | bespoke |
| `/sheet-music/[slug]` | `app/sheet-music/[slug]/opengraph-image.tsx` | bespoke, dynamic |
| `/sng` | `app/sng/opengraph-image.tsx` (127) | bespoke |
| `/spotify` | `app/spotify/opengraph-image.tsx` (127) | bespoke |
| `/spotifyhistory` | `app/spotifyhistory/opengraph-image.tsx` (112) | bespoke |
| `/add-lyrics` | `app/add-lyrics/opengraph-image.tsx` (104) | bespoke |

Observed duplication and drift:

- `size = {width: 1200, height: 630}` is written out longhand in seven files
  while `OG_SIZE` exists in `lib/og/tool-og-image.tsx`.
- Two different `COLORS` objects with overlapping keys and different values:
  `lib/og/tool-og-image.tsx` and `app/find-music/opengraph-image.tsx`. They share
  `panel: rgba(255,255,255,0.055)`, `border: rgba(255,255,255,0.14)`,
  `muted: rgba(255,255,255,0.64)`, `purple: #a855b7` — verbatim — then diverge.
- **Two different background gradients present themselves as the brand
  background**: `linear-gradient(135deg, #1a0a1f 0%, #2c0e36 50%, #0a0a14 100%)`
  (root, sheet-music) vs the radial+linear composite in `find-music`. Neither
  matches `lib/og/tool-og-image.tsx`.
- Drum lane colors are declared a third time in
  `app/sheet-music/opengraph-image.tsx` (`#facc15`/`#ef4444`/`#3b82f6`/`#22c55e`/`#f97316`),
  a fourth time in `lib/og/tool-og-image.tsx` `COLORS`, and a fifth time in
  `components/landing/lanes.ts` / `.landing-lanes`. Four of the five palettes
  disagree.
- The eyebrow (`MUSIC CHARTS TOOLS`) is re-implemented per file with different
  `letterSpacing` (`0.18em` vs `0.22em`) and different casing strategies
  (literal caps vs `textTransform`).
- Title font sizes range 66 → 100 → 132 with no rule for which applies when.

None of this is user-visible individually. Together it means there is no answer
to "what does one of our OG images look like", which is the thing a design
system is supposed to supply.

---

## 3. Working rules for whoever picks this up

1. **Read `docs/landing-page-style-guide.md` first.** This plan governs
   structure; that document governs copy, and copy must not change during a
   migration. A migration that rewords a sentence is out of scope.
2. **No re-export shims.** When a component moves, update every import directly
   (existing project rule).
3. **Extract, then migrate, in separate commits.** Adding a primitive and
   changing a page to use it are two reviewable steps.
4. **Visual no-op is the default.** Any intentional visual change gets a line in
   the audit doc with the reason, and a before/after screenshot pair.
5. **One atomic commit per completed phase**, with the
   thermo-nuclear-code-quality-review run on the phase diff before committing.
6. **Browser-validate every phase** per the repo's Browser Validation section:
   screenshot, console clean, network clean.
7. **`pnpm test`, `pnpm typecheck`, `pnpm lint` green before each commit.**

---

## Phase 0 — Audit (do this before writing any component)

Nothing is built in this phase. It produces two artifacts.

### 0a. The inventory doc — `docs/design-system-audit.md`

For each of the three tracks, a table with one row per page and one column per
structural decision, filled in from the source (not from memory):

- **Marketing:** container width, vertical rhythm, heading levels, eyebrow
  treatment, trust-signal treatment, section header treatment, card treatment,
  table treatment, CTA treatment, tooltip provider, canvas/illustration slot.
  Pages: `/drum-transcription`, `/tempo`, `/find-music` welcome, `/sng`.
- **Dashboards:** page shell, escape hatches used against `SiteMain`, header row,
  sidebar width + collapse behavior, mobile pattern, main-pane padding,
  scroll container ownership (`min-h-0` chains), empty/loading/error states,
  density tokens consumed. Pages: `/chart-editor`, `/find-music`, `/sheet-music`,
  and `/sheet-music/[slug]` for comparison.
- **OG:** size constant, background, eyebrow, title size/weight/tracking, subtitle,
  illustration, palette source, static vs dynamic. All ten files.

Each row ends in a verdict: **same** (converge silently), **different, keep**
(a real variant — record why, e.g. sheet-music's lower density), or
**different, unintentional** (drift to fix). Only "unintentional" rows are
allowed to change appearance.

The audit is also where the open questions get answered on paper, before code:

- Does the find-music welcome adopt `LandingSection` (visible hairline rules and
  larger headings), or does the marketing system grow a `compact` variant for
  landing content embedded in a dashboard? It renders inside a scroll pane, at
  `h2`, next to a sidebar; the other two own the whole page.
- Is `ShieldCheck` on `FindMusicWelcome.tsx:299` a style-guide §7 violation
  ("no shield icons") or a deliberate exception? It has to be one or the other
  before the trust component is shared.
- Does `/sng` join the marketing system or stay out of scope?
- Is `LandingSection` with no children (`TempoLanding.tsx:114`) a supported
  intro-only variant, or a bug?
- Does `/sheet-music/[slug]` (the viewer) count as a dashboard for Track C?

### 0b. The screenshot baseline

Capture **before** shots for every page in the audit, via the chrome-devtools
MCP, at 390 / 900 / 1512 px, in both light and dark, into
`plans/assets/0099-baseline/`. Include the `>=1440px` chart-editor rearrangement
and the `<lg` find-music sidebar-in-a-Sheet state. Landing pages additionally
need a shot of the scrolled-to-`#start` state.

Every later phase closes by re-shooting the same matrix and diffing against the
baseline. This is the mechanism that satisfies "don't introduce new bugs"; without
it the acceptance criterion is unfalsifiable.

Also record, per page, whether it has tests today. `app/find-music/__tests__/FindMusicWelcome.test.tsx`
exists; the two landing pages appear to have none. Component-level tests for the
extracted primitives are cheaper than page-level tests for the pages, so the
extraction is the moment to add them.

**Exit:** `docs/design-system-audit.md` committed, every row carries a verdict,
every open question above has a written answer, baseline shots committed.

---

## Phase 1 — Track A: the OG image system (lowest risk, ship first)

No runtime UI. Failure mode is a wrong-looking social card, not a broken page.

1. **`lib/og/tokens.ts`** — one source for OG palette, gradients, lane colors,
   type scale, and `OG_SIZE`. Lane colors must be derived from, or explicitly
   reconciled against, `components/landing/lanes.ts`; the audit decides which
   of the five current palettes wins, and the loser sites get updated.
2. **`lib/og/layout.tsx`** — the shared frame: `<OgFrame>` (background, padding,
   font stack, brand eyebrow), `<OgTitle>`, `<OgSubtitle>`, `<OgCardRow>`.
   Satori supports a subset of CSS; keep every primitive inside the subset that
   the existing files already prove works (explicit `display: flex` everywhere,
   no CSS `<style>` blocks — see the Apple Music glyph comment in
   `app/find-music/opengraph-image.tsx`).
3. **Generalize `createToolOgImage`** from a closed `ToolOgKind` union to taking
   content, so it stops being a two-page special case.
4. **Migrate the eight bespoke files** one at a time, each keeping its own
   illustration (the illustrations are genuinely per-page and should stay local)
   but taking frame, palette, and type scale from the system.
   `/sheet-music/[slug]` is dynamic; migrate it last.
5. **Keep `alt` accurate** in each route file. It is per-route metadata and does
   not move into the system.

**Verification:** these are generated at request time, so fetch each
`/<route>/opengraph-image` from `pnpm dev` and diff against the baseline PNG.
Add a Jest test that every route exporting an OG image exports `size === OG_SIZE`
and a non-empty `alt`.

**Exit:** ten routes, one frame, one palette; `lib/og/` is the only place a brand
color or gradient is written down for social cards.

---

## Phase 2 — Track B part 1: extract the marketing primitives

Extraction only. No page changes yet, except deleting the code that moved.

Into `components/landing/`:

- `ExternalLink` — delete both local copies.
- `LandingPage` — the shell: `landing-lanes w-full max-w-4xl space-y-12 py-8 sm:py-12`
  plus the `TooltipProvider`. Container width becomes a prop or variant only if
  the audit says find-music keeps `max-w-5xl`.
- `LandingHero` — `{eyebrow, title, lede, trust, illustration, caption}`. The
  non-breaking-hyphen trick in `DrumTranscriptionLanding.tsx:104` is content, so
  `title` stays `ReactNode`.
- `ComparisonTable` — the table markup, with optional row groups (drum needs
  them, tempo doesn't), `StatCell` rendering, `caption` for screen readers, the
  `overflow-x-auto` wrapper, a `min-w` prop (`30rem` vs `32rem` today — pick one
  in the audit), a methodology footnote slot, and a disclaimer slot. Style guide
  §5.2 forbids a verdict sentence; the component having no slot for one is the
  cheapest way to keep that true.
- `ToolEntrySection` — `LandingSection id="start"` + the `max-w-2xl` centering
  wrapper + the `toolEntry` prop contract.
- `ScrollToStartCta` — the footer button and its `scrollIntoView` callback,
  which also removes the duplicated `#start` id coupling.
- `FixtureGrid` (name TBD) — the "What you'll fix" `grid gap-px … sm:last:odd:col-span-2`
  card list from `DrumTranscriptionLanding.tsx:146-159`. One page uses it today;
  extract it anyway only if the audit finds a second user, otherwise leave it.

Each primitive gets a doc comment in the house style (why it exists, what rule it
encodes, which style-guide section governs it) and a Jest test covering its
structural contract (heading level, `aria` wiring, row groups, empty states).

**Exit:** primitives exist and are tested; no page imports them yet; build green.

---

## Phase 3 — Track B part 2: migrate the marketing pages

One page per commit, each a screenshot-verified no-op.

1. `/tempo` first — it is the smaller page and exercises the intro-only
   `LandingSection` question.
2. `/drum-transcription` — exercises row groups and the fixes grid.
3. `/find-music` welcome — the real test. It adopts whatever the audit decided:
   either the shared primitives with a `compact`/embedded variant, or (if the
   audit says its density is intentional, like sheet-music's) only the subset
   that genuinely matches, with the divergence recorded. `SetupCard`,
   `OutcomePanel` and `StatusDot` are dashboard-source-status components, not
   marketing components; if they move anywhere it is to a dashboard namespace,
   not `components/landing/`.
   `app/find-music/__tests__/FindMusicWelcome.test.tsx` must keep passing without
   being rewritten to match the implementation — if it needs rewriting, the
   migration changed behavior.
4. `/sng`, if the audit included it.

**Exit:** `DrumTranscriptionLanding.tsx` and `TempoLanding.tsx` contain content
(`STEPS`, `FIXES`, copy, their canvases) and nothing structural. Screenshot
diffs clean or explained.

---

## Phase 4 — Track C: the dashboard shell

Highest risk: these are the pages with real state, scroll containers, and
responsive rearrangements. Do not start it before Tracks A and B have landed.

1. **Fix the `SiteMain` gutter contract first, on its own.** Split the single
   `EDITOR_ROUTES` check in `components/SiteChrome.tsx` into two independent
   decisions — *which header* and *how much gutter* — so `/find-music` can take
   the full site nav with no gutter and delete the `-m-4 w-[calc(100%+2rem)]`
   hack at `FindMusicClient.tsx:670`. This is a standalone, shippable fix and
   is worth doing even if the rest of Track C is deferred.
2. **Name the shared regions** from the audit. The candidate set, from what all
   three pages already have: an app header row, an optional left rail, a main
   pane that owns its own scrolling, and an optional bottom region. `/chart-editor`
   already has exactly these four as grid areas.
3. **Decide grid-vs-flex before building.** `.chart-editor-grid` is a named-areas
   grid in `globals.css` with a `>=1440px` rearrangement; find-music is a
   two-column grid; sheet-music is neither. A shared shell that cannot express
   the editor's 1440px rearrangement is not a shared shell, so either the shell
   is the named-areas grid generalized, or the editor keeps its own and the shell
   covers only the simpler two. Pick one in writing; do not discover it mid-build.
4. **Density is a variant, not a fork.** `--ed-*` tokens and
   `:root[data-density='compact']` already model this. Promote the density token
   set out of the editor-only namespace and give the shell a density prop:
   `compact` (chart-editor), `default` (find-music), `relaxed` (sheet-music —
   the owner's "intentionally less dense and has more spacing"). Sheet-music's
   spacing must come out of the token set, not out of the shell being avoided.
5. **`min-h-0` discipline.** Every one of these shells threads
   `min-h-0`/`min-w-0`/`overflow-hidden` by hand today, and a missed link is the
   classic "the page scrolls instead of the pane" bug. The shell owns that chain
   so pages stop re-deriving it. Note that `FindMusicClient` also carries
   `pt-12 sm:pt-0` for a mobile affordance; that is page-specific and stays.
6. **Migrate in order:** `/find-music` (already closest to a plain two-column),
   then `/sheet-music` (proves the relaxed density variant), then `/chart-editor`
   last (highest risk, most state, and it is the shell's own source of truth).
   The mobile sidebar-in-a-`Sheet` pattern from `FindMusicClient.tsx:686` becomes
   the shell's `<lg` rail behavior if the audit says the editor wants it too.

**Exit:** one shell, three densities, no negative-margin hacks, screenshot matrix
clean at all three widths including the two rearrangement breakpoints.

---

## Phase 5 — Guardrails

Without these, the system drifts back apart within a few features.

1. **`docs/design-system.md`** — the structural sibling to the copy style guide:
   which primitive to reach for, which tokens exist, what the density variants
   mean, and the rule that a new page composes primitives rather than opening
   with a bespoke container. Cross-link both directions.
2. **A lint rule or test** that fails on the specific regressions this plan
   removes: a raw `#rrggbb` in an `opengraph-image.tsx` outside `lib/og/`, a
   negative margin used to cancel `SiteMain` padding, a second definition of
   `ExternalLink`. Keep it narrow — a broad "no arbitrary Tailwind values" rule
   would fight the codebase and get disabled.
3. **Update `spotify-clonehero-next/CLAUDE.md`'s "Existing Utilities" table**
   with the landing primitives, the OG system, and the dashboard shell, so the
   next feature finds them.
4. **Fold the audit's "different, keep" rows into `docs/design-system.md`** as
   documented variants. A recorded intentional difference is part of the system;
   an unrecorded one is drift.

---

## 4. What this plan explicitly does not do

- Change any copy. `docs/landing-page-style-guide.md` owns copy; a structural
  migration that reworded a sentence has exceeded its scope.
- Redesign anything. Where two pages disagree, the audit picks a winner; it does
  not invent a third option.
- Touch the highway renderer, the editor's interaction model, or the landing
  canvases (`EditPassCanvas`, `BeatGridCanvas`). Those are content the shell
  hosts.
- Resolve plan `0084`'s project-model work. `0084` Phase 5 is about OPFS project
  *storage* layout, not UI layout, so the two do not collide — but `0084` moves
  `/drum-transcription` and `/tempo` toward being entrypoints into
  `/chart-editor`, which changes what those landing pages are for. If `0084`
  lands first, re-check Track B's page list before starting Phase 3.
