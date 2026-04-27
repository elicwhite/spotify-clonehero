# Plan 0037: chart-editor-core + EditorProfile + ChartOperation + EntityAdapter (Phase 8)

> **Source:** `plans/chart-editor-architecture-review.md` § "Migration plan → Phase 8"
> **Dependencies:** 0036 (hotkey registry feeds keymap); 0032 (test suite proves command inversion)
> **Parallel track:** 0039 (`recomputeDerived` and friends upstreamed in scan-chart).
> **Unlocks:** Phase 9.
> **Critical:** This phase is large enough to ship in multiple PRs. Each PR is gated by the phase-3 test suite.

## Context

The current editor has:

- `chartDoc + chart + track` triple state, manually mirrored.
- Concrete command classes per kind (~15 of them) with bespoke execute/undo logic.
- `EntityKindHandler` with `listIds / locate / move` only.
- Doc-snapshot undo because commands can't faithfully invert against a live doc post-round-trip.
- Capabilities-as-flat-config; UI gating only.
- React state coupled tightly to renderer, audio, MCP tools.
- `DrumNote` / `DrumNoteFlags` / `drumNoteTypeMap` / `noteTypeToDrumNote` as a friendly facade over scan-chart's numeric `NoteType` and bitmask flags.

This phase factors a headless **`chart-editor-core`** library and replaces the bespoke command surface with one operation language.

## Goal

1. `lib/chart-editor-core/` exists. Houses `EditorSession`, command history, selection, projections, subscriptions. **No React imports.**
2. `ChartOperation` + `EntityAdapter` replace the per-command classes. Adapter `TEntity` types are scan-chart shapes (`NoteEvent`, `NormalizedLyricEvent`, etc.) — never re-declared.
3. `EditorProfile` replaces flat `EditorCapabilities`. `allowedOperations` enforced **inside the core's dispatch**, not just in UI.
4. Validation + normalization live in `chart-edit`. Editor-specific rules only; scan-chart's rules are delegated.
5. Undo switches from doc-snapshot to inverse-operation. Phase-3 tests are the safety net.
6. Structured `EntityRef` replaces opaque tick strings.
7. `DrumNote` / `DrumNoteFlags` / `drumNoteTypeMap` / `noteTypeToDrumNote` retired. Friendly drum names come from the active `InstrumentSchema` + display projections, not a parallel type system.

## Design

See `plans/chart-editor-architecture-review.md` § "Target architecture" for the full design. Below is the scope-bounded version specific to this phase.

### 1. Move state machine to `lib/chart-editor-core/`

The current reducer + command stack + selection map move into a React-free module:

```ts
// lib/chart-editor-core/EditorSession.ts
class EditorSession {
  constructor(initial: {doc: ChartDocument; profile: EditorProfile});
  dispatch(op: ChartOperation): DispatchResult;
  undo(): void;
  redo(): void;
  setSelection(sel: Selection): void;
  subscribe(listener: (state: EditorState) => void): () => void;
  getState(): EditorState;
  getProjection(viewId: string): EditorProjection; // memoized
}
```

The provider becomes a thin React adapter that owns one `EditorSession` and republishes its state through context + a `useSyncExternalStore` hook.

### 2. ChartOperation

```ts
type ChartOperation =
  | {type: 'object.add'; target: EntityTarget; object: ChartEntity}
  | {type: 'object.delete'; target: EntityTarget; ref: EntityRef}
  | {
      type: 'object.update';
      target: EntityTarget;
      ref: EntityRef;
      patch: EntityPatch;
    }
  | {
      type: 'object.move';
      target: EntityTarget;
      ref: EntityRef;
      tickDelta: number;
      laneDelta?: number;
    }
  | {type: 'batch'; operations: ChartOperation[]};
```

`ChartEntity` and `EntityPatch` are unions over scan-chart shapes (and `Partial<>` of them). Concrete examples:

- A note: `ChartEntity = NoteEvent`.
- A lyric: `ChartEntity = NormalizedLyricEvent`.
- A phrase: `ChartEntity = NormalizedVocalPhrase`.

### 3. EntityAdapter

```ts
interface EntityAdapter<TEntity> {
  kind: EntityKind;
  list(doc: ChartDocument, scope: EditorScope): TEntity[];
  get(doc: ChartDocument, ref: EntityRef): TEntity | null;
  apply(doc: ChartDocument, op: ChartOperation): PatchResult;
  invert(op: ChartOperation, before: PatchResult): ChartOperation;
  validate?(doc: ChartDocument, op: ChartOperation): ValidationIssue[];
  normalize?(doc: ChartDocument, dirty: TickRange[]): NormalizeResult;
  project?(doc: ChartDocument, scope: EditorScope): ChartElement[];
}
```

Migrate adapters one kind at a time: notes first, then sections, then lyrics+phrases, then BPM/timesig (added in phase 5), then star-power/solo/activation/flex.

### 4. EditorProfile

```ts
interface EditorProfile {
  id: string;
  scopes: EditorScope[];
  visibleEntities: Set<EntityKind>;
  selectableEntities: Set<EntityKind>;
  editableEntities: Set<EntityKind>;
  allowedOperations: Set<ChartOperation['type']>;
  tools: ToolDefinition[];
  keymap: KeyBindingDefinition[];
  panels: PanelDefinition[];
  defaultView: EditorViewConfig;
}
```

`DRUM_EDIT_PROFILE`, `ADD_LYRICS_PROFILE`. The dispatch path checks `profile.allowedOperations.has(op.type)` and `profile.editableEntities.has(target.kind)` **before** mutation. UI gating becomes secondary; programmatic API and MCP tools are gated through the same path automatically.

### 5. Validation + normalization in chart-edit

```ts
// lib/chart-edit/validation/
validateChart(doc): ValidationIssue[]
validateOperation(doc, op): ValidationIssue[]
normalizeAfterOperation(doc, result): NormalizeResult
getDirtyRanges(op): TickRange[]
```

Rules scan-chart already encodes (msTime, HOPOs, chord shapes, drum-type lane validation, sustain caps) are **delegated**. Only editor-specific rules (duplicate/colliding objects, lyric ownership inside a phrase, in-flight invariants) live here.

`ValidationIssue` aliases scan-chart's existing `ChartIssueType` / `FolderIssueType` / `MetadataIssueType` unions. No parallel issue catalog.

### 6. Invertible undo

`adapter.invert(op, before)` returns the operation that reverses `op`. The history stack stores `{ op, inverse }` instead of doc snapshots. `undo()` dispatches the inverse; `redo()` dispatches the forward op.

Snapshot stack stays as a fallback for now (gated behind a feature flag during transition); flip the flag once tests have run for a release cycle.

### 7. Structured EntityRef

```ts
type EntityRef = {kind: EntityKind; scope: EditorScope; key: string};
```

Examples:

- Track notes: `{ kind: 'note', scope: { kind: 'track', track: { instrument: 'drums', difficulty: 'expert' } }, key: 'note:1234:2:0' }` (tick:lane:ordinalAtTick).
- Vocal lyrics: `{ kind: 'lyric', scope: { kind: 'vocals', part: 'vocals' }, key: 'lyric:phrase:3:lyric:1' }` (phraseIndex:lyricIndex).
- Phrase boundaries: `{ kind: 'phrase-end', scope: { kind: 'vocals', part: 'vocals' }, key: 'phrase:3:end' }` (phraseIndex:end — stable across length changes).

### 8. Retire DrumNote facade

`lib/chart-edit/types.ts` `DrumNoteType`, `DrumNoteFlags`, `drumNoteTypeMap`, `noteTypeToDrumNote`, and `drumFlagsToNoteFlags` are deleted. Adapters operate on `NoteEvent` directly. Drum-friendly labels come from `InstrumentSchema.lanes[].label`.

## Tasks (suggested order)

This phase ships in roughly seven PRs (one per numbered task). Each PR runs the phase-3 tests and validates in browser.

1. **Move state machine to `lib/chart-editor-core/`.** No behavior change — just relocate the reducer, command stack, selection. React provider becomes a thin adapter.
2. **Define `ChartOperation` types + adapter scaffolding.** No migrations yet; just types + a `dispatch(op)` path that delegates to existing command classes for backward compat.
3. **Migrate adapters one kind at a time.** Notes first (largest blast radius). Run phase-3 inversion tests for the operation form before deleting the old command class.
4. **`EditorProfile` + `allowedOperations` enforcement.** Convert capabilities. Wire the dispatch-path gate. Update `EditorMCPTools` to register through the profile, not bypass it.
5. **Validation + normalization layer.** Delegate to scan-chart for known rules. Push gaps upstream (track in 0039).
6. **Switch undo to invertible operations.** Feature-flag the snapshot fallback. Run for a release cycle, then drop snapshots.
7. **Structured `EntityRef` migration.** Update all adapters + selection + MCP surface. Migrate stored selection on load.
8. **Delete `DrumNote` facade.** Replace UI consumers with schema-driven labels.

## Tests

The phase-3 test suite is the critical safety net:

- Every command's execute/undo must still pass after migration to operation form.
- Capability gate tests gain new cases for `allowedOperations` enforcement (try to dispatch a forbidden op, verify rejection).
- Validation tests cover both editor-specific rules and the delegated path (validateOperation surfaces scan-chart issues).
- New: invertibility tests — for every `(adapter, operation)` pair, `apply(invert(apply(doc, op))) === doc`.

## Open questions

1. **Profile-tool decoupling** — should `tools` be a property of the profile or registered separately and filtered by profile? Lean: profile-owned, since add-lyrics has fundamentally different tools than drum-edit.
2. **`PatchResult` shape** — the result of `apply(doc, op)`. Lean: `{ doc: ChartDocument; ranges: TickRange[]; affectedRefs: EntityRef[] }`. Sufficient for the reconciler and for `invert`.
3. **MCP tool migration cadence** — break MCP compatibility by switching to the operation API in this phase, or keep the legacy MCP surface as a translation layer? Lean: translation layer. Keeps external integrations working through the transition.
4. **Selection migration on schema change** — when a user upgrades from 0030 (interim string ids) to 0037 (structured refs), how does saved/restored state migrate? Lean: drop selection on first load post-upgrade. It's transient.

## Out of scope

- Renderer changes. The reconciler still consumes `ChartElement[]` in the same shape.
- New instruments. Phase 9.
- Tool plugins. Phase 9.
- Audio service decoupling. Mentioned in the architecture review; deferred to a phase-9 sub-task.
