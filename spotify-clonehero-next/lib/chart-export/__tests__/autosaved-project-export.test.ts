/**
 * An autosaved project exports exactly one chart file.
 *
 * The store keeps the user's latest edit in a `.edited.` sibling. scan-chart
 * classifies any name but `notes.chart` / `notes.mid` / `song.ini` as a
 * passthrough asset, so handing that name to the parse puts the autosave
 * into `chartDoc.assets`, and `writeChartFolder` then ships it beside the
 * real chart — a second, stale chart file in every download.
 */

import {installFakeOPFS} from '@/lib/drum-transcription/storage/__tests__/fake-opfs';
import {createOpfsProjectStore} from '@/lib/project-storage/opfsProjectStore';
import {
  createEmptyChart,
  chartDocToFolderFiles,
  readChartForEditing,
  type ChartDocument,
} from '@/lib/chart-edit';
import {assembleChartFiles} from '@/lib/chart-export';
import {chartFileFormatOf} from '@/lib/chart-files/chart-file-names';

function blankDoc(): ChartDocument {
  return {
    parsedChart: createEmptyChart({format: 'chart', resolution: 480, bpm: 120}),
    assets: [],
  };
}

describe('exporting a project that has autosaved', () => {
  beforeEach(() => {
    installFakeOPFS();
  });

  it('ships exactly one chart file, not the autosave beside it', async () => {
    const store = createOpfsProjectStore('test-namespace');
    const doc = blankDoc();
    const {chart} = chartDocToFolderFiles(doc);

    const meta = await store.createProject({
      name: 'Song',
      artist: 'A',
      charter: 'C',
      sourceFormat: 'folder',
      originalName: 'song',
      chartFile: chart,
      audioFiles: [],
      allFiles: [chart],
    });

    // One edit, so the project has a `notes.edited.chart` beside its original.
    await store.writeEditedChart(
      meta.id,
      chartDocToFolderFiles(blankDoc()).chart,
    );

    // The editor's own load path, then its export path.
    const loaded = await store.readChartFile(meta.id);
    const chartDoc = readChartForEditing([loaded]);
    const entries = assembleChartFiles({
      chartDoc,
      metadata: {name: 'Song', artist: 'A', charter: 'C'},
    });

    const chartFiles = entries.filter(
      e => chartFileFormatOf(e.fileName) !== null,
    );
    expect(chartFiles.map(e => e.fileName)).toEqual(['notes.chart']);
  });
});
