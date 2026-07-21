/**
 * Bakes the square-style drum-tom accent and ghost art into
 * `public/assets/preview/assets2/`.
 *
 * Algorithm (numerically validated against shipped pixels — see the
 * validation gates below and plans/completed/0069-drum-note-style-sets.md):
 *
 * - Accent: the shipped accent art (both round and square) is just the base
 *   note frames with an UNTINTED overlay (the silver arrows/cage) composited
 *   plain-over on top. There is no color to learn — the overlay source PNGs
 *   are already just silver art, transparent over the band. So
 *   `drum-tom-{color}-accent.webp` frame i = shipped `drum-tom-{color}.webp`
 *   page i, composited with `toms square/SqTmAc/SqTmAc{i}.png` (untinted).
 *   Frame i of the source art aligns 1:1 with page i of the shipped base
 *   animation (zero offset).
 *
 * - Ghost is the only variant that actually needs a color fit: the gem layer
 *   (`SQTMBody-Ghost.png`) is genuinely tinted in shipped art, and no
 *   authentic square ghost source exists to copy directly. A per-gray-value
 *   tone curve is fit from the ROUND ghost source pair (`ghost_tom.png` the
 *   gem, `ghost_tom_head.png` the untinted cage) against the shipped round
 *   ghost art, sampling only pixels attributable to the gem alone (gem
 *   opaque, cage transparent, shipped pixel opaque). That curve is then
 *   applied to the square gem (`SQTMBody-Ghost.png`), composited underneath
 *   the untinted square cage (`SQTMBaseghost.png`) — gem under cage, the
 *   compositing order verified against shipped art. Ghost art is a single
 *   static frame, matching the shipped static-ghost convention (never
 *   16-frame).
 *
 * - SP variants (`-accent-sp`, `-ghost-sp`) are already byte-identical
 *   between square and round in the shipped tree (the SP star glow/cap
 *   overlay is style-neutral by shipped precedent) — this script asserts
 *   that byte-equality rather than regenerating them.
 *
 * - Square base/sp (`drum-tom-{color}.webp` / `-sp.webp`) and all
 *   `drum-tom-round-*` files are pre-existing shipped/downloaded art (round:
 *   sourced from static.enchor.us; square base/sp: hand-tuned). This script
 *   never writes them — it only reads them as compositing/validation
 *   sources.
 *
 * Source art: 128x64 grayscale/RGBA PNG layers under
 * `/Users/eliwhite/Downloads/Textures/Note_Spritesheets/Drums/` (Unity
 * export).
 *
 * Validation gates (blocking — a color's outputs are skipped, with a loud
 * warning, unless the gate passes or --force is given):
 * - Round-accent recomposite: composite(shipped `drum-tom-round-{c}.webp`
 *   page i, `toms/Accents/AcPc{i+1}.png` untinted) vs shipped
 *   `drum-tom-round-{c}-accent.webp` page i must have mean abs channel diff
 *   <= 4 — proves the accent compositing model against real shipped art
 *   before trusting it for the square output.
 * - Round-ghost recomposite: the ghost ring curve applied back to its own
 *   round fitting sources (composited gem-under-cage) vs shipped
 *   `drum-tom-round-{c}-ghost.webp` must have mean abs channel diff <= 18 —
 *   proves the curve-fit + compositing model before trusting it for the
 *   square ghost output.
 *
 * Run with:
 *   pnpm tsx scripts/bake-drum-styles.ts            # bake + overwrite outputs
 *   pnpm tsx scripts/bake-drum-styles.ts --verify    # gates + assertions only, no writes
 *   pnpm tsx scripts/bake-drum-styles.ts --force     # bake even if a validation gate fails
 */

import {promises as fs} from 'fs';
import * as path from 'path';

import sharp from 'sharp';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const SOURCE_DIR =
  '/Users/eliwhite/Downloads/Textures/Note_Spritesheets/Drums/';
const OUTPUT_DIR = path.join(
  __dirname,
  '..',
  'public',
  'assets',
  'preview',
  'assets2',
);

const FRAME_COUNT = 16;
const FRAME_DELAY_MS = 50;

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

export const DRUM_COLORS = ['red', 'yellow', 'blue', 'green'] as const;
export type DrumColor = (typeof DRUM_COLORS)[number];

export type TomVariant = 'accent' | 'ghost';
export const TOM_VARIANTS: TomVariant[] = ['accent', 'ghost'];

export function outputFileName(color: DrumColor, variant: TomVariant): string {
  return variant === 'accent'
    ? `drum-tom-${color}-accent.webp`
    : `drum-tom-${color}-ghost.webp`;
}

// ---------------------------------------------------------------------------
// Pure, Jest-testable helpers
// ---------------------------------------------------------------------------

/** One (source grayscale value, observed shipped-pixel color) pair, used to
 * fit a `ToneCurve` from real shipped art rather than an invented hex/ratio
 * constant. */
export interface ToneSample {
  gray: number;
  r: number;
  g: number;
  b: number;
}

/** A 256-entry lookup table per channel mapping an input grayscale value
 * (0-255, R===G===B on grayscale source art) to the tinted output value for
 * one drum color. Index 0 = black input, index 255 = white input. */
export interface ToneCurve {
  r: number[];
  g: number[];
  b: number[];
}

export interface BuildToneCurveOptions {
  /** Minimum sample count for a gray-value bucket to be treated as real data
   * rather than noise. Default 1 (any sample counts). */
  minSamples?: number;
  /** Moving-average smoothing window radius applied to the fitted curve.
   * Default 4. */
  smoothRadius?: number;
}

/**
 * Fits a `ToneCurve` from real (gray, shipped-color) pixel-pair samples:
 * buckets samples by their (rounded) gray value, keeps only buckets with at
 * least `minSamples` samples, averages the observed shipped color per
 * surviving bucket, linearly interpolates gaps between data-bearing buckets,
 * and extends past the first/last data-bearing bucket toward black (gray=0)
 * and near-white (gray=255) respectively — reflecting that a ring/gem's
 * shading realistically bottoms out near black in shadow and tops out near
 * white in a highlight, rather than holding flat at whatever the extreme
 * sampled bucket happened to be.
 */
export function buildToneCurve(
  samples: ToneSample[],
  options: BuildToneCurveOptions = {},
): ToneCurve {
  const minSamples = options.minSamples ?? 1;
  const smoothRadius = options.smoothRadius ?? 4;

  const sums = Array.from({length: 256}, () => ({r: 0, g: 0, b: 0, n: 0}));
  for (const s of samples) {
    const bucket = Math.max(0, Math.min(255, Math.round(s.gray)));
    sums[bucket].r += s.r;
    sums[bucket].g += s.g;
    sums[bucket].b += s.b;
    sums[bucket].n++;
  }

  const known: {index: number; r: number; g: number; b: number}[] = [];
  for (let i = 0; i < 256; i++) {
    if (sums[i].n >= minSamples) {
      known.push({
        index: i,
        r: sums[i].r / sums[i].n,
        g: sums[i].g / sums[i].n,
        b: sums[i].b / sums[i].n,
      });
    }
  }

  const curve: ToneCurve = {r: [], g: [], b: []};
  if (known.length === 0) {
    // No data at all — identity curve (no tint) is the safest fallback.
    for (let i = 0; i < 256; i++) {
      curve.r.push(i);
      curve.g.push(i);
      curve.b.push(i);
    }
    return curve;
  }

  const blackAnchor = {index: 0, r: 0, g: 0, b: 0};
  const whiteAnchor = {index: 255, r: 255, g: 255, b: 255};

  for (let i = 0; i < 256; i++) {
    let lo: {index: number; r: number; g: number; b: number};
    let hi: {index: number; r: number; g: number; b: number};

    if (i <= known[0].index) {
      lo = blackAnchor;
      hi = known[0];
    } else if (i >= known[known.length - 1].index) {
      lo = known[known.length - 1];
      hi = whiteAnchor;
    } else {
      lo = known[0];
      hi = known[known.length - 1];
      for (let k = 0; k < known.length - 1; k++) {
        if (known[k].index <= i && known[k + 1].index >= i) {
          lo = known[k];
          hi = known[k + 1];
          break;
        }
      }
    }

    const t =
      hi.index === lo.index ? 0 : (i - lo.index) / (hi.index - lo.index);
    curve.r.push(lo.r + (hi.r - lo.r) * t);
    curve.g.push(lo.g + (hi.g - lo.g) * t);
    curve.b.push(lo.b + (hi.b - lo.b) * t);
  }

  return smoothToneCurve(curve, smoothRadius);
}

/**
 * Smooths a `ToneCurve` with a small moving-average window. The shipped
 * ground-truth art is a lossy WebP, so per-bucket averages carry
 * compression quantization noise; applied as a per-pixel LUT, that noise
 * reproduces as visible speckle on otherwise-smooth gradients. Smoothing
 * trades a small amount of curve precision for removing that speckle.
 */
function smoothToneCurve(curve: ToneCurve, windowRadius: number): ToneCurve {
  const smoothChannel = (channel: number[]) =>
    channel.map((_, i) => {
      const lo = Math.max(0, i - windowRadius);
      const hi = Math.min(channel.length - 1, i + windowRadius);
      let sum = 0;
      for (let j = lo; j <= hi; j++) sum += channel[j];
      return sum / (hi - lo + 1);
    });

  return {
    r: smoothChannel(curve.r),
    g: smoothChannel(curve.g),
    b: smoothChannel(curve.b),
  };
}

/**
 * Applies a `ToneCurve` to a grayscale (R===G===B) RGBA PNG buffer,
 * indexing by each pixel's R channel value. Alpha is unchanged.
 */
export async function tintGrayscale(
  png: Buffer,
  curve: ToneCurve,
): Promise<Buffer> {
  const {data, info} = await sharp(png)
    .ensureAlpha()
    .raw()
    .toBuffer({resolveWithObject: true});

  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

  for (let i = 0; i < data.length; i += 4) {
    const gray = data[i];
    data[i] = clamp(curve.r[gray]);
    data[i + 1] = clamp(curve.g[gray]);
    data[i + 2] = clamp(curve.b[gray]);
    // data[i + 3] (alpha) untouched
  }

  return sharp(data, {
    raw: {width: info.width, height: info.height, channels: 4},
  })
    .png()
    .toBuffer();
}

/** Scales the alpha channel of an RGBA PNG buffer by `opacity` (0-1). */
async function applyOpacity(png: Buffer, opacity: number): Promise<Buffer> {
  const {data, info} = await sharp(png)
    .ensureAlpha()
    .raw()
    .toBuffer({resolveWithObject: true});

  for (let i = 3; i < data.length; i += 4) {
    data[i] = Math.round(data[i] * opacity);
  }

  return sharp(data, {
    raw: {width: info.width, height: info.height, channels: 4},
  })
    .png()
    .toBuffer();
}

/** A layer source: a file path, an already-processed PNG buffer (e.g. a
 * pre-tinted layer), or a per-frame array of either, indexed by frame. */
export type LayerSource = string | Buffer;

export interface LayerSpec {
  /** A single source reused on every frame, or an array of exactly
   * `frameCount` sources indexed by frame number. */
  source: LayerSource | LayerSource[];
  /** Alpha multiplier applied to this layer before compositing (0-1).
   * Omitted/1 leaves the layer's alpha untouched. */
  opacity?: number;
}

/**
 * Composites `layers` (bottom to top, plain "over" blending) into
 * `frameCount` 128x64 RGBA PNG buffers, one per output frame. A layer given
 * as a single path/buffer is reused unchanged on every frame; a layer given
 * as an array is indexed by frame.
 */
export async function compositeFrames(
  layers: LayerSpec[],
  frameCount: number,
  canvasSize: {width: number; height: number} = {width: 128, height: 64},
): Promise<Buffer[]> {
  const frames: Buffer[] = [];

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
    const composites: {input: Buffer}[] = [];

    for (const layer of layers) {
      const source = Array.isArray(layer.source)
        ? layer.source[frameIndex % layer.source.length]
        : layer.source;

      let buf = await sharp(source).ensureAlpha().png().toBuffer();
      if (layer.opacity != null && layer.opacity < 1) {
        buf = await applyOpacity(buf, layer.opacity);
      }
      composites.push({input: buf});
    }

    const frame = await sharp({
      create: {
        width: canvasSize.width,
        height: canvasSize.height,
        channels: 4,
        background: {r: 0, g: 0, b: 0, alpha: 0},
      },
    })
      .composite(composites)
      .png()
      .toBuffer();

    frames.push(frame);
  }

  return frames;
}

/** Encodes `frames` as a looping animated WebP with a uniform per-frame
 * delay, matching the format shipped in `assets2` (128x64/16-frame/50ms). */
export async function framesToAnimatedWebp(
  frames: Buffer[],
  delayMs: number,
  outPath: string,
): Promise<void> {
  await sharp(frames, {join: {animated: true, across: 1}})
    .webp({
      quality: 90,
      effort: 6,
      loop: 0,
      delay: frames.map(() => delayMs),
    })
    .toFile(outPath);
}

/** Encodes a single frame as a plain (non-animated) static WebP, matching
 * the shipped static-ghost convention — ghost art must never be written as a
 * 16-frame animation. */
export async function frameToStaticWebp(
  frame: Buffer,
  outPath: string,
): Promise<void> {
  await sharp(frame).webp({quality: 90, effort: 6}).toFile(outPath);
}

// ---------------------------------------------------------------------------
// Source frame path helpers
// ---------------------------------------------------------------------------

function framePaths(
  dir: string,
  prefix: string,
  count: number,
  {start = 0, pad = 0}: {start?: number; pad?: number} = {},
): string[] {
  return Array.from({length: count}, (_, i) => {
    const n = String(i + start);
    return path.join(dir, `${prefix}${n.padStart(pad, '0')}.png`);
  });
}

const TOMS_DIR = path.join(SOURCE_DIR, 'toms');
const TOMS_SQUARE_DIR = path.join(SOURCE_DIR, 'toms square');

/** Only the layers actually needed: the untinted accent overlay frames, and
 * the ghost gem/cage pair used for the curve fit + recomposite validation.
 * Base/sp source layers (body/head/shine) aren't needed — square and round
 * base/sp are shipped art this script never regenerates. */
const ROUND_SOURCES = {
  accent: framePaths(path.join(TOMS_DIR, 'Accents'), 'AcPc', FRAME_COUNT, {
    start: 1,
    pad: 2,
  }),
  ghostBody: path.join(SOURCE_DIR, 'ghost_tom.png'),
  ghostHead: path.join(SOURCE_DIR, 'ghost_tom_head.png'),
};

const SQUARE_SOURCES = {
  accent: framePaths(
    path.join(TOMS_SQUARE_DIR, 'SqTmAc'),
    'SqTmAc',
    FRAME_COUNT,
  ),
  ghostBody: path.join(TOMS_SQUARE_DIR, 'SQTMBody-Ghost.png'),
  ghostHead: path.join(TOMS_SQUARE_DIR, 'SQTMBaseghost.png'),
};

// ---------------------------------------------------------------------------
// Shipped-file helpers
// ---------------------------------------------------------------------------

function shippedPath(name: string): string {
  return path.join(OUTPUT_DIR, name);
}

async function extractFrames(
  filePath: string,
  count: number,
): Promise<Buffer[]> {
  const frames: Buffer[] = [];
  for (let i = 0; i < count; i++) {
    frames.push(
      await sharp(filePath, {page: i}).ensureAlpha().png().toBuffer(),
    );
  }
  return frames;
}

async function readRgba(
  source: string,
): Promise<{data: Buffer; width: number; height: number}> {
  const {data, info} = await sharp(source)
    .ensureAlpha()
    .raw()
    .toBuffer({resolveWithObject: true});
  return {data, width: info.width, height: info.height};
}

// ---------------------------------------------------------------------------
// Validation (compare regenerated frames against shipped ground truth)
// ---------------------------------------------------------------------------

interface VerifyResult {
  file: string;
  ok: boolean;
  message: string;
}

async function verifyAgainstShipped(
  frames: Buffer[],
  shipped: string | Buffer,
  {label, threshold}: {label: string; threshold: number},
): Promise<VerifyResult> {
  const file = label;
  let shippedMeta;
  try {
    shippedMeta = await sharp(shipped).metadata();
  } catch (error) {
    return {
      file,
      ok: false,
      message: `could not read shipped file: ${(error as Error).message}`,
    };
  }

  // Non-animated webps report `pages` as undefined — treat that as 1 page.
  const shippedPages = shippedMeta.pages ?? 1;
  if (shippedPages !== frames.length) {
    return {
      file,
      ok: false,
      message: `frame count mismatch: shipped=${shippedPages} regenerated=${frames.length}`,
    };
  }

  const first = await sharp(frames[0]).metadata();
  if (
    shippedMeta.width !== first.width ||
    shippedMeta.height !== first.height
  ) {
    return {
      file,
      ok: false,
      message: `dimension mismatch: shipped=${shippedMeta.width}x${shippedMeta.height} regenerated=${first.width}x${first.height}`,
    };
  }

  // Mean absolute per-channel pixel diff across all frames, as a perceptual
  // proxy (0 = identical, 255 = maximally different). Pixels where BOTH
  // sides are fully transparent are skipped: RGB values under alpha=0 are
  // visually meaningless and not guaranteed to be zeroed the same way by
  // every encoder.
  let totalDiff = 0;
  let totalSamples = 0;
  for (let i = 0; i < frames.length; i++) {
    const regenRaw = await sharp(frames[i])
      .ensureAlpha()
      .raw()
      .toBuffer({resolveWithObject: true});
    const shipRaw = await sharp(
      shipped,
      frames.length > 1 ? {page: i} : undefined,
    )
      .ensureAlpha()
      .raw()
      .toBuffer({resolveWithObject: true});

    const a = regenRaw.data;
    const b = shipRaw.data;
    const len = Math.min(a.length, b.length);
    for (let j = 0; j < len; j += 4) {
      const regenAlpha = a[j + 3];
      const shipAlpha = b[j + 3];
      if (regenAlpha <= 10 && shipAlpha <= 10) continue;
      totalDiff +=
        Math.abs(a[j] - b[j]) +
        Math.abs(a[j + 1] - b[j + 1]) +
        Math.abs(a[j + 2] - b[j + 2]) +
        Math.abs(regenAlpha - shipAlpha);
      totalSamples += 4;
    }
  }

  const meanDiff = totalDiff / totalSamples;
  const ok = meanDiff <= threshold;
  return {
    file,
    ok,
    message: `mean abs channel diff = ${meanDiff.toFixed(2)} (threshold ${threshold})${ok ? '' : ' — MISMATCH'}`,
  };
}

/**
 * Fits the ghost ring `ToneCurve` for one drum color from the aligned round
 * ghost source pair: samples pixels where the round gem (`ghost_tom.png`) is
 * opaque, the round cage (`ghost_tom_head.png`) is essentially transparent,
 * and the shipped round ghost art is opaque — i.e. pixels whose shipped
 * color is attributable to the gem tint alone.
 */
async function fitGhostRingCurve(color: DrumColor): Promise<ToneCurve> {
  const body = await readRgba(ROUND_SOURCES.ghostBody);
  const head = await readRgba(ROUND_SOURCES.ghostHead);
  const shipped = await readRgba(
    shippedPath(`drum-tom-round-${color}-ghost.webp`),
  );

  const samples: ToneSample[] = [];
  for (let px = 0; px < body.width * body.height; px++) {
    const i = px * 4;
    const bodyAlpha = body.data[i + 3];
    const headAlpha = head.data[i + 3];
    const shippedAlpha = shipped.data[i + 3];
    // The gem's own source alpha (`ghost_tom.png`) is loosened to >200: a
    // large ~400px region of the gem plate is genuinely semi-opaque in the
    // source PNG itself (not a thin antialiased edge), and a strict >250 cut
    // excluded it entirely from the fit — forcing the curve to extrapolate
    // that whole region instead of using real data (verified: this, not
    // shipped-WebP alpha quantization, was the dominant cause of the
    // round-ghost recompose gate failing for red/green). The shipped-ghost
    // threshold is likewise relaxed to >=200 for the same lossy-WebP reason
    // as before. Since semi-opaque source samples now enter the fit, require
    // the shipped pixel's alpha to track the source body alpha within ~25 —
    // this keeps samples to pixels where the shipped art is rendering that
    // same semi-opaque gem material alone, not some other composite result
    // at a similar-but-unrelated opacity.
    if (
      bodyAlpha > 200 &&
      headAlpha < 5 &&
      shippedAlpha >= 200 &&
      Math.abs(shippedAlpha - bodyAlpha) <= 25
    ) {
      samples.push({
        gray: body.data[i],
        r: shipped.data[i],
        g: shipped.data[i + 1],
        b: shipped.data[i + 2],
      });
    }
  }

  return buildToneCurve(samples, {minSamples: 5, smoothRadius: 3});
}

// ---------------------------------------------------------------------------
// Bake driver
// ---------------------------------------------------------------------------

async function bakeSquareAccent(color: DrumColor): Promise<void> {
  const baseFrames = await extractFrames(
    shippedPath(`drum-tom-${color}.webp`),
    FRAME_COUNT,
  );
  const frames = await compositeFrames(
    [{source: baseFrames}, {source: SQUARE_SOURCES.accent}],
    FRAME_COUNT,
  );
  const outPath = shippedPath(outputFileName(color, 'accent'));
  await framesToAnimatedWebp(frames, FRAME_DELAY_MS, outPath);
  console.log(`[bake] wrote ${outputFileName(color, 'accent')}`);
}

async function bakeSquareGhost(
  color: DrumColor,
  curve: ToneCurve,
): Promise<void> {
  const gemPng = await sharp(SQUARE_SOURCES.ghostBody)
    .ensureAlpha()
    .png()
    .toBuffer();
  const tintedGem = await tintGrayscale(gemPng, curve);
  const [frame] = await compositeFrames(
    [{source: tintedGem}, {source: SQUARE_SOURCES.ghostHead}],
    1,
  );
  const outPath = shippedPath(outputFileName(color, 'ghost'));
  await frameToStaticWebp(frame, outPath);
  console.log(`[bake] wrote ${outputFileName(color, 'ghost')}`);
}

async function runValidationGates(color: DrumColor): Promise<{
  accentGate: VerifyResult;
  ghostGate: VerifyResult;
  curve: ToneCurve;
}> {
  // Round-accent recomposite check.
  const roundBaseFrames = await extractFrames(
    shippedPath(`drum-tom-round-${color}.webp`),
    FRAME_COUNT,
  );
  const roundAccentRegen = await compositeFrames(
    [{source: roundBaseFrames}, {source: ROUND_SOURCES.accent}],
    FRAME_COUNT,
  );
  const accentGate = await verifyAgainstShipped(
    roundAccentRegen,
    shippedPath(`drum-tom-round-${color}-accent.webp`),
    {label: `round-accent-recompose ${color}`, threshold: 4},
  );
  console.log(
    `[gate] ${accentGate.ok ? 'OK  ' : 'FAIL'} ${accentGate.file}: ${accentGate.message}`,
  );

  // Round-ghost recomposite check: fit the ghost curve, then apply it back
  // to its own fitting sources (round) and compare against shipped round
  // ghost — proves the curve-fit + compositing model before trusting it for
  // the square ghost.
  const curve = await fitGhostRingCurve(color);
  const roundGemPng = await sharp(ROUND_SOURCES.ghostBody)
    .ensureAlpha()
    .png()
    .toBuffer();
  const tintedRoundGem = await tintGrayscale(roundGemPng, curve);
  const roundGhostRegen = await compositeFrames(
    [{source: tintedRoundGem}, {source: ROUND_SOURCES.ghostHead}],
    1,
  );
  const ghostGate = await verifyAgainstShipped(
    roundGhostRegen,
    shippedPath(`drum-tom-round-${color}-ghost.webp`),
    {label: `round-ghost-recompose ${color}`, threshold: 18},
  );
  console.log(
    `[gate] ${ghostGate.ok ? 'OK  ' : 'FAIL'} ${ghostGate.file}: ${ghostGate.message}`,
  );

  return {accentGate, ghostGate, curve};
}

async function assertSpByteEquality(color: DrumColor): Promise<boolean> {
  let ok = true;
  for (const variant of ['accent-sp', 'ghost-sp'] as const) {
    const squareFile = `drum-tom-${color}-${variant}.webp`;
    const roundFile = `drum-tom-round-${color}-${variant}.webp`;
    const [a, b] = await Promise.all([
      fs.readFile(shippedPath(squareFile)),
      fs.readFile(shippedPath(roundFile)),
    ]);
    const same = Buffer.compare(new Uint8Array(a), new Uint8Array(b)) === 0;
    console.log(
      `[assert] ${same ? 'OK  ' : 'FAIL'} ${squareFile} === ${roundFile} (byte-identical, style-neutral SP art)`,
    );
    if (!same) ok = false;
  }
  return ok;
}

async function main() {
  const verifyOnly = process.argv.includes('--verify');
  const force = process.argv.includes('--force');

  let anyGateFailed = false;
  let anySpMismatch = false;

  for (const color of DRUM_COLORS) {
    const {accentGate, ghostGate, curve} = await runValidationGates(color);
    const gatesOk = accentGate.ok && ghostGate.ok;
    if (!gatesOk) anyGateFailed = true;

    if (!verifyOnly) {
      if (gatesOk || force) {
        await bakeSquareAccent(color);
        await bakeSquareGhost(color, curve);
      } else {
        console.warn(
          `[bake] SKIPPED ${color} accent/ghost — validation gate failed; re-run with --force to overwrite anyway.`,
        );
      }
    }

    const spOk = await assertSpByteEquality(color);
    if (!spOk) anySpMismatch = true;
  }

  if (anyGateFailed) {
    console.warn(
      '\n[gate] one or more validation gates failed — see FAIL lines above.',
    );
  } else {
    console.log('\n[gate] all validation gates passed.');
  }

  if (anySpMismatch) {
    console.error(
      '\n[assert] SP art is no longer byte-identical between square and round — investigate before shipping.',
    );
    process.exitCode = 1;
  }

  if (verifyOnly) {
    console.log('\n--verify: no files were written.');
  }
}

// Guard so importing this module's pure helpers from Jest doesn't trigger a
// real bake — only run when invoked directly (`pnpm tsx scripts/bake-drum-styles.ts`).
const isMainModule = process.argv[1]?.endsWith('bake-drum-styles.ts');
if (isMainModule) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
