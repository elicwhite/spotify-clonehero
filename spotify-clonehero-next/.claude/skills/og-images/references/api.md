# OG system API

Everything in `lib/og/`.

## Contents

- [Tokens](#tokens) — `OG_SIZE`, `OG_TYPE`, `OG_COLORS`, `OG_LANES`
- [Layout primitives](#layout-primitives) — `OgFrame`, `OgBrandRow`, `OgEyebrow`, `OgTitle`, `OgSubtitle`, `OgPanel`
- [The tool card](#the-tool-card) — `createToolOgImage`
- [Route file contract](#route-file-contract)
- [Satori notes](#satori-notes)

---

## Tokens

`lib/og/tokens.ts` is the only place a brand color, gradient, lane color, or
type size is written down for social cards.

### `OG_SIZE`

`{width: 1200, height: 630}`. Routes re-export it as `size`.

### `OG_TYPE`

Pick a **named step**. There are no per-file font sizes.

| Step           | Size | Use                                                                                          |
| -------------- | ---- | -------------------------------------------------------------------------------------------- |
| `display`      | 132  | A brand-only card with no illustration (the root default).                                   |
| `title`        | 92   | The default: a title with a subtitle and an illustration below it. Most hand-composed cards. |
| `titleCompact` | 66   | Two-line titles, or cards whose illustration needs the vertical room.                        |
| `titleInset`   | 56   | A title sharing the card with a full-width framed panel — what `createToolOgImage` uses.     |

| Subtitle step   | Size | Use                                                                               |
| --------------- | ---- | --------------------------------------------------------------------------------- |
| `subtitle`      | 32   | The default line under a title.                                                   |
| `subtitleLead`  | 46   | The first of two stacked metadata lines (the chart viewer's artist over charter). |
| `subtitleLarge` | 48   | Pairs with `display`.                                                             |

Also: `titleWeight` 760 and `titleTracking` −0.03em, uniform across every card;
`eyebrow` 24 with `eyebrowTracking` 0.18em; `eyebrowTool` 20 for the per-tool
label.

Splitting weight and tracking per card was drift, not intent — do not
reintroduce it.

### `OG_COLORS`

| Key                                  | Purpose                                                                                               |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `background`                         | The brand background: a purple radial glow over a near-black sweep. One gradient, used by every card. |
| `text` / `muted` / `subtle` / `body` | Foreground ramp.                                                                                      |
| `panel` / `panelBorder`              | The translucent illustration panel.                                                                   |
| `card` / `cardBorder`                | Solid inner cards (the find-music source tiles).                                                      |
| `purple`                             | The accent, used for per-tool eyebrows and line art.                                                  |
| `spotify` / `spotifyInk`             | Spotify brand green and its ink.                                                                      |

### `OG_LANES`

The five drum-lane gem colors: `kick`, `red`, `yellow`, `blue`, `green`.

These restate the **dark** `.landing-lanes` values from `app/globals.css`.
Satori renders outside the DOM and cannot read CSS custom properties, and OG
cards are always dark, so the dark block governs. A test parses the stylesheet
and pins both this and `LANE_FALLBACKS` to it, so all three stay in step.

---

## Layout primitives

From `lib/og/layout.tsx`. Every one already sets `display: flex`.

The `style` prop is typed as `Omit<CSSProperties, 'display' | 'fontSize' |
'fontWeight' | 'letterSpacing' | 'color'>`. Spacing, measure, and alignment are
adjustable; the type scale and palette are not. A route needing a size the
scale lacks adds a step to `OG_TYPE`.

### `OgFrame`

```tsx
<OgFrame center?>{children}</OgFrame>
```

The card root: brand background, `56px 68px` padding, font stack, flex column.
`center` centers the column both ways, for brand-only cards with no
illustration.

### `OgBrandRow`

```tsx
<OgBrandRow right?={ReactNode} />
```

The "MUSIC CHARTS TOOLS" line across the top, with an optional right-aligned
per-tool label (rendered in the accent color at `eyebrowTool` size).

### `OgEyebrow`

```tsx
<OgEyebrow tone?={'muted' | 'accent'} style?>{children}</OgEyebrow>
```

A wide-tracked label on its own, for a card whose top line names the section
rather than the site — `/sheet-music/[slug]` uses "DRUM SHEET MUSIC" because it
is one chart's page.

### `OgTitle`

```tsx
<OgTitle size?={OgTitleSize} center? style?>{children}</OgTitle>
```

A flex column, so a multi-line title passes each line as its own
`<div style={{display: 'flex'}}>`.

### `OgSubtitle`

```tsx
<OgSubtitle size?={OgSubtitleSize} style?>{children}</OgSubtitle>
```

### `OgPanel`

```tsx
<OgPanel padding?={number | string} style?>{children}</OgPanel>
```

The translucent bordered panel an illustration sits in. Radius 24.

---

## The tool card

```tsx
createToolOgImage({eyebrow, title, illustration});
```

The standard shape: brand row with a per-tool eyebrow, a `titleInset` title,
and a full-width 300px-high panel holding the illustration. Used by
`/drum-transcription` and `/tempo`. Returns an `ImageResponse` — the route file
just returns it.

Write `eyebrow` in literal caps; Satori renders text as written.

---

## Route file contract

```tsx
export const alt = '…';            // non-empty; describes the card
export const size = OG_SIZE;
export const contentType = 'image/png';
export default function OpengraphImage() { … }
```

`alt` is per-route metadata and does not move into the system. A test checks
all four across every route.

Dynamic cards (`/sheet-music/[slug]`) take `{params}` and may be `async`; they
should render a `fallback` card through the same frame when the lookup fails.

---

## Satori notes

`next/og` renders through Satori, which supports a subset of CSS.

- **Every `div` needs an explicit `display: flex`.** Missing it renders wrong
  or blank, silently. The layout primitives handle their own; you need this on
  any div you write inside an illustration.
- **`<style>` blocks are not applied.** The Apple Music glyph in
  `app/find-music/opengraph-image.tsx` is the worked example: its source SVG
  keeps fills in a `<style>` block, so the tile gradient became a CSS
  background and the path carries an explicit `fill`.
- **Write literal caps** rather than `textTransform`.
- Gradients, inline SVG, and `<img src>` with an absolute URL all work.
- Everything is rendered at request time, so there is no static asset to keep
  in sync — but also no build-time error. Render the card and look at it.
