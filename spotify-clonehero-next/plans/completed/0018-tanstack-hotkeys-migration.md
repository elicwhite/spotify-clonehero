# Plan 0018: Migrate All Keyboard Shortcuts to @tanstack/react-hotkeys

> **Dependencies:** 0013 (shared editor extraction), 0016 (grid nav + keys mode adds new shortcuts)
> **Unlocks:** Independent
>
> **Goal:** Replace all raw `window.addEventListener('keydown')` keyboard handling with `@tanstack/react-hotkeys` (`useHotkey`). The library is already installed (v0.8.3) but unused. This gives us declarative, composable shortcuts with built-in platform-aware modifiers (`Mod` = Cmd on Mac, Ctrl on Windows), input field exclusion, conditional enable/disable, and devtools support.

## Context

### Current state:
All ~30+ keyboard shortcuts use raw `addEventListener` with manual `e.metaKey || e.ctrlKey` checks, manual input field skipping, and manual `e.preventDefault()`. This code is scattered across 4 locations:

| Location | Shortcuts | Pattern |
|----------|-----------|---------|
| `components/chart-editor/hooks/useEditorKeyboard.ts` | ~24 (tools, grid, flags, clipboard, undo/redo, save, select) | `window.addEventListener('keydown', handler)` in useEffect |
| `components/chart-editor/TransportControls.tsx` | 5 (space, arrows, brackets for speed) | `window.addEventListener('keydown', handler)` in useEffect |
| `components/ui/sidebar.tsx` (SidebarProvider) | 1 (Ctrl+B toggle) | `window.addEventListener('keydown', handler)` in useEffect |
| `app/drum-transcription/components/EditorApp.tsx` | 5 (N, Shift+N, D, M, Enter — via additionalShortcuts callback) | Callback passed to useEditorKeyboard |

### Target state:
Each shortcut becomes a declarative `useHotkey()` call. No raw addEventListener for keyboard events anywhere in the codebase.

## 1. @tanstack/react-hotkeys API Reference

```tsx
import { useHotkey } from '@tanstack/react-hotkeys'

// Basic usage — Mod resolves to Cmd (Mac) or Ctrl (Win/Linux)
useHotkey('Mod+S', () => save())

// Options
useHotkey('Mod+Z', () => undo(), {
  enabled: canUndo,           // Conditional enable/disable
  preventDefault: true,        // Prevent browser default (default: true)
})

// Display formatting
import { formatForDisplay } from '@tanstack/react-hotkeys'
formatForDisplay('Mod+S') // → "⌘S" on Mac, "Ctrl+S" on Windows

// Provider for global defaults
import { HotkeysProvider } from '@tanstack/react-hotkeys'
```

## 2. Migration Map

### useEditorKeyboard.ts → Individual useHotkey calls

The monolithic `useEditorKeyboard` hook with one big switch/if-else block becomes individual `useHotkey` calls. This hook should still exist as a single hook that registers all shared editor hotkeys, but internally uses `useHotkey` for each one.

```typescript
// BEFORE (raw addEventListener)
useEffect(() => {
  function handleKeyDown(e: KeyboardEvent) {
    if (e.target instanceof HTMLInputElement) return;
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      onSave?.();
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      undo();
    }
    // ... 20+ more branches
  }
  window.addEventListener('keydown', handleKeyDown);
  return () => window.removeEventListener('keydown', handleKeyDown);
}, [deps]);

// AFTER (declarative useHotkey)
useHotkey('Mod+S', () => onSave?.());
useHotkey('Mod+Z', () => undo(), { enabled: canUndo });
useHotkey('Mod+Shift+Z', () => redo(), { enabled: canRedo });
useHotkey('Mod+Y', () => redo(), { enabled: canRedo });
// ... each shortcut is its own call
```

#### Full shortcut mapping for useEditorKeyboard:

| Current implementation | useHotkey call |
|----------------------|----------------|
| `(metaKey\|ctrlKey) && 's'` | `useHotkey('Mod+S', () => onSave?.())` |
| `(metaKey\|ctrlKey) && 'z' && !shiftKey` | `useHotkey('Mod+Z', () => undo(), { enabled: canUndo })` |
| `(metaKey\|ctrlKey) && 'z' && shiftKey` | `useHotkey('Mod+Shift+Z', () => redo(), { enabled: canRedo })` |
| `(metaKey\|ctrlKey) && 'y'` | `useHotkey('Mod+Y', () => redo(), { enabled: canRedo })` |
| `(metaKey\|ctrlKey) && 'c'` | `useHotkey('Mod+C', () => copy(), { enabled: hasSelection })` |
| `(metaKey\|ctrlKey) && 'x'` | `useHotkey('Mod+X', () => cut(), { enabled: hasSelection })` |
| `(metaKey\|ctrlKey) && 'v'` | `useHotkey('Mod+V', () => paste(), { enabled: hasClipboard })` |
| `(metaKey\|ctrlKey) && 'l'` | `useHotkey('Mod+L', () => clearLoop())` |
| `(metaKey\|ctrlKey) && 'a'` | `useHotkey('Mod+A', () => selectAll())` |
| `key === 'Escape'` | `useHotkey('Escape', () => deselectAll())` |
| `key === 'Delete' \|\| key === 'Backspace'` | `useHotkey('Delete', () => deleteSelected())` and `useHotkey('Backspace', () => deleteSelected())` |
| `key === 'q'` | `useHotkey('Q', () => toggleCymbal(), { enabled: hasSelection })` |
| `key === 'a' (no modifier)` | `useHotkey('A', () => toggleAccent(), { enabled: hasSelection })` |
| `key === 's' (no modifier)` | `useHotkey('S', () => toggleGhost(), { enabled: hasSelection })` |
| `key === '1'...'5' (no shift)` | `useHotkey('1', () => setTool('cursor'))` through `useHotkey('5', () => setTool('timesig'))` |
| `shiftKey && '1'...'6'` | `useHotkey('Shift+1', () => setGrid(4))` through `useHotkey('Shift+6', () => setGrid(64))` |
| `shiftKey && '0'` | `useHotkey('Shift+0', () => setGrid(0))` |

### TransportControls.tsx → useHotkey calls

Move the keyboard handling out of TransportControls into either the component itself or a dedicated `useTransportKeyboard` hook:

| Current | useHotkey call |
|---------|----------------|
| `key === ' '` (space) | `useHotkey('Space', () => togglePlayPause())` |
| `key === 'ArrowLeft'` | `useHotkey('ArrowLeft', () => seekBack())` |
| `key === 'ArrowRight'` | `useHotkey('ArrowRight', () => seekForward())` |
| `ctrlKey && 'ArrowLeft'` | `useHotkey('Mod+ArrowLeft', () => prevSection())` |
| `ctrlKey && 'ArrowRight'` | `useHotkey('Mod+ArrowRight', () => nextSection())` |
| `key === '['` | `useHotkey('[', () => decreaseSpeed())` |
| `key === ']'` | `useHotkey(']', () => increaseSpeed())` |

### SidebarProvider (components/ui/sidebar.tsx) → useHotkey

| Current | useHotkey call |
|---------|----------------|
| `(metaKey\|ctrlKey) && 'b'` | `useHotkey('Mod+B', () => toggleSidebar())` |

### EditorApp drum-transcription specifics → useHotkey calls

The `additionalShortcuts` callback pattern is eliminated. Instead, drum-transcription's EditorApp registers its own hotkeys directly:

| Current (via callback) | useHotkey call in EditorApp |
|------------------------|---------------------------|
| `key === 'Enter'` | `useHotkey('Enter', () => markReviewed(), { enabled: hasSelection })` |
| `key === 'n' && !shiftKey` | `useHotkey('N', () => nextLowConfidence())` |
| `key === 'n' && shiftKey` | `useHotkey('Shift+N', () => prevLowConfidence())` |
| `key === 'd'` | `useHotkey('D', () => toggleDrumsSolo())` |
| `key === 'm'` | `useHotkey('M', () => toggleDrumsMute())` |

## 3. Eliminating the additionalShortcuts Pattern

Currently `useEditorKeyboard` accepts an `additionalShortcuts` callback so page-specific code can inject extra shortcuts. With `useHotkey`, this pattern is unnecessary — each component simply calls `useHotkey` for its own shortcuts. They compose naturally because `useHotkey` hooks are independent.

**Remove:**
- The `additionalShortcuts` parameter from `useEditorKeyboard`
- The callback wiring in EditorApp

**Replace with:**
- Direct `useHotkey` calls in drum-transcription's EditorApp (or a `useDrumTranscriptionKeyboard` hook)

## 4. HotkeysProvider Setup

Add `HotkeysProvider` at the app layout level with sensible defaults:

```tsx
// app/layout.tsx or components/chart-editor/ChartEditor.tsx
import { HotkeysProvider } from '@tanstack/react-hotkeys'

<HotkeysProvider defaultOptions={{
  hotkey: { preventDefault: true },
}}>
  {children}
</HotkeysProvider>
```

This ensures all hotkeys preventDefault by default (matching current behavior).

## 5. Input Field Exclusion

Current code manually checks `e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement`. Verify that @tanstack/react-hotkeys handles this automatically. If not, configure it globally via the provider or per-hook options. If the library doesn't support this natively, add a wrapper:

```typescript
function useEditorHotkey(key: string, handler: () => void, options?: HotkeyOptions) {
  useHotkey(key, (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    handler();
  }, options);
}
```

## 6. UI Enhancement: Display Shortcuts in Tooltips

With `formatForDisplay`, update toolbar buttons and tool icons to show platform-aware shortcut hints:

```tsx
import { formatForDisplay } from '@tanstack/react-hotkeys'

// Tool button tooltip
<button title={`Cursor (${formatForDisplay('1')})`}>
  <CursorIcon />
</button>

// Undo button
<button title={`Undo (${formatForDisplay('Mod+Z')})`}>
  <UndoIcon />
</button>
```

This replaces any hardcoded "Ctrl+Z" / "⌘Z" strings with auto-detected platform shortcuts.

## Execution Order

1. **Add HotkeysProvider** to the editor shell (ChartEditor.tsx or app layout).

2. **Migrate useEditorKeyboard.ts** — replace the single addEventListener + switch/if-else with individual `useHotkey` calls. Remove the `additionalShortcuts` callback parameter. Keep the hook as a single hook that registers all shared editor shortcuts.

3. **Migrate TransportControls.tsx** — replace addEventListener with `useHotkey` calls inline in the component.

4. **Migrate SidebarProvider** — replace addEventListener with `useHotkey` in sidebar.tsx.

5. **Migrate drum-transcription EditorApp** — replace the additionalShortcuts callback with direct `useHotkey` calls (or a `useDrumTranscriptionKeyboard` hook).

6. **Verify input field exclusion** — test that typing in text inputs (e.g., section name popover, BPM input) doesn't trigger shortcuts.

7. **Update tooltip/UI strings** — use `formatForDisplay` for shortcut hints in toolbar buttons, menu items, and tooltips.

8. **Grep cleanup** — verify no remaining `addEventListener('keydown'` calls exist in the editor codebase (sidebar.tsx excluded if it's a third-party shadcn component — but it should be migrated too since it's our code).

## Verification

```bash
# Tests pass
yarn test
yarn lint

# No remaining raw keyboard listeners in editor code
grep -r "addEventListener.*keydown" components/chart-editor/ app/drum-transcription/ --include="*.ts" --include="*.tsx"
# Should return nothing

# No remaining raw keyboard listeners in sidebar
grep -r "addEventListener.*keydown" components/ui/sidebar.tsx
# Should return nothing
```

## Browser Testing (chrome-devtools MCP)

Use `public/All Time Low - SUCKERPUNCH (Hubbubble).sng` as the test chart. Load it in `/drum-edit`. Test every shortcut after migration:

1. **After migrating useEditorKeyboard (step 2)**:
   - Load the test chart in the editor
   - `press_key` 1 through 5 — verify tool switching works
   - `press_key` Shift+1 through Shift+6 — verify grid division changes
   - `press_key` Q, A, S with notes selected — verify flag toggles
   - `press_key` Ctrl+Z / Ctrl+Y — verify undo/redo
   - `press_key` Ctrl+C, navigate, Ctrl+V — verify copy/paste
   - `press_key` Delete — verify note deletion
   - `press_key` Ctrl+A — verify select all
   - `press_key` Escape — verify deselect
   - `press_key` Ctrl+S — verify save triggers
   - `list_console_messages` — no errors

2. **After migrating TransportControls (step 3)**:
   - `press_key` Space — verify play/pause toggle
   - `press_key` ArrowLeft / ArrowRight — verify seeking
   - `press_key` [ and ] — verify speed adjustment
   - `press_key` Ctrl+ArrowLeft / Ctrl+ArrowRight — verify section jumping
   - `take_screenshot` — verify transport UI reflects state changes

3. **After migrating SidebarProvider (step 4)**:
   - `press_key` Ctrl+B — verify sidebar toggles
   - `take_screenshot` — verify sidebar collapsed/expanded

4. **After migrating drum-transcription shortcuts (step 5)**:
   - Navigate to `/drum-transcription`, open a project
   - `press_key` N — verify jumps to next low-confidence note
   - `press_key` Shift+N — verify jumps to previous
   - `press_key` D — verify drums solo toggle
   - `press_key` M — verify drums mute toggle
   - Select notes, `press_key` Enter — verify marks as reviewed

5. **Input field exclusion test (step 6)**:
   - Switch to BPM tool, click highway to open BPM popover with text input
   - Type "120" in the input — verify pressing keys doesn't trigger tool switches or other shortcuts
   - `press_key` Escape in the input — verify it closes the popover (or verify it doesn't interfere)
   - `list_console_messages` — no errors

6. **Tooltip verification (step 7)**:
   - `take_screenshot` of the toolbar — verify shortcut hints show platform-appropriate symbols (⌘ on Mac, Ctrl on Windows)
   - Hover over Undo button — verify tooltip shows correct shortcut
