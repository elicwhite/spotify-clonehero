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
