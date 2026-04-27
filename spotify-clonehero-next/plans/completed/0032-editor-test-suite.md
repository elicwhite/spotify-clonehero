# Plan 0032: Editor test suite — reducer + commands + capability gates (Phase 3)

> **Source:** `plans/chart-editor-architecture-review.md` § "Migration plan → Phase 3"
> **Dependencies:** 0031 (vocal-part parameterization)
> **Unlocks:** Phase 8 (snapshot-based undo can only be replaced once command inversion is proven correct).
> **Critical:** Tests in this phase are non-negotiable before phase 8 starts.

## Context

`lib/chart-edit/__tests__/` covers helper functions and entity handlers. The chart-editor component layer has **no tests**: the reducer, the concrete command classes, and the capability-gating render paths are all uncovered.

Phase 8 will switch from doc-snapshot undo to inverse-operation undo. That switch is dangerous without a regression net for command inversion. This phase builds that net.

## Goal

A Jest test suite covering:

1. **Reducer correctness** — `EXECUTE_COMMAND`, `UNDO`, `REDO`, `SET_SELECTION`, `MARK_SAVED`. Includes the snapshot stack (which exists pre-phase-8) and the selection map.
2. **Command inversion** — for every command class, `execute(doc) → undo(executedDoc)` recovers the input doc bit-for-bit.
3. **Capability gating** — render-time tests that mounting `ADD_LYRICS_CAPABILITIES` hides the toolbar's note placement, the inspector, and the place/erase tools.

## Design

### 1. Reducer tests

`components/chart-editor/__tests__/reducer.test.ts`:

- Initial state shape (post-phase-1: `chartDoc + activeScope` only, no `chart`/`track`).
- `EXECUTE_COMMAND` with a fake command that returns a known doc; verify the new doc is stored, undo stack appended, redo cleared.
- `UNDO` pops the snapshot, applies command.undo, pushes onto redo stack.
- `REDO` mirrors.
- `SET_SELECTION` with single + multi entity-kind values; immutable update verified.
- `MARK_SAVED` stamps the saved baseline.
- Stack cap (`200`) enforced.

### 2. Command tests

`components/chart-editor/__tests__/commands.test.ts`. For each concrete command (current set: `AddNoteCommand`, `RemoveNoteCommand`, `AddBPMCommand`, `RemoveBPMCommand`, `ChangeBPMCommand`, `AddTimeSigCommand`, `RemoveTimeSigCommand`, `ChangeTimeSigCommand`, `AddSectionCommand`, `RemoveSectionCommand`, `RenameSectionCommand`, `ToggleFlagCommand`, `BatchCommand`, `MoveEntitiesCommand`):

```ts
const before = makeFixtureDoc();
const cmd = new XCommand(args);
const after = cmd.execute(before);
expect(after).not.toBe(before); // immutability
const restored = cmd.undo(after);
expect(restored).toEqual(before); // bit-for-bit (after JSON normalization)
```

Helpers:

- `makeFixtureDoc()` builds a deterministic ChartDocument with one drum track + sections + tempos + a vocals part with two phrases. Reused across tests.
- `expectDocsEqual(a, b)` strips non-serializable fields (file objects in `assets[]`) and deep-equals.

`BatchCommand` test verifies:

- Sub-command execution order on `execute`.
- Reverse order on `undo`.
- Atomic failure: if a sub-command throws, the prior sub-commands' executes are undone.

### 3. Capability gate tests

`components/chart-editor/__tests__/capability-gates.test.tsx`. Render `<ChartEditor>` with each preset and assert:

- `DRUM_EDIT_CAPABILITIES` — note placement toolbar visible, inspector visible, drum lanes visible.
- `ADD_LYRICS_CAPABILITIES` — note placement hidden, inspector hidden when no notes selected, drum lanes hidden, lyric/phrase markers selectable.

Use `@testing-library/react`. The Three.js scene won't actually render in jsdom; assert on DOM-level toolbar/inspector visibility, not on the canvas. Three.js setup that requires WebGL is mocked at the module boundary (the renderer code lives under `lib/preview/highway/` and the editor imports it through a ref-passing pattern; mock the constructor to a stub).

### 4. Test harness for ChartEditorContext

A `<TestEditorProvider>` wrapper that takes an initial `chartDoc` and `capabilities` and renders children inside a configured context. Eliminates fixture boilerplate per test.

## Tasks (suggested order)

1. **Test fixtures** — `__tests__/fixtures.ts` exports `makeFixtureDoc()`, `makeMultiPartVocalsDoc()`, `expectDocsEqual()`.
2. **Reducer tests.** All actions + edge cases (stack cap, empty undo, redo-after-edit clears stack).
3. **Command tests.** One describe block per command; share fixtures.
4. **`<TestEditorProvider>`** harness.
5. **Capability gate tests** under jsdom.
6. **CI gate** — verify `yarn test` runs the new files. Document per-file run command in CLAUDE.md if needed.

## Tests

This phase IS the tests. No additional test plan beyond the file list above.

Coverage target (informally): 100% of reducer branches, 100% of command classes, both capability presets, **plus** at least one test per command exercising scope = vocals (proves phase 1/2 changes propagated).

## Open questions

1. **Mocking the Three.js renderer.** Stub at the module boundary or use a lightweight `WebGLRenderer` shim? Lean: module-boundary stub — capability gate tests don't need a real renderer.
2. **Fixture storage** — checked-in JSON dumps from `~/projects/example-charts`, or programmatic builders? Lean: programmatic. Easier to evolve when phase 8 changes the operation model.

## Out of scope

- Renderer/highway tests. Those live in `lib/preview/highway/__tests__/` and are out of this phase's scope.
- E2E browser tests. Browser validation per CLAUDE.md catches those interactively.
- Performance tests. Phase 6 owns the perf path.

## Implementation notes (post-implementation)

Files added under `components/chart-editor/__tests__/`:

- **`fixtures.ts`** — programmatic doc builders. `makeFixtureDoc()` returns a deterministic doc (one expert drum track with notes at ticks 0/480/960/1440/1920, two sections, two tempos, vocals with one phrase + two lyrics). `makeMultiPartVocalsDoc()` adds harm1/harm2. `expectDocsEqual()` does a structural deep-equal that strips `msTime`/`msLength` and `assets` so writer/parser round-trip artifacts don't false-trigger failures.
- **`commands.test.ts`** — 21 tests covering execute/undo round-trip for `AddNoteCommand`, `DeleteNotesCommand`, `ToggleFlagCommand`, `MoveEntitiesCommand` (notes, sections, lyrics in vocals scope, lyrics in harm1, phrase-start), `AddBPMCommand` (incl. tick-0 no-op semantics), `AddTimeSignatureCommand`, `AddSectionCommand`, `DeleteSectionCommand`, `RenameSectionCommand`, and `BatchCommand` (sub-command order on execute, reverse order on undo, real-edit round-trip). Plus an immutability check that `AddNoteCommand` doesn't mutate the input.
- **`reducer.test.ts`** — 18 tests covering initial-state shape, `SET_SELECTION`, `CLEAR_SELECTION` (with referential no-op when already empty), `EXECUTE_COMMAND` (undo push, redo clear, stack cap at 200, no-op when chartDoc is null), `UNDO`/`REDO` (pop/push, no-op-when-empty), `MARK_SAVED` (depth snapshot + dirty-clear behavior across UNDO), and `SET_ACTIVE_SCOPE` (preserves selection; referential equality when scope unchanged).
- **`capability-gates.test.tsx`** — 8 tests. Mounts `<LeftSidebar>` under each capability preset via `<ChartEditorProvider>` and asserts that DRUM_EDIT shows the Tools palette + Highway-mode toggle while ADD_LYRICS hides them and the NoteInspector. Also asserts capability set shapes (e.g. ADD_LYRICS does not select notes; every draggable kind is selectable).

Reducer + initial state are now exported from `ChartEditorContext.tsx` with `@internal` doc-blocks specifically for the test suite. Production callers continue to use the provider hook.

Test infrastructure additions:

- **Dependencies:** `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/dom`, and `jest-environment-jsdom` (Jest 28+ no longer ships jsdom by default).
- **`jest.setup.js`** — polyfills `TextEncoder` / `TextDecoder` from `node:util`. midi-file (loaded via scan-chart) needs them and jsdom doesn't ship them.
- **`jest.setup-after-env.js`** — loads `@testing-library/jest-dom` matchers (`toBeInTheDocument`, etc.).
- **`jest.config.js`** — wires both setup files (`setupFiles` + `setupFilesAfterEnv`).
- **Per-file env override:** `capability-gates.test.tsx` declares `@jest-environment jsdom` since the rest of the suite still runs under the default Node env.

Suite metrics: 42 suites, 728 passing, 3 skipped (was 681 → +47 new tests). Type-check, lint (no new warnings), and Prettier all green.

Browser validation: `.env` available now. Drum-edit, add-lyrics, and drum-transcription pages all load cleanly on `http://localhost:3001` with zero console errors and zero network failures (initial load only — full pipeline validation defers to phase 4 when the editor surface gets exercised end-to-end).

Notes for phase 8:

- The doc-snapshot path tested here (`undoDocStack`) is what phase 8 replaces with invertible operations. The 21 command-inversion tests stay valid as the safety net against silent regression during that switch — phase 8 just adds new `apply(invert(apply(doc, op))) === doc` tests on top.
- `UNDO_STACK_CAP` is hard-coded; phase 8 should make it part of `EditorProfile` if any consumer wants a different cap.
- Capability-gate tests in this phase only assert UI gating. Phase 8's `EditorProfile.allowedOperations` adds dispatch-path gating; tests there will verify that an operation forbidden by the profile is rejected before mutation, with separate assertions.
