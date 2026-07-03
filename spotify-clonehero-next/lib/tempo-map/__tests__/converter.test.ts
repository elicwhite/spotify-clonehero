/**
 * Golden tests for the beats → synctrack converter against frozen Python
 * reference outputs from drum-to-chart's browser-pipeline (commit dbc913d).
 * When fed the Python reference PP beats/downbeats/logits/offset, the
 * converter must reproduce the Python synctrack exactly.
 */

import {readFileSync} from 'fs';
import path from 'path';
import {
  beatsToSynctrack,
  fillBeatGaps,
  backExtrapOrigin,
  dedupShortIois,
} from '../converter';
import {parseNpz} from './npz';

function loadFixture(song: string) {
  const dir = path.join(__dirname, 'fixtures', song);
  const json = (name: string) =>
    JSON.parse(readFileSync(path.join(dir, name), 'utf8'));
  const ppFm = json('pp_fullmix.json');
  const ppDs = json('pp_drumstem.json');
  const offset = json('drum_onset_offset_ms.json');
  const expected = json('synctrack.json');
  const npzBytes = readFileSync(path.join(dir, 'bt_fullmix_logits.npz'));
  const logits = parseNpz(
    npzBytes.buffer.slice(
      npzBytes.byteOffset,
      npzBytes.byteOffset + npzBytes.byteLength,
    ) as ArrayBuffer,
  );
  return {ppFm, ppDs, offset, expected, logits};
}

function runConverter(song: string) {
  const {ppFm, ppDs, offset, expected, logits} = loadFixture(song);

  // ds median IOI (same computation as the pipeline)
  let dsIoiMs: number | null = null;
  if (ppDs.beats.length >= 4) {
    const iois: number[] = [];
    for (let i = 1; i < ppDs.beats.length; i++) {
      iois.push((ppDs.beats[i] - ppDs.beats[i - 1]) * 1000);
    }
    iois.sort((a, b) => a - b);
    dsIoiMs = iois[Math.floor(iois.length / 2)];
  }

  const sync = beatsToSynctrack({
    beats: ppFm.beats,
    downbeats: ppFm.downbeats,
    beatLogits: logits['beat_logits'].data,
    fps: logits['fps'].data[0],
    drumStemPpIoiMs: dsIoiMs,
    drumOnsetOffsetMs: offset.offset_ms,
    drumPpBeatsSec: ppDs.beats,
    // The frozen dbc913d Python reference predates PL_LSQ and the origin
    // anchor — pin both for byte-exact comparison.
    plLsqTolMs: 0,
    anchorOrigin: false,
  });
  expect(sync).not.toBeNull();
  return {sync: sync!, expected};
}

describe('beatsToSynctrack golden tests vs Python reference', () => {
  test('Beck - E-Pro (4/4): exact synctrack match', () => {
    const {sync, expected} = runConverter('beck');
    expect(sync.origin_ms).toBeCloseTo(expected.origin_ms, 6);
    expect(sync.timeSignatures).toEqual(expected.timeSignatures);
    expect(sync.tempos.length).toBe(expected.tempos.length);
    for (let i = 0; i < expected.tempos.length; i++) {
      expect(sync.tempos[i].ms).toBeCloseTo(expected.tempos[i].ms, 6);
      expect(sync.tempos[i].bpm).toBeCloseTo(expected.tempos[i].bpm, 6);
    }
  });

  test('OK Go - Shooting the Moon (3/4): picks 3/4 and matches tempos', () => {
    const {sync, expected} = runConverter('okgo');
    expect(sync.timeSignatures[0].numerator).toBe(3);
    expect(sync.origin_ms).toBeCloseTo(expected.origin_ms, 6);
    expect(sync.tempos.length).toBe(expected.tempos.length);
    for (let i = 0; i < expected.tempos.length; i++) {
      expect(sync.tempos[i].ms).toBeCloseTo(expected.tempos[i].ms, 6);
      expect(sync.tempos[i].bpm).toBeCloseTo(expected.tempos[i].bpm, 6);
    }
  });
});

describe('converter helpers', () => {
  test('fillBeatGaps inserts beats into large gaps', () => {
    // steady 500ms IOI with one 1500ms gap → two inserted beats
    const beats = [0, 500, 1000, 2500, 3000];
    const filled = fillBeatGaps(beats, 1.5);
    expect(filled).toEqual([0, 500, 1000, 1500, 2000, 2500, 3000]);
  });

  test('fillBeatGaps leaves clean beats alone', () => {
    const beats = [0, 500, 1000, 1500];
    expect(fillBeatGaps(beats, 1.5)).toEqual(beats);
  });

  test('backExtrapOrigin extrapolates to the downbeat before t=0 lead-in', () => {
    // First beat at 1000ms with 500ms IOI → origin at 0
    expect(backExtrapOrigin([1000, 1500, 2000])).toBe(0);
    // First beat at 200ms with 500ms IOI → k=0, origin stays 200
    expect(backExtrapOrigin([200, 700, 1200])).toBe(200);
  });

  test('dedupShortIois drops the lower-logit duplicate', () => {
    const beats = [0, 500, 520, 1000];
    // logit at the 520 beat is higher → 500 is dropped
    const logits = [0.9, 0.2, 0.8, 0.9];
    expect(dedupShortIois(beats, logits, 0.6)).toEqual([0, 520, 1000]);
    // logit at the 500 beat is higher → 520 is dropped
    const logits2 = [0.9, 0.8, 0.2, 0.9];
    expect(dedupShortIois(beats, logits2, 0.6)).toEqual([0, 500, 1000]);
  });
});

describe('anchorOriginToAudioStart', () => {
  const {anchorOriginToAudioStart} = require('../converter');

  test('origin whole bars before audio start advances to first downbeat >= 0', () => {
    // 120 BPM (500ms beats), 4/4; origin realized 6 beats before t=0.
    const tempos = [{ms: -3000, bpm: 120}];
    const out = anchorOriginToAudioStart(tempos, -3000, 4);
    // b0 = 6 beats -> advance ceil(6/4)*4 = 8 beats -> origin at +1000ms,
    // still on the same bar-line lattice (…-3000, -1000, +1000…).
    expect(out.originMs).toBeCloseTo(1000, 6);
    expect(out.tempos[0]).toEqual({ms: 1000, bpm: 120});
  });

  test('origin within half a beat of t=0 is left alone', () => {
    const tempos = [{ms: -200, bpm: 120}]; // b0 = 0.4 beats
    const out = anchorOriginToAudioStart(tempos, -200, 4);
    expect(out.originMs).toBe(-200);
    expect(out.tempos).toBe(tempos);
  });

  test('tempo changes inside the skipped lead-in carry the active BPM', () => {
    // Origin 5 beats early at 120; tempo change to 140 at -500ms.
    const tempos = [
      {ms: -2500, bpm: 120},
      {ms: -500, bpm: 140},
    ];
    const out = anchorOriginToAudioStart(tempos, -2500, 4);
    // b0 = 4 beats at 120 + ~1.17 beats at 140 ≈ 5.17 -> advance 8 beats.
    // New origin lands after the 140 change, so it must carry bpm 140.
    expect(out.originMs).toBeGreaterThan(0);
    expect(out.tempos[0].bpm).toBe(140);
    expect(out.tempos[0].ms).toBeCloseTo(out.originMs, 9);
  });
});
