/**
 * Offline texture bake script (plan 0068, task 2).
 *
 * Source: Unity authoring art at `~/Downloads/Textures/Note_Spritesheets`
 * (sprite strips + paired `.meta` files, drum note components split into
 * grayscale `body`/`head`/`cap` layers that Unity tints per-lane at
 * runtime, plus separate `Standard` / `Accents` / `StarNote` directories
 * per drum piece). This script slices the strips (using the frame rects
 * recorded in the `.meta` files) and composites/tints the layers into flat
 * per-variant webp files, in the project's own naming convention, under
 * `public/assets/preview/baked/`.
 *
 * Not wired into the renderer yet — plan 0068 task 3 wires
 * `TextureManager` to these paths. This script only produces the assets.
 *
 * Usage:
 *   pnpm exec tsx scripts/bake-preview-textures.ts [--source <dir>] [--out <dir>]
 *
 * Naming convention (matches the existing `public/assets/preview/assets2`
 * set consumed by `lib/preview/highway/TextureManager.ts`):
 *   drum-tom-{color}[-accent|-ghost][-sp].webp
 *   drum-cymbal-{color}[-accent|-ghost][-sp].webp
 *   drum-kick[-sp].webp
 *   strum{0-4}[-sp].webp, open[-sp].webp   (five-fret, one file per fret color)
 *
 * Drum dynamics x SP is a full cross product: for every lane color both
 * `{piece}-{color}-accent-sp.webp` and `{piece}-{color}-ghost-sp.webp` are
 * baked in addition to the plain `-accent`/`-ghost`/`-sp` variants, so every
 * legal (color, dynamic, sp) flag combo resolves to a texture.
 *
 * Mapping decisions (see plan 0068 "Asset pipeline"):
 *   - Standard  -> base variant (no suffix)
 *   - Accents   -> `-accent` variant
 *   - StarNote / 'sp shine' -> `-sp` variant
 *   - ghost     -> NOT present in the source art. Implemented as a
 *     documented tint: the Standard composite at 45% opacity with
 *     saturation reduced, matching the muted "ghost note" look used
 *     elsewhere in Clone Hero skins. Revisit if real ghost art turns up.
 *   - accent-sp / ghost-sp -> the accent/ghost composite with the same
 *     gold StarNote overlay used for the plain `-sp` variant.
 *   - Five-fret per-color art was not found in the source (the Guitar
 *     sprite strips are grayscale/white shape animations, tinted per-fret
 *     by Unity at runtime, same as the drums). Frame 0 of each strip is
 *     used as the static base shape and tinted per fret color here.
 *     Hopo/tap have no distinct source art either; this script emits the
 *     strum shape for all three note types (documented gap - the plan
 *     found no hopo/tap-specific source, only "parsed via scan-chart
 *     flags" already handled elsewhere).
 */
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const DEFAULT_SOURCE = path.join(
  process.env['HOME'] || '',
  'Downloads/Textures/Note_Spritesheets',
);
const DEFAULT_OUT = path.join(__dirname, '../public/assets/preview/baked');

type Rgb = [number, number, number];

// Standard Clone Hero drum-lane colors (matches public/assets/preview/assets2 naming).
const DRUM_COLORS: Record<string, Rgb> = {
  red: [226, 72, 61],
  yellow: [242, 201, 76],
  blue: [74, 144, 217],
  green: [76, 175, 80],
};

// Standard five-fret colors, indices match strum0..strum4.
const FRET_COLORS: Rgb[] = [
  [76, 175, 80], // 0 green
  [226, 72, 61], // 1 red
  [242, 201, 76], // 2 yellow
  [74, 144, 217], // 3 blue
  [237, 138, 44], // 4 orange
];

const GOLD: Rgb = [255, 210, 90];

export interface SpriteRect {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Parses the sub-sprite rects out of the text of a Unity TextureImporter .meta file (YAML). */
export function parseSpriteRects(metaText: string): SpriteRect[] {
  const rects: SpriteRect[] = [];
  const lines = metaText.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const nameMatch = lines[i].match(/^\s*name:\s*(\S+)/);
    if (!nameMatch) continue;
    const block = lines.slice(i, i + 12).join('\n');
    const x = block.match(/x:\s*(-?\d+)/)?.[1];
    const y = block.match(/y:\s*(-?\d+)/)?.[1];
    const w = block.match(/width:\s*(\d+)/)?.[1];
    const h = block.match(/height:\s*(\d+)/)?.[1];
    if (x && y && w && h) {
      rects.push({
        name: nameMatch[1],
        x: Number(x),
        y: Number(y),
        width: Number(w),
        height: Number(h),
      });
    }
  }
  return rects;
}

/** Parses the sub-sprite rects out of a Unity TextureImporter .meta file (YAML). */
async function readSpriteRects(pngPath: string): Promise<SpriteRect[]> {
  const metaPath = `${pngPath}.meta`;
  const text = await readFile(metaPath, 'utf8');
  return parseSpriteRects(text);
}

/** Converts a Unity sprite rect (Y-up, origin bottom-left) to a Y-down `top` offset for sharp's `extract`. */
export function rectTopYDown(rect: SpriteRect, imageHeight: number): number {
  return imageHeight - rect.y - rect.height;
}

/** Extracts a single frame (by index in strip order) from a Unity sprite-strip PNG. */
async function extractFrame(
  pngPath: string,
  frameIndex: number,
): Promise<sharp.Sharp> {
  const rects = await readSpriteRects(pngPath);
  if (rects.length === 0) {
    // Not a sliced strip (e.g. kick art) - use the whole image.
    return sharp(pngPath);
  }
  const rect = rects[frameIndex];
  if (!rect) {
    throw new Error(
      `Frame ${frameIndex} not found in ${pngPath} (${rects.length} frames)`,
    );
  }
  // Unity sprite rects are Y-up (origin bottom-left); PNG/sharp extract is Y-down.
  const meta = await sharp(pngPath).metadata();
  const top = rectTopYDown(rect, meta.height ?? 0);
  return sharp(pngPath).extract({
    left: rect.x,
    top,
    width: rect.width,
    height: rect.height,
  });
}

/** Tints a grayscale/white source image to `color`, preserving its alpha channel. */
async function tint(sharpInput: sharp.Sharp, color: Rgb): Promise<Buffer> {
  return sharpInput
    .ensureAlpha()
    .tint({r: color[0], g: color[1], b: color[2]})
    .png()
    .toBuffer();
}

/** Composites a stack of same-size RGBA buffers (bottom to top). */
async function compositeStack(
  width: number,
  height: number,
  layers: Buffer[],
): Promise<sharp.Sharp> {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: {r: 0, g: 0, b: 0, alpha: 0},
    },
  }).composite(layers.map(buf => ({input: buf})));
}

async function toWebp(image: sharp.Sharp, outPath: string): Promise<number> {
  const buf = await image.webp({quality: 90}).toBuffer();
  await writeFile(outPath, new Uint8Array(buf));
  return buf.length;
}

async function ghostVariant(baseComposite: sharp.Sharp): Promise<sharp.Sharp> {
  // Documented approximation: no ghost source art exists (see file header).
  // Muted look: desaturate + reduce alpha via a low-alpha white overlay
  // multiplied by the existing alpha channel isn't directly supported by
  // sharp's simple pipeline, so we lower opacity by scaling the alpha
  // channel through modulate + a partially-transparent composite pass.
  const buf = await baseComposite
    .clone()
    .modulate({saturation: 0.35, brightness: 0.9})
    .png()
    .toBuffer();
  const meta = await sharp(buf).metadata();
  const faded = await sharp(buf)
    .composite([
      {
        input: {
          create: {
            width: meta.width ?? 1,
            height: meta.height ?? 1,
            channels: 4,
            background: {r: 0, g: 0, b: 0, alpha: 0.45},
          },
        },
        blend: 'dest-in',
      },
    ])
    .png()
    .toBuffer();
  return sharp(faded);
}

interface BakeResult {
  file: string;
  bytes: number;
}

async function bakeDrumPiece(
  source: string,
  out: string,
  piece: 'toms' | 'cymbals',
  outPrefix: 'drum-tom' | 'drum-cymbal',
  results: BakeResult[],
): Promise<void> {
  const dir = path.join(source, 'Drums', piece);
  const standardDir = path.join(dir, 'Standard');
  const accentsDir = path.join(dir, 'Accents');
  const starDir = path.join(dir, 'StarNote');

  const bodyPath = path.join(standardDir, 'body.png');
  const headOrCapPath = path.join(
    standardDir,
    piece === 'toms' ? 'head.png' : 'cap.png',
  );
  const {width, height} = await sharp(bodyPath).metadata();
  const w = width ?? 128;
  const h = height ?? 64;

  const accentFile =
    piece === 'toms'
      ? path.join(accentsDir, 'AcPc01.png')
      : path.join(accentsDir, 'AcCm01.png');
  const starBodyFile =
    piece === 'toms'
      ? path.join(starDir, 'body0001.png')
      : path.join(starDir, 'starcym_01.png');

  for (const [colorName, rgb] of Object.entries(DRUM_COLORS)) {
    const bodyTinted = await tint(sharp(bodyPath), rgb);
    const capTinted = await tint(sharp(headOrCapPath), rgb);
    const standardImg = await compositeStack(w, h, [bodyTinted, capTinted]);

    const standardBuf = await standardImg.clone().png().toBuffer();
    results.push({
      file: `${outPrefix}-${colorName}.webp`,
      bytes: await toWebp(
        sharp(standardBuf),
        path.join(out, `${outPrefix}-${colorName}.webp`),
      ),
    });

    const ghostImg = await ghostVariant(sharp(standardBuf));
    results.push({
      file: `${outPrefix}-${colorName}-ghost.webp`,
      bytes: await toWebp(
        ghostImg,
        path.join(out, `${outPrefix}-${colorName}-ghost.webp`),
      ),
    });

    const accentTinted = await tint(sharp(accentFile), rgb);
    results.push({
      file: `${outPrefix}-${colorName}-accent.webp`,
      bytes: await toWebp(
        sharp(accentTinted),
        path.join(out, `${outPrefix}-${colorName}-accent.webp`),
      ),
    });
    const accentBuf = await sharp(accentTinted).png().toBuffer();

    // sp: lane-color body + gold star overlay (StarNote body art, gold-tinted).
    const starBodyTinted = await tint(sharp(starBodyFile), rgb);
    const starGlowBuf = await tint(sharp(starBodyFile), GOLD);
    const spImg = await compositeStack(w, h, [
      standardBuf,
      starBodyTinted,
      starGlowBuf,
    ]);
    const spBuf = await spImg.clone().png().toBuffer();
    results.push({
      file: `${outPrefix}-${colorName}-sp.webp`,
      bytes: await toWebp(
        spImg,
        path.join(out, `${outPrefix}-${colorName}-sp.webp`),
      ),
    });

    // accent-sp / ghost-sp: full dynamics x SP cross product (see file
    // header) so every legal color/dynamic/sp flag combo has a texture.
    const accentSpImg = await compositeStack(w, h, [
      accentBuf,
      starBodyTinted,
      starGlowBuf,
    ]);
    results.push({
      file: `${outPrefix}-${colorName}-accent-sp.webp`,
      bytes: await toWebp(
        accentSpImg,
        path.join(out, `${outPrefix}-${colorName}-accent-sp.webp`),
      ),
    });

    const ghostSpImg = await ghostVariant(sharp(spBuf));
    results.push({
      file: `${outPrefix}-${colorName}-ghost-sp.webp`,
      bytes: await toWebp(
        ghostSpImg,
        path.join(out, `${outPrefix}-${colorName}-ghost-sp.webp`),
      ),
    });
  }
}

async function bakeKick(
  source: string,
  out: string,
  results: BakeResult[],
): Promise<void> {
  const dir = path.join(source, 'Drums', 'drum kicks');
  const base = path.join(dir, 'kickbase.png');
  const body = path.join(dir, 'Kickbody.png');
  const {width, height} = await sharp(base).metadata();
  const w = width ?? 768;
  const h = height ?? 48;

  const baseBuf = await sharp(base).png().toBuffer();
  const bodyBuf = await sharp(body).png().toBuffer();
  const standard = await compositeStack(w, h, [baseBuf, bodyBuf]);
  const standardBuf = await standard.clone().png().toBuffer();
  results.push({
    file: 'drum-kick.webp',
    bytes: await toWebp(sharp(standardBuf), path.join(out, 'drum-kick.webp')),
  });

  const shine = path.join(dir, 'sp shine', 'sp shine00.png');
  const shineBuf = await sharp(shine).png().toBuffer();
  const sp = await compositeStack(w, h, [standardBuf, shineBuf]);
  results.push({
    file: 'drum-kick-sp.webp',
    bytes: await toWebp(sp, path.join(out, 'drum-kick-sp.webp')),
  });
}

async function bakeFiveFret(
  source: string,
  out: string,
  results: BakeResult[],
): Promise<void> {
  const notesDir = path.join(source, 'Guitar', 'Notes');
  const baseStripPath = path.join(notesDir, 'spr_newnotes_strip4.png');
  const starStripPath = path.join(notesDir, 'spr_star_notes_strip4.png');
  const openStripPath = path.join(
    notesDir,
    'Open',
    'spr_open_notes_strip5.png',
  );

  const baseFrame = await extractFrame(baseStripPath, 0);
  const baseFrameBuf = await baseFrame.png().toBuffer();
  const starFrame = await extractFrame(starStripPath, 0);
  const starFrameBuf = await starFrame.png().toBuffer();
  const {width: fw, height: fh} = await sharp(baseFrameBuf).metadata();

  // strum/hopo/tap: no distinct source art was found (see file header) -
  // all three note-type variants are baked from the same base shape, so
  // the per-color tinted buffers are computed once and reused for each.
  const starGold = await tint(sharp(starFrameBuf), GOLD);
  for (let i = 0; i < FRET_COLORS.length; i++) {
    const color = FRET_COLORS[i];
    const tinted = await tint(sharp(baseFrameBuf), color);
    const spImg = await compositeStack(fw ?? 256, fh ?? 128, [
      tinted,
      starGold,
    ]);
    const spBuf = await spImg.png().toBuffer();

    for (const kind of ['strum', 'hopo', 'tap'] as const) {
      results.push({
        file: `${kind}${i}.webp`,
        bytes: await toWebp(sharp(tinted), path.join(out, `${kind}${i}.webp`)),
      });
      results.push({
        file: `${kind}-sp${i}.webp`,
        bytes: await toWebp(
          sharp(spBuf),
          path.join(out, `${kind}-sp${i}.webp`),
        ),
      });
    }
  }

  const openFrame = await extractFrame(openStripPath, 0);
  const openBuf = await openFrame.png().toBuffer();
  results.push({
    file: 'open.webp',
    bytes: await toWebp(sharp(openBuf), path.join(out, 'open.webp')),
  });
  const {width: ow, height: oh} = await sharp(openBuf).metadata();
  const openGold = await tint(sharp(starFrameBuf).resize(ow, oh), GOLD);
  const openSp = await compositeStack(ow ?? 512, oh ?? 64, [openBuf, openGold]);
  results.push({
    file: 'open-sp.webp',
    bytes: await toWebp(openSp, path.join(out, 'open-sp.webp')),
  });
}

async function main() {
  const args = process.argv.slice(2);
  const sourceIdx = args.indexOf('--source');
  const outIdx = args.indexOf('--out');
  const source = sourceIdx >= 0 ? args[sourceIdx + 1] : DEFAULT_SOURCE;
  const out = outIdx >= 0 ? args[outIdx + 1] : DEFAULT_OUT;

  await mkdir(out, {recursive: true});

  const results: BakeResult[] = [];
  await bakeDrumPiece(source, out, 'toms', 'drum-tom', results);
  await bakeDrumPiece(source, out, 'cymbals', 'drum-cymbal', results);
  await bakeKick(source, out, results);
  await bakeFiveFret(source, out, results);

  let total = 0;
  console.log(`Baked ${results.length} files to ${out}:`);
  for (const r of results.sort((a, b) => a.file.localeCompare(b.file))) {
    total += r.bytes;
    console.log(`  ${r.file}\t${(r.bytes / 1024).toFixed(1)} KB`);
  }
  console.log(`Total: ${(total / 1024 / 1024).toFixed(2)} MB`);
}

if (require.main === module) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
