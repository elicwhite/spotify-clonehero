import {
  packStereoStem,
  unpackStereoStem,
  stereoStemToMono,
} from '../stem-cache-format';

describe('stem-cache-format', () => {
  const left = Float32Array.from([0.1, 0.2, 0.3, 0.4]);
  const right = Float32Array.from([-0.1, -0.2, -0.3, -0.4]);

  it('round-trips a planar stereo stem through pack/unpack', () => {
    const packed = packStereoStem({left, right});
    expect(packed.length).toBe(8);

    const unpacked = unpackStereoStem(packed, 4);
    expect(unpacked).not.toBeNull();
    expect(Array.from(unpacked!.left)).toEqual(Array.from(left));
    expect(Array.from(unpacked!.right)).toEqual(Array.from(right));
  });

  it('packs [L‖R] planar, not interleaved', () => {
    const packed = packStereoStem({left, right});
    expect(Array.from(packed.subarray(0, 4))).toEqual(Array.from(left));
    expect(Array.from(packed.subarray(4))).toEqual(Array.from(right));
  });

  it('truncates to the shorter channel when lengths differ', () => {
    const packed = packStereoStem({left, right: right.subarray(0, 3)});
    expect(packed.length).toBe(6);
    const unpacked = unpackStereoStem(packed, 3);
    expect(Array.from(unpacked!.left)).toEqual([left[0], left[1], left[2]]);
  });

  it('rejects a buffer whose length does not match the expected sample count', () => {
    const packed = packStereoStem({left, right});
    // Wrong song length (different N) and legacy v1 mono entries (N floats
    // instead of 2N) both fail this check.
    expect(unpackStereoStem(packed, 3)).toBeNull();
    expect(unpackStereoStem(new Float32Array(4), 4)).toBeNull();
  });

  it('derives the mean-of-channels mono mixdown', () => {
    const mono = stereoStemToMono({
      left: Float32Array.from([1, 0.5, -1]),
      right: Float32Array.from([0, 0.5, 1]),
    });
    expect(Array.from(mono)).toEqual([0.5, 0.5, 0]);
  });

  it('unpacked channels view the packed buffer without copying', () => {
    const packed = packStereoStem({left, right});
    const unpacked = unpackStereoStem(packed, 4)!;
    expect(unpacked.left.buffer).toBe(packed.buffer);
    expect(unpacked.right.buffer).toBe(packed.buffer);
  });
});
