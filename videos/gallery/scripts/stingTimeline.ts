/**
 * The invented timeline the gallery's logo sting is rendered against: 2.45 s
 * at 120 BPM with a kick on every beat and a four-note guitar run (orange,
 * blue, yellow, red) just after the second beat. Laid out so a 2-second sting
 * closing it gets every event the sting has: the mark enters on the first
 * kick, hits on the second, flashes a lane rim per note of the run, rests,
 * and takes a sheen on the downbeat before its last frame.
 *
 * From videos/:
 *
 *   node --import tsx gallery/scripts/stingTimeline.ts --out <timeline.json> [--fps 60]
 */
import path from 'node:path';
import {
  makeTimeline,
  tempoTimeline,
  type Timeline,
} from '@musiccharts/video-kit/music';
import {
  isMain,
  need,
  parseFlags,
  positive,
  runCli,
} from '@musiccharts/video-kit/scripts/lib/cli.ts';
import {writeJsonAtomic} from '@musiccharts/video-kit/scripts/lib/files.ts';

const BPM = 120;
const DURATION_SEC = 2.45;
/** The run after the second kick: seconds and frets. */
const RUN = [
  {t: 1.05, fret: 4},
  {t: 1.1, fret: 3},
  {t: 1.15, fret: 2},
  {t: 1.2, fret: 1},
] as const;

/** The tempo bed's beat grid, with the run and a kick hit on every beat. */
export const stingTimeline = (fps: number): Timeline => {
  const bed = tempoTimeline({bpm: BPM, durationSec: DURATION_SEC, fps});
  const kicks = bed.beats.map(b => b.t);
  return makeTimeline({
    fps,
    durationSec: DURATION_SEC,
    meta: bed.meta,
    tempo: bed.tempo,
    beats: bed.beats,
    bars: bed.bars,
    guitar: RUN.map(n => ({
      t: n.t,
      tick: 0,
      frets: [n.fret],
      sustain: 0,
      hopo: false,
      tap: false,
    })),
    hits: {kick: kicks, snare: [], crash: [], any: kicks},
  });
};

const USAGE =
  'usage: node --import tsx gallery/scripts/stingTimeline.ts --out <timeline.json> [--fps 60]';

if (isMain(import.meta.url)) {
  runCli(USAGE, () => {
    const {values} = parseFlags({out: {type: 'string'}, fps: {type: 'string'}});
    const out = path.resolve(need(values.out, 'out'));
    writeJsonAtomic(out, stingTimeline(positive(values.fps, 'fps', 60)), 2);
    console.log(`wrote ${out}`);
  });
}
