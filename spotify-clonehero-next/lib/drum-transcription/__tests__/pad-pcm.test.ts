import {padPcmStart} from '../audio/pad-pcm';

describe('padPcmStart', () => {
  it('returns the input unchanged when padSamples <= 0', () => {
    const pcm = new Float32Array([1, 2, 3, 4]);
    expect(padPcmStart(pcm, 0, 2)).toBe(pcm);
    expect(padPcmStart(pcm, -5, 2)).toBe(pcm);
  });

  it('prepends the right number of silent frames for mono', () => {
    const pcm = new Float32Array([1, 2, 3]);
    const out = padPcmStart(pcm, 4, 1);
    expect(out.length).toBe(4 + 3);
    expect(Array.from(out.subarray(0, 4))).toEqual([0, 0, 0, 0]);
    expect(Array.from(out.subarray(4))).toEqual([1, 2, 3]);
  });

  it('prepends the right number of silent frames for stereo (2 floats/frame)', () => {
    const pcm = new Float32Array([1, 2, 3, 4]); // 2 frames, 2ch
    const out = padPcmStart(pcm, 3, 2);
    // 3 frames * 2 channels = 6 silent floats prepended
    expect(out.length).toBe(6 + 4);
    expect(Array.from(out.subarray(0, 6))).toEqual([0, 0, 0, 0, 0, 0]);
    expect(Array.from(out.subarray(6))).toEqual([1, 2, 3, 4]);
  });

  it('zero region is entirely silent even for non-trivial pad sizes', () => {
    const pcm = new Float32Array([5, 6]);
    const out = padPcmStart(pcm, 100, 1);
    expect(out.length).toBe(102);
    for (let i = 0; i < 100; i++) expect(out[i]).toBe(0);
    expect(out[100]).toBe(5);
    expect(out[101]).toBe(6);
  });

  it('leaves original content offset correctly and does not mutate input', () => {
    const pcm = new Float32Array([9, 9, 9]);
    const original = Array.from(pcm);
    const out = padPcmStart(pcm, 2, 1);
    expect(Array.from(pcm)).toEqual(original);
    expect(Array.from(out)).toEqual([0, 0, 9, 9, 9]);
  });
});
