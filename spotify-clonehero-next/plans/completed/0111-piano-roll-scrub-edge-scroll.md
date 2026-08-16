# 0111 — The piano-roll scrub drag scrolls at the viewport edges

Status: completed

Drag the playhead to the left or the right border of the piano roll and the
drag stops there. The view does not move. To scrub past the visible window the
user must release, wheel-pan, and grab the playhead again.

Every timeline the user already knows — a DAW, a video editor — scrolls the
view when a drag reaches an edge. This plan adds that.

## What was missing

The panel had no edge auto-scroll for any gesture. `panByPx` had exactly one
caller, `applyWheel`. Nothing moved `view.leftMs` on a pointer move.

Follow-during-playback (`followLeftMs`) does not cover this: it is skipped
while `scrubbingRef.current` is true, and `view.follow` is set to false the
moment a scrub gesture starts.

## The shape

A held pointer sends no further `pointermove` events, so the pan cannot come
from `handlePointerMove` — a pointer parked at the edge would scroll one step
and stop. The pan comes from the frame loop, which already runs at 60fps for
the whole duration of any non-idle gesture (`isActive()`).

1. `viewMath.ts` — `edgeScrollDeltaPx({pointerX, viewportWidth, dtMs})`, pure.
   Returns 0 in the middle of the viewport. Inside a 56px edge band the speed
   ramps from 0 to `EDGE_SCROLL_MAX_PX_PER_MS` (0.9 px/ms) at 120px past the
   edge, then saturates. The result is multiplied by the frame time, so the
   scroll rate does not change with the frame rate. On a viewport too narrow
   for two bands each band takes half the width, so they never overlap into a
   dead zone that always scrolls.
2. `PianoRollTimeline.tsx` — `scrubPointerXRef` holds the live pointer x of an
   in-flight scrub (pointer capture keeps the events coming after the pointer
   leaves the canvas, so the value goes negative or past the width, which is
   what drives the ramp). The frame loop calls `edgeScroll()` when the pointer
   mode is `scrub`: it pans the view, then re-seeks to the ms now under the
   stationary pointer. That re-seek is what carries the playhead with the view
   and keeps it under the user's finger.
3. The ref is cleared in `endPointer` and in `cancelInFlightGesture`, next to
   `scrubbingRef`.

The scroll stops on its own at the song ends, because `panByPx` clamps
`leftMs` and the step is dropped when the clamp returns the same value.

## Scope

Scrub only. Note drag, marquee, loop flags, section flags, and lyric chips
still have no edge scroll; they read the same pointer x and could reuse
`edgeScrollDeltaPx` later.

## Verification

`components/chart-editor/piano-roll/__tests__/viewMath.test.ts` covers the
neutral middle, the direction of each band, the depth ramp and its saturation,
frame-time proportionality, a zero frame time, and the narrow viewport.
