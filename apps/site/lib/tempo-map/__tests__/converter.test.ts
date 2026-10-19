/**
 * Golden tests for the beats → synctrack converter against the SHIPPING-config
 * Python reference (synctrack_shipping.json, dumped by drum-to-chart
 * scripts/dump_converter_golden.py). The converter is run with the PRODUCTION
 * config the app actually ships (pipeline-worker.ts): DRUM_BEAT_AVG on
 * (drumPpBeatsSec passed), lag-0 (continuousLag default false), PL_LSQ=15,
 * anchorOrigin default true, selfconsist numerator. Fed the same PP
 * beats/downbeats/logits/offset, the converter must reproduce the Python
 * synctrack EXACTLY (origin, time signatures, every tempo).
 *
 * This replaces the prior frozen dbc913d golden, which pinned the STALE lag-ON
 * config (plLsqTolMs:0/anchorOrigin:false/continuousLag:true) the app no longer
 * ships. The Python reference reconciles the two prior divergence points as
 * reference choices (no app change): NUM_SELECTOR=selfconsist (the app's
 * musically-correct numerator, e.g. okgo 3/4) and DUPBPM_COLLAPSE (drops a
 * trailing duplicate-BPM tempo the app already collapses). See the dumper.
 */

import {readFileSync} from 'fs';
import path from 'path';
import {
  beatsToSynctrack,
  fillBeatGaps,
  backExtrapOrigin,
  dedupShortIois,
  PL_LSQ_TOL_MS_DEFAULT,
} from '../converter';
import {parseNpz} from './npz';
import type {Synctrack} from '../types';

function loadFixture(song: string) {
  const dir = path.join(__dirname, 'fixtures', song);
  const json = (name: string) =>
    JSON.parse(readFileSync(path.join(dir, name), 'utf8'));
  const ppFm = json('pp_fullmix.json');
  const ppDs = json('pp_drumstem.json');
  const offset = json('drum_onset_offset_ms.json');
  const expected = json('synctrack_shipping.json');
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

  // ds median IOI (same computation as pipeline-worker.ts)
  let dsIoiMs: number | null = null;
  if (ppDs.beats.length >= 4) {
    const iois: number[] = [];
    for (let i = 1; i < ppDs.beats.length; i++) {
      iois.push((ppDs.beats[i] - ppDs.beats[i - 1]) * 1000);
    }
    iois.sort((a, b) => a - b);
    dsIoiMs = iois[Math.floor(iois.length / 2)];
  }

  // PRODUCTION config (pipeline-worker.ts): drumPpBeatsSec ON (DRUM_BEAT_AVG),
  // plLsqTolMs 15, anchorOrigin + continuousLag left at their shipping defaults
  // (true / false = lag-0).
  const sync = beatsToSynctrack({
    beats: ppFm.beats,
    downbeats: ppFm.downbeats,
    beatLogits: logits['beat_logits'].data,
    fps: logits['fps'].data[0],
    drumStemPpIoiMs: dsIoiMs,
    drumOnsetOffsetMs: offset.offset_ms,
    drumPpBeatsSec: ppDs.beats,
    plLsqTolMs: PL_LSQ_TOL_MS_DEFAULT,
  });
  expect(sync).not.toBeNull();
  return {sync: sync!, expected};
}

function expectExactSynctrack(sync: Synctrack, expected: Synctrack) {
  expect(sync.origin_ms).toBeCloseTo(expected.origin_ms, 6);
  expect(sync.timeSignatures.length).toBe(expected.timeSignatures.length);
  for (let i = 0; i < expected.timeSignatures.length; i++) {
    expect(sync.timeSignatures[i].ms).toBeCloseTo(
      expected.timeSignatures[i].ms,
      6,
    );
    expect(sync.timeSignatures[i].numerator).toBe(
      expected.timeSignatures[i].numerator,
    );
    expect(sync.timeSignatures[i].denominator).toBe(
      expected.timeSignatures[i].denominator,
    );
  }
  expect(sync.tempos.length).toBe(expected.tempos.length);
  for (let i = 0; i < expected.tempos.length; i++) {
    expect(sync.tempos[i].ms).toBeCloseTo(expected.tempos[i].ms, 6);
    expect(sync.tempos[i].bpm).toBeCloseTo(expected.tempos[i].bpm, 6);
  }
}

describe('beatsToSynctrack golden vs SHIPPING-config Python reference', () => {
  test('Beck - E-Pro (4/4): exact synctrack match (lag-0 + DRUM_BEAT_AVG)', () => {
    const {sync, expected} = runConverter('beck');
    expect(sync.timeSignatures[0].numerator).toBe(4);
    expectExactSynctrack(sync, expected);
  });

  test('OK Go - Shooting the Moon (3/4): exact synctrack match (picks 3/4)', () => {
    const {sync, expected} = runConverter('okgo');
    expect(sync.timeSignatures[0].numerator).toBe(3);
    expectExactSynctrack(sync, expected);
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
