// One ffmpeg process per take: PNG frames in over stdin, one H.264 file out
// per component crop. Nothing is written to disk but the finished videos.
//
// The screenshots are sRGB. They are converted to BT.709 limited range and
// tagged as such (the kit's `bt709Filter` and `BT709_TAGS`), which is what
// browsers and Remotion's frame extractor assume for HD H.264, so colors
// round-trip.

import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {BT709_TAGS, bt709Filter} from '../lib/bt709.ts';
import {ffmpegArgs} from '../lib/proc.ts';

/**
 * Seconds between keyframes: Remotion extracts frames out of order, and
 * every seek decodes from the keyframe before it.
 */
const KEYFRAME_INTERVAL_SEC = 0.5;

/** Round a CSS-px box out to whole device pixels, even-aligned (so 4:2:0 works too). */
export function deviceCrop(box, scale, frame) {
  let x = Math.floor(box.x * scale);
  let y = Math.floor(box.y * scale);
  let right = Math.ceil((box.x + box.width) * scale);
  let bottom = Math.ceil((box.y + box.height) * scale);
  x = Math.max(0, x - (x % 2));
  y = Math.max(0, y - (y % 2));
  right = Math.min(frame.width, right + (right % 2));
  bottom = Math.min(frame.height, bottom + (bottom % 2));
  return {x, y, width: right - x, height: bottom - y};
}

/**
 * @param {object} opts
 * @param {{name: string, crop: {x,y,width,height}, file: string}[]} opts.outputs
 *   crops in device pixels of the input frame.
 * @param {number} opts.fps
 * @param {number} opts.crf
 * @param {string} opts.preset
 * @param {'yuv444p' | 'yuv420p'} opts.pixFmt  yuv444p (default; H.264 High
 *   4:4:4, which Remotion's frame extractor and Chrome both decode) or yuv420p
 * @param {string} [opts.ffmpeg]
 */
export function openEncoder({
  outputs,
  fps,
  crf = 12,
  preset = 'slow',
  pixFmt = 'yuv444p',
  ffmpeg = 'ffmpeg',
}) {
  if (!(fps > 0))
    throw new Error(`the encoder needs the take's fps, got ${fps}`);
  const keyint = Math.max(1, Math.round(KEYFRAME_INTERVAL_SEC * fps));
  for (const o of outputs)
    fs.mkdirSync(path.dirname(o.file), {recursive: true});
  const split =
    outputs.length > 1
      ? `[0:v]split=${outputs.length}${outputs.map((_, i) => `[s${i}]`).join('')};`
      : '';
  const chains = outputs
    .map((o, i) => {
      const src = outputs.length > 1 ? `[s${i}]` : '[0:v]';
      const {x, y, width, height} = o.crop;
      return `${src}crop=${width}:${height}:${x}:${y},${bt709Filter({from: 'rgb', pixFmt})}[o${i}]`;
    })
    .join(';');
  const args = [
    '-y',
    '-f',
    'image2pipe',
    '-framerate',
    String(fps),
    '-c:v',
    'png',
    '-i',
    'pipe:0',
    '-filter_complex',
    split + chains,
  ];
  outputs.forEach((o, i) => {
    args.push(
      '-map',
      `[o${i}]`,
      '-c:v',
      'libx264',
      '-preset',
      preset,
      '-crf',
      String(crf),
      '-pix_fmt',
      pixFmt,
      '-profile:v',
      pixFmt === 'yuv444p' ? 'high444' : 'high',
      '-x264-params',
      `keyint=${keyint}:min-keyint=1`,
      ...BT709_TAGS,
      '-r',
      String(fps),
      '-fps_mode',
      'cfr',
      '-movflags',
      '+faststart',
      '-an',
      o.file,
    );
  });
  const child = spawn(ffmpeg, ffmpegArgs(args), {
    stdio: ['pipe', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', d => {
    stderr += d;
  });
  const done = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', code =>
      code === 0
        ? resolve()
        : reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-2000)}`)),
    );
  });
  // `close()` reports a failure; after `kill()` nobody waits for it.
  done.catch(() => {});
  let frames = 0;
  let pipeError = null;
  child.stdin.on('error', error => {
    pipeError = error;
  });
  return {
    args,
    get frames() {
      return frames;
    },
    /** Write one PNG frame; resolves once ffmpeg has taken it (backpressure). */
    write(png) {
      if (pipeError)
        return Promise.reject(
          new Error(
            `ffmpeg input closed: ${pipeError.message}\n${stderr.slice(-2000)}`,
          ),
        );
      frames++;
      return new Promise(resolve => {
        if (child.stdin.write(png)) resolve();
        else child.stdin.once('drain', resolve);
      });
    },
    async close() {
      child.stdin.end();
      await done;
    },
    kill() {
      child.kill('SIGKILL');
    },
  };
}
