# Plan 0036: Centralize hotkeys behind a registry (Phase 7)

> **Source:** `plans/chart-editor-architecture-review.md` § "Migration plan → Phase 7"
> **Dependencies:** 0035 (perf path stable; safe to refactor input plumbing)
> **Unlocks:** Phase 8 (`EditorProfile.keymap` reads from this registry).

## Context

`components/chart-editor/hooks/useEditorKeyboard.ts` registers hotkeys via inline `useHotkey` calls scattered across multiple useEffect blocks, with a `react-hooks/rules-of-hooks` eslint-disable to loop over keys. Drum-transcription's "Enter to mark reviewed" / "N for next low-confidence" are inline calls in another hook. Place-mode lane keys (1-5), flag toggle keys (Q/A/S), and tool-mode keys are all separate.

Adding a new shortcut today means finding the right place to wedge it in; collisions happen silently.

## Goal

A central action registry. Pages register actions and declare scope. The dispatcher handles enable/disable based on current scope (e.g. "place-tool active" / "note-selected"). One source of truth for the keymap, queryable from a future shortcuts UI.

## Design

### 1. Registry shape

```ts
type ActionScope =
  | 'global' // always live
  | 'editor' // any time editor is mounted
  | 'place-tool' // only when toolMode === 'place'
  | 'note-selected' // any selected note
  | 'marker-selected' // any selected marker (lyric / phrase / etc.)
  | 'transport'; // playback context

interface ActionDefinition {
  id: string; // 'editor.placeLane.0', 'editor.flag.cymbal'
  keys: string; // tanstack-hotkeys format
  scope: ActionScope[];
  preventDefault?: boolean;
  description?: string; // for a future shortcuts panel
}

interface ActionBinding {
  id: string;
  handler: (e: KeyboardEvent, context: ActionContext) => void;
}
```

A page or hook calls `useEditorActions(definitions, bindings)` to register. The dispatcher matches incoming key events against active-scope actions and calls the bound handler.

### 2. Default actions

Defined in `components/chart-editor/actions.ts`:

```ts
export const DEFAULT_ACTIONS: ActionDefinition[] = [
  {id: 'editor.undo', keys: 'Mod+Z', scope: ['editor']},
  {id: 'editor.redo', keys: 'Mod+Shift+Z', scope: ['editor']},
  {id: 'editor.placeLane.0', keys: '1', scope: ['place-tool']},
  // ... per-lane keys read from the active InstrumentSchema (phase 1)
  {id: 'editor.flag.cymbal', keys: 'Q', scope: ['note-selected']},
  // ...
  {id: 'transport.playPause', keys: 'Space', scope: ['transport']},
  {id: 'editor.delete', keys: 'Delete', scope: ['editor']},
];
```

Place-mode keys aren't hard-coded any more — they're emitted from the active `InstrumentSchema.lanes[].defaultKey`. The registry is the merge of defaults + per-page overrides + schema-derived per-lane bindings.

### 3. Per-page additions

Drum-transcription adds:

```ts
const TRANSCRIPTION_ACTIONS: ActionDefinition[] = [
  {id: 'review.markReviewed', keys: 'Enter', scope: ['note-selected']},
  {id: 'review.nextLowConfidence', keys: 'N', scope: ['editor']},
];
```

`useEditorActions(TRANSCRIPTION_ACTIONS, transcriptionBindings)` inside the page's main hook.

### 4. Implementation

The dispatcher is one hook at the top of `<ChartEditor>`. It listens to keydown on the editor's root element (or window, for global scope) and consults a `Set<ActionScope>` derived from current state (toolMode, selection, etc.). On match, it invokes the bound handler.

Behind the scenes, this can still use `@tanstack/react-hotkeys` — but the surface is the registry, not a per-key hook call.

### 5. Migration

- `useEditorKeyboard` becomes a thin wrapper that registers `DEFAULT_ACTIONS` + binds each id to the existing imperative handlers.
- The drum-transcription review hotkeys move to a `useTranscriptionActions(...)` hook in the page.
- The lane key map and flag key map are removed; replaced by schema lookups.

## Tasks (suggested order)

1. **Define types and dispatcher** — `actions.ts`, `useActionRegistry.ts`, `useEditorActions.ts`.
2. **Migrate `useEditorKeyboard`** — define DEFAULT_ACTIONS, bind handlers, drop inline `useHotkey`s.
3. **Migrate per-page hotkeys** — drum-transcription's review hotkeys.
4. **Remove the rules-of-hooks eslint-disable** in useEditorKeyboard.
5. **Browser validation** — every existing shortcut still fires; new shortcuts can be registered without touching the dispatcher; conflicts log warnings.
6. **(Optional)** Add a `Cmd+/` shortcuts panel reading from the registry. Out of scope for this phase but trivial follow-up.

## Tests

- `actions.test.ts` — dispatch with no matching scope returns false; dispatch with matching scope calls the handler exactly once; conflict between two registrations logs and uses the more specific scope.
- Reducer tests don't touch this; the dispatcher is React-side.
- Browser validation per CLAUDE.md.

## Open questions

1. **Scope precedence on conflicts** — if `editor` and `place-tool` both register `1`, which wins? Lean: more specific scope (here, `place-tool`). Document precedence rules.
2. **Mac/Win meta key** — `Mod` is the conventional "Cmd on Mac, Ctrl on Win". Confirm `@tanstack/react-hotkeys` supports it natively. If not, write a small translator.

## Out of scope

- Customizable user keymaps. Hardcode the registry; user customization is later.
- Multi-key chord sequences (`g g`, `Cmd+K Cmd+S`). Single-keystroke + modifier combos only.
- The shortcuts UI panel.
