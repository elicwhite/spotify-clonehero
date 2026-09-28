/**
 * A pixel check of a film range against reference frames: renders every Nth
 * frame of the range and compares each with the reference of the same film
 * frame (files named by frame number). Make the reference first, from the
 * code you trust, with --write-reference.
 *
 *   node --import tsx scripts/render/checkFrames.ts --entry <film/src/index.ts> \
 *     --composition <id> --range 0-2699 --reference <dir> [--every 15] \
 *     [--write-reference] [--tolerance 3] [--keep <dir>] [--concurrency 2] \
 *     [--film <dir>] [--props <json>] [--browser <chrome>]
 *
 * The default tolerance is FRAME_TOLERANCE (compareFrames.ts), the
 * render-to-render noise of WebGL frames. --keep saves the new renders (else
 * they go with the scratch folder). Exits 1 when a reference is missing or a
 * frame differs by more than the tolerance.
 */
import fs from 'node:fs';
import path from 'node:path';
import {frameRange, int, isMain, need, parseFlags, runCli} from '../lib/cli';
import {withScratchDir} from '../lib/files';
import {
  FILM_FLAGS,
  FILM_USAGE,
  frameFile,
  openRenderSession,
  strideFrames,
} from '../lib/remotion';
import {
  FRAME_TOLERANCE,
  compareFrameDirs,
  reportComparison,
} from './compareFrames';

const USAGE = `
Usage: node --import tsx scripts/render/checkFrames.ts ${FILM_USAGE} --range <from-to>
         --reference <dir> [--every 15] [--write-reference] [--tolerance 3] [--keep <dir>]
         [--concurrency 2]
`;

async function main(): Promise<void> {
  const {values} = parseFlags({
    ...FILM_FLAGS,
    range: {type: 'string'},
    every: {type: 'string'},
    reference: {type: 'string'},
    'write-reference': {type: 'boolean', default: false},
    tolerance: {type: 'string'},
    keep: {type: 'string'},
    concurrency: {type: 'string'},
  });
  const [from, to] = frameRange(need(values.range, 'range'), 'range');
  const frames = strideFrames(from, to, int(values.every, 'every', 15, 1));
  const reference = path.resolve(need(values.reference, 'reference'));
  const tolerance = int(values.tolerance, 'tolerance', FRAME_TOLERANCE, 0);
  const concurrency = int(values.concurrency, 'concurrency', 2, 1);
  const session = await openRenderSession(values);
  try {
    const composition = await session.composition(
      need(values.composition, 'composition'),
    );
    const renderInto = (dir: string) =>
      session.stills(
        composition,
        frames.map(frame => ({
          frame,
          output: path.join(dir, frameFile(frame)),
        })),
        {concurrency},
      );
    if (values['write-reference']) {
      await renderInto(reference);
      console.log(`${frames.length} reference frames -> ${reference}`);
      return;
    }
    const names = frames.map(frameFile);
    const missing = names.filter(f => !fs.existsSync(path.join(reference, f)));
    if (missing.length) {
      throw new Error(
        `${reference} has no reference for ${missing.join(', ')}; run with --write-reference first`,
      );
    }
    const check = async (dir: string) => {
      await renderInto(dir);
      return reportComparison(
        await compareFrameDirs(reference, dir, tolerance, names),
        tolerance,
      );
    };
    const ok = values.keep
      ? await check(path.resolve(values.keep))
      : await withScratchDir('check-frames', check);
    if (!ok) process.exitCode = 1;
  } finally {
    await session.close();
  }
}

if (isMain(import.meta.url)) runCli(USAGE, main);
