/**
 * Reconciler-key format for highway markers.
 *
 * Notes:
 *   - Section / BPM / time-signature keys stay flat: `section:480`, `bpm:480`, `ts:480`.
 *     These markers are chart-wide.
 *   - Lyric / phrase-start / phrase-end keys are namespaced by vocal part:
 *     `lyric:vocals:480`, `phrase-start:harm1:480`, `phrase-end:harm2:1920`.
 *     A chart with harmonies has parallel `lyric` markers at the same tick
 *     for different parts; without the part in the key the reconciler would
 *     reuse one element for two logical entities.
 *
 * Producer (`chartToElements`), consumer (`useChartElements` drag overlay,
 * `useHighwayMouseInteraction` hover state), and parser
 * (`InteractionManager.elementToMarkerHit`) all go through these helpers
 * so the format can never drift.
 */

export type ChartMarkerKind = 'section' | 'bpm' | 'ts';
export type VocalMarkerKind = 'lyric' | 'phrase-start' | 'phrase-end';

export function chartMarkerKey(kind: ChartMarkerKind, tick: number): string {
  return `${kind}:${tick}`;
}

export function vocalMarkerKey(
  kind: VocalMarkerKind,
  partName: string,
  tick: number,
): string {
  return `${kind}:${partName}:${tick}`;
}

/** Parse a marker key into its components, or null if it doesn't match. */
export function parseMarkerKey(
  key: string,
):
  | {kind: ChartMarkerKind; tick: number}
  | {kind: VocalMarkerKind; partName: string; tick: number}
  | null {
  // Vocal markers have three colon-separated segments.
  if (
    key.startsWith('lyric:') ||
    key.startsWith('phrase-start:') ||
    key.startsWith('phrase-end:')
  ) {
    const firstColon = key.indexOf(':');
    const secondColon = key.indexOf(':', firstColon + 1);
    if (secondColon === -1) return null;
    const kind = key.slice(0, firstColon) as VocalMarkerKind;
    const partName = key.slice(firstColon + 1, secondColon);
    const tick = parseInt(key.slice(secondColon + 1), 10);
    if (Number.isNaN(tick)) return null;
    return {kind, partName, tick};
  }
  // Chart-wide markers have two segments.
  if (
    key.startsWith('section:') ||
    key.startsWith('bpm:') ||
    key.startsWith('ts:')
  ) {
    const colon = key.indexOf(':');
    const kind = key.slice(0, colon) as ChartMarkerKind;
    const tick = parseInt(key.slice(colon + 1), 10);
    if (Number.isNaN(tick)) return null;
    return {kind, tick};
  }
  return null;
}
