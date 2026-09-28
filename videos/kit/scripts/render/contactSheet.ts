/**
 * Tiles a clip's frames into one PNG to review motion at a glance. Every
 * source frame is stamped with its film frame BEFORE frames are picked, so
 * each tile's label is exactly the frame it shows: --from is the film frame
 * of the clip's first frame (600 for a clip rendered from film frame 600).
 *
 *   node --import tsx scripts/render/contactSheet.ts --in <clip.mp4> --out <sheet.png> \
 *     [--every 10] [--cols 6] [--width 480] [--from 0] [--crop w:h:x:y] [--font monospace]
 *
 * --every is the frame stride between tiles (1 = every frame, to inspect
 * easing and hit timing frame by frame). --crop cuts a region out first.
 */
import path from 'node:path';
import {UsageError, int, isMain, need, parseFlags, runCli} from '../lib/cli';
import {produceAtomic} from '../lib/files';
import {countFrames, probeVideo} from '../lib/media';
import {ffmpeg} from '../lib/proc';
import {DEFAULT_FONT, fontOption} from './sheet';

export interface ContactSheetOptions {
  input: string;
  out: string;
  every: number;
  cols: number;
  width: number;
  /** The film frame of the clip's first frame. */
  from: number;
  crop?: string;
  font: string;
}

export async function contactSheet(
  o: ContactSheetOptions,
): Promise<{tiles: number}> {
  if (o.crop && !/^\d+:\d+:\d+:\d+$/.test(o.crop)) {
    throw new UsageError(`--crop must be w:h:x:y, got "${o.crop}"`);
  }
  const frames = countFrames(o.input);
  const tiles = Math.ceil(frames / o.every);
  const cols = Math.min(o.cols, tiles);
  const rows = Math.ceil(tiles / cols);
  // Labels are drawn at source size before the tiles shrink: size them so they
  // read at about a 24th of the tile's width.
  const sourceWidth = o.crop
    ? Number(o.crop.split(':')[0])
    : probeVideo(o.input).width;
  const fontSize = Math.round(
    (Math.max(12, o.width / 24) * sourceWidth) / o.width,
  );
  const label =
    `drawtext=${fontOption(o.font)}:text='%{eif\\:n+${o.from}\\:d}':x=${Math.round(fontSize / 3)}:` +
    `y=${Math.round(fontSize / 3)}:fontsize=${fontSize}:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=${Math.round(fontSize / 6)}`;
  const filters = [
    ...(o.crop ? [`crop=${o.crop}`] : []),
    label,
    `select='not(mod(n\\,${o.every}))'`,
    `scale=${o.width}:-2`,
    `tile=${cols}x${rows}:padding=4:margin=4:color=0x222222`,
  ];
  await produceAtomic(o.out, tmp =>
    ffmpeg([
      '-y',
      '-i',
      o.input,
      '-vf',
      filters.join(','),
      '-fps_mode',
      'vfr',
      '-frames:v',
      '1',
      '-update',
      '1',
      tmp,
    ]),
  );
  return {tiles};
}

const USAGE = `
Usage: node --import tsx scripts/render/contactSheet.ts --in <clip.mp4> --out <sheet.png>
         [--every 10] [--cols 6] [--width 480] [--from 0] [--crop w:h:x:y] [--font monospace]
`;

async function main(): Promise<void> {
  const {values} = parseFlags({
    in: {type: 'string'},
    out: {type: 'string'},
    every: {type: 'string'},
    cols: {type: 'string'},
    width: {type: 'string'},
    from: {type: 'string'},
    crop: {type: 'string'},
    font: {type: 'string'},
  });
  const o: ContactSheetOptions = {
    input: need(values.in, 'in'),
    out: path.resolve(need(values.out, 'out')),
    every: int(values.every, 'every', 10, 1),
    cols: int(values.cols, 'cols', 6, 1),
    width: int(values.width, 'width', 480, 16),
    from: int(values.from, 'from', 0),
    crop: values.crop,
    font: values.font ?? DEFAULT_FONT,
  };
  const {tiles} = await contactSheet(o);
  console.log(
    `contact sheet: ${tiles} tiles, every ${o.every} frames -> ${o.out}`,
  );
}

if (isMain(import.meta.url)) runCli(USAGE, main);
