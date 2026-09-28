/**
 * Review sheets: images tiled into one PNG, each tile stamped with a label
 * (its frame number, say). One image makes a one-tile sheet.
 *
 * Labels are drawn with ffmpeg's drawtext through fontconfig: `font` is a
 * family name ("monospace", "Menlo") or a path to a font file.
 */
import fs from 'node:fs';
import path from 'node:path';
import {produceAtomic, withScratchDir} from '../lib/files';
import {probeVideo} from '../lib/media';
import {ffmpeg} from '../lib/proc';

export const DEFAULT_FONT = 'monospace';

/** drawtext's font option: a file path, or a fontconfig family. */
export function fontOption(font: string): string {
  const escape = (s: string) =>
    s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/:/g, '\\:');
  const isFile = font.includes('/') || /\.(ttf|otf|ttc)$/i.test(font);
  return isFile ? `fontfile='${escape(font)}'` : `font='${escape(font)}'`;
}

/** A drawtext filter that stamps the text in `textFile` at the top left. */
function labelFilter(textFile: string, fontSize: number, font: string): string {
  const escaped = textFile
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/:/g, '\\:');
  return (
    `drawtext=${fontOption(font)}:textfile='${escaped}':x=${Math.round(fontSize / 2)}:y=${Math.round(fontSize / 2)}:` +
    `fontsize=${fontSize}:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=${Math.round(fontSize / 5)}`
  );
}

export interface SheetOptions {
  cols: number;
  /** Tile width in px (height keeps each image's aspect); default: the first image's own width. */
  tileWidth?: number;
  font?: string;
}

/** Tiles `images` (with a label each) into `out`, left to right, top to bottom. */
export async function tileSheet(
  images: readonly {file: string; label: string}[],
  out: string,
  {cols, tileWidth, font = DEFAULT_FONT}: SheetOptions,
): Promise<void> {
  if (!images.length) throw new Error('No images to tile');
  const columns = Math.max(1, Math.min(cols, images.length));
  const rows = Math.ceil(images.length / columns);
  // Labels read at about a 24th of the tile's width.
  const width = tileWidth ?? probeVideo(images[0]!.file).width;
  const fontSize = Math.max(12, Math.round(width / 24));
  await withScratchDir('sheet', async scratch => {
    images.forEach(({file, label}, i) => {
      const text = path.join(scratch, `${i}.txt`);
      fs.writeFileSync(text, label);
      const scale = tileWidth ? `scale=${tileWidth}:-2,` : '';
      ffmpeg([
        '-y',
        '-i',
        file,
        '-vf',
        `${scale}${labelFilter(text, fontSize, font)}`,
        '-frames:v',
        '1',
        path.join(scratch, `${String(i).padStart(6, '0')}.png`),
      ]);
    });
    await produceAtomic(out, tmp =>
      ffmpeg([
        '-y',
        '-framerate',
        '1',
        '-i',
        path.join(scratch, '%06d.png'),
        '-vf',
        `tile=${columns}x${rows}:padding=4:margin=4:color=0x222222`,
        '-frames:v',
        '1',
        '-update',
        '1',
        tmp,
      ]),
    );
  });
}
