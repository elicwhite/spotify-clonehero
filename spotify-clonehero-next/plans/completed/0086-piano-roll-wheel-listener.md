# 0086 — One non-passive wheel listener for the piano roll

Status: todo

Split out of plan 0083, which had bundled it as "Phase 0". It shares no code
with tap tempo beyond living in the same file, and it is a one-commit bug fix.

---

## 1. The problem

`PianoRollTimeline` attaches one **non-passive** native wheel listener, on the
stacked-rows scroll container (`stackedRowsScrollRef`,
`{capture: true, passive: false}`). It also passes React wheel props on four
JSX nodes: `onWheel` on the stacked top canvas, the stacked waveform canvas and
the single-canvas layout, and `onWheelCapture` on the stacked rows scroll div.
All four route to `handleWheel`, which calls `e.preventDefault()`.

React 19 attaches `wheel` listeners on the root container **passively**, for
both phases. From
`node_modules/react-dom/cjs/react-dom-client.production.js:12390-12405`:

```js
!passiveBrowserEventsSupported ||
  ('touchstart' !== domEventName &&
    'touchmove' !== domEventName &&
    'wheel' !== domEventName) ||
  (listenerWrapper = !0); // passive: true
```

So every `preventDefault()` from a React `onWheel`/`onWheelCapture` is a no-op
and logs `Unable to preventDefault inside passive event listener invocation`.
Consequences, in order of severity:

1. **Zoom/pan is probably applied twice in the stacked layout.** React's
   capture-phase dispatch happens at the root container, an ancestor of the
   scroll div, so `onWheelCapture={handleWheel}` runs _before_ the
   element-level native capture listener. The native listener then runs
   `applyWheel` a second time on the same event; its `stopPropagation()` cannot
   undo the earlier call. This is derived from listener ordering, not observed
   — measure it first (a temporary counter in `applyWheel`, or simply count
   zoom steps per notch in the stacked layout).
2. **The page scrolls / the browser zooms** where `preventDefault` was meant to
   stop it. The single-canvas layout has no native listener at all, so its
   wheel default is never actually prevented.
3. Console noise.

---

## 2. The fix

Delete all four React wheel props and the element-scoped effect on
`stackedRowsScrollRef`. Replace with a single non-passive **capture-phase**
listener on `containerRef` — the wrapper div that contains every canvas and the
stacked scroll container:

```ts
useEffect(() => {
  const el = containerRef.current;
  if (!el) return;
  const onWheel = (event: WheelEvent) => {
    // The context menu / tap popover render inside this container and can
    // scroll themselves when `computeContextMenuPlacement` clips them.
    // An ancestor capture listener must not eat their wheel events.
    const target = event.target;
    if (target instanceof Node && overlayRef.current?.contains(target)) return;
    const rect = el.getBoundingClientRect();
    if (
      !applyWheel(
        event.clientX - rect.left,
        event.deltaX,
        event.deltaY,
        event.shiftKey,
      )
    )
      return;
    event.preventDefault();
  };
  el.addEventListener('wheel', onWheel, {capture: true, passive: false});
  return () => el.removeEventListener('wheel', onWheel, {capture: true});
}, [applyWheel]);
```

**The overlay bail is load-bearing, not defensive.** `ContextMenuPopover` is
rendered inside `containerRef` (the `{menu && …}` block is a child of the
`ref={containerRef}` div) and it sets `overflowY: 'auto'` whenever
`computeContextMenuPlacement` returns a `maxHeight`. Today no wheel handler
covers it, so a clipped menu scrolls natively. A container-capture listener
without the bail would zoom the piano roll instead and the menu would never
scroll. `applyWheel` returns `true` (→ `preventDefault`) even when
`sceneRef.current` is null, so the bail cannot be left to `applyWheel`.

Implementation of the bail: give `ContextMenuPopover` a forwarded ref, or wrap
the overlay block in a `<div ref={overlayRef} className="contents">`. The
wrapper is the smaller change and keeps the shared component untouched; take
that unless it breaks the popover's absolute positioning, in which case forward
the ref.

Why capture on the container rather than bubble on each canvas: the stacked
rows live in an `overflow-auto` div, and only an ancestor capture listener can
`preventDefault()` _before_ that div consumes the wheel as a native scroll —
which is what the existing element-level listener was working around. One
listener, one `applyWheel` call per event, and `stopPropagation` is no longer
needed anywhere.

The x-coordinate changes from `e.nativeEvent.offsetX` (target-relative) to
container-relative. For the canvases these are the same, since each canvas
spans the container's width and starts at its left edge; the existing native
listener already computed it this way. `applyWheel`'s gutter bail
(`rawX < STACKED_GUTTER_W` → return `false` → no `preventDefault`) keeps the
track-list gutter natively scrollable, unchanged.

Keep the effect inline. A `useNonPassiveWheel(ref, applyWheel)` extraction is
worth it once a second surface needs it; one call site does not justify the
indirection.

**Alternative rejected:** keeping the React props and dropping
`preventDefault()`. That silences the warning by giving up the behaviour —
ctrl+wheel would zoom the browser and the page would scroll under the piano
roll.

---

## 3. Test plan

There is no unit test for a DOM listener's passiveness that is worth its
maintenance cost here; this is a browser-verified fix.

Browser QA (chrome-devtools MCP, per CLAUDE.md): `new_page` first, then
`/chart-editor`, `upload_file`
`public/All Time Low - SUCKERPUNCH (Hubbubble).sng`.

1. Wheel and shift-wheel over each region: stacked top canvas, stacked rows,
   waveform row, single-canvas layout, and the track-list gutter (which must
   still scroll natively).
2. Count zoom steps per notch in the stacked layout — exactly one. Compare
   against a pre-fix measurement to confirm or refute the double-apply.
3. Open the tempo-lane context menu somewhere it gets clipped (right-click near
   the bottom of the viewport) and wheel over it: the menu scrolls, the piano
   roll does not zoom.
4. `list_console_messages` clean; in particular the passive-listener warning is
   gone.

---

## 4. Note on landing order

`PianoRollTimeline.tsx` is being decomposed by a separate in-flight effort.
Apply this wherever the wheel handling has landed by then. It is independent of
plans 0083 and 0085 and can go in any order relative to them.
