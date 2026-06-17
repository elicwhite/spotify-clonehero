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
import {buildTimedTempoMap, msToTick} from './timing';

export interface ChartLyricsResult {
  lyrics: {tick: number; length: number; text: string}[];
  vocalPhrases: {tick: number; length: number}[];
}

// Gap-based phrase boundary constants (autoresearch exp23, top-80% by Viterbi
// quality). Joint metric (2*median + p90) sweet spot vs the alternatives.
//   preroll  = min(PHRASE_START_PREROLL_MS, backward_gap * PRE_GAP_FRAC)
//   postroll = min(PHRASE_END_POSTROLL_MS,  forward_gap  * POST_GAP_FRAC)
// The gap-fraction caps guarantee phrase[i].end <= phrase[i+1].start.
const PHRASE_START_PREROLL_MS = 240;
const PRE_GAP_FRAC = 0.55;
const PHRASE_END_POSTROLL_MS = 180;
const POST_GAP_FRAC = 0.25;

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

  // Group syllables into phrases via newLine markers.
  const phraseRanges: [number, number][] = [];
  let cur = 0;
  for (let i = 1; i < syllables.length; i++) {
    if (syllables[i].newLine) {
      phraseRanges.push([cur, i]);
      cur = i;
    }
  }
  phraseRanges.push([cur, syllables.length]);

  const firstOnsetMs = phraseRanges.map(([s]) => syllables[s].startMs);
  const lastEndMs = phraseRanges.map(([, e]) => syllables[e - 1].endMs);

  const vocalPhrases: {tick: number; length: number}[] = [];

  for (let p = 0; p < phraseRanges.length; p++) {
    const backwardGap =
      p === 0
        ? firstOnsetMs[p]
        : Math.max(0, firstOnsetMs[p] - lastEndMs[p - 1]);
    const forwardGap =
      p + 1 < phraseRanges.length
        ? Math.max(0, firstOnsetMs[p + 1] - lastEndMs[p])
        : Number.POSITIVE_INFINITY;

    const preroll = Math.min(
      PHRASE_START_PREROLL_MS,
      backwardGap * PRE_GAP_FRAC,
    );
    const postroll = Math.min(
      PHRASE_END_POSTROLL_MS,
      forwardGap * POST_GAP_FRAC,
    );

    const phraseStartMs = Math.max(0, firstOnsetMs[p] - preroll);
    const phraseEndMs = lastEndMs[p] + postroll;

    const phraseStartTick = msToTick(phraseStartMs, timedTempos, resolution);
    const phraseEndTick = msToTick(phraseEndMs, timedTempos, resolution);

    vocalPhrases.push({
      tick: phraseStartTick,
      length: Math.max(0, phraseEndTick - phraseStartTick),
    });
  }

  for (let i = 0; i < syllables.length; i++) {
    const syl = syllables[i];
    const tick = msToTick(syl.startMs, timedTempos, resolution);

    let text = syl.text.replace(/-/g, '=');
    if (syl.joinNext) text += '-';

    lyrics.push({tick, length: 0, text});
  }

  return {lyrics, vocalPhrases};
}
