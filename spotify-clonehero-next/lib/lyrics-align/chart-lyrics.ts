/**
 * Convert aligned syllables to Clone Hero chart lyrics format.
 *
 * Clone Hero lyrics conventions:
 * - Each syllable is a separate lyric event at a tick position
 * - Hyphen suffix (`-`) means syllable continues into the next (same word)
 * - No suffix = word boundary (space before next word in display)
 * - Literal hyphens in text use `=` instead
 * - `phrase_start` / `phrase_end` events wrap each display line
 */

import type {AlignedSyllable} from './aligner';
import {buildTimedTempoMap, msToTick, type TimedTempo} from './timing';

export interface ChartLyricsResult {
  lyrics: {tick: number; length: number; text: string}[];
  vocalPhrases: {tick: number; length: number}[];
}

/**
 * Convert aligned syllables to chart-edit's lyrics format.
 *
 * @param syllables - Aligned syllables from the aligner (with newLine markers).
 * @param tempos - Tempo map from ChartDocument (beatsPerMinute).
 * @param resolution - Ticks per beat (chartTicksPerBeat).
 */
export function alignedSyllablesToChartLyrics(
  syllables: AlignedSyllable[],
  tempos: {tick: number; beatsPerMinute: number}[],
  resolution: number,
): ChartLyricsResult {
  if (syllables.length === 0) return {lyrics: [], vocalPhrases: []};

  const timedTempos = buildTimedTempoMap(tempos, resolution);

  const lyrics: {tick: number; length: number; text: string}[] = [];
  const vocalPhrases: {tick: number; length: number}[] = [];

  // Track phrase boundaries using newLine markers
  let phraseStartTick = -1;
  let phraseLastTick = 0;

  for (let i = 0; i < syllables.length; i++) {
    const syl = syllables[i];
    const tick = msToTick(syl.startMs, timedTempos, resolution);

    // Start a new phrase on newLine boundaries
    if (syl.newLine && phraseStartTick >= 0) {
      // Close previous phrase
      vocalPhrases.push({
        tick: phraseStartTick,
        length: Math.max(phraseLastTick - phraseStartTick, resolution),
      });
    }
    if (syl.newLine || phraseStartTick < 0) {
      phraseStartTick = tick;
    }
    phraseLastTick = tick;

    // Format syllable text per Clone Hero spec
    let text = syl.text;
    // Escape literal hyphens as `=`
    text = text.replace(/-/g, '=');
    // Append continuation hyphen if this syllable joins with the next
    if (syl.joinNext) {
      text += '-';
    }

    lyrics.push({tick, length: 0, text});
  }

  // Close final phrase
  if (phraseStartTick >= 0) {
    vocalPhrases.push({
      tick: phraseStartTick,
      length: Math.max(phraseLastTick - phraseStartTick, resolution),
    });
  }

  return {lyrics, vocalPhrases};
}
