/**
 * Escape-key priority for the piano-roll panel (plan 0062 §12).
 *
 * "Escape clears an open context menu, then an in-flight gesture, then the
 * selection, when the panel has focus." The panel owns the first two tiers
 * (it's the only thing that knows about its menu / in-flight drag); the
 * third tier is the existing global "clear selection" hotkey
 * (`useEditorKeyboard`), which the panel must NOT also re-trigger on the same
 * keypress — hence a pure decision function the component consults before
 * deciding whether to consume the event (`stopPropagation`) or let it fall
 * through to the global handler.
 */

export type EscapeTier = 'menu' | 'gesture' | 'none';

/**
 * Which tier a single Escape keypress should resolve to, given the panel's
 * current state. `'none'` means the panel has nothing of its own to do —
 * the keypress should be left alone so the global Escape hotkey (selection
 * clear + tool reset) fires exactly once.
 */
export function resolveEscapeTier(
  hasOpenMenu: boolean,
  hasInFlightGesture: boolean,
): EscapeTier {
  if (hasOpenMenu) return 'menu';
  if (hasInFlightGesture) return 'gesture';
  return 'none';
}
