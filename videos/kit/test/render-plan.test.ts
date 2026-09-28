/**
 * The pure planning parts of the render and QA tools: chunk plans, the
 * supersampled encode, delivery variants, frame strides, still-run
 * detection, and the sting preview's key frames and the meta check it reads
 * with (the brand's own).
 */
import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {keyFrames} from '../blender/preview';
import {assertStingMeta} from '../src/brand/stingMeta';
import {strideFrames} from '../scripts/lib/remotion';
import {stillRuns} from '../scripts/qa/motionAudit';
import {parseVariant} from '../scripts/render/delivery';
import {downscaleInEncode, planChunks} from '../scripts/render/renderFilm';

describe('the supersampled encode', () => {
  // The shape of Remotion's encode of piped PNG frames at scale 2.
  const encode = [
    '-r',
    '60',
    '-f',
    'image2pipe',
    '-s',
    '3840x2160',
    '-vcodec',
    'png',
    '-i',
    '-',
    '-c:v',
    'libx264',
    '-colorspace:v',
    'bt709',
    '-color_range',
    'tv',
    '-vf',
    'zscale=matrix=709:matrixin=709:range=limited',
    '-pix_fmt',
    'yuv420p',
    '-crf',
    '12',
    '-y',
    'chunk.mp4',
  ];
  const scaled = downscaleInEncode(1920, 1080);

  it('resizes in the BT.709 conversion and changes nothing else', () => {
    const out = scaled({type: 'pre-stitcher', args: encode});
    const at = encode.indexOf('-vf') + 1;
    assert.equal(
      out[at],
      'zscale=w=1920:h=1080:filter=lanczos:matrix=709:matrixin=709:range=limited',
    );
    assert.deepEqual(
      out.filter((_, i) => i !== at),
      encode.filter((_, i) => i !== at),
    );
  });

  it('leaves the stream copy alone and refuses an encode it cannot scale', () => {
    const copy = ['-i', 'pre.mp4', '-an', '-c:v', 'copy', '-y', 'chunk.mp4'];
    assert.deepEqual(scaled({type: 'stitcher', args: copy}), copy);
    const noFilter = encode.filter(
      a => a !== '-vf' && !a.startsWith('zscale='),
    );
    assert.throws(
      () => scaled({type: 'pre-stitcher', args: noFilter}),
      /one zscale filter/,
    );
  });
});

describe('planChunks', () => {
  it('keeps listed chunks that tile the range', () => {
    assert.deepEqual(
      planChunks(
        [0, 99],
        [
          [0, 49],
          [50, 99],
        ],
        null,
      ),
      [
        [0, 49],
        [50, 99],
      ],
    );
  });

  it('rejects listed chunks with a gap, an overlap or a short end', () => {
    assert.throws(
      () =>
        planChunks(
          [0, 99],
          [
            [0, 49],
            [51, 99],
          ],
          null,
        ),
      /should start at 50/,
    );
    assert.throws(
      () =>
        planChunks(
          [0, 99],
          [
            [0, 49],
            [40, 99],
          ],
          null,
        ),
      /should start at 50/,
    );
    assert.throws(
      () =>
        planChunks(
          [0, 99],
          [
            [0, 49],
            [50, 90],
          ],
          null,
        ),
      /end at 90, not 99/,
    );
  });

  it('slices by size, or renders the range whole', () => {
    assert.deepEqual(planChunks([10, 34], null, 10), [
      [10, 19],
      [20, 29],
      [30, 34],
    ]);
    assert.deepEqual(planChunks([0, 5], null, null), [[0, 5]]);
  });
});

describe('parseVariant', () => {
  it('reads the master size and a height', () => {
    assert.deepEqual(parseVariant('web:18:same'), {
      suffix: 'web',
      crf: 18,
      height: null,
    });
    assert.deepEqual(parseVariant('720p:24:h720'), {
      suffix: '720p',
      crf: 24,
      height: 720,
    });
  });

  it('rejects anything else, a width-by-height size included', () => {
    assert.throws(() => parseVariant('web:18'), /looks like/);
    assert.throws(() => parseVariant('square:20:1080x1080'), /looks like/);
  });

  it('rejects a height 4:2:0 cannot encode: zero or odd', () => {
    for (const spec of ['tiny:28:h0', 'odd:24:h719', 'one:24:h1']) {
      assert.throws(() => parseVariant(spec), /even and at least 2/, spec);
    }
    assert.equal(parseVariant('small:28:h2').height, 2);
  });
});

describe('strideFrames', () => {
  it('includes the end when it lands on the step, and a single frame works', () => {
    assert.deepEqual(strideFrames(300, 330, 15), [300, 315, 330]);
    assert.deepEqual(strideFrames(300, 329, 15), [300, 315]);
    assert.deepEqual(strideFrames(42, 42, 5), [42]);
    assert.throws(() => strideFrames(10, 5, 1), /10-5 runs backwards/);
  });
});

describe('stillRuns', () => {
  it('finds runs of frames that stop changing', () => {
    // Frame i + 1 against frame i: frames 3-8 stand still (5 small changes).
    const diffs = [2, 2, 2, 0.1, 0.1, 0.1, 0.1, 0.1, 2, 2];
    assert.deepEqual(stillRuns(diffs, 0.35, 5), [{from: 3, to: 8}]);
    assert.deepEqual(stillRuns(diffs, 0.35, 6), []);
  });

  it('finds a run that lasts to the end, and honours the window', () => {
    const diffs = [2, 0.1, 0.1, 0.1];
    assert.deepEqual(stillRuns(diffs, 0.35, 3), [{from: 1, to: 4}]);
    assert.deepEqual(
      stillRuns(diffs, 0.35, 3, f => f < 3),
      [],
    );
  });
});

describe('the sting preview key frames', () => {
  const meta = {
    fps: 60,
    frames: 330,
    globalStart: 2370,
    digits: 4,
    frameSizePx: 540,
    appearFrame: 12,
    impactFrame: 45,
    flashFrames: [50, 55],
    restFrames: [64, 329] as [number, number],
    sheenFrames: [120, 210, 300],
  };

  it('picks the story in order, each frame once, all inside the sting', () => {
    const keys = keyFrames(meta);
    assert.ok(keys.length <= 16);
    assert.deepEqual(
      keys,
      [...keys].sort((a, b) => a - b),
    );
    assert.equal(new Set(keys).size, keys.length);
    assert.ok(keys.includes(12) && keys.includes(45) && keys.includes(329));
  });

  it('copes with a sting with no sheens and no second flash', () => {
    const keys = keyFrames({...meta, flashFrames: [], sheenFrames: []});
    assert.ok(keys.every(f => f >= 0 && f < 330));
    assert.ok(keys.includes(45 + 16));
  });

  it('reads a meta file only when it is a whole version-1 sting', () => {
    const full = {
      version: 1,
      ...meta,
      rest: {
        centerPx: [270, 270],
        squarePx: 300,
        cornerRadiusPx: 60,
        iconBoxPx: 200,
        strokePx: 12,
      },
    };
    assert.doesNotThrow(() => assertStingMeta(full));
    assert.throws(
      () => assertStingMeta({...full, version: 2}),
      /version 2 is not 1/,
    );
    assert.throws(
      () =>
        assertStingMeta({
          ...full,
          impactFrame: 330,
          restFrames: [64],
          rest: {...full.rest, strokePx: 0},
        }),
      (e: Error) =>
        /impactFrame must be at most 329/.test(e.message) &&
        /restFrames must be \[first, last\]/.test(e.message) &&
        /rest.strokePx must be above 0/.test(e.message),
    );
  });
});
