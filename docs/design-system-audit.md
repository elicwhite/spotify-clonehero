---
title: Design System Audit (plan 0099, Phase 0)
type: audit
scope: Landing pages, dashboard shells, and Open Graph images for Music Charts Tools
created: 2026-08-09
updated: 2026-08-09
---

# Design system audit

Phase 0 of `plans/in-progress/0099-design-system-convergence.md`. One row per
page, one column per structural decision, filled in from source. Each row's
verdict is one of:

- **same** — converge silently; the migration is a visual no-op.
- **different, keep** — a real variant; the reason is recorded here and the
  difference becomes a documented part of the system.
- **different, unintentional** — drift; the migration is allowed to change
  appearance, with a before/after screenshot pair.

Copy is governed by `docs/landing-page-style-guide.md` and does not change in
any migration.

---

## Track B — Marketing / landing pages

Pages audited: `/drum-transcription` (`app/drum-transcription/landing/DrumTranscriptionLanding.tsx`),
`/tempo` (`app/tempo/landing/TempoLanding.tsx`), `/find-music` welcome
(`app/find-music/FindMusicWelcome.tsx`), `/sng` (`app/sng/components/SngLanding.tsx`).

| Decision | /drum-transcription | /tempo | /find-music welcome | /sng | Verdict |
| --- | --- | --- | --- | --- | --- |
| Page shell | `landing-lanes w-full max-w-4xl space-y-12 py-8 sm:py-12` | identical string | `max-w-5xl px-4 py-7 sm:px-6 sm:py-10 lg:px-8` inside its own scroll pane | `max-w-3xl p-4 sm:p-8` | drum/tempo: **same** → `LandingPage`. find-music: **different, keep** (embedded in a dashboard scroll pane; the dashboard owns the gutters). sng: **different, keep** (see "/sng scope" below) |
| Tooltip provider | `TooltipProvider delayDuration={150}` | identical | none (no stat tooltips) | none | drum/tempo: **same** → part of `LandingPage` |
| Heading level | `h1` | `h1` | `h2` (page's `h1` is the dashboard header row) | `h1` | **different, keep** — find-music welcome is embedded content; heading level is contextual and stays `h2` |
| Hero title | `max-w-3xl text-3xl font-semibold tracking-tight sm:text-5xl [text-wrap:balance]` | identical | `text-2xl font-semibold tracking-tight sm:text-3xl` | `text-3xl font-bold` | drum/tempo: **same** → `LandingHero`. find-music: **different, keep** (smaller ramp fits the embedded context). sng: **different, keep** |
| Lede | `max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg` | identical | `max-w-xl text-sm leading-6 … sm:text-base` | `text-lg text-muted-foreground` | drum/tempo: **same**. others: **different, keep** |
| Eyebrow | `Eyebrow` component | `Eyebrow` | bordered pill with `LockKeyhole` icon (`FindMusicWelcome.tsx:283`) | none | find-music: **different, unintentional** — a decorated badge; style guide §7: "Trust signals are stated, not decorated. No badge graphics." Replaced by plain stated text during Phase 3, screenshot pair recorded |
| Trust signals | `TrustLine` | `TrustLine` | `ShieldCheck` callout box (`FindMusicWelcome.tsx:298-304`) | one sentence inside the lede | find-music: **different, unintentional** — §7 explicitly bans shield icons. The same sentences move into a `TrustLine`; copy unchanged. sng: **same enough** (a stated sentence, no decoration) |
| Section treatment | `LandingSection` (hairline rule + h2 + intro) | `LandingSection` | inline `section` + `h3.text-sm.font-semibold` + intro `p` | inline `section`, no rules | drum/tempo: **same**. find-music: **different, keep** — the welcome's sections are dashboard-embedded and `LandingSection`'s visible rules + `text-xl` headings would fight the sidebar context. The marketing system does NOT grow a `compact` variant for this; the welcome keeps its own section rhythm |
| Vertical rhythm | `space-y-12` | `space-y-12` | ad-hoc `mt-8`/`mt-5`/`mt-4` | `mb-8` + grid `gap-6` | find-music/sng: **different, keep** (follows from the shell decisions above) |
| Cards | `FIXES` grid: `grid gap-px … bg-border sm:grid-cols-2` with `sm:last:odd:col-span-2` | none | local `SetupCard`, `OutcomePanel`, `StatusDot` | shadcn `Card` | **different, keep**. The fixes grid has one user today → stays local (plan rule: extract on the second user). `SetupCard`/`OutcomePanel`/`StatusDot` are dashboard source-status components, not marketing components; they stay in `app/find-music/` |
| Comparison table | ~90 lines, row-group header rows, `min-w-[30rem]`, 4 cols | ~45 lines, no row groups, `min-w-[32rem]`, 3 cols | none | none | **same** → `ComparisonTable` with optional row groups. `min-w` standardized to `32rem` (the wider of the two; both values already overflow-scroll at the 390 px baseline width, so the standardization is invisible there and benign elsewhere). Recorded as an intentional trivial change |
| Tool entry section | `LandingSection id="start"` + `mx-auto flex w-full max-w-2xl flex-col items-center gap-6` + `toolEntry: ReactNode` | identical | n/a | n/a | **same** → `ToolEntrySection` |
| Footer CTA | `scrollToStart` → `#start`; `flex flex-col items-start border-t border-border pt-8` + `Button` | identical | none | none | **same** → `ScrollToStartCta` |
| `ExternalLink` | defined locally, lines 28-38 | defined locally, lines 24-34, character-identical | different pattern (icon suffix link, `FindMusicWelcome.tsx:352-361`) | none | drum/tempo: **same** → shared `ExternalLink`. find-music's icon-suffix link is a different affordance (opens a provider's account page) and stays local |
| Canvas / illustration | `EditPassCanvas` + mono caption | `BeatGridCanvas` + mono caption | none | none | **same** slot in `LandingHero` (`illustration` + `caption`); the canvases themselves are content and do not move |
| Mono caption under canvas | `font-mono text-[11px] leading-relaxed text-muted-foreground` | identical | n/a | n/a | **same** |

### Open questions, answered

1. **Does the find-music welcome adopt `LandingSection` or a `compact` variant?**
   Neither. Its density and heading scale are intentional, the same status
   sheet-music has in Track C (owner: embedded/less dense contexts are
   variants, not outliers). It adopts only what genuinely matches: the trust
   treatment (`TrustLine`, after removing the shield/badge decoration, which is
   drift, not a variant). Everything else on the welcome is recorded here as
   **different, keep**. No `compact` marketing variant is built on speculation.
2. **Is `ShieldCheck` at `FindMusicWelcome.tsx:299` a §7 violation?** Yes.
   §7: "no shield icons", "trust signals are stated, not decorated." The
   `LockKeyhole` eyebrow pill is the same violation (a badge graphic). Both are
   **different, unintentional**: in Phase 3 the sentences stay verbatim and the
   decoration goes — the pill becomes plain stated text, the callout box
   becomes a `TrustLine` item. Before/after screenshots required.
3. **Does `/sng` join the marketing system?** Track A yes (its OG image
   migrates like every other). Track B no: `/sng` is a utility page, not a
   marketing page — it isn't in the style guide's scope list, has no
   trust/measurement/comparison content, and its shadcn-`Card` action grid has
   no counterpart in the landing system. Recorded as **different, keep**;
   revisit only if it ever grows marketing content.
4. **Is `LandingSection` with `{null}` children (`TempoLanding.tsx:114`) a
   supported variant or a bug?** A bug in the component contract: the section
   is intentional (an intro-only section is legitimate content per the copy
   guide) but the component still emits an empty `mt-6` body div. Fix:
   `children` becomes optional and the body div is not rendered when absent.
   The 1.5 rem of trailing dead space disappears — **different, unintentional**,
   screenshot pair recorded in Phase 2/3.
5. **Does `/sheet-music/[slug]` count as a dashboard for Track C?** No. It is
   a full-viewport chart-detail view (`SongView`/ChartDetailLayout) with no
   sidebar rail and no header-row/rail/main/bottom region structure. Audited
   below for comparison only; verdict **different, keep**.

### Test coverage today

- `/find-music` welcome: `app/find-music/__tests__/FindMusicWelcome.test.tsx`
  exists (plus ten sibling suites for the client). It must keep passing
  unmodified through Phase 3.
- `/drum-transcription` and `/tempo` landing pages: no tests. Coverage is added
  at the primitive level in Phase 2 (`ExternalLink`, `LandingPage`,
  `LandingHero`, `ComparisonTable`, `ToolEntrySection`, `ScrollToStartCta`,
  `LandingSection` intro-only contract).
- `/sng`: no tests; out of Track B scope.

---

## Track C — Dashboard shells

Pages audited: `/chart-editor` (`components/chart-editor/ChartEditor.tsx:318`),
`/find-music` (`app/find-music/FindMusicClient.tsx:666-736`), `/sheet-music`
(`app/sheet-music/Search.tsx:232`), `/sheet-music/[slug]` (comparison only).

| Decision | /chart-editor | /find-music | /sheet-music | /sheet-music/[slug] | Verdict |
| --- | --- | --- | --- | --- | --- |
| Page shell | `.chart-editor-grid` named-areas grid (header/sidebar/main/bottom), `app/globals.css:119-136` | hand-rolled: header + `grid grid-cols-1 lg:grid-cols-[292px_minmax(0,1fr)]` | `main.min-h-screen` + `container mx-auto px-4 py-8`, document scroll | full-viewport flex column (SongView) | **different, unintentional** between editor and find-music (same four regions, two implementations). sheet-music: **different, keep** — it is a document-scrolling search page by intent (owner: "intentionally less dense") |
| Escape hatches vs `SiteMain` | none (route is in `EDITOR_ROUTES`, gets `px-3 pb-3`) | `-m-4 w-[calc(100%+2rem)]` + `pt-12 sm:pt-0` (`FindMusicClient.tsx:670`) cancels `SiteMain`'s `p-4` with a hard-coded 2 rem | none (lives inside the `p-4` gutter happily) | none | find-music: **different, unintentional** — the concrete bug risk. Fixed first in Phase 4 by splitting `EDITOR_ROUTES` into two decisions (which header / how much gutter) |
| Header row | `EditorHeaderRow` (song identity + export), grid area `header`, beneath `CompactSiteHeader` | own `header.border-b.px-3.py-3.md:px-5` with h1 + subtitle + mobile menu button | `header.mb-8` inside the container (h1 + search input) | `PlaybackBar` + song chrome | editor/find-music: **same region, different content** → shell provides the region, pages provide content. sheet-music: **different, keep** (header scrolls with the document) |
| Sidebar | `LeftSidebar`, width set by content, grid area `sidebar`; full-height rail ≥1440 px | fixed `292px` column, `hidden lg:block` | none | none | editor/find-music: **same region** with different widths — width becomes a shell parameter. No convergence of the two widths (each is tuned to its content): **different, keep** |
| Mobile pattern | grid collapses; sidebar stays in-flow | sidebar moves into a `Sheet` drawer (`FindMusicClient.tsx:673-705`), trigger in header | n/a (single column always) | n/a | **different, keep** for now; the Sheet pattern becomes the shell's optional `<lg` rail behavior, adopted by the editor only if a later plan asks |
| Main pane padding | none (highway owns its surface; `SiteMain` provides `px-3 pb-3`) | `p-4 md:p-5` (`:736`) | container padding | none | **different, keep** — padding is a density concern (see below) |
| Scroll ownership | panes own scrolling; `min-h-0`/`overflow-hidden` threaded manually through grid children | `min-h-0` chain threaded manually (`:670`, `:718`, `:721`, `:736`) | document scrolls | internal panes scroll | editor/find-music: **same intent, duplicated by hand** → the shell owns the `min-h-0`/`min-w-0`/`overflow-hidden` chain |
| Empty/loading/error states | per-pane | `initializing` panel, `held-matches` banner | "No songs found" block | per-pane | **different, keep** — page content, not shell |
| Density tokens consumed | `--ed-*` + `:root[data-density='compact']` via `useEditorDensity` | none | none | none | **different, unintentional** as a system gap: density is already modeled but editor-namespaced. Phase 4 promotes it: `compact` (chart-editor), `default` (find-music), `relaxed` (sheet-music) |
| Bottom region | grid area `bottom` (transport) | none | none | `PlaybackBar` | **same region, optional** in the shell |

**Grid-vs-flex decision (made in writing, per the plan):** the shell is the
named-areas grid generalized. `.chart-editor-grid` already expresses all four
regions plus the ≥1440 px rearrangement with pure CSS; find-music's two-column
grid is a strict subset (no bottom region, no rearrangement). A flex shell
cannot express the editor's rearrangement, so flex is ruled out. Sheet-music's
search page stays a document-flow page (its lower density and document scroll
are the owner-stated intent) and consumes only the density tokens, not the
grid.

---

## Track A — Open Graph images

All ten files, from source.

| Route | File | Size constant | Background | Eyebrow | Title size/weight/tracking | Subtitle | Illustration | Palette source | Static/dynamic |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| default | `app/opengraph-image.tsx` | longhand `{1200,630}` | linear `#1a0a1f→#2c0e36→#0a0a14` | none (title is the brand) | 132 / 800 / -0.03em, centered | 48 `rgba(255,255,255,0.78)` | "Find · View · Lyrics" row | inline literals | static |
| /drum-transcription | `app/drum-transcription/opengraph-image.tsx` | `OG_SIZE` | radial purple + linear `#17091d→#0a0710→#08070d` | brand 24 @ 0.18em + tool eyebrow 20 purple | 56 / 760 / -0.04em | none | drum highway SVG | `lib/og/tool-og-image.tsx` `COLORS` | static |
| /tempo | `app/tempo/opengraph-image.tsx` | `OG_SIZE` | same as above | same | same | none | waveform + markers SVG | same | static |
| /find-music | `app/find-music/opengraph-image.tsx` | longhand | radial+linear (verbatim same as tool-og-image) | brand 24 @ 0.18em, literal caps | 66 / 760 / -0.04em | 28 `COLORS.body` | three source cards | its own `COLORS` (partially verbatim-identical to tool-og-image) | static |
| /sheet-music | `app/sheet-music/opengraph-image.tsx` | longhand | linear `#1a0a1f…` | 26 @ 0.22em, `textTransform` | 100 / 800 / -0.03em | 34 | staff + lane-colored notes | third lane palette (`#facc15/#ef4444/#3b82f6/#22c55e/#f97316`) | static |
| /sheet-music/[slug] | `app/sheet-music/[slug]/opengraph-image.tsx` | longhand | linear `#1a0a1f…` | 28 @ 0.22em ("Drum Sheet Music") | 80 / 800 / -0.02em | artist 46 / charter 32 | album art `<img>` | inline literals | **dynamic** (Chorus lookup + fallback card) |
| /sng | `app/sng/opengraph-image.tsx` | longhand | linear `#1a0a1f…` | 26 @ 0.22em, `textTransform` | 92 / 800 / -0.03em | 38 | .sng → files → .sng/.zip flow | inline literals | static |
| /spotify | `app/spotify/opengraph-image.tsx` | longhand | linear `#1a0a1f…` | 28 @ 0.22em, `textTransform` | 110 / 800 / -0.03em | 42 | playlist checklist | inline + `#1DB954` | static |
| /spotifyhistory | `app/spotifyhistory/opengraph-image.tsx` | longhand | linear `#1a0a1f…` | 28 @ 0.22em, `textTransform` | 92 / 800 / -0.03em | 36 | history checklist | inline + `#1DB954` | static |
| /add-lyrics | `app/add-lyrics/opengraph-image.tsx` | longhand | linear `#1a0a1f…` | 28 @ 0.22em, `textTransform` | 110 / 800 / -0.03em | 42 | syllable timing row | inline literals | static |

Verdict for the whole track: **different, unintentional** across the board.
Two "brand backgrounds", five lane palettes (counting `.landing-lanes` light +
dark and `LANE_FALLBACKS`), two eyebrow trackings, three casing strategies,
title sizes 56→132 with no rule. OG images are explicitly allowed to change
appearance in Phase 1 (a wrong-looking social card, not a broken page), so
every "loser" below gets updated rather than preserved.

### Decisions

- **Background winner:** the radial-purple + linear composite from
  `lib/og/tool-og-image.tsx` (also used verbatim by find-music). It is the
  system built most recently against the design language, and two of the three
  most-worked cards already use it. The `#1a0a1f→#2c0e36→#0a0a14` linear (seven
  files) loses.
- **Lane palette winner:** the dark-theme `.landing-lanes` values
  (`#ff9a3d/#e5484d/#f5c531/#4c8dff/#46c46b`, mirrored in `LANE_FALLBACKS`).
  OG cards are always dark, and these are the canonical highway gem colors the
  landing canvases render. `lib/og/tokens.ts` restates them with a comment
  pointing at `components/landing/lanes.ts` (OG code cannot read CSS custom
  properties). Losers: `tool-og-image.tsx` `COLORS` kick/red/yellow/blue/green
  and the sheet-music OG palette.
- **Eyebrow:** 24 px, `0.18em` tracking (matches the `Eyebrow` component),
  literal caps ("MUSIC CHARTS TOOLS"). The 0.22em/`textTransform` variants lose.
- **Type scale (the rule that was missing):** four named sizes in
  `lib/og/tokens.ts` —
  `display` 132 (brand-only card: the root default),
  `title` 92 (standard tool card: title + subtitle + illustration),
  `titleCompact` 66 (two-line titles or cards whose illustration needs the
  vertical room: find-music, [slug]),
  `titleInset` 56 (titles inside a framed panel: the tool cards).
  Weight 760, tracking −0.03em everywhere (splitting 760/800 and
  −0.02/−0.03/−0.04 was drift, not intent). A route picks a named size; no
  per-file numbers.
- **Panel style:** `rgba(255,255,255,0.055)` background,
  `1px solid rgba(255,255,255,0.14)` border, radius 24/20 → standardized 24,
  from tool-og-image (find-music agrees verbatim on the colors).
- **`alt` and illustrations stay per-route**, per the plan.
- **Migration order:** static files first, `/sheet-music/[slug]` (dynamic)
  last.

---

## Screenshot baseline

Captured into `spotify-clonehero-next/plans/assets/0099-baseline/` before any
code change; every later phase re-shoots the same matrix and diffs.

Matrix per page: 390 / 900 / 1512 px × light / dark. Additional states:
`/chart-editor` at 1512 uses the ≥1440 px rearrangement (also shot at 1280 for
the narrow layout); `/find-music` `<lg` with the sidebar Sheet open;
`/drum-transcription` and `/tempo` scrolled to `#start`. OG baselines are the
fetched PNGs from `/<route>/opengraph-image` at `pnpm dev` time.

Naming: `<route-slug>--<width>--<light|dark>[--<state>].png`, e.g.
`find-music--390--dark--sheet-open.png`, `og--sheet-music.png`.

Captured 2026-08-09. Notes:

- `/chart-editor` is baselined in its chart-picker entry state (no chart in
  OPFS in the capture profile). The loaded-editor grid states could not be
  baselined without a chart; Phase 4's editor migration must validate the
  loaded grid interactively in the browser at 1280 and 1512 px instead of by
  diffing against this baseline.
- `/sheet-music/[slug]`'s OG baseline (`og--sheet-music-slug.png`) was fetched
  for the chart recorded in `og--sheet-music-slug.url.txt`; re-shoot the same
  slug when diffing.
- Landing pages are full-page captures; dashboards are viewport captures
  (their panes scroll internally).
