import {describe, test, expect} from '@jest/globals';
import {wav2vecFrames} from '../frames';

describe('wav2vecFrames', () => {
  // Oracle values verified against the actual wav2vec2-base-960h fp16 ONNX
  // model's output dims (run on the WASM EP) — these must match exactly so
  // emissions can be trimmed back after fixed-size WebGPU padding.
  test.each([
    [160000, 499], // 10 s @ 16 kHz
    [430080, 1343], // 26.88 s
    [432000, 1349], // 27 s
    [480000, 1499], // 30 s
    [615520, 1923], // 38.47 s — tail-chunk length from a 188 s song
    [960000, 2999], // 60 s — full CHUNK_SAMPLES
  ])('%d samples -> %d frames', (samples, frames) => {
    expect(wav2vecFrames(samples)).toBe(frames);
  });

  test('never returns a negative count for sub-receptive-field input', () => {
    expect(wav2vecFrames(0)).toBe(0);
    expect(wav2vecFrames(100)).toBe(0);
  });
});
