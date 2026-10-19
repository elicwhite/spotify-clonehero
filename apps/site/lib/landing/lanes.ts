/**
 * The five Clone Hero drum-lane gem colors, as CSS custom properties.
 *
 * The values live in `app/globals.css` under `.landing-lanes` (one definition
 * per theme); this module is only the names, so markup and canvas code refer
 * to the same five slots. These are the only illustrative colors the tool
 * landing pages use, and they are always used for the lane they name.
 */
export const LANE_VARS = {
  kick: 'var(--lane-kick)',
  red: 'var(--lane-red)',
  yellow: 'var(--lane-yellow)',
  blue: 'var(--lane-blue)',
  green: 'var(--lane-green)',
} as const;

export type LaneName = keyof typeof LANE_VARS;

/** Custom-property names in lane order (kick first, then left to right). */
export const LANE_PROPERTIES: readonly string[] = [
  '--lane-kick',
  '--lane-red',
  '--lane-yellow',
  '--lane-blue',
  '--lane-green',
];

/**
 * Fallbacks matching the dark values in globals.css, used only if a canvas
 * reads the properties before the stylesheet applies.
 */
export const LANE_FALLBACKS: readonly string[] = [
  '#ff9a3d',
  '#e5484d',
  '#f5c531',
  '#4c8dff',
  '#46c46b',
];
