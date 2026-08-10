---
title: Design System (structure)
type: concept
scope: Structural components, tokens, and layout rules for Music Charts Tools
sources:
  - docs/design-system-audit.md (plan 0099 Phase 0)
  - spotify-clonehero-next/plans/completed/0099-design-system-convergence.md
created: 2026-08-10
updated: 2026-08-10
---

# Design system (structure)

The structural sibling to `docs/landing-page-style-guide.md`. That document
governs **copy**: what a page says, what it must not claim, which phrases are
banned. This one governs **structure**: which component to reach for, which
tokens exist, and what the documented variants mean.

Neither restates the other. Where a component exists because of a copy rule,
its doc comment cites the style-guide section rather than re-arguing it —
`TrustLine` exists because §7 says trust signals are stated and not decorated,
and `ComparisonTable` has no verdict slot because §5.2 forbids a verdict
sentence.

**The rule that matters most:** a new page composes these primitives. It does
not open with a bespoke container. If a primitive is close but not right,
change the primitive or add a documented variant here; do not fork it into a
page.

---

## 1. Marketing / landing pages

Compose in this order. Everything lives in `components/landing/`.

| Reach for | When | Notes |
| --- | --- | --- |
| `LandingPage` | The root of any tool landing page | Owns the measure (`max-w-4xl`), the section rhythm (`space-y-12`), the `.landing-lanes` colour scope, and the `TooltipProvider`. The provider is not optional: §6 requires every number to reach its own source, and `StatChip`/`StatCell` need a provider ancestor to do it. |
| `LandingHero` | The first screenful | `{eyebrow, title, lede, trust, illustration, caption}`. `title` is a `ReactNode` because titles carry content-bearing typography (`/drum-transcription` uses a non-breaking hyphen so "first-pass" cannot split). |
| `ToolEntrySection` | The working entry screen | Carries `START_SECTION_ID`. A tool page opens the tool, so this sits above the explanation. |
| `LandingSection` | Every other section | Title over a hairline rule, optional intro, optional body. |
| `ComparisonTable` | Measuring against other tools | See variants below. |
| `StepFlow` | An ordered pipeline of steps | |
| `TrustLine` | The plain trust facts | Stated, never decorated. |
| `Eyebrow` | The mono label above a heading | The "measurement voice": labels, numbers, provenance. |
| `StatChip` / `InlineStat` / `StatCell` | Any measured figure | Chip, in-sentence, and table-cell sizes of the same thing. All three surface provenance. |
| `ScrollToStartCta` | The closing call to action | Scrolls to `START_SECTION_ID`. Caller supplies only the verb. |
| `ExternalLink` | Naming a third-party project | One definition, enforced by test. |
| `SectionDropZone` | A file drop target inside a section | |

### Documented variants

- **`LandingSection` with no children.** An intro-only section is supported:
  `/tempo`'s "When it works, and when it doesn't" is one honest paragraph with
  nothing to illustrate. The component renders no body wrapper when `children`
  is absent.
- **`ComparisonTable` row groups.** Groups are optional.
  `/drum-transcription` uses two (existing tempo map / starting from audio);
  `/tempo` uses one unlabelled group.
- **`ComparisonTable` summary rows.** A row marked `summary` is the row the
  rest of its group breaks down, and its group's other rows drop to muted so
  the hierarchy is visible. A group of peer measurements has no summary row and
  keeps every row at full contrast. This is why the drum table's kit parts are
  muted under "Whole chart" while the tempo table's measurements are not.
- **No verdict slot.** Deliberate, per style guide §5.2. Use `footnote` for
  methodology and attribution, `disclaimer` for what the measurement does not
  establish.

### Pages that are deliberately not in this system

- **`/find-music`'s welcome** (`app/find-music/FindMusicWelcome.tsx`) is
  marketing content embedded in a dashboard: it renders inside a scroll pane,
  next to a sidebar, under the page's `h1`, so it keeps its own `h2` scale,
  its `max-w-5xl` measure, and its own section rhythm. It adopts only
  `Eyebrow` and `TrustLine`, because the decorated version of those violated
  §7. `SetupCard`, `OutcomePanel` and `StatusDot` are dashboard
  source-status components and stay in `app/find-music/`.
- **`/sng`** is a utility page, not a marketing page. It is not in the style
  guide's scope list and has no trust, measurement, or comparison content.
  Revisit only if it grows some.

---

## 2. Open Graph images

`lib/og/` is the only place a brand colour, gradient, or type size is written
down for social cards. A route file contributes its own illustration, copy,
and `alt`, and nothing else.

| Reach for | Purpose |
| --- | --- |
| `lib/og/tokens.ts` | `OG_SIZE`, `OG_COLORS`, `OG_LANES`, `OG_TYPE`. |
| `OgFrame` | The card root: background, padding, font stack. `center` for brand-only cards. |
| `OgBrandRow` | The brand line, with an optional per-tool label on the right. |
| `OgEyebrow` | A wide-tracked label on its own. |
| `OgTitle` / `OgSubtitle` | Named type-scale steps, never raw sizes. |
| `OgPanel` | The translucent bordered panel an illustration sits in. |
| `createToolOgImage` | The standard tool card: brand row, inset title, full-width illustration panel. |

**The type scale** — pick a named step, never a number:

| Step | Size | Use |
| --- | --- | --- |
| `display` | 132 | Brand-only card with no illustration (the root default). |
| `title` | 92 | The standard tool card. |
| `titleCompact` | 66 | Two-line titles, or cards whose illustration needs the room. |
| `titleInset` | 56 | A title sharing the card with a full-width framed panel. |

Weight 760 and tracking −0.03em everywhere. Splitting those was drift, not
intent.

**Satori, not a browser.** Every div needs an explicit `display: flex`. CSS
`<style>` blocks are not applied, which is why the Apple Music tile's gradient
is a CSS background and its glyph carries an explicit fill. Gradients and
inline SVG work; anything more exotic needs checking against a real render.

**Lane colours** come from `OG_LANES`, which restates the dark
`.landing-lanes` values because Satori cannot read CSS custom properties. A
test keeps that copy equal to `LANE_FALLBACKS` in
`components/landing/lanes.ts`, so the two cannot drift.

---

## 3. Page shells and the outer gutter

`components/SiteChrome.tsx` owns two **independent** decisions. Keeping them
independent is the point; collapsing them into one route check is what forced
`/find-music` to cancel its gutter with a hard-coded negative margin.

| Decision | Driven by | Values |
| --- | --- | --- |
| Which header | `EDITOR_ROUTES` | Compact site header on editor routes, full site nav everywhere else. |
| How much gutter `<main>` gives | `EDITOR_ROUTES` + `FULL_BLEED_ROUTES` | `px-3 pb-3` on editor routes, none on full-bleed routes, `p-4` otherwise. |

**If your page wants no gutter, add it to `FULL_BLEED_ROUTES`.** Do not
subtract the gutter back out in the page. A test fails on
`w-[calc(100%+…)]` and on an all-sides negative margin anywhere in `app/` or
`components/`.

### Density

`app/globals.css` defines `--ed-*` tokens under
`:root[data-density='compact']`, switched on by `useEditorDensity` for as long
as a chart editor is mounted. The scope is the document root so it reaches
Radix's portalled surfaces (Select, Dialog, AlertDialog all render into
`document.body`). Consumers spend `var(--ed-token, <default>)`, where the
default is the unscoped appearance, so the override is additive and needs no
`!important`.

Ambiguous Tailwind utilities need a type hint when the value is a bare
`var()`: `text-[var(--ed-text-label)]` compiles to `color`, not a font size.
Spend `text-[length:var(--ed-text-label,…)]`.

### Dashboard layouts today

There is **no single dashboard shell**, and that is a recorded position rather
than an oversight. See `docs/design-system-audit.md` Track C for the full
comparison and the reasoning.

| Page | Shell | Status |
| --- | --- | --- |
| `/chart-editor` | `.chart-editor-grid`, a named-areas grid over header / sidebar / main / bottom with a ≥1440px rearrangement | The reference structure. |
| `/find-music` | Its own header row plus a two-column grid; a strict subset of the editor's regions | Full-bleed; no gutter hack. |
| `/sheet-music` | Document-flow search page | **Different, keep.** Lower density and document scrolling are intentional. |
| `/sheet-music/[slug]` | Full-viewport chart detail view | **Different, keep.** Not a dashboard: no rail, no region structure. |

If a shared shell is built later, the audit already settles the design
question in writing: it must be the named-areas grid generalized, because a
flex shell cannot express the editor's ≥1440px rearrangement. Two conditions
should hold first — a second genuine consumer beyond `/find-music` (otherwise
the extraction produces two shells instead of one), and a screenshot baseline
of the chart editor with a chart **loaded**, which the Phase 0 baseline does
not have.

---

## 4. Where the rules live

| Question | Document |
| --- | --- |
| What may this page say? | `docs/landing-page-style-guide.md` |
| Which component do I reach for? | this document |
| Why does page X differ from page Y? | `docs/design-system-audit.md` |
| What does the codebase already provide? | `spotify-clonehero-next/CLAUDE.md`, "Existing Utilities" |
