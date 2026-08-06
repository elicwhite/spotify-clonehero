/**
 * Chart-checker issue summary the export dialog surfaces (plan item:
 * "The export dialog should surface the problems scan-chart reports about
 * the chart"). Covers both the pure de-dupe/cap mapping and the real
 * assemble -> scan pipeline it runs against a chart package.
 */

import {
  parseChartAndIni,
  scanChart,
  type ScannedChart,
} from '@eliwhite/scan-chart';
import {assembleChartFiles} from '@/lib/chart-export';
import {summarizeScanIssues} from '../ExportDialog';
import {makeFixtureDoc} from './fixtures';

/** Builds a `ScannedChart`-shaped fixture from just the three issue
 * channels `summarizeScanIssues` reads — the rest of `ScannedChart` /
 * `NotesData` is irrelevant to the mapping under test. */
function fakeScannedChart(overrides: {
  folderIssues?: ScannedChart['folderIssues'];
  metadataIssues?: ScannedChart['metadataIssues'];
  chartIssues?: NonNullable<ScannedChart['notesData']>['chartIssues'];
}): ScannedChart {
  const {folderIssues = [], metadataIssues = [], chartIssues} = overrides;
  return {
    folderIssues,
    metadataIssues,
    notesData: chartIssues ? {chartIssues} : null,
  } as unknown as ScannedChart;
}

describe('summarizeScanIssues', () => {
  it('reports nothing for a clean scan', () => {
    const summary = summarizeScanIssues(fakeScannedChart({}));
    expect(summary.totalCount).toBe(0);
    expect(summary.lines).toEqual([]);
  });

  it('drops the benign noAlbumArt folder issue', () => {
    const summary = summarizeScanIssues(
      fakeScannedChart({
        folderIssues: [
          {
            folderIssue: 'noAlbumArt',
            description: "This chart doesn't have album art.",
          },
        ],
      }),
    );
    expect(summary.totalCount).toBe(0);
  });

  it('keeps other folder issues, metadata issues and chart issues, in that order', () => {
    const summary = summarizeScanIssues(
      fakeScannedChart({
        folderIssues: [
          {
            folderIssue: 'noAudio',
            description: "This chart doesn't have an audio file.",
          },
        ],
        metadataIssues: [
          {
            metadataIssue: 'missingValue',
            description: 'Metadata is missing the "name" property.',
          },
        ],
        chartIssues: [
          {
            instrument: 'drums',
            difficulty: 'expert',
            noteIssue: 'noStarPower',
            description:
              'The "expert" difficulty of "drums" has no star power.',
          },
        ],
      }),
    );
    expect(summary.lines).toEqual([
      "This chart doesn't have an audio file.",
      'Metadata is missing the "name" property.',
      'The "expert" difficulty of "drums" has no star power.',
    ]);
    expect(summary.totalCount).toBe(3);
  });

  it('deduplicates identical descriptions across difficulties', () => {
    const repeated = {
      instrument: 'drums' as const,
      difficulty: 'expert' as const,
      noteIssue: 'noStarPower' as const,
      description: 'The "expert" difficulty of "drums" has no star power.',
    };
    const summary = summarizeScanIssues(
      fakeScannedChart({
        chartIssues: [repeated, {...repeated}, {...repeated}],
      }),
    );
    expect(summary.lines).toEqual([repeated.description]);
    expect(summary.totalCount).toBe(1);
  });

  it('caps the visible list and reports the remainder as a count', () => {
    const chartIssues = Array.from({length: 12}, (_, i) => ({
      instrument: 'drums' as const,
      difficulty: 'expert' as const,
      noteIssue: 'noStarPower' as const,
      description: `issue ${i}`,
    }));
    const summary = summarizeScanIssues(fakeScannedChart({chartIssues}));
    expect(summary.lines).toHaveLength(8);
    expect(summary.totalCount).toBe(12);
    expect(summary.totalCount - summary.lines.length).toBe(4);
  });
});

describe('summarizeScanIssues against a real assembled package', () => {
  it('surfaces real issues from an assembled fixture chart with no audio', () => {
    const doc = makeFixtureDoc();
    const fileEntries = assembleChartFiles({
      chartDoc: doc,
      metadata: {name: 'Untitled', artist: '', charter: ''},
      audioSources: [],
    });

    const parseResult = parseChartAndIni(fileEntries);
    const scanned = scanChart(fileEntries, parseResult, {
      includeMd5: false,
      includeBTrack: false,
    });

    const summary = summarizeScanIssues(scanned);

    // No audio was supplied, so the folder-issue channel must surface it.
    expect(scanned.folderIssues.some(i => i.folderIssue === 'noAudio')).toBe(
      true,
    );
    expect(summary.lines.some(line => line.includes('audio'))).toBe(true);
    expect(summary.totalCount).toBeGreaterThan(0);
  });
});
