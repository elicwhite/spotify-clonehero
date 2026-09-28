// The recorder's command line, one for every recorder: the generic one
// (record.mjs, any web page) and each app adapter (apps/<app>/record.mjs)
// is `recordCli(adapter)`. The flags every take shares are parsed here with
// the kit's CLI helpers (scripts/lib/cli.ts), spelled as the kit's flag
// table has them (scripts/lib/README.md); the spec is loaded and placed in
// the film; one hook context is built for every spec hook; and the take is
// recorded with the adapter's own steps in a scratch folder that is removed
// afterwards.

import path from 'node:path';
import {
  frameRange,
  int,
  intList,
  need,
  num,
  parseFlags,
  runCli,
  UsageError,
} from '../lib/cli.ts';
import {withScratchDir} from '../lib/files.ts';
import {toFrames} from '../../src/format/format.ts';
import {DEFAULT_HANDLE_SEC, loadStoryboard, loadTimeline} from './film-time.ts';
import {loadSpec, takeFrames} from './spec.ts';
import {
  DEFAULT_CLOCK_DATE,
  DEFAULT_CLOCK_START_SEC,
  recordTake,
} from './take.mjs';

const SHARED_OPTIONS = {
  cdp: {type: 'string'},
  spec: {type: 'string'},
  out: {type: 'string'},
  timeline: {type: 'string'},
  storyboard: {type: 'string'},
  'handle-sec': {type: 'string'},
  range: {type: 'string'},
  'preroll-sec': {type: 'string'},
  'clock-start-sec': {type: 'string'},
  'clock-date': {type: 'string'},
  crf: {type: 'string'},
  preset: {type: 'string'},
  'pix-fmt': {type: 'string'},
  keep: {type: 'string'},
  frames: {type: 'string'},
  'no-encode': {type: 'boolean'},
};

const sharedUsage =
  prerollSec => `  --cdp <url>                the Chrome's DevTools endpoint (http://127.0.0.1:<port>)
  --spec <file>              the take's spec module
  --out <dir>                the folder of takes: the take lands in <out>/<id>/
  --timeline <json> --storyboard <module>
                             place the take in a film's scene
  --handle-sec <s>           recorded on each side of the scene (default ${DEFAULT_HANDLE_SEC})
  --range <a-b>              only these film frames of the take (tests)
  --preroll-sec <s>          played before the first captured frame (default ${prerollSec})
  --clock-start-sec <s>      the page's performance.now() at the pre-roll start
                             (default ${DEFAULT_CLOCK_START_SEC}; not behind the page's real clock)
  --clock-date <ISO date>    the page's date then (default ${DEFAULT_CLOCK_DATE})
  --crf <n> --preset <name> --pix-fmt yuv444p|yuv420p
                             the encoding (default 12, slow, yuv444p)
  --keep <dir> --frames <f,f,...>
                             also keep these film frames as PNG in <dir>
  --no-encode                run everything but write no video`;

/** A flag in seconds, at least 0. */
const seconds = (value, flag, fallback) => {
  const s = num(value, flag, fallback);
  if (s < 0) throw new UsageError(`--${flag} must be 0 or more, got ${s}`);
  return s;
};

const PIX_FMTS = ['yuv444p', 'yuv420p'];

/**
 * Parse the command line and record the take. `adapter`:
 * - app: the manifest's `app` ('web', 'chart-editor').
 * - command: how the recorder is run, for its usage.
 * - usage: lines for its own flags; options: its own flags (parseArgs).
 * - placedInFilm: every take needs --timeline and --storyboard.
 * - prerollSec: its default pre-roll.
 * - viewport(spec): the viewport the take records ({width, height, scale}).
 * - take({args, spec, ctx, scratch}): its part of `recordTake`'s options
 *   (colorScheme, scripts, songAt, setup, begin, components, only, plan,
 *   hooks, extra). `ctx` is the hook context, the one object every spec
 *   hook gets: {log, fps, start, from, to, viewport, tl, beat} (spec.ts).
 */
export function recordCli(adapter) {
  const usage = `${adapter.command}\n\n${adapter.usage}\n${sharedUsage(adapter.prerollSec)}`;
  runCli(usage, async () => {
    const {values: args} = parseFlags({...SHARED_OPTIONS, ...adapter.options});
    const cdp = need(args.cdp, 'cdp');
    const out = path.resolve(need(args.out, 'out'));
    const spec = await loadSpec(need(args.spec, 'spec'));
    if (adapter.placedInFilm) {
      need(args.timeline, 'timeline');
      need(args.storyboard, 'storyboard');
    }
    const storyboard = args.storyboard
      ? await loadStoryboard(path.resolve(args.storyboard))
      : null;
    const tl = args.timeline
      ? loadTimeline(path.resolve(args.timeline), {
          storyboard,
          handleSec: seconds(
            args['handle-sec'],
            'handle-sec',
            DEFAULT_HANDLE_SEC,
          ),
        })
      : null;
    const fps = tl?.fps ?? spec.fps;
    if (!(fps > 0))
      throw new UsageError(
        `${spec.id} has no frame rate: pass --timeline, or give the spec \`fps\``,
      );
    const preroll = Math.round(
      toFrames(
        seconds(args['preroll-sec'], 'preroll-sec', adapter.prerollSec),
        fps,
      ),
    );
    const {start, from, to, beat} = takeFrames(spec, {
      tl,
      preroll,
      override: args.range ? frameRange(args.range, 'range') : undefined,
    });
    const clockStartSec = seconds(
      args['clock-start-sec'],
      'clock-start-sec',
      DEFAULT_CLOCK_START_SEC,
    );
    const dateMs = Date.parse(args['clock-date'] ?? DEFAULT_CLOCK_DATE);
    if (!Number.isFinite(dateMs))
      throw new UsageError(
        `--clock-date must be an ISO date, got "${args['clock-date']}"`,
      );
    const pixFmt = args['pix-fmt'] ?? 'yuv444p';
    if (!PIX_FMTS.includes(pixFmt))
      throw new UsageError(
        `--pix-fmt must be ${PIX_FMTS.join(' or ')}, got "${pixFmt}"`,
      );
    const keepFrames = args.frames ? intList(args.frames, 'frames') : [];
    if (keepFrames.length > 0 && !args.keep)
      throw new UsageError('--frames names frames to keep: pass --keep <dir>');
    const log = (...m) => console.error(`[${spec.id}]`, ...m);
    const ctx = {
      log,
      fps,
      start,
      from,
      to,
      viewport: adapter.viewport(spec),
      tl,
      beat,
    };
    await withScratchDir(`recorder-${spec.id}`, async scratch => {
      const steps = await adapter.take({args, spec, ctx, scratch});
      await recordTake({
        cdp,
        id: spec.id,
        app: adapter.app,
        description: spec.description,
        fps,
        start,
        from,
        to,
        viewport: ctx.viewport,
        clockStartMs: clockStartSec * 1000,
        dateMs,
        out: args['no-encode'] ? null : path.join(out, spec.id),
        encoding: {
          crf: int(args.crf, 'crf', 12, 0),
          preset: args.preset ?? 'slow',
          pixFmt,
        },
        keepDir: args.keep ? path.resolve(args.keep) : null,
        keepFrames: new Set(keepFrames),
        log,
        ...steps,
      });
    });
  });
}
