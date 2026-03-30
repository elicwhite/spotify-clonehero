import type {ParsedChart} from '../chorus-chart-processing';
import type {ChartElement} from './SceneReconciler';
import type {MarkerElementData} from './MarkerRenderer';
import {trackToElements} from './trackToElements';
import type {Track} from './types';

// ---------------------------------------------------------------------------
// chartToElements
// ---------------------------------------------------------------------------

/**
 * Converts a ParsedChart + Track to a combined ChartElement[] containing
 * notes, sections, lyrics, vocal phrases, BPM changes, and time signatures.
 *
 * Notes come from the existing trackToElements(). All other marker types
 * are extracted from the ParsedChart's global metadata.
 */
export function chartToElements(
  parsedChart: ParsedChart,
  track: Track,
): ChartElement[] {
  const elements: ChartElement[] = [];

  // Notes (existing converter)
  elements.push(...trackToElements(track));

  // Sections
  for (const section of parsedChart.sections) {
    elements.push({
      key: `section:${section.tick}`,
      kind: 'section',
      msTime: section.msTime,
      data: {text: section.name} satisfies MarkerElementData,
    });
  }

  // Lyrics
  for (const lyric of parsedChart.lyrics) {
    elements.push({
      key: `lyric:${lyric.tick}`,
      kind: 'lyric',
      msTime: lyric.msTime,
      data: {text: lyric.text} satisfies MarkerElementData,
    });
  }

  // Vocal phrases (start and end markers)
  for (const phrase of parsedChart.vocalPhrases) {
    elements.push({
      key: `phrase-start:${phrase.tick}`,
      kind: 'phrase-start',
      msTime: phrase.msTime,
      data: {text: 'phrase \u25B6'} satisfies MarkerElementData,
    });
    const endTick = phrase.tick + phrase.length;
    const endMs = phrase.msTime + phrase.msLength;
    elements.push({
      key: `phrase-end:${endTick}`,
      kind: 'phrase-end',
      msTime: endMs,
      data: {text: 'phrase \u25A0'} satisfies MarkerElementData,
    });
  }

  // BPM changes (tempos)
  for (const tempo of parsedChart.tempos) {
    elements.push({
      key: `bpm:${tempo.tick}`,
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
      key: `ts:${ts.tick}`,
      kind: 'ts',
      msTime: ts.msTime,
      data: {
        text: `${ts.numerator}/${ts.denominator}`,
      } satisfies MarkerElementData,
    });
  }

  return elements;
}
