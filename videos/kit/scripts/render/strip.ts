/**
 * Motion QA: renders every Nth frame of a range and tiles them into one
 * sheet, each tile labelled with its film frame and time. One Chrome renders
 * every frame; a range of one frame makes a one-tile sheet.
 *
 *   node --import tsx scripts/render/strip.ts --entry <film/src/index.ts> --composition <id> \
 *     --range 300-420 --out <sheet.png> [--every 5] [--scale 0.5] [--cols 4] \
 *     [--font monospace] [--keep <dir>] [--concurrency 2] \
 *     [--film <dir>] [--props <json>] [--browser <chrome>]
 *
 * --keep saves the rendered frames (named by film frame) in <dir>; otherwise
 * they are deleted with the scratch folder.
 */
import path from 'node:path';
import {
  frameRange,
  int,
  isMain,
  need,
  parseFlags,
  positive,
  runCli,
} from '../lib/cli';
import {withScratchDir} from '../lib/files';
import {
  FILM_FLAGS,
  FILM_USAGE,
  frameFile,
  openRenderSession,
  strideFrames,
} from '../lib/remotion';
import {DEFAULT_FONT, tileSheet} from './sheet';

const USAGE = `
Usage: node --import tsx scripts/render/strip.ts ${FILM_USAGE} --range <from-to>
         --out <sheet.png> [--every 5] [--scale 0.5] [--cols 4] [--font monospace]
         [--keep <dir>] [--concurrency 2]
`;

async function main(): Promise<void> {
  const {values} = parseFlags({
    ...FILM_FLAGS,
    range: {type: 'string'},
    every: {type: 'string'},
    scale: {type: 'string'},
    cols: {type: 'string'},
    font: {type: 'string'},
    out: {type: 'string'},
    keep: {type: 'string'},
    concurrency: {type: 'string'},
  });
  const [from, to] = frameRange(need(values.range, 'range'), 'range');
  const frames = strideFrames(from, to, int(values.every, 'every', 5, 1));
  const out = path.resolve(need(values.out, 'out'));
  const scale = positive(values.scale, 'scale', 0.5);
  const session = await openRenderSession(values);
  try {
    const composition = await session.composition(
      need(values.composition, 'composition'),
    );
    const {fps} = composition;
    const render = async (dir: string) => {
      const jobs = frames.map(frame => ({
        frame,
        output: path.join(dir, frameFile(frame)),
      }));
      await session.stills(composition, jobs, {
        scale,
        concurrency: int(values.concurrency, 'concurrency', 2, 1),
      });
      await tileSheet(
        jobs.map(j => ({
          file: j.output,
          label: `${j.frame}  ${(j.frame / fps).toFixed(2)}s`,
        })),
        out,
        {
          cols: int(values.cols, 'cols', 4, 1),
          font: values.font ?? DEFAULT_FONT,
        },
      );
    };
    if (values.keep) await render(path.resolve(values.keep));
    else await withScratchDir('strip', render);
  } finally {
    await session.close();
  }
  console.log(`${frames.length} frames -> ${out}`);
}

if (isMain(import.meta.url)) runCli(USAGE, main);
