/**
 * Bakes the Unity guitar/bass sustain sprites into small browser-friendly
 * WebP assets used by the Three.js highway sustain tails.
 *
 * `spr_sustain_strip6` contains six brightness/specular frames of one fret
 * sustain sprite, not six lane colours. All frames are baked so animation
 * can be added later; the highway currently uses frame 1 as its idle art.
 * The source sprites are already authored for the vertical highway, so the
 * fret frames are kept in their original orientation.
 *
 * Run with:
 *   pnpm tsx scripts/bake-guitar-sustains.ts <sustains-source-dir> [output-dir]
 */

import {promises as fs} from 'fs';
import * as path from 'path';
import sharp from 'sharp';

const OUTPUT_DIR = path.join(
  __dirname,
  '..',
  'public',
  'assets',
  'preview',
  'assets2',
);

const FRET_FRAME_COUNT = 6;

const FRET_FRAME_WIDTH = 73;
const FRET_FRAME_TOP = 1;
const FRET_FRAME_HEIGHT = 70;

export async function bakeGuitarSustainTextures(
  sourceDir: string,
  outputDir = OUTPUT_DIR,
): Promise<string[]> {
  await fs.mkdir(outputDir, {recursive: true});

  const frettedSource = path.join(sourceDir, 'spr_sustain_strip6.png');
  const baked: string[] = [];

  for (let frame = 0; frame < FRET_FRAME_COUNT; frame++) {
    const output = path.join(
      outputDir,
      `highway-sustain-fretted-${frame}.webp`,
    );
    await sharp(frettedSource)
      .extract({
        left: 1 + frame * FRET_FRAME_WIDTH,
        top: FRET_FRAME_TOP,
        width: FRET_FRAME_WIDTH,
        height: FRET_FRAME_HEIGHT,
      })
      .webp({quality: 92, effort: 6})
      .toFile(output);
    baked.push(output);
  }

  const passthroughs = [
    ['spr_open_sustain_strip2.png', 'highway-sustain-open.webp'],
  ] as const;
  for (const [sourceName, outputName] of passthroughs) {
    const output = path.join(outputDir, outputName);
    await sharp(path.join(sourceDir, sourceName))
      .webp({quality: 92, effort: 6})
      .toFile(output);
    baked.push(output);
  }

  return baked;
}

if (process.argv[1]?.endsWith('bake-guitar-sustains.ts')) {
  const sourceDir = process.argv[2];
  if (!sourceDir) {
    throw new Error(
      'Usage: pnpm tsx scripts/bake-guitar-sustains.ts <sustains-source-dir> [output-dir]',
    );
  }

  bakeGuitarSustainTextures(sourceDir, process.argv[3] ?? OUTPUT_DIR)
    .then(outputs => {
      for (const output of outputs) console.log(`baked ${output}`);
    })
    .catch(error => {
      console.error(error);
      process.exitCode = 1;
    });
}
