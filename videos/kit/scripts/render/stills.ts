/**
 * Full-size stills for QA, with one Chrome for all of them: chosen frames of
 * one composition, or the hero frame of every composition whose id starts
 * with a prefix (a storyboard's scenes).
 *
 *   node --import tsx scripts/render/stills.ts --entry <film/src/index.ts> --composition <id> \
 *     --frames 110,200,450 --out <dir> [--scale 2] [--concurrency 2] \
 *     [--film <dir>] [--props <json>] [--browser <chrome>]
 *   node --import tsx scripts/render/stills.ts --entry <film/src/index.ts> --heroes <id prefix> \
 *     --out <dir> [--scale 2] ...
 *
 * Writes <dir>/<composition>-<frame>.png (with @<scale>x before .png when
 * --scale is not 1). A composition's hero frame is its `hero` default prop,
 * or frame 0. --scale 2 renders at twice the size, to check what a
 * supersampled render (renderFilm.ts --scale 2) will see.
 */
import path from 'node:path';
import type {VideoConfig} from 'remotion';
import {
  UsageError,
  int,
  intList,
  isMain,
  need,
  parseFlags,
  positive,
  runCli,
} from '../lib/cli';
import {FILM_FLAGS, FILM_USAGE, openRenderSession} from '../lib/remotion';

const stillName = (composition: string, frame: number, scale: number): string =>
  `${composition}-${frame}${scale === 1 ? '' : `@${scale}x`}.png`;

/** A composition's hero frame: its `hero` default prop when that is a frame of it, else 0. */
function heroFrame(composition: VideoConfig): number {
  const hero = (composition.defaultProps as {hero?: unknown}).hero;
  return typeof hero === 'number' &&
    Number.isInteger(hero) &&
    hero >= 0 &&
    hero < composition.durationInFrames
    ? hero
    : 0;
}

const USAGE = `
Usage: node --import tsx scripts/render/stills.ts ${FILM_USAGE} --frames <n,n,...> --out <dir>
         [--scale 2] [--concurrency 2]
       node --import tsx scripts/render/stills.ts --entry <film/src/index.ts> --heroes <id prefix>
         --out <dir> [--scale 2] [--film <dir>] [--browser <chrome>]
`;

async function main(): Promise<void> {
  const {values} = parseFlags({
    ...FILM_FLAGS,
    frames: {type: 'string'},
    heroes: {type: 'string'},
    out: {type: 'string'},
    scale: {type: 'string'},
    concurrency: {type: 'string'},
  });
  const heroes = values.heroes;
  if ((heroes === undefined) === (values.frames === undefined)) {
    throw new UsageError('give --frames (with --composition) or --heroes');
  }
  const out = path.resolve(need(values.out, 'out'));
  const scale = positive(values.scale, 'scale', 1);
  const concurrency = int(values.concurrency, 'concurrency', 2, 1);
  const session = await openRenderSession(values);
  try {
    const plan: {composition: VideoConfig; frames: number[]}[] = [];
    if (heroes !== undefined) {
      const all = await session.compositions();
      for (const c of all.filter(c => c.id.startsWith(heroes))) {
        plan.push({composition: c, frames: [heroFrame(c)]});
      }
      if (!plan.length)
        throw new Error(`No composition id starts with "${heroes}"`);
    } else {
      const frames = intList(values.frames!, 'frames');
      if (!frames.length) throw new UsageError('--frames lists no frames');
      const id = need(values.composition, 'composition');
      plan.push({composition: await session.composition(id), frames});
    }
    for (const {composition, frames} of plan) {
      const jobs = frames.map(frame => ({
        frame,
        output: path.join(out, stillName(composition.id, frame, scale)),
      }));
      await session.stills(composition, jobs, {scale, concurrency});
      for (const j of jobs) console.log(j.output);
    }
  } finally {
    await session.close();
  }
}

if (isMain(import.meta.url)) runCli(USAGE, main);
