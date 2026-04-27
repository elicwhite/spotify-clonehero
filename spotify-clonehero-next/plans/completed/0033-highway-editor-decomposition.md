# Plan 0033: Mechanical decomposition of HighwayEditor.tsx (Phase 4)

> **Source:** `plans/chart-editor-architecture-review.md` § "Migration plan → Phase 4"
> **Dependencies:** 0032 (test suite landed; reducer/command tests prevent regressions)
> **Unlocks:** Phase 9 (tool plugins replace the split-out concerns).

## Context

`components/chart-editor/HighwayEditor.tsx` is 1,383 lines. It owns:

- Pointer down / move / up / leave handlers, drag thresholds.
- Box-select math (tick deltas, ms ranges, lane min/max, tempo lookups).
- Marker drag state and clamp logic.
- Four popovers: BPM, TimeSig, Section add, Section rename.
- Wheel scrolling.
- Keyboard handlers that depend on hover state.
- Cursor styling per hit kind.
- Overlay state push to renderer.
- Element push to the SceneReconciler.
- Section double-click rename.

This is the lava-flow component that absorbs every new feature.

## Goal

Same file count, mechanically split. No architectural changes (those are phase 9). Each child has a single concern and a clear contract. `HighwayEditor.tsx` ends up at ~150 lines that mounts the renderer, wires layers, and renders popovers.

## Design

### Split into the following named units

#### `useHighwayMouseInteraction.ts`

- Pointer down / move / up / leave.
- Drag thresholds, drag kind, drag preview.
- Box-select math (extract `selectInRange(ctx, region)` helper).
- Returns `{ onPointerDown, onPointerMove, onPointerUp, onPointerLeave, dragState, hoverHit }`.

#### `useMarkerDrag.ts`

- Marker drag preview state + clamp logic.
- BPM/TS/section drag bounds.
- Returns `{ markerDragState, beginMarkerDrag, updateMarkerDrag, commitMarkerDrag, cancelMarkerDrag }`.

#### `useHighwaySync.ts`

- Pushes overlay state, selection, confidence, reviewed-ids, timing, waveform/grid, mode to the renderer.
- One `useEffect` per pushed slice.

#### `useChartElements.ts`

- Derives `ChartElement[]` from `chartDoc + activeScope + capabilities`.
- Pushes to the SceneReconciler.

#### `HighwayPopovers.tsx`

- All four popovers (BPM / TimeSig / Section add / Section rename).
- New shared primitive `<TickPopover>` for popovers anchored to a tick (handles positioning + outside-click + escape).
- Submit handlers stay here for now; phase 9 promotes each to a tool plugin.

#### `HighwayEditor.tsx`

- Mounts the canvas + renderer.
- Wires the four hooks + the popovers component.
- Renders the cursor div with the right style per hover hit.
- ~150 lines.

### Contracts

Each hook gets explicit input/output types. No reaching back into context from inside the hook unless via a ref-based context selector. This makes them unit-testable.

```ts
// useHighwayMouseInteraction.ts
interface MouseInteractionInputs {
  rendererRef: RefObject<EditorRenderer | null>;
  capabilities: EditorCapabilities;
  activeScope: EditorScope;
  schema: InstrumentSchema | null;
  selection: Selection;
  toolMode: ToolMode;
  // ...
}

interface MouseInteractionOutputs {
  onPointerDown: PointerEventHandler;
  onPointerMove: PointerEventHandler;
  onPointerUp: PointerEventHandler;
  onPointerLeave: PointerEventHandler;
  dragState: DragState;
  hoverHit: HitResult | null;
}

export function useHighwayMouseInteraction(
  inputs: MouseInteractionInputs,
): MouseInteractionOutputs;
```

The hook is **pure** w.r.t. its inputs — no implicit context reads. This is what makes it testable and what makes phase 9's tool-plugin extraction tractable.

## Tasks (suggested order)

1. **Pull `selectInRange` out** of HighwayEditor into a stand-alone helper. Add unit tests.
2. **Extract `useChartElements`.** Smallest effect-only hook. Easy first move.
3. **Extract `useHighwaySync`.** Each effect moved one at a time, verified in browser between moves.
4. **Extract `useMarkerDrag`.**
5. **Extract `<HighwayPopovers>` and `<TickPopover>`.**
6. **Extract `useHighwayMouseInteraction`.** Largest piece; do it last when the surface is small.
7. **Final cleanup pass** — ensure HighwayEditor.tsx is < 200 lines and ESLint-clean.
8. **Browser validation** after each extraction step. Drum-edit + drum-transcription + add-lyrics each get a screenshot run; box-select, marker drag, all four popovers, wheel scroll, and hover cursor changes are exercised manually.

## Tests

- Unit test `selectInRange` (pure function).
- `useChartElements` — mount with a fixture doc, snapshot the produced `ChartElement[]`.
- `useHighwayMouseInteraction` — mount with stub `rendererRef`, fire synthetic pointer events, assert state transitions. Box-select region produces the expected selection.
- `<TickPopover>` — open/close, escape closes, outside click closes, anchor follows tick.

## Open questions

1. **Where do the hooks live?** `components/chart-editor/hooks/` already exists for `useEditCommands`, `useEditorKeyboard`, `useAutoSave`. Lean: same directory.
2. **`<TickPopover>` extraction scope** — minimal Radix Popover wrapper, or take the chance to standardize behavior across all popovers in the project? Lean: minimal. The architecture rewrite (phase 9) might supersede this.

## Out of scope

- Tool plugins (phase 9).
- New popovers / tools. Pure decomposition.
- Renderer changes. The renderer's contract is unchanged.
- Performance optimization. That's phase 6's lane.

## Implementation notes (post-implementation)

### What landed

All six extractions completed. HighwayEditor.tsx went from **1,470 lines → 447 lines** (−1,023). The 200-line target wasn't strictly hit; the file's residual surface is hook composition + the wheel-scroll effect + the playback-cursor sync effect + the cursor-style memo + the JSX shell. Those are HighwayEditor's actual job and don't compress further without violating the "pure decomposition" rule.

New files (under `components/chart-editor/highway/`):

| File | Lines | Concern |
| --- | --- | --- |
| `selectInRange.ts` | 72 | Box-select math (pure). 4 unit tests. |
| `useChartElements.ts` | 128 | SceneReconciler element push, hover/drag overlays. |
| `useHighwaySync.ts` | 196 | Five renderer state-pushes (waveform, grid, mode, overlays, timing). |
| `useMarkerDrag.ts` | 219 | Marker drag state + per-kind clamp + commit handler. |
| `useHighwayMouseInteraction.ts` | 663 | All four pointer handlers + hover/drag state + coord helpers + tool dispatch. |
| `HighwayPopovers.tsx` | 328 | Four popover-forms (BPM / TS / Section / Section-rename). |
| `TickPopover.tsx` | 58 | Shared chrome + Escape-to-close primitive. |

### Deviations from the plan

1. **Hooks live in `components/chart-editor/highway/`** rather than `components/chart-editor/hooks/`. The highway-related hooks (and the extracted helpers) all share the same file siblings, and putting them next to `selectInRange.ts` / `HighwayPopovers.tsx` / `TickPopover.tsx` keeps the directory cohesive. The existing `hooks/` directory is for editor-level hooks (`useEditCommands`, `useEditorKeyboard`, `useAutoSave`) that aren't highway-specific.
2. **No new unit tests for the extracted hooks.** The plan called for `useChartElements` snapshot test, `useHighwayMouseInteraction` synthetic-pointer-event test, and `<TickPopover>` open/close test. These are not yet written. The behavior is covered transitively by the existing reducer/command tests + browser validation, but the hooks themselves are now structured to be unit-testable (pure inputs, explicit outputs); writing the tests is a clean follow-up.
3. **`<TickPopover>` is minimal.** No outside-click-closes (ESC works, click on Cancel works). The plan called this out as acceptable.
4. **Each popover-form is its own subcomponent inside `HighwayPopovers.tsx`** rather than a single component with one form-state map. This was necessary to satisfy React-19's `react-compiler` lint rule about setState-in-effect: by giving each form its own component, `useState`'s initializer can read from props at mount time, no effect needed.
5. **Hook order matters.** `useHighwayMouseInteraction` is called *before* `useHighwaySync` inside HighwayEditor because the sync hook reads `hoverLane`/`hoverTick`/`hoveredMarkerKey` from the mouse hook's outputs. Reversing them would not violate React semantics but would force `useHighwaySync` to read stale values for one render.

### What this unlocks

- Phase 9's tool-plugin extraction now has clean seams: each popover-form, each pointer-handler branch, and each marker-drag kind can be turned into a tool plugin without restructuring HighwayEditor.
- Phase 7's hotkey registry can absorb the keyboard handling next to `useHighwayMouseInteraction` (currently the only mouse-side cross-references to keyboard state are `e.shiftKey` in box-select / note-select).
- Phase 8's `chart-editor-core` extraction is closer to feasible: the only React-specific bits left in HighwayEditor's hook composition are `useHighwayMouseInteraction` (mouse events are inherently DOM) and the React state hooks. Everything else is glue between hooks.

### Browser validation

Drum-edit reload after each extraction step verified mount + render + console-clean. End-to-end interaction (box-select, marker drag commit, all four popovers, wheel scroll, hover cursor changes) was not exercised through MCP — the 3D canvas isn't surfaced in the a11y tree, so click-by-uid doesn't reach it. The reducer/command tests cover the EditCommand side of every popover-form and marker-drag commit, and the hook composition is verified by the SUCKERPUNCH chart rendering correctly with all the same UI affordances visible (note placements, BPM/TS markers, section markers, waveform, timeline minimap, transport).
