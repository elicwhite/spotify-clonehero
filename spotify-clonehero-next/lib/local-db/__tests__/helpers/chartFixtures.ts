import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {createEmptyChart, writeChartFolder} from '@/lib/chart-edit';
import type {ChartDocument, File as ChartFile} from '@/lib/chart-edit';
import {exportAsSng} from '@/lib/chart-export/sng';
import type {FileEntry} from '@/lib/chart-export/types';

export type ChartFixtureSpec = {
  artist: string;
  song: string; // -> song.ini name
  charter?: string;
  album?: string;
  genre?: string;
  year?: number;
  diff_drums?: number;
  diff_guitar?: number;
  song_length?: number;
};

/**
 * Build a `ChartDocument` whose metadata reflects the spec, then run it
 * through scan-chart's `writeChartFolder` to produce notes.chart + song.ini
 * file bytes. This exercises the real chart writing pipeline and is what
 * the folder/SNG fixture helpers below feed into.
 */
export function buildChartFiles(spec: ChartFixtureSpec): ChartFile[] {
  const parsedChart = createEmptyChart({bpm: 120, resolution: 480});
  parsedChart.metadata.name = spec.song;
  parsedChart.metadata.artist = spec.artist;
  if (spec.charter !== undefined) parsedChart.metadata.charter = spec.charter;
  if (spec.album !== undefined) parsedChart.metadata.album = spec.album;
  if (spec.genre !== undefined) parsedChart.metadata.genre = spec.genre;
  if (spec.year !== undefined) parsedChart.metadata.year = String(spec.year);
  if (spec.diff_drums !== undefined)
    parsedChart.metadata.diff_drums = spec.diff_drums;
  if (spec.diff_guitar !== undefined)
    parsedChart.metadata.diff_guitar = spec.diff_guitar;
  if (spec.song_length !== undefined)
    parsedChart.metadata.song_length = spec.song_length;

  const doc: ChartDocument = {parsedChart, assets: []};
  return writeChartFolder(doc);
}

/**
 * Disk filenames can't contain `/`, `\`, or other reserved chars. Build a
 * unique, mostly-readable name from `<artist> - <song> (<charter>)` then
 * sanitize. Tests don't care about the name as long as it's deterministic
 * and unique enough across fixtures.
 */
function safeFolderName(spec: ChartFixtureSpec): string {
  const raw = [spec.artist, spec.song, spec.charter ?? '']
    .filter(Boolean)
    .join(' - ');
  return raw.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 200) || 'chart';
}

/**
 * Write the chart's File[] (notes.chart + song.ini) into a fresh subfolder
 * of `parentPath`. Returns the absolute path of the created folder.
 */
export async function writeFolderChart(
  parentPath: string,
  spec: ChartFixtureSpec,
): Promise<string> {
  const folder = path.join(parentPath, safeFolderName(spec));
  await fs.mkdir(folder, {recursive: true});
  const files = buildChartFiles(spec);
  for (const f of files) {
    await fs.writeFile(path.join(folder, f.fileName), f.data);
  }
  return folder;
}

/**
 * Pipe the chart's File[] through `exportAsSng` and write the resulting
 * binary as `<safeName>.sng` directly under `parentPath`. Exercises the
 * .sng scan path in `scanLocalCharts`.
 */
export async function writeSngChart(
  parentPath: string,
  spec: ChartFixtureSpec,
): Promise<string> {
  const files = buildChartFiles(spec);
  const fileEntries: FileEntry[] = files.map(f => ({
    filename: f.fileName,
    data: f.data,
  }));
  const sng = exportAsSng(fileEntries);
  const filePath = path.join(parentPath, `${safeFolderName(spec)}.sng`);
  await fs.writeFile(filePath, sng);
  return filePath;
}

export type ChartLibrarySpec = ChartFixtureSpec & {format: 'folder' | 'sng'};

/**
 * Write each spec into `rootPath` using the requested format. Returns the
 * list of paths created (folders for `folder` specs, files for `sng` specs).
 */
export async function writeChartLibrary(
  rootPath: string,
  specs: ChartLibrarySpec[],
): Promise<string[]> {
  const out: string[] = [];
  for (const spec of specs) {
    if (spec.format === 'folder') {
      out.push(await writeFolderChart(rootPath, spec));
    } else {
      out.push(await writeSngChart(rootPath, spec));
    }
  }
  return out;
}
