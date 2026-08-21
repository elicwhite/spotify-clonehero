# Piano-roll perf: changes that would trade pixels for speed

A log of optimizations that are **not** safe to take silently, because they
change what the user sees, and of what it would actually take to hit 60fps
under 10x CPU throttling.

Measured on `/chart-editor` with 4 highways (Guitar·Expert, Bass·Expert,
Drums·Expert, Drums·Hard) on a real 4:10 chart, Chrome at 10x CPU throttling,
playing from 0:18, in a ~36s trace window.

## Where it stands

| | piano-roll draw | highway frame |
| --- | --- | --- |
| before any of this work | 58.2 ms | 71.5 ms |
| now | **20.1 ms** | **21.2 ms** |

About 3x on both. A 60fps budget under 10x throttling is 16.6 ms for
*everything* in the frame; the two together are ~41 ms, so the target is
still ~2.5x away. See "What 60fps would actually take" at the bottom.

## Where a draw goes now

Share of the trace window, by the nearest app-level frame:

| | share |
| --- | --- |
| `draw` (highway, all 4 panes) | 16.6% |
| `copyCanvasRegion` (piano roll) | 10.3% |
| `paintFretGlyph` | 9.1% |
| `drawLyricsRow` | 7.3% |
| `roundRect` | 5.3% |
| `tick` (highway animated textures) | 4.6% |
| `drawNotes` | 3.0% |

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

## 2b. ALREADY LANDED — an unpainted frame after a very large scroll jump

**Also committed. Smaller than item 1, and the risk is narrower, but it is a
behaviour change under stress rather than a pure win.**

The stacked rows band only paints rows inside its scrolled slice plus a
screenful of margin either side. The band scrolls on the compositor, so a
frame can be composited at an offset the last draw never saw — the margin is
the lookahead that covers it.

A scroll that jumps further than a screenful between repaints would bring
unpainted rows into view for a frame, showing empty lanes until the next
draw. In practice:

- the band's scrollbar is hidden (`no-scrollbar`), so scrolling is trackpad
  and wheel only, which arrives incrementally
- nothing in the app scrolls the band programmatically
- a fast flick on a heavily loaded machine is the one case that could
  outrun it, and only for a frame

**If you would rather not have that at all:** widen the margin (cheap, costs
the rest of the saving) or drop the row skipping. The saving here is 49.6ms →
46.2ms per draw with four highways, growing with the number of rows held off
screen — so it is worth more to someone with six or eight highways open than
to the four-highway case it was measured on.

---

## 3. Not pursued — these would change the product, not just pixels

Listed so it is clear they were considered and rejected:

- Pre-computing the whole chart's layout at load time. Faster playback, but
  buys it with a loading screen at open.
- Capping how many highways render at once, or dropping the piano roll's
  frame rate while more than N rows are visible.
- Reducing the piano roll's rendering resolution below the device pixel ratio.
- Thinning out the lyric, tempo or section labels when they crowd together.
  Scrolling and zooming around the chart is the main thing the panel is for,
  and a label that disappears at some zooms is worse than a crowded lane.

None of these are on the table; they trade the editing experience itself
rather than a handful of antialiased pixels.

---

## What 60fps under 10x throttling would actually take

A 16.6 ms budget for the whole frame. The two renderers currently spend ~41 ms
between them, and the remaining safe, invisible optimizations do not close
that. Adding up every one still on the table:

| | worth |
| --- | --- |
| Drawing the bands straight into their canvases, deleting the offscreen copy | ~10% |
| Batching opaque note heads into one fill per lane | ~5% |
| Sharing the highway's animated textures across the four panes | ~5% |
| Pooling the Object3Ds the reconciler allocates every frame | ~1% |

That is roughly another 20%, landing near 33 ms. Still twice the budget.

Getting the rest means changing *when* pixels are produced, not how fast:

**Scroll-blit the piano roll.** During playback and scrolling the view
translates horizontally: almost every pixel of the next frame is the previous
frame shifted sideways. Copying the previous frame by the scroll delta and
repainting only the newly exposed strip makes a frame cost scale with how far
it moved rather than with how much is on screen — plausibly 5-10x on the
panel, and it is the case the panel is used in most.

The catch is that the shift has to land on whole device pixels, so the view's
left edge would snap to a half-CSS-pixel grid at dpr 2 instead of moving
continuously. At that size it should be invisible, and arguably crisper, but
it is a real change to how scrolling looks and it is the kind of thing that
has to be looked at rather than argued about. Zooming still costs a full
repaint, which is correct — the geometry genuinely changes.

**The highway needs its own pass.** It is 4 panes rendered from one shared
`THREE.Scene`, so every pane's render traverses all four panes' objects, and
each pane owns a duplicate set of animated textures it ticks and uploads
separately. Fixing both is mechanical but it is a day's careful work, not an
afternoon's.

Below ~30fps at 10x throttling the honest answer may be that four WebGL
highways plus a full-width 2D panel is more than the budget allows, and the
lever left is resolution rather than algorithms.
