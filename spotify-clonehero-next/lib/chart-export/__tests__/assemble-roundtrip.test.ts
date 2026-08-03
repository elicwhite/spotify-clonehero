/**
 * Tests for `assembleChartFiles`'s round-trip mode — `metadata` omitted.
 *
 * Flows that MINT a chart (drum transcription) supply
 * metadata and get the chart stamped with that identity plus drum ratings.
 * Flows that EDIT somebody else's chart and hand it back (/add-lyrics) omit
 * it, and must get the document's own metadata through untouched: stamping
 * `pro_drums` onto a guitar-only chart, or renaming its charter, would
 * corrupt a chart the user is merely round-tripping.
 */

import {describe, test, expect} from '@jest/globals';
import type {ChartDocument} from '@eliwhite/scan-chart';

import {createEmptyChart} from '@/lib/chart-edit';

import {assembleChartFiles} from '../assemble';

function chartDoc(
  overrides: Partial<ChartDocument['parsedChart']['metadata']> = {},
): ChartDocument {
  const parsedChart = createEmptyChart();
  return {
    parsedChart: {
      ...parsedChart,
      metadata: {
        ...parsedChart.metadata,
        name: 'Original Name',
        artist: 'Original Artist',
        charter: 'Original Charter',
        genre: 'Rock',
        year: '2024',
        ...overrides,
      },
    },
    assets: [],
  };
}

function songIniText(entries: {fileName: string; data: Uint8Array}[]): string {
  const songIni = entries.find(e => e.fileName === 'song.ini');
  if (!songIni) throw new Error('assembleChartFiles produced no song.ini');
  return new TextDecoder().decode(songIni.data);
}

describe('assembleChartFiles round-trip mode (no metadata)', () => {
  test('ships the document’s own identity untouched', () => {
    const ini = songIniText(assembleChartFiles({chartDoc: chartDoc()}));

    expect(ini).toContain('name = Original Name');
    expect(ini).toContain('artist = Original Artist');
    expect(ini).toContain('charter = Original Charter');
    expect(ini).toContain('genre = Rock');
  });

  test('does not declare drum ratings the chart never had', () => {
    const ini = songIniText(assembleChartFiles({chartDoc: chartDoc()}));

    expect(ini).not.toMatch(/pro_drums/);
    expect(ini).not.toMatch(/diff_drums/);
  });

  test('leaves song_length alone rather than recomputing it', () => {
    const ini = songIniText(
      assembleChartFiles({chartDoc: chartDoc({song_length: 12345})}),
    );

    expect(ini).toContain('song_length = 12345');
  });

  test('does not mutate the caller’s document', () => {
    const doc = chartDoc();
    assembleChartFiles({chartDoc: doc});

    expect(doc.parsedChart.metadata.charter).toBe('Original Charter');
    expect(doc.parsedChart.metadata.pro_drums).toBeUndefined();
  });

  test('still appends audio sources and extra assets', () => {
    const entries = assembleChartFiles({
      chartDoc: chartDoc(),
      audioSources: [{fileName: 'song.opus', data: new Uint8Array([1, 2])}],
      extraAssets: [{fileName: 'album.png', data: new Uint8Array([3, 4])}],
    });

    const names = entries.map(e => e.fileName);
    expect(names).toContain('song.opus');
    expect(names).toContain('album.png');
  });

  test('rejects a half-configured stamp at compile time', () => {
    // `songLengthMs` has nothing to stamp onto without `metadata`. The union
    // makes that a type error rather than a silently dropped option — this
    // assertion fails `pnpm typecheck` if the guarantee ever regresses.
    const options = {
      chartDoc: chartDoc({song_length: 999}),
      songLengthMs: 12345,
    };
    // @ts-expect-error songLengthMs without metadata is not a valid mode
    const entries = assembleChartFiles(options);

    expect(songIniText(entries)).toContain('song_length = 999');
  });

  test('supplying metadata still stamps identity and ratings', () => {
    const ini = songIniText(
      assembleChartFiles({
        chartDoc: chartDoc(),
        metadata: {name: 'New', artist: 'New Artist', charter: 'New Charter'},
      }),
    );

    expect(ini).toContain('name = New');
    expect(ini).toContain('charter = New Charter');
    expect(ini).toMatch(/pro_drums/);
    expect(ini).toMatch(/diff_drums/);
  });
});
