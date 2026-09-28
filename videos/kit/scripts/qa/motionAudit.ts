/**
 * Finds stretches where the picture stops moving. The film is decoded by
 * ffmpeg to small grey raw frames; each frame's mean absolute difference from
 * the one before (0-255 levels) is its motion, and a run of at least
 * --min-run-sec of frames whose motion stays under --threshold reads as a
 * frozen frame on screen.
 *
 *   node --import tsx scripts/qa/motionAudit.ts --in <film.mp4> [--range <from-to>] \
 *     [--threshold 0.35] [--min-run-sec 0.333] [--width 480] [--csv <file>]
 *
 * --range limits the audit to those frames of the video (inclusive; frame 0
 * is its first). Exits 1 when it finds a still run. See scripts/qa/README.md
 * for how to calibrate the threshold for a film.
 */
import {
  frameRange,
  int,
  isMain,
  need,
  parseFlags,
  positive,
  runCli,
} from '../lib/cli';
import {writeFileAtomic} from '../lib/files';
import {probeVideo} from '../lib/media';
import {ffmpegArgs, streamRecords} from '../lib/proc';

export interface StillRun {
  /** First and last frame that did not change (inclusive). */
  from: number;
  to: number;
}

/**
 * Runs of at least `minRun` consecutive frame-to-frame differences under
 * `threshold`, as the frames that stood still. `diffs[i]` is frame i + 1
 * against frame i; `inWindow(frame)` limits the search.
 */
export function stillRuns(
  diffs: readonly number[],
  threshold: number,
  minRun: number,
  inWindow: (frame: number) => boolean = () => true,
): StillRun[] {
  const runs: StillRun[] = [];
  let start = -1;
  for (let i = 0; i <= diffs.length; i++) {
    const still = i < diffs.length && diffs[i]! < threshold && inWindow(i + 1);
    if (still && start < 0) start = i;
    if (!still && start >= 0) {
      if (i - start >= minRun) runs.push({from: start, to: i});
      start = -1;
    }
  }
  return runs;
}

const percentile = (sorted: readonly number[], p: number) =>
  sorted.length
    ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!
    : NaN;

/** Mean absolute difference between consecutive frames, via raw grey frames. */
async function frameDiffs(
  file: string,
  width: number,
): Promise<{diffs: number[]; fps: number}> {
  const info = probeVideo(file);
  const height = Math.max(
    2,
    Math.round((width * info.height) / info.width / 2) * 2,
  );
  const size = width * height;
  const diffs: number[] = [];
  let prev: Buffer | null = null;
  await streamRecords(
    'ffmpeg',
    ffmpegArgs([
      '-i',
      file,
      '-vf',
      // ffmpeg's default (bicubic) scaler: the one the default threshold was tuned with.
      `scale=${width}:${height},format=gray`,
      '-f',
      'rawvideo',
      '-pix_fmt',
      'gray',
      'pipe:1',
    ]),
    size,
    frame => {
      if (prev) {
        let sum = 0;
        for (let i = 0; i < size; i++) sum += Math.abs(frame[i]! - prev[i]!);
        diffs.push(sum / size);
      }
      prev = Buffer.from(frame);
    },
  );
  return {diffs, fps: info.fps};
}

const USAGE = `
Usage: node --import tsx scripts/qa/motionAudit.ts --in <film.mp4> [--range <from-to>]
         [--threshold 0.35] [--min-run-sec 0.333] [--width 480] [--csv <file>]
`;

async function main(): Promise<void> {
  const {values} = parseFlags({
    in: {type: 'string'},
    range: {type: 'string'},
    threshold: {type: 'string'},
    'min-run-sec': {type: 'string'},
    width: {type: 'string'},
    csv: {type: 'string'},
  });
  const file = need(values.in, 'in');
  const threshold = positive(values.threshold, 'threshold', 0.35);
  const [from, to] = values.range
    ? frameRange(values.range, 'range')
    : [0, Infinity];
  const {diffs, fps} = await frameDiffs(
    file,
    int(values.width, 'width', 480, 16),
  );
  const minRun = Math.max(
    1,
    Math.round(positive(values['min-run-sec'], 'min-run-sec', 1 / 3) * fps),
  );
  // diffs[i] is frame i + 1 against frame i: a pair is audited when both are in the window.
  const inWindow = (f: number) => f - 1 >= from && f <= to;
  const audited = diffs.filter((_, i) => inWindow(i + 1));
  if (audited.length < minRun) {
    throw new Error(
      `only ${audited.length} frame pairs to audit (${diffs.length + 1} frames, window ${from}-${Number.isFinite(to) ? to : 'end'}); ` +
        `a still run needs ${minRun}`,
    );
  }
  const runs = stillRuns(diffs, threshold, minRun, inWindow);
  if (values.csv) {
    writeFileAtomic(
      values.csv,
      `frame,diff\n${diffs.map((d, i) => `${i + 1},${d.toFixed(4)}`).join('\n')}\n`,
    );
  }
  const sorted = [...audited].sort((a, b) => a - b);
  const sec = (f: number) => (f / fps).toFixed(2);
  for (const r of runs) {
    console.log(
      `still ${sec(r.from)}s-${sec(r.to)}s (frames ${r.from}-${r.to}, ${sec(r.to - r.from + 1)}s)`,
    );
  }
  const total = runs.reduce((acc, r) => acc + r.to - r.from + 1, 0);
  console.log(
    `${audited.length} frame pairs at ${fps} fps; motion p5 ${percentile(sorted, 0.05).toFixed(3)}, ` +
      `median ${percentile(sorted, 0.5).toFixed(3)}, p95 ${percentile(sorted, 0.95).toFixed(3)}; ` +
      `${runs.length} still runs of ${minRun}+ frames under ${threshold}, ${sec(total)}s still in total`,
  );
  if (runs.length) process.exitCode = 1;
}

if (isMain(import.meta.url)) runCli(USAGE, main);
