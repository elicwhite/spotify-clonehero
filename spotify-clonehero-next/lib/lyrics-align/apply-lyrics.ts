/**
 * Apply aligned lyric syllables to a chart document's PART VOCALS track.
 */

import type {ChartDocument} from '@/lib/chart-edit';
import {alignedSyllablesToChartLyrics} from './chart-lyrics';
import type {AlignedSyllable} from './aligner';
import {buildTimedTempos, tickToMs} from '@/lib/drum-transcription/timing';

/**
 * Clone + apply aligned lyrics to the chart document's PART VOCALS track.
 * Produces a new ChartDocument that writeChartFolder() can serialize with lyrics.
 *
 * Replaces both `notePhrases` and `staticLyricPhrases` on the vocals part:
 * scan-chart's MIDI writer unions both arrays when emitting lyric events, so
 * leaving the originals in place would cause duplicate (old + new) lyrics
 * on save.
 *
 * msTime fields are computed from each tick using the chart's tempo map so
 * the highway can position lyrics correctly. (scan-chart's parser fills
 * these in on parse, but we're constructing the doc directly here.)
 */
export function applyAlignedLyricsToDoc(
  source: ChartDocument,
  syllables: AlignedSyllable[],
): ChartDocument {
  const {lyrics: chartLyrics, vocalPhrases} = alignedSyllablesToChartLyrics(
    syllables,
    source.parsedChart.tempos,
    source.parsedChart.resolution,
  );

  const resolution = source.parsedChart.resolution;
  const timedTempos = buildTimedTempos(source.parsedChart.tempos, resolution);
  const tickMs = (tick: number) => tickToMs(tick, timedTempos, resolution);

  // Group lyric events under each phrase and pair each lyric with a placeholder
  // pitched note (required so scan-chart keeps the phrase on round-trip).
  const notePhrases = vocalPhrases.map(phrase => {
    const phraseLyrics = chartLyrics.filter(
      l => l.tick >= phrase.tick && l.tick <= phrase.tick + phrase.length,
    );
    const phraseMsStart = tickMs(phrase.tick);
    const phraseMsEnd = tickMs(phrase.tick + phrase.length);
    return {
      tick: phrase.tick,
      msTime: phraseMsStart,
      length: phrase.length,
      msLength: phraseMsEnd - phraseMsStart,
      isPercussion: false,
      notes: phraseLyrics.map(l => ({
        tick: l.tick,
        msTime: tickMs(l.tick),
        length: 60,
        msLength: tickMs(l.tick + 60) - tickMs(l.tick),
        pitch: 60,
        type: 'pitched' as const,
      })),
      lyrics: phraseLyrics.map(l => ({
        tick: l.tick,
        msTime: tickMs(l.tick),
        text: l.text,
        flags: 0,
      })),
    };
  });

  const existingVocals = source.parsedChart.vocalTracks?.parts?.['vocals'];
  const vocalsPart = {
    ...(existingVocals ?? {
      staticLyricPhrases: [],
      starPowerSections: [],
      rangeShifts: [],
      lyricShifts: [],
      textEvents: [],
    }),
    notePhrases,
    // Clear staticLyricPhrases so scan-chart's writer doesn't union them
    // with the new notePhrases and emit duplicate lyrics.
    staticLyricPhrases: [],
  };

  const doc: ChartDocument = {
    ...source,
    parsedChart: {
      ...source.parsedChart,
      vocalTracks: {
        ...source.parsedChart.vocalTracks,
        parts: {
          ...source.parsedChart.vocalTracks?.parts,
          vocals: vocalsPart,
        },
      },
    },
  };

  return doc;
}
