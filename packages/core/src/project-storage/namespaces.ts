/**
 * The OPFS directories the user's own projects live in.
 *
 * A leaf module on purpose. The storage readout needs these names and nothing
 * else, and reaching them through `projects.ts` would pull the chart parser,
 * the .sng reader and the editor core into the page a user opens because their
 * device is out of room.
 */

/** The namespace new chart-package projects are written to. */
export const CHART_EDITOR_NAMESPACE = 'chart-editor';

/**
 * Namespaces written by routes that have since been folded into
 * `/chart-editor`. Their projects stay listable and editable in place.
 */
export const CHART_EDITOR_LEGACY_NAMESPACES = [
  'drum-edit',
  'guitar-edit',
  'bass-edit',
] as const;

/** The drum-transcription pipeline's own project namespace. */
export const DRUM_TRANSCRIPTION_NAMESPACE = 'drum-transcription';
