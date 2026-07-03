/**
 * Tests for the deploy song-context vector (512-dim stereo mel time-mean
 * tiled 10x -> 5120).
 */

import {computeDeployContext} from '../ml/song-context';
import {SONG_CONTEXT_DIM} from '../ml/types';

describe('computeDeployContext', () => {
  const nMels = 256;

  it('returns SONG_CONTEXT_DIM (5120) floats', () => {
    const nFrames = 10;
    const melStereo = new Float32Array(2 * nMels * nFrames);
    const ctx = computeDeployContext(melStereo, nFrames, nMels);
    expect(ctx.length).toBe(SONG_CONTEXT_DIM);
    expect(SONG_CONTEXT_DIM).toBe(5120);
  });

  it('computes the time-mean per (channel, mel bin) and tiles it 10x', () => {
    const nFrames = 4;
    const melStereo = new Float32Array(2 * nMels * nFrames);
    // Row cm gets values cm, cm+1, cm+2, cm+3 over time -> mean = cm + 1.5.
    for (let cm = 0; cm < 2 * nMels; cm++) {
      for (let t = 0; t < nFrames; t++) {
        melStereo[cm * nFrames + t] = cm + t;
      }
    }

    const ctx = computeDeployContext(melStereo, nFrames, nMels);

    for (let slot = 0; slot < 10; slot++) {
      for (let cm = 0; cm < 2 * nMels; cm++) {
        expect(ctx[slot * 2 * nMels + cm]).toBeCloseTo(cm + 1.5, 5);
      }
    }
  });

  it('orders the base vector as [L bins 0..255, R bins 0..255]', () => {
    const nFrames = 2;
    const melStereo = new Float32Array(2 * nMels * nFrames);
    // L channel all 1.0, R channel all 2.0.
    melStereo.fill(1.0, 0, nMels * nFrames);
    melStereo.fill(2.0, nMels * nFrames);

    const ctx = computeDeployContext(melStereo, nFrames, nMels);

    for (let m = 0; m < nMels; m++) {
      expect(ctx[m]).toBe(1.0); // L block
      expect(ctx[nMels + m]).toBe(2.0); // R block
    }
    // Second tile identical
    expect(ctx[2 * nMels]).toBe(1.0);
    expect(ctx[3 * nMels]).toBe(2.0);
  });

  it('handles zero frames (all-zero context)', () => {
    const ctx = computeDeployContext(new Float32Array(0), 0, nMels);
    expect(ctx.length).toBe(SONG_CONTEXT_DIM);
    for (let i = 0; i < ctx.length; i++) {
      expect(ctx[i]).toBe(0);
    }
  });
});
