---
name: landing-pages
description: Build and edit marketing / tool landing pages in Music Charts Tools using the shared primitives in components/landing (LandingPage, LandingHero, LandingSection, ComparisonTable, ToolEntrySection, ScrollToStartCta, TrustLine, Eyebrow, StatChip, ExternalLink). Use this whenever creating a new landing or marketing page, adding a hero, section, comparison or measurement table, trust signals, stat chips with provenance, or a call-to-action, and whenever editing /drum-transcription, /tempo, /why, or the /find-music welcome. Also use it before writing any page-level container div with a max-width and vertical rhythm, since that shell already exists and forking it fails a test.
---

# Landing pages

Everything structural on a landing page already exists in
`components/landing/`. Your job is to supply content.

The two class strings that define the shell — the page container and the hero
`h1` — are owned by `LandingPage.tsx` and `LandingHero.tsx`, and a test fails
if they appear anywhere else. Read `references/primitives.md` for the full
catalogue with props and signatures.

## The shape of a page

```tsx
<LandingPage>
  <LandingHero eyebrow=… title=… lede=… trust={[…]} illustration={…} caption=… />

  <ToolEntrySection title="Start a song" intro=…>{toolEntry}</ToolEntrySection>

  <LandingSection title="What it does" intro=…>
    <StepFlow steps={STEPS} />
  </LandingSection>

  <LandingSection title="How it scores" intro=…>
    <ComparisonTable caption=… rowHeader=… columns={…} groups={…} />
  </LandingSection>

  <ScrollToStartCta>Open a song</ScrollToStartCta>
</LandingPage>
```

**Everything except the hero, the tool entry, and the CTA lives inside a
`LandingSection`** — including tables and step flows. The section supplies the
heading and the hairline rule that give the content its place on the page;
hanging content directly off `LandingPage` compiles but loses both.

Sections are not numbered — a landing page's sections are not a pipeline.

`LandingPage` owns the measure, the vertical rhythm, the `.landing-lanes`
colour scope, and a `TooltipProvider`. The provider is not decoration: the copy
guide requires every number to reach its own source, and `StatChip`/`StatCell`
need a provider ancestor to show provenance. Owning it here means a page cannot
put a measured figure on screen without one.

Two couplings worth knowing:

- `ScrollToStartCta` scrolls to `START_SECTION_ID`, which only exists if a
  `ToolEntrySection` rendered. On a page with no tool, drop the CTA — it would
  be a no-op button.
- `LandingHero` renders `TrustLine` itself from its `trust` prop. Pass the
  facts to the hero; do not also render a `TrustLine` beside it.
- Import paths do not always match export names (`LandingSection` lives in
  `Section.tsx`). `references/primitives.md` opens with the full import block.

## How a route is assembled

Tool pages split in two, so the marketing layout never owns the pipeline:

- `app/<route>/page.tsx` — server component, exports `metadata`.
- `app/<route>/landing/<Name>Landing.tsx` — `'use client'`, takes the working
  entry screen as a `toolEntry: ReactNode` prop and passes it to
  `ToolEntrySection`.

A page with no tool still splits, it just has no `toolEntry`: `/why` is
`app/why/page.tsx` (metadata) plus `app/why/WhyPage.tsx`. `WhyPage` needs no
`'use client'` of its own — `LandingPage` carries the client boundary, and a
server component may render it.

Every route needs `page.tsx` with a `metadata` export. A route with no
`ROUTE_CHROME` entry in `components/SiteChrome.tsx` gets the default chrome —
the full site nav and a `p-4` gutter — which is what a marketing page wants, so
most new pages add nothing there.

## When a primitive does not quite fit

This is the moment the system usually breaks, so treat it as a decision point
rather than an inconvenience.

**Prefer, in this order:**

1. **Make the blocking prop optional.** This is the one that actually happened:
   `/why` forked the entire shell and hero because `LandingHero` required a
   `trust` array a position page has no facts for. One optional prop would have
   prevented it.
2. **Add a documented variant** to the component, and record it in
   `../docs/design-system.md` under "Documented variants".
3. **Leave it local** if it genuinely has one user. The rule is to extract on
   the _second_ user, not the first — `/drum-transcription`'s "What you'll fix"
   grid is deliberately still a local `<ul>`.

**Do not** copy a primitive's markup into your page. If you catch yourself
pasting `landing-lanes w-full max-w-4xl…` or the hero `h1` classes, the test
will fail, and the fix is one of the three options above.

## Copy is governed elsewhere

`../docs/landing-page-style-guide.md` owns what a page says. Read it before
drafting or revising copy. The rules most likely to bite:

- Every page states that the tool produces a first pass a human reviews, high
  on the page, in normal body text (§4).
- Every number traces to a source, surfaced through `StatChip`/`StatCell`
  provenance, and provisional figures are marked as such on the page (§6).
- Comparison tables present measurements and stop. No verdict sentence, no
  framing sentence. `ComparisonTable` has no slot for one, deliberately (§5.2).
- Trust signals are stated, never decorated — no badges, shields, or seals
  (§7). That is what `TrustLine` is for.

**A structural migration that reworded a sentence has exceeded its scope.** If
you are consolidating, keep the copy byte-identical.

## Reference files

- `references/primitives.md` — every component, its props, and what it encodes.
  Read when picking a component or adding a variant.
- `references/pages.md` — the pages in and out of the system today, and why the
  `/find-music` welcome and `/sng` are deliberately outside it. Read before
  assuming a page should be migrated.

## Checking your work

```bash
pnpm jest components/landing components/__tests__/design-system-guardrails
```

If you changed an existing page and intended no visual change, verify it —
`../design-system/references/verifying-changes.md` has the procedure, including
why diffing against a stale screenshot baseline will lie to you.
