# text

Type for kinetic text: font loading, measurement and balanced line
breaking.

## Fonts and measurement (`fonts.ts`, `measure.ts`)

```tsx
import {
  breakLines,
  measureWidth,
  useFontsReady,
} from '@musiccharts/video-kit/text';

const Headline: React.FC<{words: string[]}> = ({words}) => {
  const ready = useFontsReady(); // false until the fonts load; the frame waits
  if (!ready) return null;
  const font = {
    family: fontFamily.sans,
    size: 86 * unit,
    weight: 760,
    tracking: -0.03,
  };
  const lines = breakLines(
    words.map(w => measureWidth(w, font)),
    measureWidth(' ', font),
    space.headlineMaxWidth * unit,
  );
  // lines: word indices per line
};
```

| Export                                                            | What it is                                                                                       |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `useFontsReady()`                                                 | False until Inter Variable and JetBrains Mono Variable have loaded, then true (with a re-render) |
| `areFontsLoaded()`                                                | The same, synchronous                                                                            |
| `measureWidth(text, font)`                                        | Advance width in px, measured in the DOM with the exact CSS (kerning, tracking, optical size)    |
| `charAdvances(word, font)`                                        | Per-character advances with kerning folded in, so split characters keep the word's kerning       |
| `breakLines(widths, spaceWidth, maxWidth, {balance?, maxLines?})` | Word indices per line                                                                            |
| `PIXEL_STABLE_LINE_HEIGHT`                                        | A `line-height` value identical at every render scale                                            |
| `pixelStableLineHeightRule(selector)`                             | A stylesheet rule applying it to a subtree                                                       |

`breakLines` uses the fewest lines that fit (capped at `maxLines`). Balanced
(the default), like CSS `text-wrap: balance`, it then:

1. makes the widest line as narrow as it can be;
2. among the breaks that achieve that, picks the most even line widths (the
   smallest sum of squared widths);
3. breaks a remaining tie as late as possible, so earlier lines are longer.

With `balance: false` lines fill greedily.

## Kinetic type (`KineticText.tsx`, `presets.ts`, `timing.ts`)

One component for every animated line: headlines, titles, captions,
eyebrows, URLs, and blur-rise copy set word by word on beats.

```tsx
import {KineticText, blurRise} from '@musiccharts/video-kit/text';

const {fps, unit} = useFormat();
<KineticText
  text="Generate a tempo map from the audio"
  maxWidth={1100 * unit}
  maxLines={2}
  enterAt={beat(4)}
  exitAt={beat(7, 3)}
  exit="whipUp"
/>
<KineticText variant="display" text="Chart Editor" enter="flipUp" enterAt={f} weightFrom={420} />
<KineticText
  text={['Your', 'library', 'is', 'already', 'a', {text: 'setlist.', style: accentText}]}
  variant="h2"
  enter="blurRise"
  enterAt={wordBeats} // one film frame per word
  exit="blurLift"
  exitAt={f + 3 * fps}
  float
/>
```

| Prop                                                         | Meaning                                                                                                                                                                                                                 |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `text`                                                       | A string (spaces split words, `\n` breaks a line) or atomic groups; a group may carry its own paint: `{text, style}` (a colour, a gradient, a glow; never metrics).                                                     |
| `variant`                                                    | A type token name (`'h1'` default) or your own `TypeToken`. Its size is reference px, scaled by the format. `size` (frame px), `weight`, `tracking`, `lineHeight`, `color`, `font`, `uppercase` override it.            |
| `maxWidth`, `maxLines`, `balance`, `align`                   | Layout: lines broken from measured widths and balanced like `text-wrap: balance`.                                                                                                                                       |
| `split`                                                      | `'words'` or `'chars'` (default: the preset's preference). Characters keep the word's kerning.                                                                                                                          |
| `enter`, `enterAt`, `stagger`, `duration`, `order`           | Enter preset and timing. `enterAt` is one film frame (staggered) or one frame per unit (or per word in chars mode). Without it the text is at rest. `stagger`/`duration` are frames; the defaults come from the preset. |
| `exit`, `exitAt`, `exitStagger`, `exitDuration`, `exitOrder` | Exit preset and timing.                                                                                                                                                                                                 |
| `weightFrom`, `weightTo`                                     | Variable-weight animation during enter and exit; unit widths are locked so nothing reflows.                                                                                                                             |
| `caret`                                                      | `true`, `false` or `{color, lead, hideAfter, blink, shape}` (frames; defaults 0.3 s, 1 s and 0.6 s). On by default for `typeOn`.                                                                                        |
| `float`                                                      | `true` or `{amount, seed}`: a slow parallax drift of the whole block, so a held line never sits dead still.                                                                                                             |
| `unitStyle(u)`                                               | Extra per-unit style every frame (a beat pulse), added on top.                                                                                                                                                          |
| `seed`, `style`, `className`                                 | The randomness seed (default the text), container style. The clock is the film clock; re-time a line with `TimeShift`.                                                                                                  |

Enter presets (`enterPresets`): `maskUp` (the headline reveal from behind the
line mask), `flipUp` (title letters tipping up), `blurIn` (focus pull),
`blurRise` (words rise, un-blur and fade in on a spring), `fadeUp`
(captions), `scalePop`, `typeOn` (with caret), `decode` (scramble then
lock; best in mono), `whipIn`, `fadeIn`, `dropIn` (falls into place on a
spring), `none`. Exit presets (`exitPresets`): `maskUpOut`, `maskDownOut`,
`whipUp`, `peelUp`, `blurOut`, `blurLift` (the blur-rise exit), `fadeDown`,
`fadeOut`, `shrinkOut`, `fallOut`, `riseOut`, `none`. Every exit ends fully
transparent. `fx`'s `Pop` plays the ones that need no line mask or caret
(`POP_ENTERS`, `POP_EXITS`) on any element.

A preset is `{duration, stagger, split?, mask?, caret?, style: (p, u) => UnitStyle}`
with `duration` and `stagger` in SECONDS, so it holds at any frame rate.
`u` (`UnitContext`) carries the unit's text, size, line height, its phase's
`start` film frame and `durationFrames`, the `fps`, and the format's `unit`
for distances. A time-based preset (a spring) reads the seconds since its
phase began with `elapsedSec(p, u)`, never `p * duration`.
`blurRise({spring, rise, blur, scale, duration, stagger})` and
`blurLift({lift, blur, duration, stagger})` build tuned variants.

### Timing (`timing.ts`)

`kineticTimeline({text, fps, enter, exit, split, enterAt, stagger, duration,
order, exitAt, exitStagger, exitDuration, exitOrder, seed})` is the timing
KineticText draws, as a pure function (Node-safe, `@musiccharts/video-kit/text/timing`):
every unit's `start`, `land`, `exitStart` and `exitEnd` (exact film frames),
each phase's length (`enterFrames`, `exitFrames`), plus `fullyIn` and
`gone`, the first whole film frames on which every unit has landed and left.
Line breaks (`\n`) never change the word count. `fullyInFrame(options)` is
`fullyIn`, for pacing sheets; `wholeFrameAtOrAfter(t)` is its rounding.
`tokenize(text)` splits the text the way KineticText does, and `LineTiming`
is the timing props a line takes (the options without `fps`).

### Unit styles (`unitStyle.ts`)

A preset returns a `UnitStyle`, a delta from rest. `composeStyle(a, b)`
combines two (offsets, rotations and blurs add; scales and opacity
multiply), and `unitCss(style, {base, perspective, directionalFilter})`
lays one over an element's own style: the base transform applies first,
opacities multiply, and the base filter chains before the unit's blur.
KineticText and `Pop` both draw with them.

### Fitting a line (`fit.ts`)

`useFitLineSize(text, variant, size, maxWidth)` is the largest size, at most
`size`, at which a line sets within `maxWidth` (the end card fits its title
and URL to the title-safe width this way). `useLineCount(text, variant,
size, maxWidth)` is how many lines KineticText breaks a block into, for a
layout stacked around it (the end card's tagline). `fitLineSize` and
`lineCount` are the same outside a component, and `tokenFontSpec(variant,
size, overrides)` the exact spec KineticText measures a token with, font
features included.

## Text styles (`style.ts`)

| Export                               | What it is                                                                                         |
| ------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `textStyle(token, unit, overrides?)` | Full CSS for a type token (name or object) at the format's size unit                               |
| `crispText`, `monoFeatures`          | Rendering flags every text node gets (grayscale AA, geometric precision, kerning; tabular figures) |
| `resolveType(token)`, `TypeInput`    | A token by name or the token itself                                                                |

## Rules

- Importing `fonts.ts` (every text block does) holds every frame until the
  fonts are in, so no still captures a fallback face.
- Measure only once `useFontsReady()` is true; measurements taken earlier
  are not cached.
- Use `PIXEL_STABLE_LINE_HEIGHT` for text whose layout must match between a
  normal and a supersampled render (Chrome rounds `normal` line heights to
  device pixels). Its metrics are Inter's.
- `measure.ts` is pure outside the DOM (Node estimates widths), so
  `breakLines` is unit-tested; `fonts.ts` is browser-only.
- All timing props on `KineticText` are film frames; presets are seconds.
- Keep a word readable once it has landed for as long as the pacing rules
  in [`scripts/qa/pacing.ts`](../../scripts/qa/pacing.ts) ask; only blur
  what is supposed to move fast.
