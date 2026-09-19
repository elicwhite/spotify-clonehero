/**
 * A chart that carries lyrics must export a `song.ini` that says so.
 *
 * Neither chart format carries `diff_vocals`, so `song.ini` is the only place
 * an exported package declares that it has a vocals part. Left at the `-1`
 * sentinel, a chart the Add Lyrics flow just wrote lyrics into still lists
 * drums alone in every chart browser and part picker — the lyrics ship inside
 * the package, but nothing says they are there.
 *
 * These tests read the emitted `song.ini` back with this project's ini parser,
 * which is the file a chart manager actually reads.
 */

import {describe, test, expect} from '@jest/globals';
import type {ChartDocument} from '@eliwhite/scan-chart';

import {createEmptyChart} from '@/lib/chart-edit';
import {emptyTrackData, mkNote} from '@/lib/chart-edit/__tests__/test-utils';
import {noteTypes} from '@eliwhite/scan-chart';
import {applyAlignedLyricsToDoc} from '@/lib/lyrics-align/apply-lyrics';
import {parse as parseIni, $NoSection} from '@/lib/ini-parser';

import {assembleChartFiles, type ChartPackageMetadata} from '../assemble';

const IDENTITY: ChartPackageMetadata = {
  name: 'Test Song',
  artist: 'Test Artist',
  charter: 'Test Charter',
};

/** One aligned syllable — enough to make the chart carry lyrics. */
const SYLLABLES = [{text: 'la', startMs: 1000, endMs: 1200}] as never[];

/** A minted drums chart, the shape `/drum-transcription` hands to export. */
function drumsDoc(): ChartDocument {
  const parsedChart = createEmptyChart({
    format: 'chart',
    resolution: 480,
    bpm: 120,
    timeSignature: {numerator: 4, denominator: 4},
  });
  return {
    parsedChart: {
      ...parsedChart,
      trackData: [
        emptyTrackData('drums', 'expert', {
          noteEventGroups: [
            [mkNote({tick: 480, length: 0, type: noteTypes.kick, flags: 0})],
          ],
        }),
      ],
    },
    assets: [],
  };
}

/** The `[song]` section of the assembled package's `song.ini`. */
function assembledIni(
  chartDoc: ChartDocument,
  metadata: ChartPackageMetadata = IDENTITY,
): Record<string, string> {
  const entries = assembleChartFiles({chartDoc, metadata});
  const ini = entries.find(f => f.fileName === 'song.ini');
  expect(ini).toBeDefined();
  const {iniObject, iniErrors} = parseIni(ini!.data as Uint8Array);
  expect(iniErrors).toEqual([]);
  return iniObject['song'] ?? iniObject[$NoSection] ?? {};
}

describe('assembleChartFiles vocals declaration', () => {
  test('declares diff_vocals once the chart carries lyrics', () => {
    const song = assembledIni(applyAlignedLyricsToDoc(drumsDoc(), SYLLABLES));

    expect(song['diff_vocals']).toBe('0');
    // The drums the chart already had are still declared beside it.
    expect(song['pro_drums']).toBe('True');
  });

  test('does not declare a vocals part the chart never had', () => {
    const song = assembledIni(drumsDoc());

    expect(song['diff_vocals']).toBeUndefined();
  });

  test('keeps an intensity the chart already declared', () => {
    const withLyrics = applyAlignedLyricsToDoc(drumsDoc(), SYLLABLES);
    const song = assembledIni({
      ...withLyrics,
      parsedChart: {
        ...withLyrics.parsedChart,
        metadata: {...withLyrics.parsedChart.metadata, diff_vocals: 4},
      },
    });

    expect(song['diff_vocals']).toBe('4');
  });

  // Round-trip mode ships somebody else's metadata untouched by contract (see
  // `RoundTripChartOptions`), so it declares nothing here either. The export
  // dialog always supplies `metadata`, so every export a user can trigger goes
  // through the minting branch above.
  test('round-trip mode leaves the chart’s own metadata alone', () => {
    const withLyrics = applyAlignedLyricsToDoc(drumsDoc(), SYLLABLES);
    const entries = assembleChartFiles({chartDoc: withLyrics});
    const ini = entries.find(f => f.fileName === 'song.ini');
    const {iniObject} = parseIni(ini!.data as Uint8Array);
    const song = iniObject['song'] ?? iniObject[$NoSection] ?? {};

    expect(song['diff_vocals']).toBeUndefined();
  });
});
