/**
 * The music edit's splice model: crossfades placed clear of attacks, every
 * segment's audio landing sample-exact on its video time, equal-power
 * blends, and the gain lanes' breakpoint curves.
 */
import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import type {Segment} from '../src/music/contract';
import {
  SILENCE_DB,
  addRingOut,
  checkTailTimes,
  gainCurve,
  makeImpulseResponse,
  placeCrossfade,
  renderEdit,
  silentRanges,
  splicesOf,
  type CrossfadeSpec,
  type TailSpec,
} from '../scripts/audio/edit';
import {
  SAMPLE_RATE,
  allocStereo,
  toSamples,
  type Stereo,
} from '../scripts/audio/pcm';
import {mulberry32} from '../src/motion/random';

const SPEC: CrossfadeSpec = {
  lengthSec: 0.02,
  guardSec: 0.004,
  lookbackSec: 0.03,
  marginSec: 0.005,
};

/** Song bars [1, 3) and [10, 12) played back to back: a splice at video 2 s. */
const SEGMENTS: Segment[] = [
  {videoStart: 0, videoEnd: 2, songStart: 1, songEnd: 3},
  {videoStart: 2, videoEnd: 4, songStart: 10, songEnd: 12},
];

const song = (seconds = 14) => allocStereo(seconds * SAMPLE_RATE);

/** A decaying noise hit starting at `t` (song seconds): a clear attack. */
function addHit(s: Stereo, t: number, amp = 0.8): void {
  const rnd = mulberry32(Math.round(t * 1000));
  const start = toSamples(t);
  for (let i = 0; i < toSamples(0.08); i++) {
    const v = amp * (2 * rnd() - 1) * Math.exp(-i / toSamples(0.02));
    s.l[start + i] = s.l[start + i]! + v;
    s.r[start + i] = s.r[start + i]! + v;
  }
}

/** A soft 220 Hz tone under everything, so the stems are never silent. */
function addBed(s: Stereo): void {
  for (let i = 0; i < s.l.length; i++) {
    const v = 0.05 * Math.sin((2 * Math.PI * 220 * i) / SAMPLE_RATE);
    s.l[i] = s.l[i]! + v;
    s.r[i] = s.r[i]! + v;
  }
}

describe('placeCrossfade', () => {
  it('ends the fade `guard` before the bar line when no attack is near', () => {
    const s = song();
    addBed(s);
    const w = placeCrossfade(s, SEGMENTS[0]!, SEGMENTS[1]!, SPEC);
    assert.ok(
      Math.abs(w.endSec - (2 - SPEC.guardSec)) < 1e-9,
      `end ${w.endSec}`,
    );
    assert.ok(Math.abs(w.endSec - w.startSec - SPEC.lengthSec) < 1e-9);
  });

  it('moves the fade clear of an early attack on the incoming side', () => {
    const s = song();
    addBed(s);
    addHit(s, 10 - 0.012); // the incoming downbeat, played 12 ms early
    const w = placeCrossfade(s, SEGMENTS[0]!, SEGMENTS[1]!, SPEC);
    const attackVideo = 2 - 0.012;
    assert.ok(
      w.endSec <= attackVideo - SPEC.marginSec + 0.002,
      `fade ends at ${w.endSec}, the attack is at ${attackVideo}`,
    );
    assert.ok(
      w.endSec < 2 - SPEC.guardSec,
      'the fade moved earlier than the guard alone',
    );
  });

  it('moves the fade clear of an attack on the outgoing side too', () => {
    const s = song();
    addBed(s);
    addHit(s, 3 - 0.02); // the outgoing bar's own next downbeat, arriving early
    const w = placeCrossfade(s, SEGMENTS[0]!, SEGMENTS[1]!, SPEC);
    assert.ok(
      w.endSec <= 2 - 0.02 - SPEC.marginSec + 0.002,
      `fade ends at ${w.endSec}`,
    );
  });
});

describe('renderEdit', () => {
  const splices = (s: Stereo) =>
    splicesOf(SEGMENTS, (a, b) => ({stem: placeCrossfade(s, a, b, SPEC)}));

  it('lands every segment sample-exact on its video time', () => {
    const s = song();
    // Single-sample marks at song times inside each segment and in the incoming pre-roll.
    const marks = [
      {song: 1.5, video: 0.5},
      {song: 2.5, video: 1.5},
      {song: 9.999, video: 1.999},
      {song: 11, video: 3},
    ];
    for (const m of marks) s.l[toSamples(m.song)] = 0.5;
    const cuts = splices(s);
    const out = renderEdit(s, SEGMENTS, cuts, 'stem', 4 * SAMPLE_RATE);
    const fade = cuts[0]!.fades.stem;
    for (const m of marks) {
      assert.equal(out.l[toSamples(m.video)], 0.5, `mark at song ${m.song}`);
    }
    // Nothing else is non-zero outside the crossfade.
    let stray = 0;
    out.l.forEach((v, i) => {
      const t = i / SAMPLE_RATE;
      if (
        v !== 0 &&
        !marks.some(m => toSamples(m.video) === i) &&
        !(t >= fade.startSec && t < fade.endSec)
      )
        stray++;
    });
    assert.equal(stray, 0);
  });

  it('blends with equal power across the crossfade', () => {
    const outgoing = song();
    const incoming = song();
    for (let i = toSamples(1); i < toSamples(3); i++) outgoing.l[i] = 1;
    for (let i = toSamples(9); i < toSamples(12); i++) incoming.l[i] = 1;
    // Place the fade on the combined song, then render each side alone.
    const both = song();
    for (let i = 0; i < both.l.length; i++)
      both.l[i] = outgoing.l[i]! + incoming.l[i]!;
    const cuts = splices(both);
    const a = renderEdit(outgoing, SEGMENTS, cuts, 'stem', 4 * SAMPLE_RATE);
    const b = renderEdit(incoming, SEGMENTS, cuts, 'stem', 4 * SAMPLE_RATE);
    const {startSec: start, endSec: end} = cuts[0]!.fades.stem;
    let prev = 1;
    for (let i = toSamples(start); i < toSamples(end); i++) {
      const gOut = a.l[i]!;
      const gIn = b.l[i]!;
      assert.ok(Math.abs(gOut * gOut + gIn * gIn - 1) < 1e-6, `power at ${i}`);
      assert.ok(gOut <= prev + 1e-9, 'the outgoing side only falls');
      prev = gOut;
    }
  });
});

describe('gain lanes', () => {
  const at = (g: Float32Array, t: number) => g[toSamples(t)]!;
  const db = (v: number) => 20 * Math.log10(v);

  it('interpolates linearly in dB and holds past the ends', () => {
    const g = gainCurve(
      [
        {atSec: 1, gainDb: 0},
        {atSec: 2, gainDb: -6},
      ],
      3 * SAMPLE_RATE,
    );
    assert.ok(Math.abs(at(g, 0.5) - 1) < 1e-6);
    assert.ok(Math.abs(db(at(g, 1.5)) + 3) < 1e-3);
    assert.ok(Math.abs(db(at(g, 2.5)) + 6) < 1e-3);
  });

  it('ramps to exact silence through -80 dB', () => {
    const g = gainCurve(
      [
        {atSec: 1, gainDb: 0},
        {atSec: 2, gainDb: SILENCE_DB},
      ],
      3 * SAMPLE_RATE,
    );
    assert.ok(Math.abs(db(at(g, 1.5)) + 40) < 1e-3, 'half way is -40 dB');
    assert.equal(at(g, 2), 0);
    assert.equal(at(g, 2.9), 0);
  });

  it('reports where a curve is silent', () => {
    const points = [
      {atSec: 1, gainDb: 0},
      {atSec: 1.1, gainDb: SILENCE_DB},
      {atSec: 2.9, gainDb: SILENCE_DB},
      {atSec: 3, gainDb: 0},
      {atSec: 5, gainDb: 0},
      {atSec: 5.1, gainDb: SILENCE_DB},
    ];
    assert.deepEqual(silentRanges(points, 8), [
      {startSec: 1.1, endSec: 2.9},
      {startSec: 5.1, endSec: 8},
    ]);
  });
});

describe('ring-out', () => {
  const spec: TailSpec = {
    sendStartSec: 0,
    sendRampSec: 0.01,
    rt60Sec: 1.5,
    wetDb: -8,
    preDelaySec: 0.015,
    brightHz: 7000,
    darkHz: 900,
    darkenSec: 1.5,
    lowCutHz: 120,
    dryFadeStartSec: 1,
    dryFadeEndSec: 2,
    seed: 1,
  };

  it('has a unit-energy, deterministic impulse response', () => {
    const a = makeImpulseResponse(spec);
    const b = makeImpulseResponse(spec);
    for (const ch of [a.l, a.r]) {
      const energy = ch.reduce((acc, v) => acc + v * v, 0);
      assert.ok(Math.abs(energy - 1) < 1e-3, `energy ${energy}`);
    }
    assert.deepEqual(a.l, b.l);
    assert.notDeepEqual(a.l, a.r, 'the channels are decorrelated');
  });

  it('refuses tail times that would jump or ring nothing: a dry fade before the send or ending first, a send outside the audio', () => {
    assert.doesNotThrow(() => checkTailTimes(spec, 3));
    assert.throws(
      () => checkTailTimes({...spec, sendStartSec: 1.5}, 3),
      /starts before the send opens/,
    );
    assert.throws(
      () => checkTailTimes({...spec, dryFadeEndSec: 1}, 3),
      /at or before it starts/,
    );
    assert.throws(
      () =>
        checkTailTimes(
          {...spec, sendStartSec: 3, dryFadeStartSec: 3, dryFadeEndSec: 4},
          3,
        ),
      /outside the audio \(0 to 3\.000 s\)/,
    );
  });

  it('keeps the dry level continuous where the send opens', () => {
    const s = song(3);
    for (let i = 0; i < s.l.length; i++) s.l[i] = s.r[i] = 0.5;
    addRingOut(s, makeImpulseResponse(spec), {...spec, sendStartSec: 0.5});
    const at = toSamples(0.5);
    assert.ok(Math.abs(s.l[at]! - s.l[at - 1]!) < 0.01, 'no step at the send');
    assert.equal(
      s.l.findIndex(v => !Number.isFinite(v)),
      -1,
    );
  });
});
