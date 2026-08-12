---
name: og-images
description: Build and edit Open Graph / social card images for Music Charts Tools routes using the shared frame and tokens in lib/og (OgFrame, OgBrandRow, OgTitle, OgSubtitle, OgPanel, OgEyebrow, createToolOgImage, OG_TYPE, OG_COLORS, OG_LANES). Use this whenever adding a new route's opengraph-image.tsx, editing an existing social card, changing a card's title size, background, brand color, or lane colors, or debugging a card that renders wrong or blank. Also use it whenever writing next/og ImageResponse code in this repo, since Satori only supports a subset of CSS and raw hex or font sizes at the call site will fail a test.
---

# OG images

Every route's social card is generated at request time by `next/og`. The frame,
palette, and type scale live in `lib/og/`; a route file supplies only its own
illustration, copy, and `alt`.

Before this was consolidated there were two competing "brand backgrounds", five
disagreeing lane palettes, three eyebrow treatments, and title sizes ranging
56–132 with no rule for which applied when. Tests now fail on the specific ways
that came back.

## Adding a card

**A standard tool card** — brand row, inset title, one full-width illustration
panel:

```tsx
import {createToolOgImage} from '@/lib/og/tool-og-image';
import {OG_SIZE} from '@/lib/og/tokens';

export const alt = 'Turn a song into a draft drum chart';
export const size = OG_SIZE;
export const contentType = 'image/png';

export default function OpengraphImage() {
  return createToolOgImage({
    eyebrow: 'DRUM TRANSCRIPTION',
    title: 'Turn a song into a draft drum chart',
    illustration: <DrumChart />,
  });
}
```

`createToolOgImage` is a fixed shape — a `titleInset` title over one
full-width illustration panel, with no subtitle. It fits the two pipeline tool
pages. If you need a subtitle, or any other arrangement, compose the frame
yourself.

**Anything else** — note the `new ImageResponse(jsx, size)` wrapper. The
primitives are plain JSX; returning them without wrapping ships a broken route:

```tsx
import {ImageResponse} from 'next/og';
import {
  OgBrandRow,
  OgFrame,
  OgPanel,
  OgSubtitle,
  OgTitle,
} from '@/lib/og/layout';
import {OG_SIZE} from '@/lib/og/tokens';

export const alt = 'Spotify Chart Finder';
export const size = OG_SIZE;
export const contentType = 'image/png';

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <OgFrame>
        <OgBrandRow />
        <OgTitle style={{marginTop: 22, marginBottom: 28}}>
          Spotify Chart Finder
        </OgTitle>
        <OgSubtitle style={{maxWidth: 1040, marginBottom: 48}}>…</OgSubtitle>
        <OgPanel padding="32px 40px" style={{flexDirection: 'column', gap: 22}}>
          …
        </OgPanel>
      </OgFrame>
    ),
    size,
  );
}
```

`alt`, `size`, and `contentType` are per-route metadata and stay in the route
file. `alt` describes the card and must be non-empty — a test checks all four,
default export included.

Illustrations are genuinely per-page and stay local. Only the frame, palette,
and type scale are shared.

`references/api.md` has every primitive, token, and the full type scale.

## The two constraints that actually bite

**Satori is the renderer, not a browser.** It supports a subset of CSS:

- Every `div` needs an explicit `display: flex`. A div without one renders
  wrong or vanishes, with no error.
- CSS `<style>` blocks are not applied. When lifting an SVG whose fills live in
  a `<style>` block (the Apple Music glyph is the example in the repo), move the
  gradient to a CSS background and give the path an explicit `fill`.
- Text renders as written — write literal caps rather than `textTransform`.

**Sizes and colors come from tokens, never the call site.** The `style` prop on
these primitives is typed to exclude `display`, `fontSize`, `fontWeight`,
`letterSpacing`, and `color`, so spacing and alignment stay adjustable and the
scale cannot be quietly overridden. If you need a size the scale lacks, **add a
step to `OG_TYPE`** rather than writing a number in the route file. That is
exactly how seven ad-hoc title sizes accumulated before.

Pick a named title step — `display`, `title`, `titleCompact`, `titleInset` —
described in `references/api.md`. Weight and tracking are uniform everywhere.

## Lane colors

`OG_LANES` restates the dark `.landing-lanes` values from `app/globals.css`,
because Satori renders outside the DOM and cannot read CSS custom properties.
OG cards are always dark, so the dark block is the one that governs.

A test parses the stylesheet and pins both `OG_LANES` and
`components/landing/lanes.ts`'s `LANE_FALLBACKS` to it. **Change the colors in
`globals.css` and the test tells you which copies to update** — do not edit the
constants alone.

## Verifying

These are generated at request time, so render them. With `pnpm dev` running:

```bash
curl -s -o /tmp/claude/og.png http://localhost:3000/<route>/opengraph-image
```

Then look at the PNG. A card that renders blank or with collapsed layout is
almost always a missing `display: flex`.

```bash
pnpm jest lib/og
```

checks that every route exports `OG_SIZE` as `size`, a non-empty `alt`,
`image/png`, and a default function; that no route re-declares a brand gradient
or lane palette; and that the lane copies match the stylesheet.

**One sharp edge in that test:** a route file may not contain the literals
`#facc15`, `#ef4444`, `#3b82f6`, `#22c55e`, `#f97316`, or `#1DB954` _anywhere_,
including inside a hand-written illustration SVG — those are the old
page-local lane palette and Spotify green. Reaching for Tailwind's `yellow-400`
(`#facc15`) for a gem in your own SVG will fail CI. Use `OG_LANES` and
`OG_COLORS.spotify`. Other illustration-internal colors are fine.
