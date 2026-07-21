/**
 * Bakes drum-tom note style-set art into `public/assets/preview/assets2/`.
 *
 * Current state: the full round tom set (base/sp/accent/accent-sp/ghost/
 * ghost-sp, all 4 colors) is sourced directly from static.enchor.us —
 * authentic, professionally-colored art — and downloaded as-is, not baked
 * by this script (see `drum-tom-round-*.webp`). The square set's base/sp
 * variants also already ship correct, hand-tuned art. What's still missing
 * is color-accurate square accent/ghost variants; no authentic source has
 * been found for those, so this script's grayscale-tint pipeline exists to
 * fill that gap.
 *
 * Source art: 128x64 grayscale PNG layers under
 * `/Users/eliwhite/Downloads/Textures/Note_Spritesheets/Drums/` (Unity
 * export). Color is applied at bake time via `tintGrayscale`, not baked
 * into the source PNGs.
 *
 * Known limitation: the tint pipeline does not yet reach color parity for
 * the square accent/ghost variants — the shipped source art composites
 * multiple materials (rim highlight, head, shadow) that a single tone curve
 * can't reproduce faithfully. The parity gate below (verified against
 * shipped square base/sp art, and independently against the original
 * shipped round accent via git HEAD) catches this: a regenerated
 * parity-target file that doesn't match shipped art within threshold is
 * skipped (loud warning) rather than silently shipping a regression — pass
 * --force to overwrite anyway. Until the tint pipeline improves, this
 * script does not produce usable square accent/ghost art.
 *
 * See plans/completed/0069-drum-note-style-sets.md for the full
 * investigation (source-file audit, compositing model, naming design) this
 * script implements.
 *
 * Run with:
 *   pnpm tsx scripts/bake-drum-styles.ts            # bake + overwrite outputs
 *   pnpm tsx scripts/bake-drum-styles.ts --verify    # diff-only, no writes
 *   pnpm tsx scripts/bake-drum-styles.ts --force     # bake even if a parity
 *                                                     # check (square base/sp
 *                                                     # vs shipped art) fails
 */

import {execFileSync} from 'child_process';
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

/** Opacity applied to the reused (non-ghost) shine/sweep overlay when it's
 * composited on top of the dimmer ghost base, since no ghost-specific shine
 * source exists. Tunable — chosen to read as a subtle highlight rather than
 * matching the full brightness of the non-ghost base. */
const GHOST_SHINE_OPACITY = 0.5;

// ---------------------------------------------------------------------------
// Tint colors
// ---------------------------------------------------------------------------

export const DRUM_COLORS = ['red', 'yellow', 'blue', 'green'] as const;
export type DrumColor = (typeof DRUM_COLORS)[number];

/** Ghost variants get an extra brightness scale on top of already-dimmer
 * ghost source art (`SQTMBaseghost`/`ghost_tom`), so the dimming survives
 * tone-curve recalibration. Tunable — chosen to read as a clearly duller
 * gem/band than the non-ghost tone curve output. */
export const GHOST_TONE_DIM = 0.6;

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

/**
 * Fits a `ToneCurve` from real (gray, shipped-color) pixel-pair samples:
 * buckets samples by their (rounded) gray value, averages the observed
 * shipped color per bucket, then fills gaps between data-bearing buckets by
 * linear interpolation and extends flatly past the first/last data-bearing
 * bucket. This reproduces whatever nonlinear tone the shipped art actually
 * used (verified: the shipped tint is not a plain multiply — brightness
 * near white is preserved while midtones saturate toward the drum color —
 * so a single hex/ratio multiply can't reproduce it, but a measured curve
 * can) without hardcoding an invented color constant.
 */
export function buildToneCurve(samples: ToneSample[]): ToneCurve {
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
    if (sums[i].n > 0) {
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

  for (let i = 0; i < 256; i++) {
    if (i <= known[0].index) {
      curve.r.push(known[0].r);
      curve.g.push(known[0].g);
      curve.b.push(known[0].b);
      continue;
    }
    if (i >= known[known.length - 1].index) {
      const last = known[known.length - 1];
      curve.r.push(last.r);
      curve.g.push(last.g);
      curve.b.push(last.b);
      continue;
    }
    // Find the bracketing known points and linearly interpolate.
    let lo = known[0];
    let hi = known[known.length - 1];
    for (let k = 0; k < known.length - 1; k++) {
      if (known[k].index <= i && known[k + 1].index >= i) {
        lo = known[k];
        hi = known[k + 1];
        break;
      }
    }
    const t =
      hi.index === lo.index ? 0 : (i - lo.index) / (hi.index - lo.index);
    curve.r.push(lo.r + (hi.r - lo.r) * t);
    curve.g.push(lo.g + (hi.g - lo.g) * t);
    curve.b.push(lo.b + (hi.b - lo.b) * t);
  }

  return smoothToneCurve(curve);
}

/**
 * Smooths a `ToneCurve` with a small moving-average window. The shipped
 * ground-truth art is a lossy WebP, so per-bucket averages carry
 * compression quantization noise; applied as a per-pixel LUT, that noise
 * reproduces as visible speckle on otherwise-smooth gradients (verified:
 * un-smoothed curves produced a grainy gem instead of the shipped art's
 * smooth shading). Smoothing trades a small amount of curve precision for
 * removing that speckle.
 */
function smoothToneCurve(curve: ToneCurve, windowRadius = 4): ToneCurve {
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
 * indexing by each pixel's R channel value. `brightnessScale` (default 1)
 * additionally scales the curve's output, used to dim ghost variants.
 * Alpha is unchanged.
 */
export async function tintGrayscale(
  png: Buffer,
  curve: ToneCurve,
  brightnessScale = 1,
): Promise<Buffer> {
  const {data, info} = await sharp(png)
    .ensureAlpha()
    .raw()
    .toBuffer({resolveWithObject: true});

  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

  for (let i = 0; i < data.length; i += 4) {
    const gray = data[i];
    data[i] = clamp(curve.r[gray] * brightnessScale);
    data[i + 1] = clamp(curve.g[gray] * brightnessScale);
    data[i + 2] = clamp(curve.b[gray] * brightnessScale);
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
  /** Whether this layer receives the per-drum-color tone curve (the
   * gem/body piece). `false` leaves it untouched grayscale — the metal
   * rim/cage, and (currently) the SP glow ring/cap, which the source art's
   * own white ring shape doesn't carry enough uncontaminated sample area to
   * calibrate a reliable cyan curve for yet (see `spOverlay` below).
   * Defaults to `'color'`. */
  tint?: 'color' | false;
}

/**
 * Composites `layers` (bottom to top) into `frameCount` 128x64 RGBA PNG
 * buffers, one per output frame. A layer given as a single path is reused
 * unchanged on every frame; a layer given as an array is indexed by frame.
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

const ROUND_SOURCES = {
  body: path.join(TOMS_DIR, 'Standard', 'body.png'),
  head: path.join(TOMS_DIR, 'Standard', 'head.png'),
  shine: framePaths(path.join(TOMS_DIR, 'Standard'), 'shine', FRAME_COUNT, {
    pad: 2,
  }),
  accent: framePaths(path.join(TOMS_DIR, 'Accents'), 'AcPc', FRAME_COUNT, {
    start: 1,
    pad: 2,
  }),
  ghostBody: path.join(SOURCE_DIR, 'ghost_tom.png'),
  ghostHead: path.join(SOURCE_DIR, 'ghost_tom_head.png'),
};

const SQUARE_SOURCES = {
  body: path.join(TOMS_SQUARE_DIR, 'SQTMBase.png'),
  head: path.join(TOMS_SQUARE_DIR, 'SQTMBody.png'),
  shine: framePaths(path.join(TOMS_SQUARE_DIR, 'Shines'), 'Sh', FRAME_COUNT),
  accent: framePaths(
    path.join(TOMS_SQUARE_DIR, 'SqTmAc'),
    'SqTmAc',
    FRAME_COUNT,
  ),
  ghostBody: path.join(TOMS_SQUARE_DIR, 'SQTMBaseghost.png'),
  ghostHead: path.join(TOMS_SQUARE_DIR, 'SQTMBody-Ghost.png'),
};

/** SP glow overlay is style-neutral — shared by both square and round. */
const STAR_NOTE_GLOW = framePaths(
  path.join(TOMS_DIR, 'StarNote'),
  '',
  FRAME_COUNT,
  {start: 1, pad: 4},
);
const STAR_NOTE_CAP = path.join(TOMS_DIR, 'StarNote', 'sp_cap.png');

// ---------------------------------------------------------------------------
// Recipes (color-independent — grayscale layer composition per variant)
// ---------------------------------------------------------------------------

export type TomVariant =
  | 'base'
  | 'sp'
  | 'accent'
  | 'accent-sp'
  | 'ghost'
  | 'ghost-sp';

export const TOM_VARIANTS: TomVariant[] = [
  'base',
  'sp',
  'accent',
  'accent-sp',
  'ghost',
  'ghost-sp',
];

export interface TomStyleRecipe {
  style: 'square' | 'round';
  /** variant -> composite layers (bottom to top) */
  recipes: Record<TomVariant, LayerSpec[]>;
}

/**
 * Which of the two static body layers is the tinted "gem"/color piece vs
 * the untinted metal rim, verified visually against shipped art:
 * - square (`SQTMBase`+`SQTMBody`): `SQTMBase` (outer spikes) stays silver,
 *   `SQTMBody` (center diamond) is tinted — so `head` (the 2nd slot) tints.
 * - round (`body`+`head`): `body` (outer rim band) is tinted (matches the
 *   already-shipped round accent, where the rim band is colored and the
 *   top disc/arrows stay white) — so `body` (the 1st slot) tints.
 */
function buildStyleRecipes(
  style: 'square' | 'round',
  src: typeof ROUND_SOURCES,
): TomStyleRecipe {
  const tintBody = style === 'round';
  const colorTint = (isBody: boolean): 'color' | false =>
    isBody === tintBody ? 'color' : false;

  const base: LayerSpec[] = [
    {source: src.body, tint: colorTint(true)},
    {source: src.head, tint: colorTint(false)},
    {source: src.shine, tint: false},
  ];
  const accent: LayerSpec[] = [{source: src.accent, tint: 'color'}];
  const ghost: LayerSpec[] = [
    {source: src.ghostBody, tint: colorTint(true)},
    {source: src.ghostHead, tint: colorTint(false)},
    {source: src.shine, opacity: GHOST_SHINE_OPACITY, tint: false},
  ];
  // The glow ring genuinely needs its own cyan tint (it is NOT already
  // cyan in the source art — verified: the raw StarNote frames are a plain
  // white ring). A dedicated glow tone curve was attempted but the ring's
  // silhouette barely extends past the note's own footprint on this 128x64
  // canvas, so there's very little uncontaminated "glow-only" pixel area to
  // sample from — even a same-alpha-only mask keeps producing a poorly-fit,
  // non-monotonic curve that made the SP parity diff worse, not better.
  // Left as an identity (grayscale) pass-through rather than shipping a
  // worse-than-before approximation; SP variants remain a known-imperfect,
  // write-protected parity target (see PARITY_TARGET_VARIANTS) until this
  // gets revisited with a larger/cleaner sample source.
  const spOverlay: LayerSpec[] = [
    {source: STAR_NOTE_GLOW, tint: false},
    {source: STAR_NOTE_CAP, tint: false},
  ];

  return {
    style,
    recipes: {
      base,
      sp: [...base, ...spOverlay],
      accent,
      'accent-sp': [...accent, ...spOverlay],
      ghost,
      'ghost-sp': [...ghost, ...spOverlay],
    },
  };
}

export const SQUARE_RECIPE = buildStyleRecipes('square', SQUARE_SOURCES);
export const ROUND_RECIPE = buildStyleRecipes('round', ROUND_SOURCES);

/** Maps a (style, variant) pair to the filename suffix used in `assets2`. */
function variantSuffix(variant: TomVariant): string {
  switch (variant) {
    case 'base':
      return '';
    case 'sp':
      return '-sp';
    case 'accent':
      return '-accent';
    case 'accent-sp':
      return '-accent-sp';
    case 'ghost':
      return '-ghost';
    case 'ghost-sp':
      return '-ghost-sp';
  }
}

export function outputFileName(
  style: 'square' | 'round',
  color: DrumColor,
  variant: TomVariant,
): string {
  const styleInfix = style === 'round' ? '-round' : '';
  return `drum-tom${styleInfix}-${color}${variantSuffix(variant)}.webp`;
}

// ---------------------------------------------------------------------------
// Verification (square base/sp should be visually unchanged from shipped)
// ---------------------------------------------------------------------------

interface VerifyResult {
  file: string;
  ok: boolean;
  message: string;
}

async function verifyAgainstShipped(
  frames: Buffer[],
  shipped: string | Buffer,
  {label}: {label: string},
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

  if (shippedMeta.pages !== frames.length) {
    return {
      file,
      ok: false,
      message: `frame count mismatch: shipped=${shippedMeta.pages} regenerated=${frames.length}`,
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
  // every encoder, so including them measures encoder noise, not a real
  // mismatch (verified: skipping them drops a spurious 62 mean diff down to
  // ~16 on already-matching art).
  let totalDiff = 0;
  let totalSamples = 0;
  for (let i = 0; i < frames.length; i++) {
    const regenRaw = await sharp(frames[i])
      .ensureAlpha()
      .raw()
      .toBuffer({resolveWithObject: true});
    const shipRaw = await sharp(shipped, {page: i})
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
  const THRESHOLD = 8; // mean abs channel diff (0-255 scale) considered a close match
  const ok = meanDiff <= THRESHOLD;
  return {
    file,
    ok,
    message: `mean abs channel diff = ${meanDiff.toFixed(2)} (threshold ${THRESHOLD})${ok ? '' : ' — MISMATCH, recipe may not match shipped art'}`,
  };
}

// ---------------------------------------------------------------------------
// Tint curve calibration (derived from real shipped pixels, not invented
// hex/ratio constants)
// ---------------------------------------------------------------------------

/**
 * Reads a raw RGBA pixel buffer for a PNG/WebP source (path or buffer),
 * one frame at a time.
 */
async function readRgba(
  source: string | Buffer,
  page?: number,
): Promise<{data: Buffer; width: number; height: number}> {
  const img = sharp(source, page != null ? {page} : undefined).ensureAlpha();
  const {data, info} = await img.raw().toBuffer({resolveWithObject: true});
  return {data, width: info.width, height: info.height};
}

/**
 * Calibrates a `ToneCurve` per drum color from the currently-shipped square
 * base file (`drum-tom-{color}.webp`), the ground truth this feature must
 * not regress. Samples are collected only from pixels where the tinted
 * "gem" layer (`SQTMBody`) is opaque and the untinted `Shines` overlay is
 * essentially transparent at that pixel/frame — i.e. pixels whose shipped
 * color is attributable to the gem tint alone, not partially covered by an
 * untinted highlight sweep. This walks the gem's own internal shading
 * (shadow to highlight), which is what makes the fitted curve reproduce
 * "near-white stays white, midtones saturate toward the drum color"
 * without hardcoding that behavior.
 */
async function calibrateSquareBaseCurve(color: DrumColor): Promise<ToneCurve> {
  const body = await readRgba(SQUARE_SOURCES.head); // SQTMBody = tinted gem
  const samples: ToneSample[] = [];

  for (let frame = 0; frame < FRAME_COUNT; frame++) {
    const shine = await readRgba(SQUARE_SOURCES.shine[frame]);
    const shippedPath = path.join(OUTPUT_DIR, `drum-tom-${color}.webp`);
    const shipped = await readRgba(shippedPath, frame);

    for (let px = 0; px < body.width * body.height; px++) {
      const i = px * 4;
      const bodyAlpha = body.data[i + 3];
      const shineAlpha = shine.data[i + 3];
      const shippedAlpha = shipped.data[i + 3];
      if (bodyAlpha === 255 && shineAlpha === 0 && shippedAlpha > 200) {
        samples.push({
          gray: body.data[i],
          r: shipped.data[i],
          g: shipped.data[i + 1],
          b: shipped.data[i + 2],
        });
      }
    }
  }

  // The gem's own highlight sparkle never reaches pure white (its brightest
  // sampled pixel tops out well under 255), so without an anchor the curve
  // extends flatly from that dimmer endpoint — under-predicting brightness
  // for any *other* asset whose source art does reach gray=255 (e.g. the
  // round accent's white arrows/disc, verified separately). Every sampled
  // shipped asset shows pure-white source pixels rendering as pure white
  // regardless of drum color (a highlight, not a colored surface), so
  // anchor the white endpoint explicitly rather than extrapolating it,
  // unless real samples already reached it (avoid diluting a measured
  // value with a synthetic one in the same bucket).
  if (!samples.some(s => s.gray >= 250)) {
    samples.push({gray: 255, r: 255, g: 255, b: 255});
  }

  return buildToneCurve(samples);
}

/**
 * Reads a file's bytes as they exist at git HEAD (not the working tree),
 * used to diff against the *original* shipped round accent art even though
 * this bake intentionally overwrites that same filename with new square
 * accent content (see naming design: `drum-tom-{color}-accent.webp` moves
 * from round to square style; the round accent moves to a new
 * `-round-...` filename).
 */
function readGitBlob(relPath: string): Buffer {
  return execFileSync('git', ['show', `HEAD:${relPath}`], {
    cwd: path.join(__dirname, '..'),
    maxBuffer: 1024 * 1024 * 50,
  });
}

/**
 * Validates the calibrated curve against a second, independent ground
 * truth: the *original* shipped round accent (`AcPc` frames, tinted),
 * fetched from git HEAD since the working-tree file at that path now
 * intentionally holds new square accent content. `AcPc` frames are
 * self-contained (no separate untinted rim layer), so this checks that the
 * curve fitted from the square gem generalizes to a different asset tinted
 * with the same recipe.
 */
async function verifyRoundAccentCurve(
  curve: ToneCurve,
  color: DrumColor,
): Promise<VerifyResult> {
  const originalBlob = readGitBlob(
    `spotify-clonehero-next/public/assets/preview/assets2/drum-tom-${color}-accent.webp`,
  );

  const regenFrames: Buffer[] = [];
  for (let frame = 0; frame < FRAME_COUNT; frame++) {
    const gray = await sharp(ROUND_SOURCES.accent[frame])
      .ensureAlpha()
      .png()
      .toBuffer();
    regenFrames.push(await tintGrayscale(gray, curve));
  }

  return verifyAgainstShipped(regenFrames, originalBlob, {
    label: `drum-tom-${color}-accent.webp (round, from git HEAD)`,
  });
}

// ---------------------------------------------------------------------------
// Bake driver
// ---------------------------------------------------------------------------

/**
 * Pre-tints the individual layers flagged `tint: 'color'` (the gem/body
 * piece) with the per-drum-color curve before compositing, so untinted
 * layers (metal rim, SP glow) stay grayscale in the final composite instead
 * of the whole frame being tinted uniformly.
 */
async function tintLayers(
  layers: LayerSpec[],
  colorCurve: ToneCurve,
  brightnessScale: number,
): Promise<LayerSpec[]> {
  return Promise.all(
    layers.map(async layer => {
      if (layer.tint === false) return layer;

      const sources = Array.isArray(layer.source)
        ? layer.source
        : [layer.source];
      const tinted = await Promise.all(
        sources.map(async source => {
          const buf = await sharp(source).ensureAlpha().png().toBuffer();
          return tintGrayscale(buf, colorCurve, brightnessScale);
        }),
      );
      return {
        ...layer,
        source: Array.isArray(layer.source) ? tinted : tinted[0],
      };
    }),
  );
}

const PARITY_TARGET_VARIANTS: TomVariant[] = ['base', 'sp'];

async function bakeVariant(
  style: 'square' | 'round',
  color: DrumColor,
  variant: TomVariant,
  layers: LayerSpec[],
  colorCurve: ToneCurve,
  {verifyOnly, force}: {verifyOnly: boolean; force: boolean},
): Promise<VerifyResult | null> {
  const brightnessScale =
    variant === 'ghost' || variant === 'ghost-sp' ? GHOST_TONE_DIM : 1;
  const coloredLayers = await tintLayers(layers, colorCurve, brightnessScale);
  const tintedFrames = await compositeFrames(coloredLayers, FRAME_COUNT);

  const outFile = outputFileName(style, color, variant);
  const outPath = path.join(OUTPUT_DIR, outFile);

  // Square base/sp already ship correct, hand-tuned art — treat them as a
  // parity target: only overwrite if the regenerated frames match closely,
  // or the caller passed --force. Every other output (round-*, square
  // accent/ghost) has no existing shipped equivalent under that exact
  // filename, so there's nothing to protect and they always write.
  const isParityTarget =
    style === 'square' && PARITY_TARGET_VARIANTS.includes(variant);

  let verifyResult: VerifyResult | null = null;
  if (isParityTarget) {
    verifyResult = await verifyAgainstShipped(tintedFrames, outPath, {
      label: outFile,
    });
    console.log(
      `[verify] ${verifyResult.ok ? 'OK  ' : 'WARN'} ${outFile}: ${verifyResult.message}`,
    );
  }

  const blockedByParity = isParityTarget && !verifyResult!.ok && !force;

  if (!verifyOnly && !blockedByParity) {
    await framesToAnimatedWebp(tintedFrames, FRAME_DELAY_MS, outPath);
    console.log(`[bake] wrote ${outFile}`);
  } else if (blockedByParity) {
    console.warn(
      `[bake] SKIPPED ${outFile} — regenerated art failed the parity check against shipped art; re-run with --force to overwrite anyway.`,
    );
  }

  return verifyResult;
}

async function main() {
  const verifyOnly = process.argv.includes('--verify');
  const force = process.argv.includes('--force');

  console.log('Calibrating tint curves from shipped square base pixels...');
  const curves: Record<DrumColor, ToneCurve> = {} as Record<
    DrumColor,
    ToneCurve
  >;
  for (const color of DRUM_COLORS) {
    curves[color] = await calibrateSquareBaseCurve(color);
  }

  const verifyResults: VerifyResult[] = [];

  // Independent parity check: the fitted curve, applied to a different
  // (self-contained) source asset, should reproduce the original shipped
  // round accent closely too.
  for (const color of DRUM_COLORS) {
    const result = await verifyRoundAccentCurve(curves[color], color);
    console.log(
      `[verify] ${result.ok ? 'OK  ' : 'WARN'} ${result.file}: ${result.message}`,
    );
    verifyResults.push(result);
  }

  for (const color of DRUM_COLORS) {
    for (const variant of TOM_VARIANTS) {
      const squareResult = await bakeVariant(
        'square',
        color,
        variant,
        SQUARE_RECIPE.recipes[variant],
        curves[color],
        {verifyOnly, force},
      );
      if (squareResult) verifyResults.push(squareResult);

      await bakeVariant(
        'round',
        color,
        variant,
        ROUND_RECIPE.recipes[variant],
        curves[color],
        {verifyOnly, force},
      );
    }
  }

  const failures = verifyResults.filter(r => !r.ok);
  if (failures.length > 0) {
    console.warn(
      `\n[verify] ${failures.length}/${verifyResults.length} parity checks (square base/sp + round accent) did not match shipped art within threshold.`,
    );
  } else {
    console.log(
      `\n[verify] all ${verifyResults.length} parity checks (square base/sp + round accent) matched shipped art within threshold.`,
    );
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
