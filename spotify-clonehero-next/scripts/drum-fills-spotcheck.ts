/**
 * Drum-fill detection spot-check harness (dev tooling, Node-only).
 *
 * Walks a Clone Hero Songs directory directly on the filesystem, parses every
 * chart (folder or .sng) with @eliwhite/scan-chart, runs the same fill
 * detection + classification code the app uses, and prints aggregate stats plus
 * ASCII grid renderings of sample fills so a human can sanity-check the output.
 *
 * Run with:
 *   npx tsx scripts/drum-fills-spotcheck.ts [songsDir] [--limit N] [--samples N]
 *
 * Default songsDir: /Users/eliwhite/Clone Hero/Songs
 */

import {promises as fs} from 'fs';
import * as path from 'path';
import {Readable} from 'stream';

import {parseChartAndIni} from '@eliwhite/scan-chart';
import {SngStream} from '@eliwhite/parse-sng';
import type {File} from '@eliwhite/scan-chart';
import type {ParsedChart} from '@eliwhite/scan-chart';

import {
  detectFills,
  getExpertDrumsTrack,
} from '../lib/drum-fills/detection/detectFills';
import {classifyAndDedupe} from '../lib/drum-fills/detection/classify';
import {buildFingerprints} from '../lib/drum-fills/detection/grooveModel';
import type {
  ClassifiedFill,
  DrumVoice,
} from '../lib/drum-fills/detection/types';
import {GRID_DIVISIONS_PER_BAR} from '../lib/drum-fills/detection/types';

const DEFAULT_SONGS_DIR = '/Users/eliwhite/Clone Hero/Songs';

interface SongResult {
  name: string;
  fills: ClassifiedFill[];
  chart: ParsedChart;
}

async function main() {
  const args = process.argv.slice(2);
  let songsDir = DEFAULT_SONGS_DIR;
  let limit = Infinity;
  let sampleCount = 10;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit') limit = parseInt(args[++i], 10);
    else if (args[i] === '--samples') sampleCount = parseInt(args[++i], 10);
    else if (!args[i].startsWith('--')) songsDir = args[i];
  }

  console.log(`Scanning ${songsDir} ...`);
  const chartPaths = await findCharts(songsDir, limit);
  console.log(`Found ${chartPaths.length} candidate charts. Parsing...`);

  let scanned = 0;
  let withExpertDrums = 0;
  let withFills = 0;
  let parseErrors = 0;
  const fillsPerSong: number[] = [];
  const results: SongResult[] = [];

  // Taxonomy tallies.
  const lengthDist = new Map<string, number>();
  const subdivDist = new Map<string, number>();
  const voicingDist = new Map<string, number>();
  const complexityDist = new Map<number, number>();

  for (const cp of chartPaths) {
    let files: File[];
    try {
      files = await readChartFiles(cp);
    } catch {
      parseErrors++;
      continue;
    }
    if (files.length === 0) continue;

    let chart: ParsedChart | null;
    try {
      chart = parseChartAndIni(files).parsedChart;
    } catch {
      parseErrors++;
      continue;
    }
    if (!chart) continue;
    scanned++;

    const track = getExpertDrumsTrack(chart);
    if (!track) continue;
    withExpertDrums++;

    let fills;
    try {
      const raw = detectFills(chart);
      fills = classifyAndDedupe(chart, track, raw);
    } catch {
      parseErrors++;
      continue;
    }

    fillsPerSong.push(fills.length);
    if (fills.length > 0) withFills++;

    for (const cf of fills) {
      tally(lengthDist, `${cf.classification.lengthBars}bar`);
      tally(subdivDist, cf.classification.subdivision);
      for (const tag of cf.classification.voicingTags) tally(voicingDist, tag);
      complexityDist.set(
        cf.classification.complexity,
        (complexityDist.get(cf.classification.complexity) ?? 0) + 1,
      );
    }

    results.push({name: path.basename(cp.path), fills, chart});

    if (scanned % 100 === 0) {
      process.stdout.write(`  parsed ${scanned} charts...\r`);
    }
  }

  // ---- Report ----
  console.log('\n\n=========== DRUM FILL SPOT-CHECK ===========');
  console.log(`Charts found:            ${chartPaths.length}`);
  console.log(`Parsed OK:               ${scanned}`);
  console.log(`Parse/detect errors:     ${parseErrors}`);
  console.log(`With Expert drums:       ${withExpertDrums}`);
  console.log(`With >=1 detected fill:  ${withFills}`);

  const totalFills = fillsPerSong.reduce((a, b) => a + b, 0);
  const drummed = fillsPerSong.length || 1;
  console.log(`Total fills:             ${totalFills}`);
  console.log(
    `Fills / song (drummed):  mean ${(totalFills / drummed).toFixed(2)}, ` +
      `median ${median(fillsPerSong).toFixed(1)}, max ${Math.max(0, ...fillsPerSong)}`,
  );

  console.log('\n--- Fills/song distribution ---');
  printHistogram(bucketCounts(fillsPerSong));

  console.log('\n--- Length distribution ---');
  printMap(lengthDist);
  console.log('\n--- Subdivision distribution ---');
  printMap(subdivDist);
  console.log('\n--- Voicing tag distribution ---');
  printMap(voicingDist);
  console.log('\n--- Complexity distribution (1..5) ---');
  for (let c = 1; c <= 5; c++) {
    console.log(`  ${c}: ${complexityDist.get(c) ?? 0}`);
  }

  console.log(`\n--- ${sampleCount} sample fills (ASCII grids) ---`);
  printSamples(results, sampleCount);
  console.log('\n============================================');
}

// ---------------------------------------------------------------------------
// Filesystem walking + reading
// ---------------------------------------------------------------------------

interface ChartPath {
  /** Folder path or .sng file path. */
  path: string;
  kind: 'folder' | 'sng';
}

async function findCharts(root: string, limit: number): Promise<ChartPath[]> {
  const out: ChartPath[] = [];

  async function walk(dir: string): Promise<void> {
    if (out.length >= limit) return;
    let entries;
    try {
      entries = await fs.readdir(dir, {withFileTypes: true});
    } catch {
      return;
    }
    const hasNotes = entries.some(
      e =>
        e.isFile() &&
        (e.name.toLowerCase() === 'notes.chart' ||
          e.name.toLowerCase() === 'notes.mid'),
    );
    if (hasNotes) {
      out.push({path: dir, kind: 'folder'});
      if (out.length >= limit) return;
    }
    for (const e of entries) {
      if (out.length >= limit) return;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        await walk(full);
      } else if (e.isFile() && e.name.toLowerCase().endsWith('.sng')) {
        out.push({path: full, kind: 'sng'});
      }
    }
  }

  await walk(root);
  return out;
}

async function readChartFiles(cp: ChartPath): Promise<File[]> {
  if (cp.kind === 'folder') return readFolderFiles(cp.path);
  return readSngFiles(cp.path);
}

async function readFolderFiles(dir: string): Promise<File[]> {
  const entries = await fs.readdir(dir, {withFileTypes: true});
  const wanted: File[] = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    const lower = e.name.toLowerCase();
    if (
      lower === 'notes.chart' ||
      lower === 'notes.mid' ||
      lower === 'song.ini'
    ) {
      const data = await fs.readFile(path.join(dir, e.name));
      wanted.push({fileName: e.name, data: new Uint8Array(data)});
    }
  }
  return wanted;
}

async function readSngFiles(sngPath: string): Promise<File[]> {
  const buf = await fs.readFile(sngPath);
  const webStream = Readable.toWeb(
    Readable.from(buf),
  ) as ReadableStream<Uint8Array>;

  const sngStream = new SngStream(webStream, {generateSongIni: true});
  const files: File[] = [];

  return new Promise<File[]>((resolve, reject) => {
    sngStream.on('error', err => reject(err));
    sngStream.on('file', (fileName, fileStream, nextFile) => {
      const lower = fileName.toLowerCase();
      const want =
        lower === 'notes.chart' ||
        lower === 'notes.mid' ||
        lower === 'song.ini';
      collectStream(fileStream)
        .then(data => {
          if (want) files.push({fileName, data});
          if (nextFile) nextFile();
          else resolve(files);
        })
        .catch(reject);
    });
    sngStream.start();
  });
}

async function collectStream(
  stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// ASCII rendering of fills
// ---------------------------------------------------------------------------

const LANE_ORDER: DrumVoice[] = ['crash', 'hat', 'tom', 'snare', 'kick'];
const LANE_LABEL: Record<DrumVoice, string> = {
  crash: 'CR',
  hat: 'HH',
  tom: 'TM',
  snare: 'SN',
  kick: 'KK',
};

function printSamples(results: SongResult[], count: number): void {
  const withFills = results.filter(r => r.fills.length > 0);
  if (withFills.length === 0) {
    console.log('  (no fills detected)');
    return;
  }
  // Spread samples across the library and prefer higher-confidence fills.
  const step = Math.max(1, Math.floor(withFills.length / count));
  let shown = 0;
  for (let i = 0; i < withFills.length && shown < count; i += step) {
    const r = withFills[i];
    const cf = [...r.fills].sort(
      (a, b) => b.fill.confidence - a.fill.confidence,
    )[0];
    renderFill(r, cf);
    shown++;
  }
}

function renderFill(song: SongResult, cf: ClassifiedFill): void {
  const {chart} = song;
  const track = getExpertDrumsTrack(chart)!;
  const fps = buildFingerprints(chart, track);
  const spanFps = fps.filter(
    fp => fp.startTick >= cf.fill.startTick && fp.endTick <= cf.fill.endTick,
  );

  const c = cf.classification;
  console.log(
    `\n  "${song.name}"  ${cf.fill.tempoBpm.toFixed(0)} BPM  ` +
      `conf=${cf.fill.confidence.toFixed(2)} reps=${cf.repetitions}`,
  );
  console.log(
    `    ${c.lengthBars}bar ${c.subdivision} cx${c.complexity} ` +
      `[${c.voicingTags.join(',') || 'none'}] ` +
      `densX${cf.fill.features.densityRatio.toFixed(1)} ` +
      `tom${(cf.fill.features.tomFraction * 100).toFixed(0)}%`,
  );

  // Build a grid: lanes x (48 per bar * numBars).
  const numBars = Math.max(1, spanFps.length);
  const cols = GRID_DIVISIONS_PER_BAR * numBars;
  const grid: string[][] = LANE_ORDER.map(() => new Array(cols).fill('.'));

  spanFps.forEach((fp, barIdx) => {
    for (const onset of fp.onsets) {
      const col = barIdx * GRID_DIVISIONS_PER_BAR + onset.slot;
      if (col >= cols) continue;
      LANE_ORDER.forEach((lane, laneIdx) => {
        if (onset.voices.has(lane)) {
          grid[laneIdx][col] = lane === 'crash' ? 'O' : 'x';
        }
      });
    }
  });

  // Print compacted to a readable width: subsample to 16 cols/bar.
  const subStep = GRID_DIVISIONS_PER_BAR / 16; // 3
  LANE_ORDER.forEach((lane, laneIdx) => {
    let line = `    ${LANE_LABEL[lane]} |`;
    for (let bar = 0; bar < numBars; bar++) {
      for (let s = 0; s < 16; s++) {
        // Mark the cell as hit if any sub-slot in this 16th window is hit.
        let ch = '.';
        for (let k = 0; k < subStep; k++) {
          const col = bar * GRID_DIVISIONS_PER_BAR + s * subStep + k;
          const cell = grid[laneIdx][col];
          if (cell !== '.') ch = cell;
        }
        line += ch;
        if (s % 4 === 3) line += ' ';
      }
      line += '|';
    }
    console.log(line);
  });
}

// ---------------------------------------------------------------------------
// Stats helpers
// ---------------------------------------------------------------------------

function tally(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function printMap(map: Map<string, number>): void {
  const entries = [...map.entries()].sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) {
    console.log('  (none)');
    return;
  }
  for (const [k, v] of entries) console.log(`  ${k.padEnd(14)} ${v}`);
}

function bucketCounts(values: number[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const v of values) {
    const key =
      v === 0
        ? '0'
        : v <= 5
          ? `${v}`
          : v <= 10
            ? '6-10'
            : v <= 20
              ? '11-20'
              : '21+';
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
}

function printHistogram(map: Map<string, number>): void {
  const order = ['0', '1', '2', '3', '4', '5', '6-10', '11-20', '21+'];
  const max = Math.max(1, ...map.values());
  for (const key of order) {
    const v = map.get(key) ?? 0;
    const bar = '#'.repeat(Math.round((v / max) * 40));
    console.log(`  ${key.padStart(5)} | ${bar} ${v}`);
  }
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
