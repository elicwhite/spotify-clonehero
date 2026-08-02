/**
 * Bakes the original highway playline flame assets into WebPs for the
 * highway preview. The fretted flame is an animation sheet; the open-flame
 * assets are already complete four-/five-arch hitline sprites and must stay
 * intact rather than being split into animation frames.
 *
 * The renderer still decodes and selects frames per note, but the shipped
 * assets are animated WebPs so each animation is one compact network asset.
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
      animated: true,
    },
    {
      source: path.join(sourceDir, 'open_flame.png'),
      output: 'highway-open-flame.webp',
      animated: false,
    },
    {
      source: path.join(sourceDir, 'open_flame_drum.png'),
      output: 'highway-open-flame-drum.webp',
      animated: false,
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
    if (source.animated) {
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
    } else {
      await sharp(source.source).webp({quality: 92, effort: 6}).toFile(output);
    }
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
