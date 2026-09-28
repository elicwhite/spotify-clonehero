/**
 * A chart folder served under the film's public dir, parsed the way the
 * chart editor opens a chart for editing (`readChartForEditing`, which also
 * parses a chart generated in memory, such as `testChartFiles()`).
 *
 * A chart folder holds `chart-files.json` (the names of the files to read)
 * and `chart/` (a link to, or a copy of, the chart's folder).
 * scripts/highway/link-chart.ts writes both into the film's gitignored
 * public/generated tree, so song material never enters the repository.
 *
 * Nothing here reads, logs or copies lyric text: the parsed document goes
 * straight to the app's renderer.
 */
import type {ChartDocument, File as ChartFile} from '@eliwhite/scan-chart';
import {readChartForEditing} from '@product/lib/chart-edit';
import {fetchFile, loadJson, useLoaded} from '../load';

export interface ChartFolder {
  /** The folder, relative to the film's public dir, e.g. `generated/highway`. */
  dir: string;
  /** The command that writes the folder, named in the error when it is missing. */
  writtenBy?: string;
}

/** Fetch and parse a chart folder. */
export const loadChartFolder = async ({
  dir,
  writtenBy,
}: ChartFolder): Promise<ChartDocument> => {
  const names = await loadJson<string[]>(`${dir}/chart-files.json`, {
    writtenBy,
  });
  const files: ChartFile[] = await Promise.all(
    names.map(async fileName => ({
      fileName,
      data: new Uint8Array(
        await (
          await fetchFile(`${dir}/chart/${fileName}`, {writtenBy})
        ).arrayBuffer(),
      ),
    })),
  );
  return readChartForEditing(files);
};

/** The parsed chart in a chart folder; null (with the frame held) until it is ready. */
export const useChartFolder = (folder: ChartFolder): ChartDocument | null =>
  useLoaded(
    `chart-folder:${folder.dir}`,
    () => loadChartFolder(folder),
    `Parsing the chart in public/${folder.dir}`,
  );
