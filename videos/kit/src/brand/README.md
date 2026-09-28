# brand

The brand as data, and the pieces built on it.

## Tokens (`tokens.ts`), presets (`ease.ts`) and layout (`layout.ts`)

```ts
import {
  color,
  ease,
  space,
  springs,
  timing,
  type,
  useLayout,
} from '@musiccharts/video-kit/brand';
import {kf, spring01} from '@musiccharts/video-kit/motion';

const {fps, unit} = useFormat();
const {slateX, slateY, headlineMaxWidth} = useLayout(); // px, inside the title-safe box
const style = {color: color.muted, fontSize: type.caption.size * unit};
const wordEnter = timing.wordEnter * fps; // seconds -> frames
const pop = spring01(frame, at, springs.pop, fps);
const y = kf(frame, [
  [at, 40],
  [at + wordEnter, 0, ease.enter],
]);
```

| Export                                                  | What it is                                                                                                                                                                                                                                           |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `color`                                                 | Stage, text, brand purple, fuchsia, emerald, panel borders and glass, the app's page background, Spotify green. The app's social-card colours come from its `lib/og/tokens`.                                                                         |
| `stageBackground`                                       | The brand gradient (the app's `OG_COLORS.background`)                                                                                                                                                                                                |
| `lane`, `LANE_COLORS`, `FRET_COLORS`                    | Drum-lane gem colours (the app's `OG_LANES`) and guitar fret order                                                                                                                                                                                   |
| `fontFace`, `fontFamily`                                | The loaded family names and CSS font stacks                                                                                                                                                                                                          |
| `type` (`TypeToken`, `TypeName`)                        | The type scale: display, h1, h2, caption, wordmark, eyebrow, micro, microSmall, url, callout, chip, small                                                                                                                                            |
| `space`, `radius`                                       | Layout constants (reference px); `space.safe` is the format's `SAFE_MARGIN`                                                                                                                                                                          |
| `curves`, `springs` (`SpringName`)                      | The motion language as data: bezier curves, and spring configs (pop, hero, snap, soft, wobble, copy) for motion's spring functions                                                                                                                   |
| `ease` (`ease.ts`)                                      | The curves as easings: `enter`, `exit`, `camera`, plus `drift` and `settle`                                                                                                                                                                          |
| `timing`, `accent`                                      | Standard durations (`kickDecay` is `useHitPulse`'s default) and the flash strength                                                                                                                                                                   |
| `layoutOf(format, at?)`, `useLayout(at?)` (`layout.ts`) | The space tokens in px with the horizontal ones kept inside the title-safe box: `{safe, slateX, slateY, slateWidth, headlineMaxWidth, captionMaxWidth}`. `at` (`{x?, y?}`) places the slate somewhere of your own, kept inside the box the same way. |

Units: durations are in seconds; sizes (type, space, radius) are
reference px on a frame whose short side is 1080, so multiply them by
`useFormat().unit`, and lay out with `useLayout()` so a slate written for
a landscape frame still fits a portrait one.

## Brand JSON (`brandJson.ts`)

The colours the Blender logo sting reads, written atomically, from
`videos/`:

```sh
node --import tsx kit/scripts/brand/write-brand-json.ts --out out/brand.json
```

`{colors: {primary, accent, lanes: {green, red, yellow, blue, orange}}}`,
all sRGB hex.

## Marks (`BrandMark.tsx`, `services.tsx`)

| Export                                                                 | What it is                                                                                                                                                                                                 |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BrandMark({size, finish, glow, drawOn, sweep, outline, trace, tint})` | The purple rounded square with the white Music glyph, at the product's proportions (`BRAND`). `'lit'` adds depth for hero shots; `outline` 0..1 is the mark before it exists (traced square, drawn glyph). |
| `Wordmark({size, color, reveal})`, `WORDMARK_TEXT`                     | "Music Charts Tools" set in the `wordmark` type token, with a soft left-to-right `reveal`.                                                                                                                 |
| `SpotifyMark({size, variant})`                                         | The official Spotify icon (the app's own vector): green only on black or white, white or black elsewhere, never on a tile.                                                                                 |
| `AppleMusicMark({size, variant, assets})`                              | The official Apple Music icon, colour or white.                                                                                                                                                            |
| `InstrumentIcon({instrument, size, assets})`                           | The app's instrument artwork.                                                                                                                                                                              |
| `Gem({sprite, width, assets})`, `GemSprite`                            | One of the highway gem sprites, for flat layouts.                                                                                                                                                          |

`AppleMusicMark`, `InstrumentIcon` and `Gem` draw the app's own files from
its `public/assets`, which a film serves at `public/product` (a link to the
app's folder, the same one the product highway reads; `PRODUCT_ASSETS_PATH`).
Pass `assets` if it is served elsewhere. A missing file stops the render
with its path.

## The stage (`BrandStage.tsx`)

```tsx
<BrandStage
  accent={[
    [0, lane.blue],
    [600, lane.yellow],
  ]}
  tint={[
    [0, 0.3],
    [600, 1],
  ]}
  whip={{enter: cut, exit: nextCut}}
  push={0.03}>
  <Scene />
</BrandStage>
```

`BrandStage({grain, vignette, glow, glowAt, drift, accent, tint, whip, push})`:
the near-black purple sweep, the brand glow wandering top right (or pinned
at `glowAt`), an accent glow bottom left (a colour, or `[frame, colour]` keys
crossfading over half a second), its `tint` strength (a number or keyframes),
then the content, the vignette and grain. The content can whip in and out
across cuts with horizontal motion blur (`whip.enter` starts the whip in;
`whip.exit` is the cut the whip out ends on) and push in slowly over the
enclosing scene (`push`). `grain={false}` on any shot with the product
highway.

## The end card (`EndCard.tsx`)

```tsx
<EndCard
  at={f}
  title="Chart Editor"
  url="musiccharts.tools/chart-editor"
  tagline="Runs in your browser. Your chart and audio are never uploaded."
  titleSweeps={[f + 2 * fps]}
/>
```

`EndCard({at, title, url, tagline, credit, logo, logoSize, titleAt, urlAt, taglineAt, creditAt, titleSweeps, urlSweeps, glow, dust, push})`:
the logo (the brand mark springing in, or any node, such as a `LogoSting`),
the title (one line, flipping up), the URL (decoded, mono), the tagline, and
the music credit on the bottom safe margin, over a breathing glow and
drifting dust (the shared `particleField`, wrapping, so it never empties),
pushing in slowly to the end of the scene. The stack is laid out from the
format, so it fits landscape and portrait: a title or URL too long for the
title-safe width sets smaller (`useFitLineSize`) instead of running off the
frame, and the tagline and credit wrap inside it (the stack counts the
tagline's lines, so it stays centred). Its copy timing is
`endCardTiming(props, fps)` (`endCardTiming.ts`, Node-safe): when the title,
URL and tagline are fully in and the credit starts, for a pacing sheet.
`credit` is
`{title, artist}` or a whole line; left out, it is read from the timeline's
`meta` ("Music: {title} by {artist}"); `false` drops it. The chart is never
credited, only the music. The last frame is a complete card.

## The logo sting (`LogoSting.tsx`, `stingMeta.ts`)

The kit's Blender script renders the sting as square RGBA PNGs in
`<folder>/NNNN.png` and writes its meta beside them as `<folder>.json`.
Paths are public-relative and go through `load`'s `publicUrl`.

```tsx
const meta = useStingMeta('generated/blender/logo-sting.json'); // null while loading
if (!meta) return null;
const cues = stingCues(meta); // appear, impact, flashes, rest, sheens, end: film frames
<LogoSting
  meta={meta}
  src="generated/blender/logo-sting"
  x={cx}
  y={cy}
  size={240 * unit}
/>;
```

| Export                                                                                 | What it is                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `StingMeta` (`stingMeta.ts`)                                                           | `{version: 1, fps, frames, globalStart, digits, frameSizePx, appearFrame, impactFrame, flashFrames, restFrames, sheenFrames, rest: {centerPx, squarePx, cornerRadiusPx, iconBoxPx, strokePx}}`                                                                                                                       |
| `assertStingMeta(value)`, `stingMetaProblems(value)` (`stingMeta.ts`)                  | The whole-shape check of a meta read from JSON: every field, frames inside the sting, throwing once with every problem. The player's `useStingMeta` and the kit's sting preview both check with it.                                                                                                                  |
| `stingCues(meta, start)`, `checkSting(meta, fps)`, `STING_WRITTEN_BY` (`stingMeta.ts`) | The sting's events as film frames; the version and fps check (a sting rendered at another fps throws). React-free, so Node tools (the sting preview) import `stingMeta.ts` directly.                                                                                                                                 |
| `useStingMeta(path)`                                                                   | Loads and checks the meta (a public path) once per page, holding the frame.                                                                                                                                                                                                                                          |
| `LogoSting({meta, src, x, y, size, start})`                                            | Plays one sting frame per film frame from `start` (default `meta.globalStart`): nothing before the mark appears, the last frame held after. The resting mark's centre lands on (x, y), its square `size` px. `src` is a public folder or a function giving each frame's URL. Re-time it with `start` or `TimeShift`. |

## Rules

- A colour the app already names comes from the app's tokens, never a copy.
- A block that needs a value not here adds a token instead of a literal.
- Film-only material (a film's format, its chapters) stays in the film.
- Brand marks are the product's own art, never redrawn: the mark as vectors
  at the product's proportions, service and instrument marks from the app's
  files.
- `tokens.ts`, `ease.ts`, `brandJson.ts` and `stingMeta.ts` are pure. Node code imports the
  tokens as `@musiccharts/video-kit/brand/tokens` (inside the kit, the files
  directly): the `brand` barrel also exports React blocks that load fonts,
  which Node cannot import.
- The brand builds on motion and format, never the other way round; its
  tokens are data any area may read.
