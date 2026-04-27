# Plan 0029: Configurable chart editor + draggable lyrics & phrase markers

## Context

The chart editor today is implicitly a **drum** editor:

- `ChartEditorContext` typing for the active track is a single `ParsedChart['trackData'][0]` that the rest of the UI assumes is `expert/drums`.
- `HighwayEditor` hit-tests notes + sections + highway lanes, drags notes (`MoveNotesCommand`) and sections (`MoveSectionCommand`), runs box-select against expert drum notes, and uses the 5-lane drum lane math (`LANE_ORDER`).
- Lyrics, phrase-start, and phrase-end markers render via `chartToElements.ts` + `MarkerRenderer`, but `InteractionManager.hitTest()` has no path for them — they're visible but inert.
- `EditToolbar` exposes drum-only placement tools.

The add-lyrics page reuses this editor as its post-alignment view. The user wants:

1. Chart editor must work with **no drum track** — vocals-only charts must render the highway, transport, waveform, and markers. No drum lanes, no note rendering, no note hit-testing.
2. Editor capabilities (hover / select / drag, per-entity-kind) must be **configurable** by the page that mounts it.
3. **Add-lyrics preset:** notes + sections are read-only; only lyric markers and phrase markers are selectable and draggable.
4. **Drum-edit preset:** keep current behavior (notes + sections selectable + draggable, lyrics/phrases inert).
5. Lyric and phrase drag must reuse the same shared infrastructure as note + section drag (one move-command path, one chart-edit helper layer).
6. Drag operations snap to grid (current note-drag behavior).
7. All four entity kinds (note / section / lyric / phrase) participate in the same undo stack.

## Goal

Replace per-entity-type editor logic with:

- a small **EditorCapabilities** config consumed by `ChartEditor` and threaded through `HighwayEditor`,
- a generalized **MoveEntitiesCommand** backed by a per-kind dispatch table in `chart-edit`, replacing `MoveNotesCommand` and `MoveSectionCommand`,
- new hit-test paths in `InteractionManager` for `lyric`, `phrase-start`, and `phrase-end`,
- new `lib/chart-edit/helpers/lyrics.ts` and `helpers/phrases.ts` covering move + selection-key helpers,
- a "lanes-off" highway rendering mode for vocals-only charts,
- and an updated add-lyrics page that mounts the editor with the lyrics-only capability set.

This plan does **not** change the alignment pipeline, the export flow, the audio manager, or any non-highway editor surface.

## Design

### 1. Generalized entity model in `lib/chart-edit/`

A movable entity, regardless of kind, needs three things from chart-edit: a stable id, a way to be located in a doc, and a way to be moved.

New module `lib/chart-edit/entities/index.ts`:

```ts
export type EntityKind =
  | 'note'
  | 'section'
  | 'lyric'
  | 'phrase-start'
  | 'phrase-end';

export interface EntityRef {
  kind: EntityKind;
  /** Stable id within `kind`. Format is kind-specific but opaque to consumers. */
  id: string;
}

/** Per-kind handler. Pure functions over ChartDocument. */
export interface EntityKindHandler {
  /** List all entities of this kind currently in the doc. */
  listIds(doc: ChartDocument): string[];

  /** Resolve an id to the absolute tick (and, for notes, lane index). Returns null if missing. */
  locate(doc: ChartDocument, id: string): {tick: number; lane?: number} | null;

  /**
   * Apply a move to one entity. Mutates `doc` in place (callers always clone first).
   * Returns the new id after the move (e.g. note id changes when tick or lane changes;
   * section id is its tick).
   */
  move(
    doc: ChartDocument,
    id: string,
    tickDelta: number,
    laneDelta: number,
  ): string;

  /** True if this kind responds to lane delta (notes only today). */
  supportsLaneDelta: boolean;
}

export const entityHandlers: Record<EntityKind, EntityKindHandler>;
```

Each handler lives next to its existing CRUD helpers:

- `helpers/drum-notes.ts` — already has `addDrumNote`/`removeDrumNote`, gains a handler that wraps the existing `noteId(...)` format.
- `helpers/sections.ts` — already has `addSection`/`removeSection`; handler keys by tick.
- **new** `helpers/lyrics.ts` — `getLyrics(doc)`, `moveLyric(doc, oldTick, newTick)`, `lyricId(tick)` keyed by tick. A lyric lives inside a `notePhrase`; moving it preserves the phrase association unless the new tick falls outside any phrase, in which case `move` clamps to phrase bounds (no cross-phrase moves in this plan).
- **new** `helpers/phrases.ts` — `movePhraseStart(doc, oldTick, newTick)` and `movePhraseEnd(doc, oldEndTick, newEndTick)`. `phrase-start` id is `phrase:${tick}`. `phrase-end` id is `phrase-end:${endTick}`. Length is recomputed from start + end. `move` rejects (returns the original id, no-op) if the new boundary would invert the phrase or cross an adjacent phrase boundary.

All four handlers are unit-tested in `lib/chart-edit/__tests__/` against round-tripped charts.

### 2. Generalized `MoveEntitiesCommand`

Replace `MoveNotesCommand` and `MoveSectionCommand` (in `components/chart-editor/commands.ts`) with one command:

```ts
export class MoveEntitiesCommand implements EditCommand {
  constructor(
    private kind: EntityKind,
    private ids: string[],
    private tickDelta: number,
    private laneDelta: number,
  ) { ... }

  execute(doc): ChartDocument {
    const handler = entityHandlers[this.kind];
    const newDoc = cloneDocFor(this.kind, doc);
    this.movedIds = [];
    for (const id of this.ids) {
      this.movedIds.push(handler.move(newDoc, id, this.tickDelta, this.laneDelta));
    }
    return newDoc;
  }

  undo(doc): ChartDocument { /* mirror with negated deltas, replaying movedIds */ }
}
```

Migration path:

- Step A: introduce `MoveEntitiesCommand` alongside the existing two commands, ported `MoveNotesCommand` callsite first as a regression check.
- Step B: port `MoveSectionCommand` callsite.
- Step C: delete the two old commands once both flows are on the new one.

`cloneDocFor(kind, doc)` consolidates the existing `cloneDocWithTracks` / `cloneDocWithSections` / etc. helpers so each kind only deep-clones what it needs.

### 3. EditorCapabilities config

New module `components/chart-editor/capabilities.ts`:

```ts
export type EntityKind =
  | 'note'
  | 'section'
  | 'lyric'
  | 'phrase-start'
  | 'phrase-end';

export interface EditorCapabilities {
  /** Entity kinds that respond to hover (cursor change, hit feedback). */
  hoverable: ReadonlySet<EntityKind>;
  /** Entity kinds that can be added to the selection. */
  selectable: ReadonlySet<EntityKind>;
  /** Entity kinds that can be drag-moved. Must be a subset of `selectable`. */
  draggable: ReadonlySet<EntityKind>;
  /** Show drum-note placement tools (1-5 keys, erase). */
  showNotePlacementTools: boolean;
  /** Show drum lanes + drum highway floor. */
  showDrumLanes: boolean;
}

export const DRUM_EDIT_CAPABILITIES: EditorCapabilities = {
  hoverable: new Set(['note', 'section']),
  selectable: new Set(['note', 'section']),
  draggable: new Set(['note', 'section']),
  showNotePlacementTools: true,
  showDrumLanes: true,
};

export const ADD_LYRICS_CAPABILITIES: EditorCapabilities = {
  hoverable: new Set(['lyric', 'phrase-start', 'phrase-end']),
  selectable: new Set(['lyric', 'phrase-start', 'phrase-end']),
  draggable: new Set(['lyric', 'phrase-start', 'phrase-end']),
  showNotePlacementTools: false,
  showDrumLanes: false,
};
```

`<ChartEditor capabilities={...} />`. Default = `DRUM_EDIT_CAPABILITIES` for back-compat.
Capabilities flow through context (or a prop, see open question 1).

### 4. `HighwayEditor` refactor

- Replace direct references to `MoveNotesCommand`/`MoveSectionCommand` with `MoveEntitiesCommand` driven by hit kind.
- Selection state in `ChartEditorContext`:
  - **Replace** `selectedNoteIds: Set<string>` and `selectedSectionTick: number | null`
  - **With** `selection: { kind: EntityKind; id: string }[]` (or a `Map<EntityKind, Set<string>>` if that's lighter on the existing reducer — see open question 2).
  - All existing actions (`SET_SELECTED_NOTES`, `SET_SELECTED_SECTION`, etc.) are rewritten to operate on the unified shape. The MCP tool surface (`EditorMCPTools.tsx`) and `NoteInspector.tsx` need updates.
- Hit-test result handling generalized: any `hit.kind in capabilities.selectable` is treated the same way — click selects, shift-click toggles, drag moves.
- Box-select restricted to entity kinds in `capabilities.selectable` that have a 2D footprint (notes today; not extending to lyrics in this plan since lyrics are 1D along time).
- When `capabilities.showDrumLanes === false`:
  - Skip the drum hit box loader, skip the drum highway floor mesh, skip drum-note rendering.
  - Replace lane-strip background with a generic time-only floor (single neutral plane) — implemented as a new `EmptyHighwayFloor` mesh in `lib/preview/highway/`.
  - `screenToLane` returns null/0 (no lane axis); placement tools are hidden anyway.

### 5. Hit-testing for lyrics & phrase markers

Markers are billboarded text on the side of the highway (kind `'lyric'`, `'phrase-start'`, `'phrase-end'`). They live in `MarkerRenderer` per kind.

Plan:

- `MarkerRenderer` exposes a `getInstanceAtRay(ray)` raycast helper similar to the existing section path. Each marker mesh is tagged with its kind and id.
- `InteractionManager.hitTest()` consults the three marker renderers in priority order (lyric > phrase-end > phrase-start, or whatever feels right under the cursor) **before** falling through to highway hits, but **after** notes (existing behavior for sections is the same — markers and sections are both off-highway, so order between them doesn't conflict).
- New `HitResult` variants:

```ts
| { type: 'lyric'; tick: number; text: string }
| { type: 'phrase-start'; tick: number }
| { type: 'phrase-end'; endTick: number; phraseStartTick: number }
```

Hover feedback: marker's outline brightens / scales slightly (mirrors existing section hover).

### 6. Drag implementation

Drag flow today (`HighwayEditor.tsx:540-660`) branches on `isDragging` (notes) vs `isDraggingSection` (sections). Refactor into a single drag flow:

- `dragKind: EntityKind | null` replaces the two booleans.
- `onMouseDown` on a `selectable` hit sets `dragKind` from `hit.kind` and seeds `selection`.
- `onMouseMove` while `dragKind !== null` updates a live preview offset (visual only — mirror what notes already do).
- `onMouseUp` issues `new MoveEntitiesCommand(dragKind, [...ids], tickDelta, laneDelta)`. `laneDelta` is 0 for non-note kinds.
- All deltas snap to `state.gridDivision` via the existing `snapTickToGrid` helper.

### 7. Add-lyrics integration

`app/add-lyrics/page.tsx`:

- The "done" branch (`showEditor` block) keeps `<ChartEditor>` but passes `capabilities={ADD_LYRICS_CAPABILITIES}`.
- `editorData.track` becomes optional. The expert-drums-or-fallback lookup is removed; the editor receives `track: null` when drums are absent.
- Export button + sidebar + transport unchanged.

`components/chart-editor/ChartEditor.tsx` is the main affected component (lyrics editing uses it directly, no new wrapper).

### 8. Tests

- `lib/chart-edit/__tests__/lyrics.test.ts` — round-trip, move within phrase, clamp at phrase bounds, no-op on missing id.
- `lib/chart-edit/__tests__/phrases.test.ts` — move start, move end, reject inversion, reject cross-boundary.
- `lib/chart-edit/__tests__/entity-handlers.test.ts` — `entityHandlers` dispatch table covers all four kinds, `locate(listIds(d))` is total.
- `components/chart-editor/__tests__/move-entities-command.test.ts` — `MoveEntitiesCommand` undo/redo for each kind.
- `lib/preview/highway/__tests__/InteractionManager.test.ts` (extend existing) — lyric / phrase-start / phrase-end hit cases.
- Browser validation per CLAUDE.md: open `/add-lyrics`, take screenshots, verify hover/select/drag on lyrics + phrases, confirm notes + sections are inert, confirm console clean.

## Tasks (suggested order)

1. **chart-edit entity handlers** — add `lib/chart-edit/entities/index.ts`, `helpers/lyrics.ts`, `helpers/phrases.ts`, plus handler wrappers for existing drum-notes and sections. Tests.
2. **MoveEntitiesCommand** — add alongside existing commands, port `MoveNotesCommand` callsite; verify drum drag still works. Then port `MoveSectionCommand` callsite. Then delete the old two commands.
3. **Selection state unification** — collapse `selectedNoteIds` + `selectedSectionTick` into a single `selection`. Update reducer, MCP tools, NoteInspector.
4. **EditorCapabilities** — add the type + presets, plumb through `ChartEditor` → `HighwayEditor` (and `EditToolbar` for `showNotePlacementTools`).
5. **Marker hit-testing** — extend `InteractionManager` + each `MarkerRenderer`; add new `HitResult` variants.
6. **Generalized drag flow in HighwayEditor** — collapse note + section drag branches behind `dragKind`. Wire lyric + phrase drag through it.
7. **Lanes-off highway** — gate drum hitbox + drum floor + note rendering behind `capabilities.showDrumLanes`. Add empty floor mesh.
8. **Add-lyrics integration** — pass `ADD_LYRICS_CAPABILITIES`, drop the drum-track fallback, browser-validate.
9. **Cleanup** — delete dead code paths (the per-entity move commands, the dual-flag drag state), update CLAUDE.md plans table.

## Open questions (please confirm before/during implementation)

1. **Capabilities prop vs context** — flow through `ChartEditorContext` (every consumer reads from context, no prop drilling) or pass as a `<ChartEditor>` prop and prop-drill into `HighwayEditor`? Lean: context, since `EditToolbar` and `LeftSidebar` also need it.
2. **Selection shape** — `Set<{kind,id}>` is hard to dedupe; `Map<EntityKind, Set<string>>` is easier and matches how the reducer dispatches. Lean: map.
3. **Phrase-end drag UX** — when the user drags phrase-end past the last lyric in the phrase, do we (a) shrink the phrase but keep the lyric, (b) refuse the move, or (c) drop the lyric? Out-of-scope assumption: (a). Confirm.
4. **Lyric drag past phrase boundary** — clamp at boundary (proposed) vs. reassign to neighbor phrase (out of scope here).
5. **Marker hover priority** — when a lyric and a phrase-start sit on the same tick, which wins on hit-test? Lean: lyric, since it's the smaller target and likely the user's intent.
6. **Empty-highway visual** — how aggressive a redesign is wanted for the lanes-off mode? Minimal (just turn off drum geometry, keep the strip) or a proper neutral floor? This plan assumes minimal.

## Out of scope

- New keyboard shortcuts for lyric/phrase placement.
- Cross-phrase lyric or phrase-marker moves.
- Editing lyric **text** (only timing).
- Splitting / merging phrases.
- Multi-marker box selection.
- Switching the chart editor to non-drum _note_ tracks (guitar/bass) — only the lanes-off case is covered here.
