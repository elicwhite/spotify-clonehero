/**
 * A drum-transcription project that has autosaved exports one chart file.
 *
 * `findProjectChartFile` prefers the `.edited.` sibling, and the editor
 * hands that name straight to `readChart`. The name must not make the file a
 * passthrough asset: `writeChartFolder` re-emits assets verbatim, so the
 * package would carry the autosave beside the assembled chart, and Clone
 * Hero's chart checker would report both "is not named notes.chart" and
 * "multiple .chart/.mid files".
 */

import {
  chartDocToFolderFiles,
  createEmptyChart,
  readChart,
  type ChartDocument,
} from '@/lib/chart-edit';
import {assembleChartFiles} from '@/lib/chart-export';
import {chartFileFormatOf} from '@/lib/chart-files/chart-file-names';

import {installFakeOPFS} from './fake-opfs';
import {
  createProject,
  findProjectChartFile,
  readProjectBinary,
  writeProjectBinary,
} from '../opfs';

function blankDoc(): ChartDocument {
  return {
    parsedChart: createEmptyChart({format: 'chart', resolution: 480, bpm: 120}),
    assets: [],
  };
}

describe('a drum-transcription project that has autosaved', () => {
  beforeEach(() => {
    installFakeOPFS();
  });

  it('exports one chart file, under the canonical name', async () => {
    const meta = await createProject('Song');
    const {chart} = chartDocToFolderFiles(blankDoc());
    await writeProjectBinary(meta.id, 'notes.chart', chart.data);
    // One edit, so the autosave sibling is what the editor loads.
    await writeProjectBinary(meta.id, 'notes.edited.chart', chart.data);

    // The editor's own load path (EditorApp), then its export path.
    const fileName = await findProjectChartFile(meta.id);
    expect(fileName).toBe('notes.edited.chart');
    const data = new Uint8Array(await readProjectBinary(meta.id, fileName!));
    const chartDoc = readChart([{fileName: fileName!, data}], {
      pro_drums: true,
    });

    const entries = assembleChartFiles({
      chartDoc,
      metadata: {name: 'Song', artist: 'Artist', charter: 'Charter'},
    });
    expect(
      entries
        .map(e => e.fileName)
        .filter(name => chartFileFormatOf(name) !== null),
    ).toEqual(['notes.chart']);
  });
});
