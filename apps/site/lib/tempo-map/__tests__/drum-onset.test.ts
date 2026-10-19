import {
  spectralFluxEnvelope,
  findNearestPeak,
  computeDrumOnsetOffsetMs,
} from '../drum-onset';

/** Synthesize clicks (short bursts of noise-free sine) at the given times. */
function clickTrack(
  sr: number,
  durationSec: number,
  clickTimesSec: number[],
): Float32Array {
  const pcm = new Float32Array(Math.floor(sr * durationSec));
  for (const t of clickTimesSec) {
    const start = Math.floor(t * sr);
    for (let i = 0; i < Math.floor(sr * 0.01); i++) {
      if (start + i < pcm.length) {
        pcm[start + i] =
          Math.sin((2 * Math.PI * 1000 * i) / sr) * Math.exp(-i / (sr * 0.003));
      }
    }
  }
  return pcm;
}

describe('spectralFluxEnvelope', () => {
  test('peaks near click onsets', () => {
    const sr = 44100;
    const clicks = [0.5, 1.0, 1.5, 2.0];
    const {flux, fps} = spectralFluxEnvelope(clickTrack(sr, 3, clicks), sr);
    expect(fps).toBeCloseTo(sr / Math.round(sr * 0.005), 6);
    for (const t of clicks) {
      const peakMs = findNearestPeak(t * 1000, flux, fps, 50);
      expect(peakMs).not.toBeNull();
      // Frame timestamps are window-start times, so the detected peak sits
      // up to ~3 hops (15 ms) after the true onset.
      expect(Math.abs(peakMs! - t * 1000)).toBeLessThanOrEqual(20);
    }
  });

  test('empty audio yields empty flux', () => {
    const {flux} = spectralFluxEnvelope(new Float32Array(100), 44100);
    expect(flux.length).toBe(0);
  });
});

describe('computeDrumOnsetOffsetMs', () => {
  test('recovers a constant onset-vs-beat offset', () => {
    const sr = 44100;
    // Clicks 20ms BEFORE each nominal beat.
    const beats = Array.from({length: 12}, (_, i) => 0.5 + i * 0.5);
    const clicks = beats.map(b => b - 0.02);
    const offset = computeDrumOnsetOffsetMs({
      drumStemPcm: clickTrack(sr, 8, clicks),
      sr,
      ppFmBeatsSec: beats,
    });
    expect(offset).not.toBeNull();
    expect(offset!).toBeLessThan(-10);
    expect(offset!).toBeGreaterThan(-35);
  });

  test('returns null with too few beats', () => {
    const offset = computeDrumOnsetOffsetMs({
      drumStemPcm: new Float32Array(44100),
      sr: 44100,
      ppFmBeatsSec: [0.1, 0.2],
    });
    expect(offset).toBeNull();
  });
});
