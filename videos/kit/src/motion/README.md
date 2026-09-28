# motion

Motion math: easings, springs, keyframes, staggers, seeded randomness,
colour, 2D geometry, sorted event lists and quad-to-quad warps. Every export
is a pure function with no imports at all (no React, no Remotion, no brand),
exact at fractional frames and safe in Node. The brand builds its named
presets on it: `ease.enter` and friends in `brand/ease.ts`, spring configs in
`brand/tokens.ts`.

```ts
import {
  glide,
  keyed,
  kf,
  progress,
  settle,
  spring01,
  staggerIndex,
  wave,
} from '@musiccharts/video-kit/motion';
import {ease} from '@musiccharts/video-kit/brand';
import {springs} from '@musiccharts/video-kit/brand/tokens';

const {fps} = useFormat();
const y = kf(frame, [
  [cue, 80],
  [cue + 18, 0, ease.enter],
]);
const pop = spring01(frame, cue, springs.pop, fps); // 0 until cue, then springs to 1
const readyAt = cue + settle(springs.pop, fps); // when it stops moving
const delay = staggerIndex(i, n, 'center') * 2;
const camT = glide(progress(frame, moveStart, moveFrames)); // never fully stops
const sway = 6 * wave(frame / fps, 23); // a slow wander, 23 s per cycle
```

## Easing and keyframes

| Export                                                                                            | What it is                                                                                                        |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `linear`, `bezier(x1, y1, x2, y2)`, `inOutCubic`, `quintOut`, `expoOut`, `sineInOut`              | Easing functions (`bezier` is CSS's `cubic-bezier`)                                                               |
| `glide(t, floor = 0.12)`                                                                          | In-out cubic with a linear floor: the speed at either end is `floor` of the average, never zero                   |
| `keyed(frame, keys, mix, defaultEase?)`                                                           | Keyframes of any value: keys `{at, value, ease?}`; between two keys `mix(a, b, e)`, `e` eased by the arriving key |
| `kf(frame, keys)`                                                                                 | Number keyframes `[frame, value, easing?]`, the everyday case                                                     |
| `envelope(frame, inAt, inDur, outAt, outDur, easeIn, easeOut)`                                    | In, hold, out (durations in frames)                                                                               |
| `clamp`, `clamp01`, `mix`, `progress`, `smoothstep`, `mod`, `velocity`, `wave(t, period, phase?)` | Scalars; `wave` is a -1..1 sine with a period in the same unit as `t`                                             |

## Springs

The closed-form damped oscillator (Remotion's model). A spring is a
`SpringConfig` (`{damping, stiffness, mass}`); the brand's presets are
`springs.pop`, `springs.hero`, `springs.snap`, `springs.soft`,
`springs.wobble` and `springs.copy`.

| Export                                      | What it is                                                     |
| ------------------------------------------- | -------------------------------------------------------------- |
| `springAt(tSec, config, {from?, to?, v0?})` | Position `tSec` seconds after release                          |
| `spring01(frame, start, config, fps)`       | 0 until `start`, then toward 1                                 |
| `settle(config, fps, tolerance = 0.005)`    | Frames until the spring stays within `tolerance` of its target |

Write a spring that starts on a cue as `spring01(frame, at, config, fps)`,
never `frame < at ? 0 : springAt((frame - at) / fps, config)`; write a linear
ramp as `progress(frame, at, frames)`.

## Randomness, staggers, ballistics

| Export                                     | What it is                                                                                                             |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `rand(seed, ...keys)`, `rng(seed)`         | Deterministic [0, 1) values and streams from any seed                                                                  |
| `mulberry32(seed)`                         | The generator underneath, from a 32-bit number seed (audio noise uses it)                                              |
| `staggerIndex(i, n, from, seed?)`          | Order from `'start'`, `'end'`, `'center'`, `'edges'` or a seeded `'random'` shuffle (computed once per seed and count) |
| `ballistic(tSec, {vx, vy, gravity, drag})` | Closed-form flight with drag                                                                                           |

## Colour, geometry, lists, quads

| Export                                                                                       | What it is                                                                                                               |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `parseColor(c)`                                                                              | `[r, g, b, a]` from `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()`, `rgba()` or `transparent`; throws on anything else |
| `alpha(c, a)`, `mixColor(a, b, t)`, `lighten(c, t)`, `colorAt(frame, keys, crossfadeFrames)` | Colour math, returning `rgba()` strings                                                                                  |
| `Vec2`, `Rect`, `add`, `sub`, `scale`, `dist`, `norm`, `perp`, `lerp2`                       | Screen-space vectors and boxes (y down); `Rect` is the kit's one `{x, y, width, height}`                                 |
| `lowerBound(sorted, x)`, `sortedUnique(values)`                                              | Sorted number lists (event frames, hit times)                                                                            |
| `Point`, `Quad`, `mapQuad`, `offsetQuad`, `quadBounds`                                       | Screen quads                                                                                                             |
| `quadToQuadMatrix3d(from, to)`                                                               | The CSS `matrix3d` that maps one quad onto another (exact for a plane seen in perspective)                               |

## Rules

- motion imports nothing: not the brand, not the app, not Remotion. Named
  presets live in the brand, on top of it.
- Frames may be fractional; everything here is exact at any frame and in any
  order.
- Anything that counts frames takes `fps`; springs themselves are in seconds.
- Never `Math.random`: use `rand`/`rng` with a seed.
- A colour the parser cannot read is an error, not white.
