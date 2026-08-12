# Landing primitives

Everything in `components/landing/`. Import directly; there are no re-export
barrels in this repo.

## Import paths

**The file name is not always the export name** — check here rather than
guessing, because `LandingSection` is the one that catches people.

```tsx
import {LandingPage} from '@/components/landing/LandingPage';
import {LandingHero} from '@/components/landing/LandingHero';
import {LandingSection} from '@/components/landing/Section'; // ← not LandingSection.tsx
import {
  ToolEntrySection,
  START_SECTION_ID,
} from '@/components/landing/ToolEntrySection';
import {ScrollToStartCta} from '@/components/landing/ScrollToStartCta';
import {ComparisonTable} from '@/components/landing/ComparisonTable';
import {ExternalLink} from '@/components/landing/ExternalLink';
import {Eyebrow} from '@/components/landing/Eyebrow';
import {TrustLine} from '@/components/landing/TrustLine';
import {StepFlow} from '@/components/landing/StepFlow';
import {StatChip, InlineStat, StatCell} from '@/components/landing/StatChip';
import SectionDropZone from '@/components/landing/SectionDropZone'; // ← default export
```

All named exports except `SectionDropZone`.

## Contents

- [Shell](#shell) — `LandingPage`
- [Hero](#hero) — `LandingHero`, `Eyebrow`, `TrustLine`
- [Sections](#sections) — `LandingSection`, `ToolEntrySection`, `SectionDropZone`
- [Content](#content) — `StepFlow`, `ComparisonTable`, `ExternalLink`
- [Numbers](#numbers) — `StatChip`, `InlineStat`, `StatCell`
- [Call to action](#call-to-action) — `ScrollToStartCta`
- [Color](#color) — `lanes.ts`

---

## Shell

### `LandingPage`

```tsx
<LandingPage className?>{children}</LandingPage>
```

The root of any page in this shell. Owns:

- the measure and rhythm (`landing-lanes w-full max-w-4xl space-y-12 py-8 sm:py-12`)
- the `.landing-lanes` scope, which is where the five drum-lane gem colors are
  defined (`app/globals.css`), read at runtime by the hero canvases so they
  track the theme
- a `TooltipProvider`, so provenance tooltips always have an ancestor

This class string is owned here and a guardrail test fails if it appears in
another file.

---

## Hero

### `LandingHero`

```tsx
<LandingHero
  eyebrow={ReactNode}
  title={ReactNode}
  lede={ReactNode}
  trust?={ReactNode[]}
  illustration?={ReactNode}
  caption?={ReactNode}
/>
```

The first screenful. The prop order is the copy guide's, not a layout
preference: the lede sells the purpose rather than the mechanism (§2), and the
trust facts sit directly under it because the not-one-shot statement and the
download size have to land in the first screenful (§4, §7).

- `title` is a `ReactNode` because titles carry typography that is content —
  `/drum-transcription` sets a non-breaking hyphen (`&#8209;`) so "first-pass"
  cannot split across lines at the display size.
- `trust` is **optional**. Tool pages always have trust facts; a position page
  like `/why` does not.
- `illustration` is a slot. The canvases (`EditPassCanvas`, `BeatGridCanvas`)
  are page-owned content and stay in the page's own directory.
- `caption` is the mono line under the illustration.

Renders the page's single `h1`.

### `Eyebrow`

The mono label above a heading. Mono is the family's "measurement voice":
labels, numbers, provenance, stage numbers. Takes any `<p>` props.

### `TrustLine`

```tsx
<TrustLine items={ReactNode[]} className? />
```

The plain trust facts under a hero: local execution, what gets downloaded, what
the page needs to run. Each item is one short factual sentence, rendered as a
list item with a hairline dash.

Exists because of style-guide §7: trust signals are stated, not decorated — no
badge graphics, no shield icons, no seals. If you are reaching for an icon to
make a trust claim feel more trustworthy, that is the rule firing.

---

## Sections

### `LandingSection`

```tsx
<LandingSection id? index? title intro? className?>{children?}</LandingSection>
```

Title over a hairline rule, optional intro, optional body.

- `children` is **optional**. An intro-only section is a supported shape —
  `/tempo`'s "When it works, and when it doesn't" is one honest paragraph with
  nothing to illustrate — and the component renders no body wrapper when
  children are absent.
- `index` is a decorative two-digit **string** (`index="02"`, not `{2}`),
  hidden from assistive tech. Use it only where order carries real information.
  A landing page's sections are not a staged pipeline, so they are not numbered.
- `title` here is a plain `string`, unlike `LandingHero`'s `title`, which is a
  `ReactNode` so it can carry typography.

Renders an `h2`.

### `ToolEntrySection`

```tsx
<ToolEntrySection title intro?>{toolEntry}</ToolEntrySection>
```

The working entry screen, promoted above the explanation, because a tool page's
job is to open the tool. Carries `START_SECTION_ID` (exported from the same
file), which `ScrollToStartCta` scrolls to — one constant rather than two
string literals that can drift.

The entry itself is passed in, so the pipeline it drives stays owned by the
page's client component.

### `SectionDropZone`

```tsx
<SectionDropZone onAudioFile onChartLoaded disabled? className?>{children}</SectionDropZone>
```

Makes a section a drop target for an audio file or a chart package (folder,
`.zip`, or `.sng`).

---

## Content

### `StepFlow`

```tsx
<StepFlow steps={FlowStepSpec[]} />
// FlowStepSpec: {Icon: LucideIcon; label: string; desc: string}
```

An ordered pipeline of steps. `label` is what happens, in the reader's
vocabulary; `desc` is one sentence naming the mechanism.

**The grid is `sm:grid-cols-2 lg:grid-cols-4`, so it is built for four steps.**
Three renders with an empty quarter at desktop width and five wraps unevenly.
Nothing enforces this — it is a layout fact to design around.

### `ComparisonTable`

```tsx
<ComparisonTable
  caption={string}          // screen-reader-only; says what the table measures
  rowHeader={string}        // header for the row-header column
  columns={readonly string[]} // the compared systems, in cell order
  groups={ComparisonTableGroup[]}
  footnote?={ReactNode}     // methodology + attribution
  disclaimer?={ReactNode}   // what the measurement does not establish
/>

// Both exported from '@/components/landing/ComparisonTable'
interface ComparisonTableRow {
  header: string;                    // also the React key within its group,
                                     // so keep it unique inside one group
  cells: readonly LandingMetric[];   // ← not strings; see "Numbers" below
  summary?: boolean;
}
interface ComparisonTableGroup {
  label?: string;
  rows: readonly ComparisonTableRow[];
}
```

**Every cell is a full `LandingMetric`, not a display string.** Cells render
through `StatCell`, so each figure carries its own provenance — that is
style-guide §6, and it is the main cost of adding a table. Budget for it:

```tsx
const prov = {
  script: 'analysis/threeway_comparison/',
  measuredOn: 'the v3 test split, which was not used to train this tool',
  asOf: '2026-08-07',
};
rows: [
  {
    header: 'Whole chart',
    cells: [
      {value: '20.3', label: 'edits per 100 notes, this tool', prov},
      {value: '40.0', label: 'edits per 100 notes, ADTOF', prov},
    ],
    summary: true,
  },
];
```

Pages keep these in a sibling `metrics.ts` (see
`app/tempo/landing/metrics.ts`) rather than inline, so the numbers and their
sources sit together and can be re-verified as a unit.

This repo compiles with `exactOptionalPropertyTypes: true`, so you cannot pass
a possibly-`undefined` value to an optional prop like `note` or `caption`.
Spread it conditionally instead — `...(note !== undefined ? {note} : {})` —
which is why `app/tempo/landing/metrics.ts` is written that way.

If a figure has not been re-confirmed on the current pipeline, set
`prov.provisional: true` — it renders a visible marker on the page, which §6
requires. If you have no measurement at all yet, you do not have a table yet;
`⟨TBD⟩` in a draft is the guide's answer, never a plausible-looking guess.

**There is no verdict slot, deliberately.** Style-guide §5.2 forbids a verdict
sentence attached to a comparison table; a component with nowhere to put one is
the cheapest way to keep that true. Use `footnote` for methodology and
attribution, `disclaimer` for limits.

Documented variants:

- **Row groups are optional.** `/drum-transcription` uses two labelled groups
  (existing tempo map / starting from audio); `/tempo` uses one unlabelled
  group.
- **Summary rows.** A row marked `summary: true` is the row the rest of its
  group breaks down; its group's other rows drop to muted so the hierarchy is
  visible. A group of peer measurements has no summary row and keeps every row
  at full contrast. That is why the drum table's kit parts are muted under
  "Whole chart" while the tempo table's measurements are not.
- Every group but the last is ruled off, at any group count.

Cell count must equal column count; the component throws in development
otherwise, because a short row silently drops a column and a long one renders
ragged.

### `ExternalLink`

```tsx
<ExternalLink href>{children}</ExternalLink>
```

A named third-party project, linked from the copy that mentions it. Opens in a
new tab with `rel="noreferrer noopener"` and a focus ring.

There is exactly one definition and a test enforces it. `lucide-react` also
exports an icon called `ExternalLink`; importing that is unrelated and fine.

---

## Numbers

All three take `{metric: LandingMetric, className?}` and surface provenance in
a tooltip: the recompute script, what it was measured on, the date, and a
visible marker when the figure is provisional.

```ts
interface LandingMetric {
  value: string; // presentation-ready
  label: string; // what the number is, in the reader's vocabulary
  prov: {script; measuredOn; asOf; provisional?; note?};
}
```

- **`StatChip`** — the figure as a card. The house standard for putting a
  number on a page.
- **`InlineStat`** — the same figure at prose scale, inside a sentence's block.
- **`StatCell`** — sized for a table cell: the number alone, with the label
  read out through `aria-label` because the row and column headers already
  carry it visually.

Style-guide §6: no number ships without its source reachable from the number
itself. That is what these are for. Provisional figures are marked on the page,
not only in the code.

---

## Call to action

### `ScrollToStartCta`

```tsx
<ScrollToStartCta>Open a song</ScrollToStartCta>
```

The closing call to action; scrolls to `START_SECTION_ID`. The caller supplies
only the verb, because §2 wants a plain instruction with no surrounding hype.

---

## Color

### `lanes.ts`

The five Clone Hero drum-lane gem colors as CSS custom-property names
(`LANE_VARS`, `LANE_PROPERTIES`) plus `LANE_FALLBACKS` for canvases that paint
before the stylesheet applies. The values live in `app/globals.css` under
`.landing-lanes`, one definition per theme.

These are the only illustrative colors the landing pages use, and they are
always used for the lane they name. The OG system restates the dark values in
`lib/og/tokens.ts` because Satori cannot read CSS custom properties; a test
keeps all three copies pinned to the stylesheet.
