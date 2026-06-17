# Plan 0040: Unified scene interaction architecture

> **Dependencies:** 0033 (HighwayEditor decomposed)
> **Unlocks:** 0034 (entity coverage expansion), 0037 (`EntityAdapter`/`EditorProfile`/`ChartOperation`)
> **Ships in:** 3 PRs along natural seams (renderer-side, editor-side, API surface).

## Context

Two parallel paths produce the same hover/select visual today.

**Notes:** mouse → `InteractionManager.hitTest` → `noteRenderer.setHoveredNoteId(id)`. The renderer holds a single `hoveredId`, applies a tint to the matching sprite, no reconciler involvement. Element data never carries hover state.

**Markers** (sections, lyrics, phrase-start/end): mouse → `setHoveredMarkerKey` React state → `useChartElements` re-emits the element list with `data.isHovered = true` → `setElements` diffs the data, recycles the old group, recreates with a different texture. Selection rides the same path. Drag rides the same path **and** rewrites `msTime`, so the dragged marker recycles on every mouse move.

The reconciler exposes `setHoveredKey`/`setHoverChangeCallback` and `setSelectedKeys`/`setSelectionChangeCallback` already, with no production caller. The recent `d75c40b` revision-counter fix masked the cache-staleness symptom but left the underlying recycle storm in place.

Beyond the marker bug, the inline `switch (hit.type)` in `useHighwayMouseInteraction` doesn't scale. Almost every interactive entity on the highway needs hover, select, drag, inline-edit, and/or delete: notes, sections, lyrics, phrase markers, BPM, time signatures, star-power phrases, solo phrases, drum activations, drum flex lanes (the latter five land in plan 0034). We need one consistent way to declare what each kind affords and one consistent way to push transient state to the renderer.

## Goal

1. Element data describes only **what exists**: text, color, lane, length, msTime. No `isHovered`, no `isSelected`.
2. The reconciler owns **transient visual state** (hover, selection) via side channels and dispatches changes to renderers in place — no recycle on hover/select toggle.
3. `ElementRenderer` exposes optional `setHovered` / `setSelected` hooks so each kind owns its own visual transition.
4. Drag continues to flow through element data (live `msTime` updates), but `dataEqual` ignores `msTime` so positional-only changes are reposition-only — no recycle mid-drag.
5. Each entity kind declares **purely declarative** affordances (`hoverable`, `selectable`, `deletable`, `inlineEditable`, `laneAxis`). Behavior (which popover opens, which command runs on delete) lives on the tool, not the affordance.
6. A single `hovered: {kind, id} | null` in the editor reducer is the source of truth — the only place that pushes into `reconciler.setHoveredKey`. Mouse interaction and drag both write to it; effects don't fight.

## Non-goals

- **Does not unify drag implementations.** Marker drag still goes through `useMarkerDrag`; note drag still goes through `MoveEntitiesCommand`. The affordance registry only declares _whether_ a kind is interactive — it does not implement drag.
- **Does not introduce `EntityRef`.** Plan 0037 commits to a structured `{kind, scope, key}` ref. Introducing a third shape (`{kind, key, tick}`) here would force 0037 to re-change it. Instead, keep `HitResult` in its current discriminated-union form and add `kindOf(hit)` / `keyOf(hit)` helpers that 0037 can swap out for the structured ref later.
- **Does not change the selection store key format.** Selection state continues using its current opaque per-kind ids (`tick:type`, `tick`, `lyricId`, etc.). A single `reconcilerKeyFor(kind, id, partName?)` utility translates between selection ids and reconciler keys.
- **Does not unify `EditorCapabilities` and `EditorProfile`.** That's plan 0037. For now, `EditorCapabilities` continues to filter which kinds are exposed; `EntityAffordance` declares per-kind interactivity; the two compose at lookup time (`editor exposes kind && affordance.X`).
- **Does not touch `EditorMCPTools`.** MCP commands bypass the affordance path entirely; they go straight to commands. A future MCP tool that wants to drag an entity would consult the affordance — out of scope here.

## Design

### 1. ElementRenderer hooks (`SceneReconciler.ts`)

```ts
interface ElementRenderer<T = unknown> {
  create(data: T, msTime: number): THREE.Group;
  recycle(group: THREE.Group): void;
  /** In-place hover transition. Renderer owns the visual. */
  setHovered?(group: THREE.Group, hovered: boolean): void;
  /** In-place selection transition. Renderer owns the visual. */
  setSelected?(group: THREE.Group, selected: boolean): void;
}
```

Renderers without the hooks fall back to the recycle path: any kind whose `data.isHovered`/`data.isSelected` change still recycles. This is graceful degradation, not a target — every renderer in this repo migrates as part of the plan.

The existing `setHoverChangeCallback` / `setSelectionChangeCallback` API gets removed from the reconciler. The only consumers are tests (`SceneReconciler.test.ts:605-707`); migrating those is task 2.

### 2. Reconciler dispatches transient state

- **Drop `a.msTime !== b.msTime` from `dataEqual`.** Drag-induced and tempo-edit-induced msTime updates become reposition-only; `updateWindow` already reads `el.msTime` to set `group.position.y`.
- **`setHoveredKey(key)`**: diff against previous; call `renderer.setHovered(oldGroup, false)` and `renderer.setHovered(newGroup, true)` for affected groups.
- **`setSelectedKeys(keys)`**: diff leavers/joiners; call `renderer.setSelected` per group.
- **`updateWindow` (group entry)**: when a group enters the window, reapply current hover/selection state via the renderer hooks. This is the third dispatch site (alongside `setHoveredKey` and `setSelectedKeys`); easy to forget.

**`dataEqual` invariants** (audit before task 1):

- No renderer caches `msTime` outside `group.position.y`. `MarkerRenderer.create` doesn't read msTime ✓. `NoteRenderer.create` reads `data.msLength` (in element data, not msTime) ✓.
- A renderer that adds new msTime-derived state must either (a) recompute it in `updateWindow` or (b) expose its own `setMsTime(group, ms)` hook — same pattern as hover/select.
- **`sortedElements` is not stable across emits.** Re-sorted on every `setElements`. Consumers (`updateWindow`'s binary search, `getElements()`) tolerate sort changes mid-frame and must not cache indices across emits. Document this so future refactors don't introduce a hidden dependency.

### 3. MarkerRenderer in-place hover/select (`MarkerRenderer.ts`)

The existing `createMarkerTexture` cache is keyed by `${text}:${color}:${isSelected}:${isHovered}` and lives at module scope. Pre-baking all four variants up front for every marker would multiply unique entries 4× and amplifies the existing no-eviction memory ratchet on long sessions.

**Lazy-bake instead:**

```ts
// Stash a lazy getter, not a baked texture.
sprite.userData.textures = {
  rest: restTexture,
  hover: () => createMarkerTexture(text, color, false, true),
  selected: () => createMarkerTexture(text, color, true, false),
  selectedHover: () => createMarkerTexture(text, color, true, true),
};
sprite.userData.state = {hovered: false, selected: false};
```

`setHovered(group, on)` and `setSelected(group, on)` mutate `userData.state`, resolve the getter for the current `(hovered, selected)` quad on demand (replacing the entry with the cached texture once baked), set `material.map = currentTexture`, and `material.needsUpdate = true`. Steady-state memory matches today; a marker that's never hovered or selected only holds the rest texture. `recycle` does nothing special: the getter and any baked entries on `userData` go to GC with the group; the shared module-level `textureCache` retains its entries (existing pre-existing memory behavior).

Drop `isHovered` and `isSelected` from `MarkerElementData` entirely. `MarkerElementData` becomes `{ text: string; stackIndex?: number }` — exactly the fields `chartToElements` already produces.

### 4. NoteRenderer in-place hooks

`NoteRenderer.updateSelectionHighlight` already mutates the existing rendered note in place. Refactor:

- Expose `setHovered(group, on)` and `setSelected(group, on)` per-group methods.
- Drop the renderer-side `hoveredNoteId` and `selectedNoteIds` bookkeeping; the reconciler owns those now.
- **Confidence rings and review indicators stay on `setConfidenceData`/`setReviewedNoteIds`.** They're not hover/select; they're separate cosmetic overlays driven by `useHighwaySync`. Task 4 only touches the hover/select code paths.

`NotesManager` has parallel `setHoveredNoteId`/`setSelectedNoteIds` methods. `useHighwaySync.ts:171` and `useHighwayMouseInteraction.ts:472` both target `noteRendererRef`, not `notesManagerRef`. The `NotesManager` setters appear to be dead in the live editor path. Verify by `grep -rn "notesManager\.set"`; if no live callers, delete them as a free win for the migration. If they're alive (e.g. behind a feature flag), apply the same hook refactor there.

### 5. Selection ↔ reconciler key contract

The selection store is `Map<EntityKind, Set<string>>` keyed by per-kind opaque ids:

| kind         | selection-store key (today)    | reconciler key (today)    |
| ------------ | ------------------------------ | ------------------------- |
| note         | `2880:yellowDrum`              | `note:2880:yellowDrum`    |
| section      | `2880`                         | `section:2880`            |
| lyric        | `2880:harm1`                   | `lyric:harm1:2880`        |
| phrase-start | `phraseStartId(2880, 'harm1')` | `phrase-start:harm1:2880` |
| phrase-end   | `phraseEndId(3360, 'harm1')`   | `phrase-end:harm1:3360`   |

These are not the same string. Reading a `Set<string>` from selection state and passing it directly to `reconciler.setSelectedKeys` would highlight nothing for notes (and silently work for sections by accident).

Resolution:

- **Selection state keeps its current format.** All commands and reducer paths use the opaque id; this plan does not change that.
- **A single utility `reconcilerKeyFor(kind, id, partName?)` is the only place that maps between them.** Introduced in PR 2 (it's a pure utility — `useChartElements`'s hover/select push effects need it before the affordance registry exists). Promote the existing `markerHoverReconcilerKey` (in `useHighwayMouseInteraction.ts`) and `markerDragReconcilerKey` (in `useChartElements.ts`) into this util. Add a note path: `reconcilerKeyFor('note', '2880:yellowDrum') === 'note:2880:yellowDrum'`.

**`partName` semantics.** The `partName` parameter is required and load-bearing for `lyric | phrase-start | phrase-end` (vocal scope is part-namespaced). It is **ignored** for `note | section | bpm | ts` (chart-wide kinds). Callers may pass `partName` unconditionally — the helper safely ignores it on chart-wide kinds. The §5 effect pseudocode below relies on this:

```ts
useEffect(() => {
  const reconcilerKey = hovered
    ? reconcilerKeyFor(hovered.kind, hovered.id, partName)
    : null;
  reconciler.setHoveredKey(reconcilerKey);
}, [hovered, partName]);

useEffect(() => {
  const reconcilerKeys = new Set<string>();
  for (const [kind, ids] of selection) {
    for (const id of ids)
      reconcilerKeys.add(reconcilerKeyFor(kind, id, partName));
  }
  reconciler.setSelectedKeys(reconcilerKeys);
}, [selection, partName]);
```

Today `partName` is always `'vocals'` by default in non-vocal scopes (passed unconditionally from `HighwayEditor`); that's fine.

Add a unit test that exercises the round-trip per kind, including the part-namespaced kinds. This is the single most likely silent-failure mode of the plan.

### 6. Hovered-key state lives in the editor reducer

Today there are two places that hold "what's hovered":

- `hoveredMarkerKey` in `useHighwayMouseInteraction`'s local state.
- `hoveredNoteId` inside `NoteRenderer`'s instance state.

After this plan, **both go away** in favor of a single `hovered: { kind: EntityKind; id: string } | null` field on `ChartEditorState`. The mouse-interaction hook dispatches `{type: 'SET_HOVER', hovered}`; drag begin/end also dispatch (drag start = `SET_HOVER` to the dragged entity; drag end = whatever the next mousemove resolves to). One effect (in §5) translates to a reconciler key and pushes once.

**Mouse handler does not dispatch `SET_HOVER` during an active drag.** While `markerDrag` is set or `isDragging` (multi-note drag) is true, `onMouseMove` skips the `SET_HOVER` dispatch. The dragged entity remains hovered until commit/cancel; on the next `onMouseMove` after commit, `SET_HOVER` is dispatched normally based on the resolved hit. This is the existing `!markerDrag` guard, relocated and named explicitly so the dragged-bright visual doesn't flicker as the cursor passes over other markers mid-drag.

Two effects pushing to `setHoveredKey` from different sources (mouse vs drag) is a race. One reducer field eliminates it.

### 7. EntityAffordance is purely declarative

```ts
interface EntityAffordance {
  kind: EntityKind;
  hoverable: boolean;
  selectable: boolean;
  deletable: boolean;
  /** Has an inline editor (popover for rename/edit value). Tool decides when to invoke. */
  inlineEditable: boolean;
  /** Drag changes the lane in addition to the tick. Notes only today. */
  laneAxis: boolean;
}

const AFFORDANCES: Record<EntityKind, EntityAffordance> = {
  note: {
    kind: 'note',
    hoverable: true,
    selectable: true,
    deletable: true,
    inlineEditable: false,
    laneAxis: true,
  },
  section: {
    kind: 'section',
    hoverable: true,
    selectable: true,
    deletable: true,
    inlineEditable: true,
    laneAxis: false,
  },
  lyric: {
    kind: 'lyric',
    hoverable: true,
    selectable: true,
    deletable: true,
    inlineEditable: true,
    laneAxis: false,
  },
  'phrase-start': {
    kind: 'phrase-start',
    hoverable: true,
    selectable: true,
    deletable: true,
    inlineEditable: false,
    laneAxis: false,
  },
  'phrase-end': {
    kind: 'phrase-end',
    hoverable: true,
    selectable: true,
    deletable: true,
    inlineEditable: false,
    laneAxis: false,
  },
};
```

**No `onDoubleClick`, no `onDelete`, no `draggable: 'whole' | 'endpoint-*'` enum, no `endpointAlias`.** Reasons:

- `onDoubleClick`/`onDelete` mix declarative metadata with controller behavior. They'd force `affordances.ts` to import commands, popover state types, and dispatch — making the registry a controller, not data. Plan 0037's `EntityAdapter` is the right home for behavior; the affordance only carries metadata.
- `draggable` enum was a workaround for "is this entity an endpoint of a length-bearing object." That's a property of the entity _kind_, not its drag affordance. Plan 0037's structured ref handles paired entities cleanly; encoding the same workaround here would just need to be re-changed.
- `endpointAlias` would mark `phrase-end` as the partner of `phrase-start`, but no code in this plan consumes it. Reintroduce it in plan 0034 alongside the consumer (e.g. a `getEndpointSibling(kind)` util used by drag clamping for length-bearing entities).
- `EditorCapabilities.draggable` already exists and is profile-specific; affordances don't need to duplicate it.
- Tools (`SelectMoveTool`, `EraseTool`, `BPMTool`, etc.) own the actual handlers. Plan 0038 envisions exactly this. A double-click on a section in `SelectMoveTool` consults `affordances[section].inlineEditable`, then opens the popover via `ctx.openPopover(...)`. Different tool → different behavior on the same affordance.

### 8. Table-driven mouse interaction (`useHighwayMouseInteraction.ts`)

Replace the per-tool/per-kind switch with affordance lookup:

```
onMouseDown(e):
  hit = hitTestAt(e)
  if !hit?.entity: handleEmptyHighway(tool, hit, e); return
  affordance = AFFORDANCES[hit.kind]
  if !profile.exposes(hit.kind): return  // current EditorCapabilities filter

  if tool === 'cursor':
    if affordance.inlineEditable && isDoubleClick(hit): openInlineEditor(hit); return
    if affordance.selectable: dispatchSelect(hit, e.shiftKey)
    if affordance.selectable && existingDragHandlerFor(hit.kind): beginDrag(hit)
  else if tool === 'erase':
    if affordance.deletable: executeCommand(deleteCommandFor(hit))
  else: ...tool-specific paths
```

`existingDragHandlerFor` is one of the two existing implementations: `useMarkerDrag` for markers, `MoveEntitiesCommand` for notes (multi-entity selection drag). The affordance only gates whether to engage drag; the implementation is the existing path. Same for `deleteCommandFor` and `openInlineEditor`.

`useHighwayMouseInteraction` shrinks because the per-kind branches collapse into the affordance lookup. Per-tool branches stay.

### 9. Drag stays in element data; key is stable

`useChartElements` still injects new `msTime` for the dragged key while drag is in progress. Because `dataEqual` no longer compares `msTime`, the reconciler treats this as a no-op data change; `updateWindow` repositions the group via `group.position.y`. The bright-on-drag visual flows from `setHoveredKey(draggedKey)` (drag begin dispatches `SET_HOVER` to the dragged entity).

**Invariant:** during drag, the reconciler key is stable. `markerDragReconcilerKey(kind, originalTick, partName)` is computed once at drag begin from the pre-move tick and does not change as `currentTick` updates. Element data may change msTime; the key does not. After commit, `MoveEntitiesCommand` produces a new chart and `useChartElements` re-emits with the _new_ tick, which generates a _new_ reconciler key — the old key disappears, the new key appears. Hovered-key from before the commit points at the now-removed old key; the next mousemove resolves it to the new key.

`useChartElements`'s drag-msTime-injection is independent of hover. The drag-driven "looks hovered" must come entirely from `setHoveredKey(draggedKey)` (per §6, dispatched from drag begin into the editor reducer). Drop `isHovered: isHover || isDrag` from the data emission entirely.

**Performance threshold for live-msTime drag.** During an active marker drag on `add-lyrics` with a 200+ lyric chart, `useChartElements`'s effect re-emits on every mousemove. Instrument the effect with `performance.now()` in PR 2; log effect duration during drag. **Threshold:** if median effect duration exceeds 8ms (half-frame at 60fps), file a follow-up to switch to a ghost-overlay drag (plan 0038). This is a follow-up trigger, **not** a blocker for shipping this plan.

### 10. Multi-select hover semantics — composed visuals

`hoveredKey` is a single key — the cursor-anchored entity. Selection is a set. During multi-note drag:

- The cursor-anchored note is hovered AND selected → renders with both visuals composited.
- The other selected notes are selected but not hovered → render with selection only.

**Composition design — one highlight mesh, additive opacity.**

`NoteRenderer` keeps a single highlight mesh per note group (existing `CHILD_SELECTION` index). `setHovered` and `setSelected` each track their own boolean on `group.userData` and recompute the mesh's `material.opacity` additively:

```ts
const opacity =
  (group.userData.selected ? 0.35 : 0) + (group.userData.hovered ? 0.25 : 0);
mesh.visible = opacity > 0;
mesh.material.opacity = Math.min(opacity, 0.6);
```

Selected-only = 0.35, hovered-only = 0.25, both = 0.60. Distinct visuals at each state without doubling the geometry. `MarkerRenderer`'s 4-texture state machine already covers the same matrix.

Box-select drag is not affected: it never touches the reconciler hover/select channels; it reads the current selection set and replaces it on drop.

## Tasks (suggested order, split across 3 PRs)

### PR 1 — renderer-side (tasks 1–4)

Reversible; no editor-side contract changes; each step is testable in isolation.

1. **`SceneReconciler.dataEqual` ignores `msTime`.** Add a regression test: drag-only msTime change does not call `recycle`. Audit `MarkerRenderer.create` and `NoteRenderer.create` for msTime use; add invariant comments where needed. Add a regression test for the _win_ on tempo edits: changing a tempo that shifts msTime for 50 downstream notes results in 0 `recycle` calls (only repositions).

2. **Rewrite `SceneReconciler.test.ts:605-707`** to drop the callback API tests in favor of renderer-hook dispatch tests. This is the precondition for removing the callback API in step 3 — the existing tests are the only consumers.

3. **Add `setHovered` / `setSelected` to `ElementRenderer`.** Wire the three dispatch sites:
   - `reconciler.setHoveredKey(key)` calls `renderer.setHovered(oldGroup, false)` and `renderer.setHovered(newGroup, true)`.
   - `reconciler.setSelectedKeys(keys)` calls `renderer.setSelected` for leavers/joiners.
   - `reconciler.updateWindow` (group entry path): when `acquireGroup` returns a fresh group for an element, call `renderer.setSelected?.(group, true)` if `selectedKeys.has(key)` and `renderer.setHovered?.(group, true)` if `hoveredKey === key`. Add a regression test: scroll an element out of the window, change selection while it's outside, scroll it back in, assert the selection visual reapplies.

   Remove `setHoverChangeCallback` / `setSelectionChangeCallback` from the reconciler's public API. Drop the callback-clear lines from `SceneReconciler.dispose` (`SceneReconciler.ts:337-338`). Renderers without hooks fall back to recycle (kept as test-fixture safety).

4. **Migrate `MarkerRenderer` and `NoteRenderer`.** Split into three reviewable diffs in this PR:

   **Task 4a — `MarkerRenderer`.** Lazy-bake hover/selected/selected+hover textures (store getters in `userData.textures`); implement `setHovered`/`setSelected`. Drop `isHovered`/`isSelected` from `MarkerElementData` (becomes `{text, stackIndex?}`). Test the 4-state texture state machine. Verify no other producers inject `isHovered`/`isSelected` into marker data: `grep -rn "isHovered\|isSelected" components/chart-editor lib/preview/highway` should show only the soon-to-be-deleted `useChartElements` injection.

   **Task 4b — `NotesManager` audit.** Verify `NotesManager.setHoveredNoteId` / `setSelectedNoteIds` are dead in the live editor path (grep for `notesManager\.set`). If dead, delete them — free win. If live, apply the same hook migration.

   **Task 4c — `NoteRenderer`.** Migrate `updateSelectionHighlight` to per-group `setHovered`/`setSelected` hooks. Implement the §10 additive-opacity composition. Confidence rings and review indicators stay on `setConfidenceData`/`setReviewedNoteIds`. Test: hovered+selected note shows opacity 0.60; hovered-only shows 0.25; selected-only shows 0.35.

### PR 2 — editor-side (tasks 5–6)

Depends on PR 1 landing first to avoid double-pushing.

5. **Centralize hovered state in the editor reducer.** Add `hovered: {kind, id} | null` to `ChartEditorState`. Mouse interaction dispatches `SET_HOVER`; drag begin/end dispatch `SET_HOVER`. **Mouse handler does not dispatch `SET_HOVER` while a drag is active** (relocate the existing `!markerDrag` guard). Delete `hoveredMarkerKey` from `useHighwayMouseInteraction`'s state and from `UseHighwayMouseInteractionOutputs`. The consumer (`HighwayEditor.tsx`) drops the prop pass to `useChartElements` in this same task. `hoveredHitType` stays on the output for cursor styling — it's derived from the hit, not editor state, and removing it is a separate cleanup.

   Delete `noteRenderer.setHoveredNoteId` calls from `useHighwayMouseInteraction`. `NoteRenderer`'s instance-side hover state (already removed in PR 1 task 4c) is now driven exclusively by the reconciler.

6. **Introduce `reconcilerKeyFor(kind, id, partName?)` and rewire `useChartElements`.** Promote `markerHoverReconcilerKey` and `markerDragReconcilerKey` into one util at `lib/preview/highway/reconcilerKey.ts`. Add the note path (`note:tick:type`). `useChartElements` becomes intrinsic-only: drop `hoveredMarkerKey` / `markerDrag.isHovered` injection. Element data is what the chart says + drag-induced msTime. Add the §5 hover/select push effects translating selection ids → reconciler keys via `reconcilerKeyFor`.

### PR 3 — API surface (tasks 7–8)

The "if it goes wrong, PR 1+2 still represent a complete improvement" PR.

7. **Define `EntityAffordance` (purely declarative).** Implement `AFFORDANCES` for existing kinds: `note`, `section`, `lyric`, `phrase-start`, `phrase-end`. Don't add `onDoubleClick`/`onDelete`/`draggable`-enum/`endpointAlias`.

8. **Table-drive `useHighwayMouseInteraction`.** Replace per-kind switches with affordance lookup. Tool branches stay (place/erase/bpm/timesig/section). Inline-edit dispatch lives on the tool, not the affordance.

### PR-spanning verification

Each PR ends with **browser validation** on add-lyrics + drum-edit pages via chrome-devtools MCP.

**Recycle-counter assertion (concretized).** Add a temporary debug counter on `SceneReconciler.recycle`. Validation procedure:

1. Pause playback (so windowing-driven recycles are quiet).
2. Reset counter.
3. Hover, drag, multi-select, eraser-click — exercise all interactions.
4. Assert counter == 0. **Recycle is expected only during playback as elements scroll off the window.** Any recycle during paused interaction is a regression.

Resume playback briefly to confirm counter increments only as elements legitimately leave the window.

## Tests

- **`SceneReconciler.test.ts`**
  - `dataEqual` returns `true` for elements differing only in `msTime`. (`updateWindow` reposition is the path.)
  - Tempo edit shifting 50 downstream msTimes results in 0 `recycle` calls.
  - `setHoveredKey(k)` calls `renderer.setHovered(g, true)` on the new group, and `setHovered(g, false)` on the previous one. No `recycle` invocation.
  - `setSelectedKeys` adds/removes through the hooks; symmetric.
  - When a group enters the window via `updateWindow`, current hover/selection are reapplied via the hooks.
  - Removed: callback-API tests (replaced by hook-dispatch tests).

- **`MarkerRenderer.test.ts`**
  - `create()` produces a group whose `userData.textures` has rest baked + lazy getters for hover/selected/selected+hover.
  - `setHovered(group, true)` resolves the getter, swaps `material.map`, marks `needsUpdate`. State machine: rest → hover → selected → selected+hover transitions correct.
  - Texture cache shared across instances (no leak; `clearTextureCache` still works).

- **`NoteRenderer.test.ts`**
  - `setHovered(group, true/false)` toggles the existing tint visual without recycling.
  - Additive opacity composition: hovered-only = 0.25, selected-only = 0.35, hovered+selected = 0.60. Highlight mesh `visible` toggles correctly when both go to false.

- **`reconcilerKey.test.ts`**
  - Round-trip per kind: `(kind, id, partName?)` → reconciler key matches what the renderer would use.
  - Note path ignores `partName`; lyric/phrase-\* paths require it.
  - **Consumer-side test:** given a `Map<EntityKind, Set<string>>` with one note, one section, one lyric (harm1), one phrase-start, one phrase-end — translating produces the expected `Set<string>` of reconciler keys.

- **`affordances.test.ts`**
  - Each declared kind has the expected purely-data affordance shape.
  - Asserts no `onDoubleClick` / `onDelete` / `endpointAlias` / `draggable` field is present (negative test that prevents accidentally adding behavior).

- **`useChartElements.test.ts`**
  - **Strategy:** Jest unit test with a stub `SceneReconciler` (a fake exposing `setElements` as a spy method). Either use `renderHook` from `@testing-library/react`, or refactor `useChartElements` to expose its inner pure function (`computeElements(inputs)`) so the test calls that directly and bypasses the effect entirely. The latter is preferred; pure-function tests are precedent in this repo (`computeDiff.test.ts`).
  - Drag-only msTime change does not change the reconciler key; element data is otherwise stable.
  - Hover state never appears in element data (no `isHovered` field on emitted element data).

- **Browser** (chrome-devtools MCP): hover/drag/delete/double-click smoke tests on add-lyrics + drum-edit, with the recycle-counter assertion above.

## Open questions

1. **Default delete command per kind.** Plan 0034 introduces helpers per kind (`removeStarPower`, etc.). The `deleteCommandFor(hit)` dispatch uses these; absent a helper, no-op. The `chart-edit` library is the natural home for a kind→remove-helper registry. Land the registry skeleton in this plan; populate as new kinds arrive.

## Out of scope

- New entity kinds (BPM, timesig, star-power, etc.) — plan 0034. They slot into the registry once defined. `endpointAlias` for paired entities lands with that plan.
- Drag ghost-overlay refactor — chose live-msTime path. May revisit if perf threshold (§9) trips.
- `EntityAdapter` / `EditorProfile` / structured `EntityRef` — plan 0037. This plan deliberately keeps `HitResult` in its current discriminated-union form (with new `kindOf`/`keyOf` helpers) so 0037 can swap the underlying shape without churning 0040's surface.
- Marker `textureCache` LRU eviction — separate concern. Pre-existing memory ratchet; this plan doesn't make it worse (lazy-bake matches steady-state). File as follow-up if long sessions show RSS growth.
- Unifying drag implementations (note vs marker) — keep as-is; affordance only declares "is interactive," doesn't reimplement drag.
- `EditorMCPTools` integration — MCP commands continue to bypass UI; if a future MCP tool wants to drag, it consults the affordance, but that's out of this plan.
