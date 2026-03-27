/**
 * Tests for the song context vector computation.
 */

import {computeFallbackContext, computeRealContext} from '../ml/song-context';
import {SONG_CONTEXT_DIM, NUM_DRUM_CLASSES} from '../ml/types';
import type {RawDrumEvent} from '../ml/types';

describe('computeFallbackContext', () => {
  it('returns correct length', () => {
    const mel = new Float32Array(100 * 128); // 100 frames, 128 bands
    const ctx = computeFallbackContext(mel, 100, 128);
    expect(ctx.length).toBe(SONG_CONTEXT_DIM);
  });

  it('repeats mean_mel in all slots', () => {
    const nFrames = 50;
    const nMels = 128;
    const mel = new Float32Array(nFrames * nMels);
    // Fill with known values
    for (let f = 0; f < nFrames; f++) {
      for (let m = 0; m < nMels; m++) {
        mel[f * nMels + m] = m + 1; // Values 1-128
      }
    }

    const ctx = computeFallbackContext(mel, nFrames, nMels);

    // Mean mel should be [1, 2, 3, ..., 128] (constant across frames)
    // All 10 slots (1 mean + 9 instruments) should be identical
    for (let slot = 0; slot < 1 + NUM_DRUM_CLASSES; slot++) {
      for (let m = 0; m < nMels; m++) {
        expect(ctx[slot * nMels + m]).toBeCloseTo(m + 1);
      }
    }
  });

  it('handles zero frames', () => {
    const mel = new Float32Array(0);
    const ctx = computeFallbackContext(mel, 0, 128);
    expect(ctx.length).toBe(SONG_CONTEXT_DIM);
    // All zeros
    for (let i = 0; i < ctx.length; i++) {
      expect(ctx[i]).toBe(0);
    }
  });
});

describe('computeRealContext', () => {
  it('returns correct length', () => {
    const mel = new Float32Array(100 * 128);
    const events: RawDrumEvent[] = [];
    const ctx = computeRealContext(mel, 100, 128, events);
    expect(ctx.length).toBe(SONG_CONTEXT_DIM);
  });

  it('falls back to mean_mel for instruments with no onsets', () => {
    const nFrames = 50;
    const nMels = 128;
    const mel = new Float32Array(nFrames * nMels);
    for (let f = 0; f < nFrames; f++) {
      for (let m = 0; m < nMels; m++) {
        mel[f * nMels + m] = m + 1;
      }
    }

    // No events — all instrument slots should fall back to mean_mel
    const ctx = computeRealContext(mel, nFrames, nMels, []);

    // All slots should equal mean_mel
    for (let slot = 0; slot < 1 + NUM_DRUM_CLASSES; slot++) {
      for (let m = 0; m < nMels; m++) {
        expect(ctx[slot * nMels + m]).toBeCloseTo(m + 1);
      }
    }
  });

  it('extracts onset mel for instruments with events', () => {
    const nFrames = 100;
    const nMels = 128;
    const mel = new Float32Array(nFrames * nMels);

    // Set a distinctive pattern at frame 50
    for (let f = 0; f < nFrames; f++) {
      for (let m = 0; m < nMels; m++) {
        mel[f * nMels + m] = f === 50 ? 10.0 : 0.0;
      }
    }

    // BD onset at frame 50 (0.5 seconds at 100fps)
    const events: RawDrumEvent[] = [
      {timeSeconds: 0.5, drumClass: 'BD', midiPitch: 36, confidence: 0.9},
    ];

    const ctx = computeRealContext(mel, nFrames, nMels, events);

    // Slot 1 (BD) should have higher values than mean_mel (slot 0)
    // because the onset window includes frame 50 which has value 10.0
    const bdSlotStart = 1 * nMels; // BD is index 0, slot 1
    const meanSlotStart = 0;

    // BD slot should have values > 0 (from the onset window including frame 50)
    let bdSum = 0;
    for (let m = 0; m < nMels; m++) {
      bdSum += ctx[bdSlotStart + m];
    }
    expect(bdSum).toBeGreaterThan(0);
  });

  it('slot 0 is always mean_mel regardless of events', () => {
    const nFrames = 50;
    const nMels = 128;
    const mel = new Float32Array(nFrames * nMels);
    for (let f = 0; f < nFrames; f++) {
      for (let m = 0; m < nMels; m++) {
        mel[f * nMels + m] = 5.0;
      }
    }

    const events: RawDrumEvent[] = [
      {timeSeconds: 0.25, drumClass: 'SD', midiPitch: 38, confidence: 0.8},
    ];

    const ctx = computeRealContext(mel, nFrames, nMels, events);

    // Slot 0 should be mean_mel (all 5.0)
    for (let m = 0; m < nMels; m++) {
      expect(ctx[m]).toBeCloseTo(5.0);
    }
  });
});
