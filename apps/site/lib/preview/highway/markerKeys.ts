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
 * The producer (`chartToElements`) and the piano roll both go through these
 * helpers so the format can never drift.
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
