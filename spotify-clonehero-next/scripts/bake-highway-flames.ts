/**
 * Bakes the original highway playline hit-flame animation sheet into a WebP
 * for the highway preview.
 *
 * The renderer still decodes and selects frames per note, but the shipped
 * asset is an animated WebP so the animation is one compact network asset.
 *
 * Run with:
 *   pnpm tsx scripts/bake-highway-flames.ts <textures-source-dir> [output-dir]
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

export function getHighwayFlameSources(sourceDir: string) {
  return [
    {
      source: path.join(sourceDir, 'flames', 'hitflame_anim_16.png'),
      output: 'highway-hit-flame.webp',
      frameWidth: 96,
      frameCount: 15,
    },
  ] as const;
}

export async function bakeHighwayFlames(
  sourceDir: string,
  outputDir = OUTPUT_DIR,
): Promise<string[]> {
  await fs.mkdir(outputDir, {recursive: true});
  const outputs: string[] = [];

  for (const source of getHighwayFlameSources(sourceDir)) {
    const output = path.join(outputDir, source.output);
    const frames = await Promise.all(
      Array.from({length: source.frameCount}, (_, frame) =>
        sharp(source.source)
          .extract({
            left: frame * source.frameWidth,
            top: 0,
            width: source.frameWidth,
            height: 96,
          })
          .png()
          .toBuffer(),
      ),
    );
    await sharp(frames, {join: {animated: true, across: 1}})
      .webp({
        quality: 92,
        effort: 6,
        loop: 0,
        delay: frames.map(() => 17),
      })
      .toFile(output);
    outputs.push(output);
  }

  return outputs;
}

if (process.argv[1]?.endsWith('bake-highway-flames.ts')) {
  const sourceDir = process.argv[2];
  if (!sourceDir) {
    throw new Error(
      'Usage: pnpm tsx scripts/bake-highway-flames.ts <textures-source-dir> [output-dir]',
    );
  }

  bakeHighwayFlames(sourceDir, process.argv[3] ?? OUTPUT_DIR)
    .then(outputs => {
      for (const output of outputs) console.log(`baked ${output}`);
    })
    .catch(error => {
      console.error(error);
      process.exitCode = 1;
    });
}
