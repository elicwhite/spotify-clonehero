/**
 * Reads the `song.ini` files that the scan could not.
 *
 * Chrome's File System Access API refuses a file named exactly `song.ini`, so
 * on Windows a whole library of chart folders scans as no charts at all. The
 * file picker behind `<input type="file" webkitdirectory>` does not apply that
 * restriction, and it hands back every file in the tree at once. So one
 * selection of the same Songs folder recovers the metadata of every folder the
 * scan recorded, and the user answers one prompt instead of one for each
 * chart.
 *
 * Nothing is uploaded. Chrome labels the prompt "Upload", but the files are
 * read in the page, the same as the scan reads them.
 */
import {parse} from '@/lib/ini-parser';
import {
  buildChart,
  type BlockedChartFolder,
  type SongAccumulator,
  type SongIniData,
} from './scanLocalCharts';

export type SongIniRescueResult = {
  charts: SongAccumulator[];
  /** Recorded folders the selection held no usable `song.ini` for. */
  missed: number;
};

/**
 * The part of a path that both sides can compare: the segments below the
 * folder the user picked. A scan path and a `webkitRelativePath` both start
 * with the name of that folder, so the segments after it name the same folder
 * in both.
 */
function belowRoot(segments: string[]): string {
  return segments.slice(1).join('/');
}

/**
 * Match by folder name, for the names that only one recorded folder has. A
 * user who picks the parent of the Songs folder, or the Songs folder of a
 * second game install, gives paths that no scan path equals. The name of a
 * chart folder is `Artist - Song (Charter)`, so it identifies the chart
 * wherever the folder sits.
 */
function candidatesByUniqueName(
  candidates: BlockedChartFolder[],
): Map<string, BlockedChartFolder> {
  const byName = new Map<string, BlockedChartFolder>();
  const duplicated = new Set<string>();

  for (const candidate of candidates) {
    const name = candidate.path.split('/').at(-1) ?? '';
    if (byName.has(name)) {
      duplicated.add(name);
      continue;
    }
    byName.set(name, candidate);
  }

  for (const name of duplicated) {
    byName.delete(name);
  }
  return byName;
}

/** Every `song.ini` in a `webkitdirectory` selection, by its folder path. */
function songInisByFolder(selection: File[]): Map<string, File> {
  const byFolder = new Map<string, File>();

  for (const file of selection) {
    if (file.name.toLowerCase() !== 'song.ini') continue;
    const segments = (file.webkitRelativePath ?? '').split('/');
    // One segment is a file the browser reported no folder for, which no
    // chart folder can be matched to.
    if (segments.length < 2) continue;
    byFolder.set(belowRoot(segments.slice(0, -1)), file);
  }

  return byFolder;
}

async function readSongIniData(file: File): Promise<SongIniData | null> {
  try {
    const {iniObject} = parse(new Uint8Array(await file.arrayBuffer()));
    // The ini parser returns loose string maps; the [Song] section is assumed
    // to carry the fields SongIniData names, as in the scan.
    return (iniObject['song'] ?? null) as unknown as SongIniData | null;
  } catch (error) {
    console.warn(`Could not parse ${file.webkitRelativePath}`, error);
    return null;
  }
}

/**
 * Build a chart for each recorded folder the selection holds a `song.ini`
 * for. The charts carry the handles the scan recorded, so a recovered chart
 * can be opened and written back like any other.
 */
export async function rescueSongInis(
  candidates: BlockedChartFolder[],
  selection: File[],
): Promise<SongIniRescueResult> {
  const byFolder = songInisByFolder(selection);
  const byName = candidatesByUniqueName(candidates);

  const matched = new Map<BlockedChartFolder, File>();
  for (const candidate of candidates) {
    const file = byFolder.get(belowRoot(candidate.path.split('/')));
    if (file) matched.set(candidate, file);
  }

  // Only folders that no path matched fall back to the name, so an exact
  // match is never lost to one.
  for (const [folder, file] of byFolder) {
    const candidate = byName.get(folder.split('/').at(-1) ?? '');
    if (candidate && !matched.has(candidate)) {
      matched.set(candidate, file);
    }
  }

  const charts: SongAccumulator[] = [];
  for (const [candidate, file] of matched) {
    const chart = buildChart(
      await readSongIniData(file),
      file.lastModified,
      candidate.handleInfo,
    );
    if (chart) charts.push(chart);
  }

  return {charts, missed: candidates.length - charts.length};
}
