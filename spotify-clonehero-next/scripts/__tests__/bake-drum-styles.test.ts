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
  SQUARE_RECIPE,
  ROUND_RECIPE,
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
    const curve = buildToneCurve([
      {gray: 100, r: 200, g: 10, b: 10},
      {gray: 100, r: 210, g: 20, b: 20},
    ]);
    expect(curve.r[100]).toBeCloseTo(205);
    expect(curve.g[100]).toBeCloseTo(15);
    expect(curve.b[100]).toBeCloseTo(15);
  });

  it('linearly interpolates between two data-bearing buckets', () => {
    const curve = buildToneCurve([
      {gray: 0, r: 0, g: 0, b: 0},
      {gray: 100, r: 200, g: 100, b: 50},
    ]);
    // Halfway between gray=0 and gray=100 should read halfway between the
    // two known outputs.
    expect(curve.r[50]).toBeCloseTo(100);
    expect(curve.g[50]).toBeCloseTo(50);
    expect(curve.b[50]).toBeCloseTo(25);
  });

  it('extends flatly past the first and last known sample', () => {
    const curve = buildToneCurve([
      {gray: 50, r: 90, g: 10, b: 10},
      {gray: 200, r: 250, g: 40, b: 40},
    ]);
    // Below the lowest sampled gray value: holds the lowest known output.
    expect(curve.r[0]).toBeCloseTo(90);
    // Above the highest sampled gray value: holds the highest known output.
    expect(curve.r[255]).toBeCloseTo(250);
  });

  it('falls back to an identity curve when given no samples', () => {
    const curve = buildToneCurve([]);
    expect(curve.r[42]).toBe(42);
    expect(curve.g[200]).toBe(200);
    expect(curve.b[0]).toBe(0);
  });
});

describe('tintGrayscale', () => {
  it('applies the tone curve per channel, preserving alpha', async () => {
    const gray = await makeSolidPng(100, 100, 100, 255);
    const curve = buildToneCurve([{gray: 100, r: 220, g: 60, b: 60}]);
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

  it('applies an optional brightnessScale on top of the curve output (ghost dimming)', async () => {
    const gray = await makeSolidPng(100, 100, 100, 255);
    const curve = buildToneCurve([{gray: 100, r: 200, g: 100, b: 50}]);
    const dimmed = await tintGrayscale(gray, curve, 0.5);

    const {data} = await sharp(dimmed)
      .ensureAlpha()
      .raw()
      .toBuffer({resolveWithObject: true});

    expect(data[0]).toBe(100); // 200 * 0.5
    expect(data[1]).toBe(50); // 100 * 0.5
    expect(data[2]).toBe(25); // 50 * 0.5
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

  it('composites layers bottom to top, and applies per-layer opacity', async () => {
    const bottom = await writeFixture('bottom.png', 50, 50, 50, 255);
    // Fully-opaque top layer at reduced composite opacity should blend with
    // the bottom layer rather than fully occluding it.
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

describe('recipe completeness', () => {
  it('every color has an output filename for every style x variant combination', () => {
    for (const color of DRUM_COLORS) {
      for (const style of ['square', 'round'] as const) {
        for (const variant of TOM_VARIANTS) {
          const name = outputFileName(style, color, variant);
          expect(name).toMatch(
            /^drum-tom(-round)?-(red|yellow|blue|green).*\.webp$/,
          );
        }
      }
    }
  });

  it('square filenames omit the -round- infix and round filenames include it', () => {
    expect(outputFileName('square', 'red', 'base')).toBe('drum-tom-red.webp');
    expect(outputFileName('square', 'red', 'ghost-sp')).toBe(
      'drum-tom-red-ghost-sp.webp',
    );
    expect(outputFileName('round', 'red', 'base')).toBe(
      'drum-tom-round-red.webp',
    );
    expect(outputFileName('round', 'red', 'accent-sp')).toBe(
      'drum-tom-round-red-accent-sp.webp',
    );
  });

  it('DRUM_COLORS covers exactly the 4 tom colors', () => {
    expect([...DRUM_COLORS].sort()).toEqual(
      ['blue', 'green', 'red', 'yellow'].sort(),
    );
  });

  it('every recipe (square + round) defines a layer list for every variant', () => {
    for (const recipeSet of [SQUARE_RECIPE, ROUND_RECIPE]) {
      for (const variant of TOM_VARIANTS) {
        const layers = recipeSet.recipes[variant];
        expect(Array.isArray(layers)).toBe(true);
        expect(layers.length).toBeGreaterThan(0);
      }
    }
  });

  it('SP variants include one more layer than their non-SP counterpart (the glow overlay)', () => {
    for (const recipeSet of [SQUARE_RECIPE, ROUND_RECIPE]) {
      expect(recipeSet.recipes.sp.length).toBe(
        recipeSet.recipes.base.length + 2,
      );
      expect(recipeSet.recipes['accent-sp'].length).toBe(
        recipeSet.recipes.accent.length + 2,
      );
      expect(recipeSet.recipes['ghost-sp'].length).toBe(
        recipeSet.recipes.ghost.length + 2,
      );
    }
  });
});
