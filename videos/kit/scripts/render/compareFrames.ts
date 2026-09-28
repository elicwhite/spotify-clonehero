/**
 * Compares two folders of rendered PNG frames, file by file, to prove a
 * change left the film unchanged.
 *
 *   node --import tsx scripts/render/compareFrames.ts <before-dir> <after-dir> [--tolerance 3]
 *
 * A sample may differ by up to `tolerance` levels (0-255; default
 * FRAME_TOLERANCE). Files starting with a dot are skipped: macOS writes a
 * `._` metadata file beside every file on an exFAT or FAT disk. Exits 1 when
 * a frame is missing or differs by more.
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import {UsageError, int, isMain, parseFlags, runCli} from '../lib/cli';

/**
 * Levels (0-255) a sample may differ by between two renders of one frame:
 * repeated WebGL renders round a few pixels differently, and 3 is the noise
 * measured between renders of the product highway. A real change is far
 * above it. The default of this tool and of checkFrames.ts.
 */
export const FRAME_TOLERANCE = 3;

const pngsIn = (dir: string): string[] =>
  fs
    .readdirSync(dir)
    .filter(f => f.toLowerCase().endsWith('.png') && !f.startsWith('.'))
    .sort();

export interface FrameDiff {
  name: string;
  /** Samples differing by more than the tolerance (all of them when the sizes differ). */
  over: number;
  /** The largest difference, levels. */
  max: number;
  /** Set when the two images are not the same size: "1920x1080x3 vs 960x540x3". */
  sizes?: string;
}

export interface FrameComparison {
  compared: number;
  /** Files that should have been there and were not. */
  missing: string[];
  changed: FrameDiff[];
}

/** One pair of images: samples over the tolerance and the largest difference. */
async function compareImages(
  a: string,
  b: string,
  tolerance: number,
): Promise<Omit<FrameDiff, 'name'>> {
  const [pa, pb] = await Promise.all(
    [a, b].map(f =>
      sharp(f).removeAlpha().raw().toBuffer({resolveWithObject: true}),
    ),
  );
  const {info: ia} = pa!;
  const {info: ib} = pb!;
  if (
    ia.width !== ib.width ||
    ia.height !== ib.height ||
    ia.channels !== ib.channels
  ) {
    return {
      over: Math.max(pa!.data.length, pb!.data.length),
      max: 255,
      sizes: `${ia.width}x${ia.height}x${ia.channels} vs ${ib.width}x${ib.height}x${ib.channels}`,
    };
  }
  let over = 0;
  let max = 0;
  const da = pa!.data;
  const db = pb!.data;
  for (let i = 0; i < da.length; i++) {
    const d = Math.abs(da[i]! - db[i]!);
    if (d > tolerance) over++;
    if (d > max) max = d;
  }
  return {over, max};
}

/**
 * The PNGs `names` (default: every PNG in `before`) in `before` against the
 * same names in `after`.
 */
export async function compareFrameDirs(
  before: string,
  after: string,
  tolerance: number,
  names: readonly string[] = pngsIn(before),
): Promise<FrameComparison> {
  const result: FrameComparison = {compared: 0, missing: [], changed: []};
  for (const name of names) {
    const pair = [path.join(before, name), path.join(after, name)] as const;
    const absent = pair.filter(f => !fs.existsSync(f));
    if (absent.length) {
      result.missing.push(...absent);
      continue;
    }
    result.compared++;
    const d = await compareImages(pair[0], pair[1], tolerance);
    if (d.over > 0) result.changed.push({name, ...d});
  }
  return result;
}

/** Prints a comparison; returns true when there were frames and every one matched. */
export function reportComparison(
  c: FrameComparison,
  tolerance: number,
): boolean {
  if (c.compared === 0 && c.missing.length === 0) {
    console.log('no PNG frames to compare');
    return false;
  }
  if (c.missing.length) console.log(`missing: ${c.missing.join(', ')}`);
  for (const d of c.changed) {
    console.log(
      d.sizes
        ? `${d.name}: the sizes differ (${d.sizes})`
        : `${d.name}: ${d.over} samples differ by more than ${tolerance} (max ${d.max})`,
    );
  }
  console.log(
    `${c.compared} frames compared, ${c.changed.length} changed beyond tolerance ${tolerance}`,
  );
  return c.missing.length === 0 && c.changed.length === 0;
}

const USAGE = `
Usage: node --import tsx scripts/render/compareFrames.ts <before-dir> <after-dir> [--tolerance 3]
`;

async function main(): Promise<void> {
  const {values, positionals} = parseFlags(
    {tolerance: {type: 'string'}},
    undefined,
    true,
  );
  const [before, after] = positionals;
  if (!before || !after || positionals.length > 2)
    throw new UsageError('give two folders');
  const tolerance = int(values.tolerance, 'tolerance', FRAME_TOLERANCE, 0);
  const ok = reportComparison(
    await compareFrameDirs(before, after, tolerance),
    tolerance,
  );
  if (!ok) process.exitCode = 1;
}

if (isMain(import.meta.url)) runCli(USAGE, main);
