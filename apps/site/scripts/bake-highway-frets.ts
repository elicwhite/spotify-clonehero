/**
 * Bakes the layered fret-button textures used by the highway hitline.
 *
 * The source assets are the original Unity layers. The renderer composes
 * them at runtime so the inner color can follow each lane's color and the
 * first/second/third highlight positions can be mirrored per lane.
 *
 * Run with:
 *   pnpm tsx scripts/bake-highway-frets.ts <frets-source-dir> [output-dir]
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
  'frets',
);

export const FRET_STYLES = ['first', 'second', 'third'] as const;
export const FRET_LAYERS = [
  'base',
  'inner_color',
  'cover',
  'half_cover',
  'head',
  'head_light',
  'pick',
] as const;

export async function bakeHighwayFrets(
  sourceDir: string,
  outputDir = OUTPUT_DIR,
): Promise<string[]> {
  await fs.mkdir(outputDir, {recursive: true});
  const outputs: string[] = [];

  for (const [styleIndex, style] of FRET_STYLES.entries()) {
    const sourceIndex = styleIndex + 1;
    for (const layer of FRET_LAYERS) {
      const output = path.join(outputDir, `${style}-${layer}.webp`);
      await sharp(path.join(sourceDir, style, `${layer}_${sourceIndex}.png`))
        .webp({quality: 92, effort: 6})
        .toFile(output);
      outputs.push(output);
    }
  }

  return outputs;
}

if (process.argv[1]?.endsWith('bake-highway-frets.ts')) {
  const sourceDir = process.argv[2];
  if (!sourceDir) {
    throw new Error(
      'Usage: pnpm tsx scripts/bake-highway-frets.ts <frets-source-dir> [output-dir]',
    );
  }

  bakeHighwayFrets(sourceDir, process.argv[3] ?? OUTPUT_DIR)
    .then(outputs => {
      for (const output of outputs) console.log(`baked ${output}`);
    })
    .catch(error => {
      console.error(error);
      process.exitCode = 1;
    });
}
