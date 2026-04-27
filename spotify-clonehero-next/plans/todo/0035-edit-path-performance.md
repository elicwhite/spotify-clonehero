# Plan 0035: Edit-path performance — stop round-tripping every edit (Phase 6)

> **Source:** `plans/chart-editor-architecture-review.md` § "Migration plan → Phase 6"
> **Dependencies:** 0034 (entity coverage so the perf fix applies uniformly)
> **Parallel track:** 0039 (upstream-to-scan-chart primitives)
> **Unlocks:** Smooth drag for batch edits; reasonable cost during phase 8's invertible-undo introduction.

## Context

`useExecuteCommand` in `components/chart-editor/hooks/useEditCommands.ts:28-35` calls `writeChartFolder` followed by `parseChartFile` after **every command's execute**. The round-trip exists because the parser populates derived fields (`msTime` per event, chord HOPOs, drum-type lane validation, sustain caps) that scan-chart computes during parse. Without it, these fields would lag behind the doc.

For a single note add this is fine. During a drag (live preview re-execution per pointermove) or a paste batch, this is dozens of round-trips per second — and the hook also pushes the parsed result to the SceneReconciler **inside the same hook**, which means the writer/parser pipeline runs twice per command in some paths.

Undo today uses doc snapshots (`undoDocStack`, capped at 200) precisely because the round-trip prevents `command.undo()` from running faithfully against a live doc. Phase 8's invertible-undo is blocked on this perf path being viable.

## Goal

1. **Cheapest:** stop round-tripping during a drag. Round-trip on drag end, batch end, and save/export. Cuts ~half the cost immediately.
2. **Better:** collapse the duplicate scan-chart invocation in `useExecuteCommand` (currently runs once for execute, once for the reconciler push).
3. **Best:** replace the round-trip with a local `recomputeDerived(doc, dirtyRanges)` from chart-edit. This phase lays the foundation (`dirtyRanges` plumbing); the actual `recomputeDerived` primitive is upstreamed in 0039.

**Undo snapshots stay** until phase 8 lands invertible operations and the phase 3 tests prove inversion correctness. Don't drop the snapshot stack speculatively.

## Design

### 1. Drag-aware execute path

`useEditCommands` exposes two execute paths:

```ts
executeCommand(cmd); // full path: round-trip + reconciler push
executeCommandPreview(cmd); // light path: no round-trip, no snapshot, no undo entry
commitPreview(); // converts the running preview into a single committed command
cancelPreview(); // discards the preview chain
```

Drag flow uses `executeCommandPreview` per pointermove and `commitPreview` on pointerup. Box-paste / batch operations use `BatchCommand` + `executeCommand`.

The "light path" applies the command to a working doc copy held in a ref (`previewDocRef`). The reconciler reads from that ref; the reducer's stored doc is unchanged until commit. This keeps undo correct (one entry per drag) without pinning the doc through the reducer per pointermove.

### 2. `dirtyRanges` plumbing

Each command surfaces a `getDirtyRanges()` returning `TickRange[]` that names which sections of the doc the command might have invalidated:

```ts
interface TickRange {
  instrument?: Instrument;
  difficulty?: Difficulty;
  minTick: number;
  maxTick: number;
}

interface EditCommand {
  execute(doc: ChartDocument): ChartDocument;
  undo(doc: ChartDocument): ChartDocument;
  getDirtyRanges(
    beforeDoc: ChartDocument,
    afterDoc: ChartDocument,
  ): TickRange[]; // NEW
}
```

The reducer stores ranges next to the command in the undo stack. The reconciler uses ranges to skip un-modified frames. Phase 8 / phase 39 use ranges to call `recomputeDerived(doc, ranges)` instead of a full round-trip.

For this phase: implement `getDirtyRanges` for every command class but **don't yet wire it to a recomputation primitive**. The round-trip stays at commit time as the recomputation step. The plumbing prepares 0039.

### 3. Collapse duplicate scan-chart invocation

`useEditCommands` currently does:

1. Run `cmd.execute(doc) → newDoc`.
2. `writeChartFolder(newDoc)` → `parseChartFile(...)` to refresh derived fields.
3. Pass parsed result to reconciler.

In the same hook, the reconciler also re-runs the writer/parser internally on its own input change.

**Fix:** the reconciler accepts a `ParsedChart` directly (no internal writer/parser). The hook produces one parsed result per commit and passes it to both state and reconciler. Net: one round-trip per commit, not two.

### 4. Round-trip on save, not edit

`writeChartFolder` is the export path's job. The edit path doesn't need the bytes; it needs the derived fields. After 0039 lands `recomputeDerived`, the edit path stops using `writeChartFolder` entirely.

For now, the edit path keeps `writeChartFolder + parseChartFile` as the recomputation method but only on commit boundaries.

## Tasks (suggested order)

1. **Add `getDirtyRanges` to every command class.** Default `[{ minTick: 0, maxTick: Infinity }]` (full doc) is acceptable initially; phase 39 will tighten.
2. **Refactor `useEditCommands`** to expose `executeCommand` / `executeCommandPreview` / `commitPreview` / `cancelPreview`. Maintain backwards compat: existing single-call sites use `executeCommand`.
3. **Convert drag flows in `useHighwayMouseInteraction` and `useMarkerDrag`** to the preview path. Pointerup commits.
4. **Collapse the reconciler's internal writer/parser** — the reconciler now accepts the parsed chart from upstream, not the doc.
5. **Browser validation** — drag a note across many lanes/ticks, watch the dev tools performance trace; confirm only one round-trip fires on pointerup. Same for marker drag and box-paste.
6. **Profile** — record before/after frame timings on a chart with 5,000 notes during a 100-tick drag.

## Tests

- `useEditCommands.test.ts` — preview chain accumulates correctly, commit produces one undo entry, cancel restores the pre-preview state.
- `commands.test.ts` extension — each command's `getDirtyRanges` returns ranges that contain every modified tick (no false negatives).
- Performance regression test (Jest `it.skip` initially) — measure command throughput on a 5K-note doc.

## Open questions

1. **Preview doc ownership** — held in a ref outside the reducer (proposed) or as a transient state slice that the reducer ignores in the undo stack? Lean: ref. Keeps the reducer's invariant simpler (committed doc only).
2. **`Infinity` as the max-tick sentinel** for full-doc dirty ranges — or use `undefined` to mean "everything"? Lean: undefined.

## Out of scope

- Implementing `recomputeDerived` (phase 39).
- Switching undo to invertible operations (phase 8).
- Replacing `writeChartFolder` on save (it stays as the canonical serializer).
