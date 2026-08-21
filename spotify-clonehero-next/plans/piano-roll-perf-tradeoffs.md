# Piano-roll perf: changes that would trade pixels for speed

A log of optimizations that are **not** safe to take silently, because they
change what the user sees. Everything landed so far renders byte-identical
output; these are the ones that need a human decision.

Measured on `/chart-editor` with 4 highways (Guitar·Expert, Bass·Expert,
Drums·Expert, Drums·Hard) on a real 4:10 chart, Chrome at 10x CPU throttling,
song position 0:20–0:52. Counts are per piano-roll draw and are reproducible
to within ~0.1% across runs at the same position.

## Reference: where a draw goes now

After the three landed fixes (binary-search tempo lookup, cached text widths,
guarded native `roundRect`):

| canvas call | per draw | ms per draw |
| ----------- | -------- | ----------- |
| `fill`      | 6,445    | 17.5        |
| `roundRect` | 5,419    | 9.7         |
| `fillText`  | 678      | 8.0         |
| `beginPath` | 7,036    | 5.2         |
| `fillRect`  | 2,534    | 4.1         |
| `lineTo`    | 2,555    | 1.6         |
| `stroke`    | 629      | 1.1         |
| `moveTo`    | 1,617    | 1.1         |
| `closePath` | 1,026    | 0.8         |
| `arcTo`     | 464      | 0.4         |

Total 49.5 ms of canvas calls per draw, at 4.09 draws/sec.

---

## 1. ALREADY LANDED — corner antialiasing on note glyphs

**This one is committed, and it is the single biggest win so far. Read it
first; back it out if you disagree with the trade.**

`roundRect()` in `draw.ts` now calls the native `ctx.roundRect()` instead of
tracing the same outline with four `arcTo` calls. That is what took `arcTo`
from 22,136 calls per draw down to 464, and it is most of the 33% drop in
canvas time per draw.

The two trace the **same geometry** — that part is guarded, and where the
radius would exceed half a side (very narrow glyphs, i.e. zoomed out) the old
`arcTo` path is kept, because there the outlines genuinely differ in shape.

What is **not** identical is the rasterization. Skia antialiases the corners
of a native round rect slightly differently from the equivalent `arcTo`
chain. Measured in Chrome 151, fresh canvas per render, with a
same-implementation control that showed zero differences:

- random in-guard shapes: **40 of 300 differ**, a handful of corner
  subpixels each
- real note-head geometry at dpr 2: about **1 in 20 differ**, worst case 36
  subpixels at up to ~24% alpha

So: no shape changes, no note moves, no colour changes. On roughly one glyph
in twenty, one or two corner pixels are a slightly different shade of the
same colour. I could not see it side by side, but it is a real difference and
I said "identical" earlier, which was wrong — my first check reused canvases
and hid it.

**Recommendation:** keep it. The cost is a sub-pixel shading difference on
glyph corners; the win is ~20,000 fewer canvas calls per draw. But it is your
call, and reverting is a one-line change (delete the `HAS_NATIVE_ROUND_RECT`
branch in `draw.ts`).

---

## 2. Batch note glyphs into one fill per colour

**Win: large — potentially most of the 17.5 ms in `fill` and the 5.2 ms in
`beginPath`.**

Every note head, halo and sustain tail is its own `beginPath` + shape +
`fill`, which is why there are ~6,445 fills per draw. Adding every glyph of a
given lane colour to a single `Path2D` and issuing one `fill()` per colour
would cut that to roughly one fill per lane.

Almost all of it is note heads. Of 2,129 rounded rects in one draw at a normal
zoom, 1,851 are the same shape: under 4 px wide, 13 px tall — one per visible
note across the four rows, none off-screen. Each costs a `beginPath`, a
`roundRect` and a `fill`, and at that size the fill is nearly all per-call
overhead rather than pixels.

**The trade:** this is pixel-identical for opaque shapes, but **not** where the
current code overlaps shapes at `globalAlpha < 1`. Today two overlapping
translucent shapes darken where they cross; batched into one path they would
fill once and not darken. Sustain tails under note heads, and the selection
halo behind a glyph, are exactly that case.

**Options:** batch only the plain opaque note heads — they are drawn at
`globalAlpha = 1`, one per lane per tick, so a per-lane batch is provably
identical and still collects the 1,851. Leave halos, ghosts and sustains as
individual fills.

**Recommendation:** worth doing, opaque groups only. Flagged here rather than
taken silently because getting the grouping wrong is a visible change.

---

## 3. Skip labels that are already covered by the next label

**Win: large — up to 7 of the 8 ms in `fillText`, plus the text shaping behind
it.**

Every text label whose x lands inside the viewport is painted, however little
room it has. At a normal zoom on this chart that is, per draw:

| label            | painted per draw |
| ---------------- | ---------------- |
| lyric syllables  | 253              |
| BPM markers      | 66               |
| bar numbers      | 21               |
| section names    | 13               |

253 lyric chips across a 1461 px lane is one label every ~5.8 px, so they
overlap into an unreadable smear — the same is true of the BPM lane, which is
why the tempo row reads as a solid blue band rather than as numbers. The
pixels are being paid for and then covered up.

**The trade:** track the right edge of the last label drawn in each lane and
skip any label that would start before it (or before it plus a small gap).
The lane then shows as many labels as actually fit, and nothing else.

This is a visible change, but it is very likely an improvement: today the
dense regions are illegible, and after the change they would show a readable
subset. It does mean a given syllable is not always on screen at low zoom,
which matters if someone is scanning for one — the chips are still hit-
testable either way, so only the painted text changes.

**Recommendation:** worth doing, but it changes what the lyrics and tempo
lanes look like, so it is your call. Would be the single largest remaining
piano-roll win after the fill batching.

---

## 4. Not pursued — these would change the product, not just pixels

Listed so it is clear they were considered and rejected:

- Pre-computing the whole chart's layout at load time. Faster playback, but
  buys it with a loading screen at open.
- Capping how many highways render at once, or dropping the piano roll's
  frame rate while more than N rows are visible.
- Reducing the piano roll's rendering resolution below the device pixel ratio.

None of these are on the table; they trade the editing experience itself
rather than a handful of antialiased pixels.
