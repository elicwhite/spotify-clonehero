/**
 * Unit tests for the reference peak-picking port (strict local maxima +
 * greedy NMS + per-lane threshold on peak height).
 *
 * Numeric equivalence with the reference is covered by
 * postprocess-reference.test.ts; these cover the algorithm's semantics.
 */

import {peakPick, pickPeaksFromModelOutput} from '../ml/peak-picking';
import type {ModelOutput} from '../ml/types';
import {NUM_DRUM_CLASSES, CRNN_THRESHOLDS} from '../ml/types';

describe('peakPick', () => {
  it('returns empty for signals shorter than 3 frames', () => {
    expect(peakPick(new Float32Array([]))).toEqual([]);
    expect(peakPick(new Float32Array([1]))).toEqual([]);
    expect(peakPick(new Float32Array([1, 2]))).toEqual([]);
  });

  it('detects a strict local maximum', () => {
    const env = new Float32Array([0, 0.2, 0.9, 0.2, 0]);
    const peaks = peakPick(env);
    expect(peaks.length).toBe(1);
    expect(peaks[0]).toEqual({frame: 2, height: expect.closeTo(0.9, 6)});
  });

  it('requires strictly rising on the left (e[i] > e[i-1])', () => {
    // Plateau: rise to 0.9 at i=2, flat at i=3 -> only i=2 is a candidate
    // (e[2] > e[1] && e[2] >= e[3]; e[3] fails e[3] > e[2]).
    const env = new Float32Array([0, 0.2, 0.9, 0.9, 0.2, 0, 0, 0]);
    const peaks = peakPick(env);
    expect(peaks.map(p => p.frame)).toEqual([2]);
  });

  it('never returns endpoint frames', () => {
    const env = new Float32Array([1.0, 0.5, 0.1, 0.5, 1.0]);
    const peaks = peakPick(env);
    expect(peaks.length).toBe(0);
  });

  it('greedy NMS suppresses peaks within 2 frames of a taller peak', () => {
    const env = new Float32Array(20);
    env[5] = 0.9; // taller
    env[7] = 0.8; // within 2 frames -> suppressed
    env[10] = 0.7; // outside window -> kept
    const peaks = peakPick(env);
    const frames = peaks.map(p => p.frame).sort((a, b) => a - b);
    expect(frames).toEqual([5, 10]);
  });

  it('breaks height ties by lower frame first', () => {
    const env = new Float32Array(20);
    env[6] = 0.8;
    env[8] = 0.8; // tie, 2 frames away -> the earlier one wins the NMS
    const peaks = peakPick(env);
    expect(peaks.map(p => p.frame)).toEqual([6]);
  });

  it('keeps both of two equal peaks outside the NMS window', () => {
    const env = new Float32Array(20);
    env[5] = 0.8;
    env[10] = 0.8;
    const peaks = peakPick(env);
    expect(peaks.map(p => p.frame).sort((a, b) => a - b)).toEqual([5, 10]);
  });
});

describe('pickPeaksFromModelOutput', () => {
  function makeOutput(
    placements: {frame: number; cls: number; value: number}[],
    nFrames = 500,
  ): ModelOutput {
    const nClasses = NUM_DRUM_CLASSES;
    const predictions = new Float32Array(nFrames * nClasses);
    for (const p of placements) {
      predictions[p.frame * nClasses + p.cls] = p.value;
    }
    return {predictions, nFrames, nClasses};
  }

  it('extracts events with frame/100 timestamps, sorted by (frame, lane)', () => {
    const events = pickPeaksFromModelOutput(
      makeOutput([
        {frame: 300, cls: 0, value: 0.8}, // BD
        {frame: 100, cls: 1, value: 0.9}, // SD
        {frame: 100, cls: 0, value: 0.9}, // BD, same frame -> lower lane first
        {frame: 200, cls: 5, value: 0.9}, // HH
      ]),
    );

    expect(events.map(e => [e.timeSeconds, e.drumClass])).toEqual([
      [1.0, 'BD'],
      [1.0, 'SD'],
      [2.0, 'HH'],
      [3.0, 'BD'],
    ]);
  });

  it('applies thresholds to peak height with strict >', () => {
    // BD threshold is 0.5: a 0.5 peak must NOT fire, 0.51 must.
    const events = pickPeaksFromModelOutput(
      makeOutput([
        {frame: 100, cls: 0, value: 0.5},
        {frame: 200, cls: 0, value: 0.51},
      ]),
    );
    expect(events.length).toBe(1);
    expect(events[0].timeSeconds).toBeCloseTo(2.0, 6);
  });

  it('skips lanes whose threshold exceeds 1.5 (crash-2 excluded)', () => {
    expect(CRNN_THRESHOLDS[7]).toBeGreaterThan(1.5);
    const events = pickPeaksFromModelOutput(
      makeOutput([{frame: 100, cls: 7, value: 0.99}]), // CR2
    );
    expect(events.length).toBe(0);
  });

  it('uses the provisional per-lane thresholds by default', () => {
    // HH threshold 0.55 (System-C tuned): 0.5 peak silent, 0.6 fires.
    const events = pickPeaksFromModelOutput(
      makeOutput([
        {frame: 100, cls: 5, value: 0.5},
        {frame: 200, cls: 5, value: 0.6},
      ]),
    );
    expect(events.length).toBe(1);
    expect(events[0].drumClass).toBe('HH');
  });

  it('returns empty for silent model output', () => {
    const events = pickPeaksFromModelOutput(makeOutput([], 100));
    expect(events.length).toBe(0);
  });

  it('maps lanes to the correct MIDI pitches', () => {
    const expectedPitches = [36, 38, 50, 47, 43, 42, 49, 57, 51];
    const placements = [];
    for (let cls = 0; cls < NUM_DRUM_CLASSES; cls++) {
      placements.push({frame: 50 + cls * 50, cls, value: 0.99});
    }
    const events = pickPeaksFromModelOutput(makeOutput(placements, 1000));

    // All lanes except CR2 (excluded) should fire once.
    expect(events.length).toBe(NUM_DRUM_CLASSES - 1);
    for (const e of events) {
      const cls = Math.round(e.timeSeconds * 100 - 50) / 50;
      expect(e.midiPitch).toBe(expectedPitches[cls]);
    }
  });
});
