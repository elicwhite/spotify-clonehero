/**
 * The last guard before a separated stem reaches the fingerprint-keyed
 * cache.
 *
 * It exists because the cache is shared: `/drum-transcription`, `/tempo` and
 * the chart editor all read the stems stored under a mix's fingerprint, so
 * one bad write is a bad read on every page until the user clears the cache.
 * A GPU that cannot compile the separation model's shaders is the known way
 * to produce one — ONNX Runtime reports that only to the console and the run
 * reads back buffers that nothing wrote (lib/onnx/webgpu-capability.ts).
 */

import {assertSeparationUsable} from '../separate-stems';

const MIX = {
  left: Float32Array.from([0, 0.5, -0.25, 0]),
  right: Float32Array.from([0, 0.4, -0.2, 0]),
};

const SILENT_MIX = {
  left: new Float32Array(4),
  right: new Float32Array(4),
};

function stems(values: {drums: number[]; vocals: number[]}) {
  return {
    drumsLeft: Float32Array.from(values.drums),
    drumsRight: Float32Array.from(values.drums),
    vocalsLeft: Float32Array.from(values.vocals),
    vocalsRight: Float32Array.from(values.vocals),
  };
}

describe('assertSeparationUsable', () => {
  it('accepts a normal separation', () => {
    expect(() =>
      assertSeparationUsable(
        MIX,
        stems({drums: [0, 0.3, 0, 0], vocals: [0, 0, 0.2, 0]}),
      ),
    ).not.toThrow();
  });

  it('rejects an all-zero separation of a mix that had signal', () => {
    // What a missing `shader-f16` produces: every read-back buffer is zero.
    expect(() =>
      assertSeparationUsable(
        MIX,
        stems({drums: [0, 0, 0, 0], vocals: [0, 0, 0, 0]}),
      ),
    ).toThrow(/silence/i);
  });

  it('accepts an all-zero separation of a silent mix', () => {
    // A silent upload has nothing to separate. That is not a fault, and it
    // must still cache, or the page repeats the work on every visit.
    expect(() =>
      assertSeparationUsable(
        SILENT_MIX,
        stems({drums: [0, 0, 0, 0], vocals: [0, 0, 0, 0]}),
      ),
    ).not.toThrow();
  });

  it('accepts a stem pair where only one stem is silent', () => {
    // A song with no vocals separates to a silent vocals stem, which is a
    // correct answer.
    expect(() =>
      assertSeparationUsable(
        MIX,
        stems({drums: [0, 0.3, 0, 0], vocals: [0, 0, 0, 0]}),
      ),
    ).not.toThrow();
  });

  it('rejects NaN samples', () => {
    expect(() =>
      assertSeparationUsable(
        MIX,
        stems({drums: [0, NaN, 0, 0], vocals: [0, 0, 0.2, 0]}),
      ),
    ).toThrow(/invalid audio/i);
  });

  it('rejects Infinity samples', () => {
    expect(() =>
      assertSeparationUsable(
        MIX,
        stems({drums: [0, 0.3, 0, 0], vocals: [0, Infinity, 0, 0]}),
      ),
    ).toThrow(/invalid audio/i);
  });
});
