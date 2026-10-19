import {promises as fs} from 'fs';
import * as os from 'os';
import * as path from 'path';

import sharp from 'sharp';

import {
  tintGrayscale,
  buildToneCurve,
  compositeFrames,
  outputFileName,
  TOM_VARIANTS,
  DRUM_COLORS,
  type ToneCurve,
} from '../bake-drum-styles';

/** A trivial identity curve (output === input) for tests that don't care
 * about the specific tint, only that the curve is applied correctly. */
function identityCurve(): ToneCurve {
  const identity = Array.from({length: 256}, (_, i) => i);
  return {r: identity, g: identity, b: identity};
}

/** Builds a tiny 2x2 RGBA PNG buffer with a uniform color. */
async function makeSolidPng(
  r: number,
  g: number,
  b: number,
  a: number,
): Promise<Buffer> {
  return sharp({
    create: {width: 2, height: 2, channels: 4, background: {r, g, b, alpha: a}},
  })
    .png()
    .toBuffer();
}

describe('buildToneCurve', () => {
  it('averages multiple samples that land in the same gray bucket', () => {
    const curve = buildToneCurve(
      [
        {gray: 100, r: 200, g: 10, b: 10},
        {gray: 100, r: 210, g: 20, b: 20},
      ],
      {smoothRadius: 0},
    );
    expect(curve.r[100]).toBeCloseTo(205);
    expect(curve.g[100]).toBeCloseTo(15);
    expect(curve.b[100]).toBeCloseTo(15);
  });

  it('linearly interpolates between two data-bearing buckets', () => {
    const curve = buildToneCurve(
      [
        {gray: 0, r: 0, g: 0, b: 0},
        {gray: 100, r: 200, g: 100, b: 50},
      ],
      {smoothRadius: 0},
    );
    // Halfway between gray=0 and gray=100 should read halfway between the
    // two known outputs.
    expect(curve.r[50]).toBeCloseTo(100);
    expect(curve.g[50]).toBeCloseTo(50);
    expect(curve.b[50]).toBeCloseTo(25);
  });

  it('extends past the first known sample toward black (gray=0)', () => {
    // smoothRadius: 0 isolates the curve *shape* from the moving-average
    // smoothing pass, which softens exact anchor values near the edges.
    const curve = buildToneCurve(
      [
        {gray: 50, r: 90, g: 40, b: 40},
        {gray: 200, r: 250, g: 40, b: 40},
      ],
      {smoothRadius: 0},
    );
    // At gray=0 (the anchor itself), the curve should read pure black.
    expect(curve.r[0]).toBeCloseTo(0);
    expect(curve.g[0]).toBeCloseTo(0);
    // Partway between the black anchor and the first known sample should be
    // strictly between 0 and the known sample's value, not held flat at it.
    expect(curve.r[25]).toBeGreaterThan(0);
    expect(curve.r[25]).toBeLessThan(90);
  });

  it('extends past the last known sample toward near-white (gray=255)', () => {
    const curve = buildToneCurve(
      [
        {gray: 50, r: 90, g: 40, b: 40},
        {gray: 200, r: 250, g: 40, b: 40},
      ],
      {smoothRadius: 0},
    );
    // At gray=255 (the anchor itself), the curve should read pure white.
    expect(curve.r[255]).toBeCloseTo(255);
    expect(curve.g[255]).toBeCloseTo(255);
    // Partway between the last known sample and the white anchor should be
    // strictly between the known sample's value and 255, not held flat.
    expect(curve.r[230]).toBeGreaterThan(250);
    expect(curve.r[230]).toBeLessThan(255);
  });

  it('falls back to an identity curve when given no samples', () => {
    const curve = buildToneCurve([]);
    expect(curve.r[42]).toBe(42);
    expect(curve.g[200]).toBe(200);
    expect(curve.b[0]).toBe(0);
  });

  it('drops gray-value buckets with fewer than minSamples samples', () => {
    // A single stray sample at gray=100 should be ignored when minSamples=2,
    // leaving only the gray=0 and gray=200 buckets (each with 2 samples) as
    // real data.
    const curve = buildToneCurve(
      [
        {gray: 0, r: 0, g: 0, b: 0},
        {gray: 0, r: 0, g: 0, b: 0},
        {gray: 100, r: 255, g: 0, b: 0}, // stray outlier, only 1 sample
        {gray: 200, r: 200, g: 200, b: 200},
        {gray: 200, r: 200, g: 200, b: 200},
      ],
      {minSamples: 2},
    );
    // Gray=100 sits between the two surviving buckets (0 and 200), so it
    // should be interpolated between them, not equal to the dropped
    // outlier's r=255.
    expect(curve.r[100]).not.toBeCloseTo(255);
    expect(curve.r[100]).toBeGreaterThan(0);
    expect(curve.r[100]).toBeLessThan(200);
  });
});

describe('tintGrayscale', () => {
  it('applies the tone curve per channel, preserving alpha', async () => {
    const gray = await makeSolidPng(100, 100, 100, 255);
    const curve = buildToneCurve([{gray: 100, r: 220, g: 60, b: 60}], {
      smoothRadius: 0,
    });
    const tinted = await tintGrayscale(gray, curve);

    const {data} = await sharp(tinted)
      .ensureAlpha()
      .raw()
      .toBuffer({resolveWithObject: true});

    expect(data[0]).toBe(220);
    expect(data[1]).toBe(60);
    expect(data[2]).toBe(60);
    expect(data[3]).toBe(255); // alpha untouched
  });

  it('an identity curve leaves the image unchanged', async () => {
    const gray = await makeSolidPng(123, 123, 123, 255);
    const tinted = await tintGrayscale(gray, identityCurve());

    const {data} = await sharp(tinted)
      .ensureAlpha()
      .raw()
      .toBuffer({resolveWithObject: true});

    expect(data[0]).toBe(123);
    expect(data[1]).toBe(123);
    expect(data[2]).toBe(123);
    expect(data[3]).toBe(255);
  });
});

describe('compositeFrames', () => {
  const tmpDir = path.join(os.tmpdir(), 'bake-drum-styles-test');

  beforeAll(async () => {
    await fs.mkdir(tmpDir, {recursive: true});
  });

  afterAll(async () => {
    await fs.rm(tmpDir, {recursive: true, force: true});
  });

  async function writeFixture(
    name: string,
    r: number,
    g: number,
    b: number,
    a: number,
  ) {
    const buf = await makeSolidPng(r, g, b, a);
    const filePath = path.join(tmpDir, name);
    await fs.writeFile(filePath, new Uint8Array(buf));
    return filePath;
  }

  it('reuses a single-path layer across every frame', async () => {
    const staticLayer = await writeFixture('static.png', 100, 0, 0, 255);
    const frames = await compositeFrames([{source: staticLayer}], 3, {
      width: 2,
      height: 2,
    });

    expect(frames).toHaveLength(3);
    for (const frame of frames) {
      const {data} = await sharp(frame)
        .ensureAlpha()
        .raw()
        .toBuffer({resolveWithObject: true});
      expect(data[0]).toBe(100);
      expect(data[3]).toBe(255);
    }
  });

  it('indexes an array-path layer by frame number', async () => {
    const frame0 = await writeFixture('anim0.png', 10, 0, 0, 255);
    const frame1 = await writeFixture('anim1.png', 20, 0, 0, 255);
    const frames = await compositeFrames([{source: [frame0, frame1]}], 2, {
      width: 2,
      height: 2,
    });

    const raw0 = await sharp(frames[0])
      .ensureAlpha()
      .raw()
      .toBuffer({resolveWithObject: true});
    const raw1 = await sharp(frames[1])
      .ensureAlpha()
      .raw()
      .toBuffer({resolveWithObject: true});
    expect(raw0.data[0]).toBe(10);
    expect(raw1.data[0]).toBe(20);
  });

  it('composites layers bottom to top (plain over), and applies per-layer opacity', async () => {
    const bottom = await writeFixture('bottom.png', 50, 50, 50, 255);
    // Fully-opaque top layer at reduced composite opacity should blend with
    // the bottom layer rather than fully occluding it — this is the "gem
    // under cage" ordering used for ghost art: an opaque untinted cage on
    // top should read as itself, but a partially transparent one should
    // blend through to the tinted gem underneath.
    const top = await writeFixture('top.png', 200, 200, 200, 255);

    const opaqueFrames = await compositeFrames(
      [{source: bottom}, {source: top}],
      1,
      {width: 2, height: 2},
    );
    const halfFrames = await compositeFrames(
      [{source: bottom}, {source: top, opacity: 0.5}],
      1,
      {width: 2, height: 2},
    );

    const opaqueRaw = await sharp(opaqueFrames[0])
      .ensureAlpha()
      .raw()
      .toBuffer({resolveWithObject: true});
    const halfRaw = await sharp(halfFrames[0])
      .ensureAlpha()
      .raw()
      .toBuffer({resolveWithObject: true});

    // Fully opaque top layer should read as the top layer's own color.
    expect(opaqueRaw.data[0]).toBe(200);
    // Half-opacity top layer should blend, landing strictly between bottom
    // and top colors.
    expect(halfRaw.data[0]).toBeGreaterThan(50);
    expect(halfRaw.data[0]).toBeLessThan(200);
  });
});

describe('output naming', () => {
  it('every color has an accent and ghost output filename', () => {
    for (const color of DRUM_COLORS) {
      for (const variant of TOM_VARIANTS) {
        const name = outputFileName(color, variant);
        expect(name).toMatch(
          /^drum-tom-(red|yellow|blue|green)-(accent|ghost)\.webp$/,
        );
      }
    }
  });

  it('produces the exact expected filenames', () => {
    expect(outputFileName('red', 'accent')).toBe('drum-tom-red-accent.webp');
    expect(outputFileName('red', 'ghost')).toBe('drum-tom-red-ghost.webp');
    expect(outputFileName('blue', 'accent')).toBe('drum-tom-blue-accent.webp');
  });

  it('DRUM_COLORS covers exactly the 4 tom colors', () => {
    expect([...DRUM_COLORS].sort()).toEqual(
      ['blue', 'green', 'red', 'yellow'].sort(),
    );
  });

  it('TOM_VARIANTS covers exactly accent and ghost — ghost is never a 16-frame variant set alongside sp combinations baked by this script', () => {
    expect([...TOM_VARIANTS].sort()).toEqual(['accent', 'ghost'].sort());
  });
});
