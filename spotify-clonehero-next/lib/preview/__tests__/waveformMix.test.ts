import {mixToInterleavedStereo} from '../waveformMix';

describe('mixToInterleavedStereo', () => {
  it('returns null for no stems', () => {
    expect(mixToInterleavedStereo([])).toBeNull();
    expect(mixToInterleavedStereo([{channelData: []}])).toBeNull();
  });

  it('duplicates a mono stem into both channels', () => {
    const mixed = mixToInterleavedStereo([
      {channelData: [new Float32Array([0.5, -0.25])]},
    ]);
    expect(mixed).not.toBeNull();
    expect(mixed!.channels).toBe(2);
    expect(Array.from(mixed!.data)).toEqual([0.5, 0.5, -0.25, -0.25]);
  });

  it('interleaves a stereo stem as left/right', () => {
    const mixed = mixToInterleavedStereo([
      {
        channelData: [
          new Float32Array([0.1, 0.2]),
          new Float32Array([-0.1, -0.2]),
        ],
      },
    ]);
    expect(Array.from(mixed!.data)).toEqual(
      [0.1, -0.1, 0.2, -0.2].map(Math.fround),
    );
  });

  it('sums multiple stems and pads to the longest', () => {
    const mixed = mixToInterleavedStereo([
      {channelData: [new Float32Array([0.25])]},
      {
        channelData: [
          new Float32Array([0.25, 0.5]),
          new Float32Array([0.5, -0.5]),
        ],
      },
    ]);
    expect(Array.from(mixed!.data)).toEqual([0.5, 0.75, 0.5, -0.5]);
  });

  it('uses first and last channels of >2-channel stems', () => {
    const mixed = mixToInterleavedStereo([
      {
        channelData: [
          new Float32Array([0.1]),
          new Float32Array([0.9]),
          new Float32Array([0.3]),
        ],
      },
    ]);
    expect(Array.from(mixed!.data)).toEqual([0.1, 0.3].map(Math.fround));
  });

  it('normalizes by the peak only when the sum clips', () => {
    const clipped = mixToInterleavedStereo([
      {channelData: [new Float32Array([0.8, 0.4])]},
      {channelData: [new Float32Array([0.8, 0.4])]},
    ]);
    // Peak 1.6 → scaled by 1/1.6
    expect(clipped!.data[0]).toBeCloseTo(1.0);
    expect(clipped!.data[2]).toBeCloseTo(0.5);

    const quiet = mixToInterleavedStereo([
      {channelData: [new Float32Array([0.2])]},
    ]);
    expect(quiet!.data[0]).toBeCloseTo(0.2);
  });
});
