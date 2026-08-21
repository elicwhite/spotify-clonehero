/**
 * A chart file read under a non-canonical name is not a passthrough asset.
 *
 * The drum-transcription editor loads its chart under the name the project
 * stores it as, and the project prefers the `.edited.` autosave sibling. If
 * `readChart` classified that name as an asset, `writeChartFolder` would
 * re-emit it beside the assembled chart, and the exported package would hold
 * two chart files — which Clone Hero's chart checker reports twice, as
 * "is not named notes.chart" and "multiple .chart/.mid files".
 */

import {
  createEmptyChart,
  chartDocToFolderFiles,
  readChart,
  writeChartFileAs,
  type ChartDocument,
} from '@/lib/chart-edit';
import {assembleChartFiles} from '@/lib/chart-export';
import {chartFileFormatOf} from '@/lib/chart-files/chart-file-names';

function blankDoc(format: 'chart' | 'mid'): ChartDocument {
  return {
    parsedChart: createEmptyChart({format, resolution: 480, bpm: 120}),
    assets: [],
  };
}

const metadata = {name: 'Song', artist: 'Artist', charter: 'Charter'};

describe('readChart with an autosave-named chart file', () => {
  it('keeps a notes.edited.chart out of the assets and out of the package', () => {
    const {data} = chartDocToFolderFiles(blankDoc('chart')).chart;
    const doc = readChart([{fileName: 'notes.edited.chart', data}]);

    expect(doc.assets).toEqual([]);

    const entries = assembleChartFiles({chartDoc: doc, metadata});
    expect(
      entries
        .map(e => e.fileName)
        .filter(name => chartFileFormatOf(name) !== null),
    ).toEqual(['notes.chart']);
  });

  it('keeps a notes.edited.mid out of the assets and out of the package', () => {
    const {data} = writeChartFileAs(blankDoc('mid'), 'mid');
    const doc = readChart([{fileName: 'notes.edited.mid', data}]);

    expect(doc.assets).toEqual([]);

    const entries = assembleChartFiles({chartDoc: doc, metadata});
    expect(
      entries
        .map(e => e.fileName)
        .filter(name => chartFileFormatOf(name) !== null),
    ).toEqual(['notes.mid']);
  });

  it('still carries an ordinary asset through', () => {
    const {data} = chartDocToFolderFiles(blankDoc('chart')).chart;
    const art = {fileName: 'album.png', data: new Uint8Array([1, 2, 3])};
    const doc = readChart([{fileName: 'notes.edited.chart', data}, art]);

    expect(doc.assets.map(a => a.fileName)).toEqual(['album.png']);

    const entries = assembleChartFiles({chartDoc: doc, metadata});
    expect(entries.map(e => e.fileName)).toContain('album.png');
  });
});
