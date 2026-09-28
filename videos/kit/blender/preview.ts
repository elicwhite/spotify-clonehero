/**
 * Review files for a logo sting rendered by logo_sting.py:
 *   <out>/logo-sting-preview.mp4   the sequence over black, H.264 CRF 23, with the
 *                                  matching slice of the soundtrack when one is given
 *   <out>/logo-sting-contact.png   labelled key frames (sting frame and film frame)
 *   <out>/logo-sting-motion.png    every frame of the fly-in, hit and settle
 * The frame rate, size, file names and key frames all come from the sting's
 * meta JSON.
 *
 *   node --import tsx blender/preview.ts --in <frames dir> --meta <sting.json> --out <dir> \
 *     [--mix <soundtrack.wav>] [--font monospace]
 */
import fs from 'node:fs';
import path from 'node:path';
import {assertStingMeta, type StingMeta} from '../src/brand/stingMeta';
import {sortedUnique} from '../src/motion/sorted';
import {DEFAULT_FONT, tileSheet} from '../scripts/render/sheet';
import {isMain, loadData, need, parseFlags, runCli} from '../scripts/lib/cli';
import {produceAtomic, withScratchDir} from '../scripts/lib/files';
import {ffmpeg} from '../scripts/lib/proc';

/** Up to 16 frames that show the sting's story, in order, each once. */
export function keyFrames(
  m: Pick<
    StingMeta,
    | 'fps'
    | 'frames'
    | 'appearFrame'
    | 'impactFrame'
    | 'flashFrames'
    | 'restFrames'
    | 'sheenFrames'
  >,
): number[] {
  const last = m.frames - 1;
  const lerp = (k: number) =>
    Math.round(m.appearFrame + k * (m.impactFrame - m.appearFrame));
  /** Frames in `sec` seconds. */
  const f = (sec: number) => Math.round(sec * m.fps);
  const [sheen, ...later] = m.sheenFrames;
  const idle =
    later.length > 1
      ? Math.round((later[0]! + later[1]!) / 2)
      : Math.round((m.restFrames[0] + last) / 2);
  const wanted = [
    m.appearFrame,
    lerp(0.25),
    lerp(0.5),
    lerp(0.75),
    m.impactFrame - f(0.05),
    m.impactFrame - 1,
    m.impactFrame,
    m.impactFrame + f(0.05),
    m.impactFrame + f(0.167),
    m.flashFrames[1] ?? m.impactFrame + f(0.267),
    m.restFrames[0],
    ...(sheen === undefined ? [] : [sheen - f(0.083), sheen, sheen + f(0.083)]),
    idle,
    last,
  ];
  return sortedUnique(wanted.filter(f => f >= 0 && f <= last)).slice(0, 16);
}

const USAGE = `
Usage: node --import tsx blender/preview.ts --in <frames dir> --meta <sting.json> --out <dir>
         [--mix <soundtrack.wav>] [--font monospace]
`;

async function main(): Promise<void> {
  const {values} = parseFlags({
    in: {type: 'string'},
    meta: {type: 'string'},
    out: {type: 'string'},
    mix: {type: 'string'},
    font: {type: 'string'},
  });
  const dir = path.resolve(need(values.in, 'in'));
  const m = await loadData(need(values.meta, 'meta'), 'meta');
  assertStingMeta(m);
  const out = path.resolve(need(values.out, 'out'));
  const font = values.font ?? DEFAULT_FONT;
  fs.mkdirSync(out, {recursive: true});
  const size = m.frameSizePx;
  const file = (f: number) =>
    path.join(dir, `${String(f).padStart(m.digits, '0')}.png`);
  const missing = Array.from({length: m.frames}, (_, f) => f).filter(
    f => !fs.existsSync(file(f)),
  );
  if (missing.length)
    throw new Error(
      `${dir} is missing ${missing.length} frames (first: ${missing[0]})`,
    );
  const dur = (m.frames / m.fps).toFixed(6);
  const sequence = [
    '-framerate',
    String(m.fps),
    '-start_number',
    '0',
    '-i',
    path.join(dir, `%0${m.digits}d.png`),
  ];
  const black = [
    '-f',
    'lavfi',
    '-i',
    `color=c=black:s=${size}x${size}:r=${m.fps}:d=${dur}`,
  ];
  const audio = values.mix
    ? ['-ss', (m.globalStart / m.fps).toFixed(6), '-t', dur, '-i', values.mix]
    : [];
  await produceAtomic(path.join(out, 'logo-sting-preview.mp4'), tmp =>
    ffmpeg([
      '-y',
      ...sequence,
      ...black,
      ...audio,
      '-filter_complex',
      '[1:v][0:v]overlay=format=auto:shortest=1,format=yuv420p[v]',
      '-map',
      '[v]',
      ...(values.mix ? ['-map', '2:a', '-c:a', 'aac', '-b:a', '160k'] : []),
      '-c:v',
      'libx264',
      '-crf',
      '23',
      '-preset',
      'slow',
      '-movflags',
      '+faststart',
      tmp,
    ]),
  );

  await withScratchDir('sting-preview', async scratch => {
    // Frames over black, so the sheets show the mark as the film will.
    const flat = (f: number, crop: boolean) => {
      const target = path.join(scratch, `${crop ? 'c' : 'f'}${f}.png`);
      const c = Math.round(size / 6);
      ffmpeg([
        '-y',
        '-f',
        'lavfi',
        '-i',
        `color=c=black:s=${size}x${size}`,
        '-i',
        file(f),
        '-filter_complex',
        `[0:v][1:v]overlay=format=auto${crop ? `,crop=${size - 2 * c}:${size - 2 * c}:${c}:${c}` : ''},format=rgb24`,
        '-frames:v',
        '1',
        target,
      ]);
      return target;
    };
    const label = (f: number) => `${f}  film ${f + m.globalStart}`;
    await tileSheet(
      keyFrames(m).map(f => ({file: flat(f, false), label: label(f)})),
      path.join(out, 'logo-sting-contact.png'),
      {cols: 4, tileWidth: 360, font},
    );
    const motion = Array.from(
      {length: Math.min(m.frames, m.restFrames[0] + 1)},
      (_, f) => f,
    );
    await tileSheet(
      motion.map(f => ({file: flat(f, true), label: label(f)})),
      path.join(out, 'logo-sting-motion.png'),
      {cols: 8, tileWidth: 240, font},
    );
  });
  for (const f of fs.readdirSync(out)) console.log(path.join(out, f));
}

if (isMain(import.meta.url)) runCli(USAGE, main);
