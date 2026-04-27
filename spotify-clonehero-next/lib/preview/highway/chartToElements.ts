import type {ParsedChart} from '../chorus-chart-processing';
import type {ChartElement} from './SceneReconciler';
import type {MarkerElementData} from './MarkerRenderer';
import {trackToElements} from './trackToElements';
import type {Track} from './types';
import {chartMarkerKey, vocalMarkerKey} from './markerKeys';

// ---------------------------------------------------------------------------
// chartToElements
// ---------------------------------------------------------------------------

/**
 * Converts a ParsedChart + (optional) Track to a combined ChartElement[]
 * containing notes, sections, lyrics, vocal phrases, BPM changes, and
 * time signatures.
 *
 * Notes come from the existing trackToElements(). All other marker types
 * are extracted from the ParsedChart's global metadata.
 *
 * `track` is optional: pages that edit something other than a notes
 * track (e.g. add-lyrics with `EditorScope = { kind: 'vocals' }`) pass
 * `null` and only the chart-wide markers + lyric + phrase elements are
 * produced.
 *
 * `vocalPartName` selects which vocal part contributes lyrics + phrase
 * markers. Defaults to `'vocals'`. Used by add-lyrics to switch between
 * `vocals` / `harm1` / `harm2` / `harm3` on multi-part charts.
 */
export function chartToElements(
  parsedChart: ParsedChart,
  track: Track | null,
  vocalPartName: string = 'vocals',
): ChartElement[] {
  const elements: ChartElement[] = [];

  // Notes (existing converter) — skipped when no track is being edited.
  if (track) {
    elements.push(...trackToElements(track));
  }

  // Sections
  for (const section of parsedChart.sections) {
    elements.push({
      key: chartMarkerKey('section', section.tick),
      kind: 'section',
      msTime: section.msTime,
      data: {text: section.name} satisfies MarkerElementData,
    });
  }

  // Lyrics + phrases for the active vocal part. Only one part is shown
  // at a time; the picker in LeftSidebar switches the part.
  const activePart = parsedChart.vocalTracks?.parts?.[vocalPartName];
  const lyrics = activePart?.notePhrases.flatMap(p => p.lyrics) ?? [];
  for (const lyric of lyrics) {
    elements.push({
      key: vocalMarkerKey('lyric', vocalPartName, lyric.tick),
      kind: 'lyric',
      msTime: lyric.msTime,
      data: {text: lyric.text} satisfies MarkerElementData,
    });
  }

  // Vocal phrases (start and end markers)
  const vocalPhrases = activePart?.notePhrases ?? [];
  for (const phrase of vocalPhrases) {
    elements.push({
      key: vocalMarkerKey('phrase-start', vocalPartName, phrase.tick),
      kind: 'phrase-start',
      msTime: phrase.msTime,
      data: {text: 'phrase \u25B6'} satisfies MarkerElementData,
    });
    const endTick = phrase.tick + phrase.length;
    const endMs = phrase.msTime + phrase.msLength;
    elements.push({
      key: vocalMarkerKey('phrase-end', vocalPartName, endTick),
      kind: 'phrase-end',
      msTime: endMs,
      data: {text: 'phrase \u25A0'} satisfies MarkerElementData,
    });
  }

  // BPM changes (tempos)
  for (const tempo of parsedChart.tempos) {
    elements.push({
      key: chartMarkerKey('bpm', tempo.tick),
      kind: 'bpm',
      msTime: tempo.msTime,
      data: {
        text: `\u2669 ${tempo.beatsPerMinute.toFixed(2)}`,
      } satisfies MarkerElementData,
    });
  }

  // Time signatures
  for (const ts of parsedChart.timeSignatures) {
    elements.push({
      key: chartMarkerKey('ts', ts.tick),
      kind: 'ts',
      msTime: ts.msTime,
      data: {
        text: `${ts.numerator}/${ts.denominator}`,
      } satisfies MarkerElementData,
    });
  }

  // Compute stack indices for markers at the same tick on the same side.
  // Group by tick+side, then assign increasing stackIndex within each group.
  const LEFT_KINDS = new Set(['lyric', 'phrase-start', 'phrase-end', 'bpm']);
  const RIGHT_KINDS = new Set(['section', 'ts']);
  const markerElements = elements.filter(e => e.kind !== 'note');

  // Group markers by msTime rounded to 1ms (close enough to overlap visually)
  const groups = new Map<string, ChartElement[]>();
  for (const el of markerElements) {
    const side = LEFT_KINDS.has(el.kind)
      ? 'L'
      : RIGHT_KINDS.has(el.kind)
        ? 'R'
        : null;
    if (!side) continue;
    const groupKey = `${side}:${Math.round(el.msTime)}`;
    let group = groups.get(groupKey);
    if (!group) {
      group = [];
      groups.set(groupKey, group);
    }
    group.push(el);
  }

  // Assign stackIndex to groups with more than one marker
  for (const group of groups.values()) {
    if (group.length <= 1) continue;
    for (let i = 0; i < group.length; i++) {
      (group[i].data as MarkerElementData).stackIndex = i;
    }
  }

  return elements;
}
