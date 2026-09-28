/**
 * The logo sting's events from a film's timeline: the kick hits inside the
 * sting (logo_sting.py takes the first as the mark's entrance and the second
 * as the impact), a lane flash for each guitar note in the run just after
 * the impact, and a sheen on each downbeat.
 *
 *   node --import tsx blender/stingEvents.ts --timeline <timeline.json|module.ts> \
 *     --length <frames> --out <events.json> [--export timeline] [--from <film frame>] \
 *     [--flash-window-sec 0.5]
 *
 * --timeline is the timeline.json buildSoundtrack wrote, or a module whose
 * export (--export, default `timeline`) is the timeline: a film on a loop
 * bed builds its own with `tempoTimeline`.
 *
 * --from, the film frame of sting frame 0, defaults to the film's end minus
 * --length (the sting closes the film). Frames in the output are film
 * frames; the file also carries fps, start and length, so logo_sting.py
 * needs no other timing flags.
 */
import {buildTimelineApi} from '../src/music/api';
import type {Timeline} from '../src/music/contract';
import {assertTimeline} from '../src/music/validate';
import {
  UsageError,
  int,
  isMain,
  loadData,
  need,
  num,
  parseFlags,
  runCli,
} from '../scripts/lib/cli';
import {writeJsonAtomic} from '../scripts/lib/files';

export interface StingEvents {
  version: 1;
  fps: number;
  /** Film frame of sting frame 0. */
  start: number;
  length: number;
  kicks: number[];
  /** Lane 0-4: green, red, yellow, blue, orange (a guitar note's lowest fret). */
  flashes: {frame: number; lane: number}[];
  sheens: number[];
}

export function stingEvents(
  timeline: Timeline,
  start: number,
  length: number,
  flashWindowSec: number,
): StingEvents {
  const {fps} = timeline;
  const inside = (f: number) => f >= start && f < start + length;
  const kicks = buildTimelineApi(timeline).hitFrames.kick.filter(inside);
  // The run after the impact; with fewer than two kicks, after the only one.
  const impact = kicks[1] ?? kicks[0];
  const flashes =
    impact === undefined
      ? []
      : timeline.notes.guitar
          .filter(
            n =>
              n.frets.length &&
              n.frame > impact &&
              n.frame <= impact + flashWindowSec * fps,
          )
          .map(n => ({frame: n.frame, lane: Math.min(4, n.frets[0]!)}));
  const sheens = timeline.beats
    .filter(b => b.downbeat && inside(b.frame))
    .map(b => b.frame);
  return {version: 1, fps, start, length, kicks, flashes, sheens};
}

const USAGE = `
Usage: node --import tsx blender/stingEvents.ts --timeline <timeline.json|module.ts>
         --length <frames> --out <events.json> [--export timeline] [--from <film frame>]
         [--flash-window-sec 0.5]
`;

async function main(): Promise<void> {
  const {values} = parseFlags({
    timeline: {type: 'string'},
    export: {type: 'string', default: 'timeline'},
    length: {type: 'string'},
    from: {type: 'string'},
    out: {type: 'string'},
    'flash-window-sec': {type: 'string'},
  });
  const file = need(values.timeline, 'timeline');
  const timeline = assertTimeline(await loadData(file, values.export), file);
  const length = int(values.length, 'length', undefined, 2);
  const start = int(values.from, 'from', timeline.durationFrames - length, 0);
  if (start + length > timeline.durationFrames) {
    throw new UsageError(
      `the sting (${start}-${start + length - 1}) runs past the film's ${timeline.durationFrames} frames`,
    );
  }
  const events = stingEvents(
    timeline,
    start,
    length,
    num(values['flash-window-sec'], 'flash-window-sec', 0.5),
  );
  writeJsonAtomic(need(values.out, 'out'), events, 2);
  console.log(
    `${events.kicks.length} kicks, ${events.flashes.length} flashes, ${events.sheens.length} sheens ` +
      `in film frames ${start}-${start + length - 1} at ${events.fps} fps -> ${values.out}`,
  );
}

if (isMain(import.meta.url)) runCli(USAGE, main);
