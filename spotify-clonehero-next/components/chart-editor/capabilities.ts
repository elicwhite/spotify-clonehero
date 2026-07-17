/**
 * EditorCapabilities — switches that decide what the chart editor surfaces
 * for interaction at the current page.
 *
 * Two presets ship today:
 *
 *  - {@link DRUM_EDIT_CAPABILITIES}: full drum editing (notes + sections
 *    selectable + draggable, drum lanes + placement tools rendered).
 *  - {@link ADD_LYRICS_CAPABILITIES}: lyrics + phrase markers selectable
 *    + draggable; notes and sections render but are inert; drum lanes and
 *    placement tools are hidden.
 *  - {@link PREVIEW_CAPABILITIES}: read-only playback — nothing is
 *    interactive on the highway and all editing chrome is hidden; only
 *    playback-related sidebar controls (loop, speed, zoom, highway mode)
 *    remain.
 *
 * Pages mount `<ChartEditor capabilities={...}>` to pick a profile. Pages
 * that omit the prop fall back to drum-edit for backward compatibility.
 */

import type {EntityKind} from '@/lib/chart-edit';

export interface EditorCapabilities {
  /** Entity kinds that respond to hover (cursor change, hit feedback). */
  hoverable: ReadonlySet<EntityKind>;
  /** Entity kinds that can be added to the selection. */
  selectable: ReadonlySet<EntityKind>;
  /**
   * Entity kinds that can be drag-moved on the highway. Should be a subset
   * of `selectable` — hover/select must precede drag.
   */
  draggable: ReadonlySet<EntityKind>;
  /** Show the drum-note placement / erase / flag tools in the toolbar. */
  showNotePlacementTools: boolean;
  /**
   * Render the drum highway: 5 lanes, hit box, drum-note geometry. When
   * false, the highway draws a neutral floor with no lanes — lyrics +
   * phrase + section markers still render normally.
   */
  showDrumLanes: boolean;
  /**
   * Show the sidebar's Tools section (cursor / place / erase / bpm /
   * timesig / section). Add-lyrics suppresses this since the only valid
   * tool is the cursor — no choice to surface.
   */
  showToolPalette: boolean;
  /**
   * Show the sidebar's Highway-mode toggle (Classic ↔ Waveform).
   * Add-lyrics pins the highway to Waveform, so the toggle is hidden.
   */
  showHighwayModeToggle: boolean;
  /**
   * Show the sidebar's Sheet Music toggle, which opens a VexFlow notation
   * pane beside the highway (the inverse of /sheet-music, where notation
   * is primary and the highway is the optional pane). Only meaningful for
   * charts with a drums track — the sidebar also checks that.
   */
  showSheetMusicToggle: boolean;
  /**
   * Show the sidebar's Vocal Part picker on multi-part vocal charts.
   * Add-lyrics suppresses this — the aligner only writes lyrics to the
   * primary vocals track, so exposing other parts would mislead.
   */
  showVocalPartPicker: boolean;
  /**
   * Show sidebar controls that only matter when the chart can be edited
   * (grid snapping, undo/redo history). Read-only pages hide them.
   */
  showEditingControls: boolean;
}

export const DRUM_EDIT_CAPABILITIES: EditorCapabilities = {
  hoverable: new Set(['note', 'section']),
  selectable: new Set(['note', 'section']),
  draggable: new Set(['note', 'section']),
  showNotePlacementTools: true,
  showDrumLanes: true,
  showToolPalette: true,
  showHighwayModeToggle: true,
  showSheetMusicToggle: false,
  showVocalPartPicker: true,
  showEditingControls: true,
};

export const ADD_LYRICS_CAPABILITIES: EditorCapabilities = {
  hoverable: new Set(['lyric', 'phrase-start', 'phrase-end']),
  selectable: new Set(['lyric', 'phrase-start', 'phrase-end']),
  draggable: new Set(['lyric', 'phrase-start', 'phrase-end']),
  showNotePlacementTools: false,
  showDrumLanes: false,
  showToolPalette: false,
  showHighwayModeToggle: false,
  showSheetMusicToggle: false,
  showVocalPartPicker: false,
  showEditingControls: true,
};

export const PREVIEW_CAPABILITIES: EditorCapabilities = {
  hoverable: new Set(),
  selectable: new Set(),
  draggable: new Set(),
  showNotePlacementTools: false,
  showDrumLanes: true,
  showToolPalette: false,
  showHighwayModeToggle: true,
  showSheetMusicToggle: true,
  showVocalPartPicker: true,
  showEditingControls: false,
};
