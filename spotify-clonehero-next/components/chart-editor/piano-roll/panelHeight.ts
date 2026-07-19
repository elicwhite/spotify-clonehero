/**
 * Piano-roll panel height persistence (plan 0062 §1).
 *
 * The panel is user-resizable via a drag handle on its top edge. The height
 * is persisted to `localStorage` under **one key shared across all three
 * host pages** (`/drum-transcription`, `/drum-edit`, `/add-lyrics`) — it's
 * one editor, one panel, one height; per-page keys would make the same
 * editor feel inconsistent (§1).
 *
 * Pure read/write/clamp helpers, no React — the component owns the drag
 * gesture and calls these at drag-start (load) and drag-end (save).
 */

/** Shared localStorage key — same panel, same height, on every host page. */
export const PANEL_HEIGHT_STORAGE_KEY = 'chart-editor:piano-roll-panel-height';

/** Sane default (§1: "~220–260px"). */
export const DEFAULT_PANEL_HEIGHT = 240;

export const MIN_PANEL_HEIGHT = 160;
export const MAX_PANEL_HEIGHT = 560;

/** Clamp a candidate height to the panel's supported range. */
export function clampPanelHeight(height: number): number {
  if (!Number.isFinite(height)) return DEFAULT_PANEL_HEIGHT;
  return Math.max(MIN_PANEL_HEIGHT, Math.min(MAX_PANEL_HEIGHT, height));
}

/**
 * Read the persisted panel height. Falls back to {@link DEFAULT_PANEL_HEIGHT}
 * when there's no stored value, the value is unparseable, `localStorage`
 * throws (private-mode / disabled storage), or we're not in a browser
 * (SSR / test) at all.
 */
export function loadPanelHeight(
  storage: Pick<Storage, 'getItem'> | null = typeof window === 'undefined'
    ? null
    : window.localStorage,
): number {
  if (!storage) return DEFAULT_PANEL_HEIGHT;
  try {
    const raw = storage.getItem(PANEL_HEIGHT_STORAGE_KEY);
    if (raw === null) return DEFAULT_PANEL_HEIGHT;
    const parsed = Number.parseFloat(raw);
    return clampPanelHeight(parsed);
  } catch {
    return DEFAULT_PANEL_HEIGHT;
  }
}

/**
 * Persist a panel height (clamped first). Swallows storage errors (quota,
 * private mode) — persistence is a nicety, not a hard requirement.
 */
export function savePanelHeight(
  height: number,
  storage: Pick<Storage, 'setItem'> | null = typeof window === 'undefined'
    ? null
    : window.localStorage,
): void {
  if (!storage) return;
  try {
    storage.setItem(PANEL_HEIGHT_STORAGE_KEY, String(clampPanelHeight(height)));
  } catch {
    // Ignore — e.g. Safari private mode throws on setItem.
  }
}
