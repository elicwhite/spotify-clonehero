/**
 * Tests for `assembleChartFiles`'s `chartDoc` option — an already-parsed
 * (and possibly modified) `ChartDocument` supplied directly, bypassing the
 * internal `chartText`/`chartFile` parse. Added for the `/difficulties`
 * page's chart export (merges Ours' reduced tracks into the uploaded
 * chart's `trackData` before assembly), which needs the real, `song.ini`-
 * merged metadata (e.g. `delay`) that a chart-file-only parse can't see.
 */

import {describe, test, expect} from '@jest/globals';
import type {ChartDocument} from '@eliwhite/scan-chart';

import {createEmptyChart} from '@/lib/chart-edit';

import {assembleChartFiles} from '../assemble';

function chartDocWithMetadata(
  overrides: Partial<ChartDocument['parsedChart']['metadata']>,
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
        delay: 250,
        genre: 'Rock',
        year: '2024',
        ...overrides,
      },
    },
    assets: [],
  };
}

describe('assembleChartFiles chartDoc option', () => {
  test('uses the supplied chartDoc instead of parsing chartText/chartFile', () => {
    const chartDoc = chartDocWithMetadata({});
    const entries = assembleChartFiles({
      chartDoc,
      metadata: {
        name: 'New Name',
        artist: 'New Artist',
        charter: 'New Charter',
      },
    });
    const songIni = entries.find(e => e.fileName === 'song.ini');
    expect(songIni).toBeDefined();
    const iniText = new TextDecoder().decode(songIni!.data);
    expect(iniText).toContain('New Name');
    expect(iniText).toContain('New Artist');
    expect(iniText).toContain('New Charter');
  });

  test('preserves fields the caller-supplied metadata already carries (e.g. delay), unlike the chartFile-only path', () => {
    const chartDoc = chartDocWithMetadata({
      delay: 250,
      genre: 'Rock',
      year: '2024',
    });
    const entries = assembleChartFiles({
      chartDoc,
      metadata: {name: 'Name', artist: 'Artist', charter: 'Charter'},
    });
    const songIni = entries.find(e => e.fileName === 'song.ini');
    const iniText = new TextDecoder().decode(songIni!.data);
    expect(iniText).toMatch(/delay\s*=\s*250/);
    expect(iniText).toContain('Rock');
    expect(iniText).toContain('2024');
  });

  test('does not mutate the supplied chartDoc', () => {
    const chartDoc = chartDocWithMetadata({});
    const originalMetadata = chartDoc.parsedChart.metadata;
    assembleChartFiles({
      chartDoc,
      metadata: {
        name: 'New Name',
        artist: 'New Artist',
        charter: 'New Charter',
      },
    });
    expect(chartDoc.parsedChart.metadata).toBe(originalMetadata);
    expect(chartDoc.parsedChart.metadata.name).toBe('Original Name');
  });

  test('carries chartDoc.assets through to the output as passthrough files', () => {
    const parsedChart = createEmptyChart();
    const chartDoc: ChartDocument = {
      parsedChart,
      assets: [{fileName: 'album.png', data: new Uint8Array([1, 2, 3])}],
    };
    const entries = assembleChartFiles({
      chartDoc,
      metadata: {name: 'Name', artist: 'Artist', charter: 'Charter'},
    });
    const asset = entries.find(e => e.fileName === 'album.png');
    expect(asset).toBeDefined();
    expect(Array.from(asset!.data)).toEqual([1, 2, 3]);
  });

  test('throws when none of chartText/chartFile/chartDoc is supplied', () => {
    expect(() =>
      assembleChartFiles({
        metadata: {name: 'Name', artist: 'Artist', charter: 'Charter'},
      }),
    ).toThrow(/requires chartText, chartFile, or chartDoc/);
  });
});
