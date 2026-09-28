import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {buildTimelineApi} from '../src/music/api';
import type {DrumNote, Envelopes, Timeline} from '../src/music/contract';
import {makeTimeline} from '../src/music/make';
import {tempoTimeline} from '../src/music/tempo';

type Drum = Omit<DrumNote, 'frame'>;

const drum = (t: number, over: Partial<Drum>): Drum => ({
  t,
  tick: 0,
  lane: 'red',
  cymbal: false,
  accent: false,
  ghost: false,
  doubleKick: false,
  kit: 'snare',
  ...over,
});

/**
 * 120 BPM (a bar is 2 s) for 8 s at `fps`. The band hits the downbeats of
 * bars 0 and 1, stops dead on bar 2, and hits bar 3 an eighth early, where a
 * guitar note lands with the kick.
 */
const song = (fps: number): Timeline => {
  const grid = tempoTimeline({bpm: 120, durationSec: 8, fps});
  return makeTimeline({
    fps,
    durationSec: 8,
    meta: grid.meta,
    tempo: grid.tempo,
    beats: grid.beats,
    bars: grid.bars,
    drums: [
      drum(0, {kit: 'kick', lane: 'kick'}),
      drum(2.01, {kit: 'crash', lane: 'green', cymbal: true, accent: true}),
      drum(3, {}),
      drum(4.5, {ghost: true}),
      drum(5.75, {kit: 'kick', lane: 'kick'}),
    ],
    guitar: [
      {t: 5.75, tick: 0, frets: [0], sustain: 0, hopo: false, tap: false},
    ],
  });
};

/** Loud, except for half a second of silence from bar 2's downbeat (4 s). */
const envelopes = (fps: number): Envelopes => ({
  fps,
  stems: {
    mix: Array.from({length: 8 * fps}, (_, f) =>
      f / fps >= 4 && f / fps < 4.5 ? 0.01 : 0.5,
    ),
  },
});

describe('buildTimelineApi', () => {
  it('turns hit times into sorted frames', () => {
    const tl = buildTimelineApi(song(60));
    assert.deepEqual(tl.hitFrames.kick, [0, 345]);
    assert.deepEqual(tl.hitFrames.any, [0, 121, 180, 345]);
    assert.equal(tl.meta.title, '');
    assert.equal(tl.fps, 60);
  });

  it('filters drum notes by field, list or predicate', () => {
    const tl = buildTimelineApi(song(60));
    assert.deepEqual(tl.drumFrames({kit: 'crash'}), [121]);
    assert.deepEqual(tl.drumFrames({lane: ['kick', 'green']}), [0, 121, 345]);
    assert.deepEqual(tl.drumFrames({ghost: false, kit: 'snare'}), [180]);
    assert.deepEqual(
      tl.drumFrames(n => n.t > 5),
      [345],
    );
  });

  it('finds the downbeats that really hit', () => {
    // Bar 1's crash lands a frame late; bar 3 is hit an eighth early.
    assert.deepEqual(buildTimelineApi(song(60)).downbeatHitFrames, [0, 120]);
  });

  it('finds stops only with envelopes', () => {
    assert.deepEqual(buildTimelineApi(song(60)).stopFrames, []);
    const tl = buildTimelineApi(song(60), {envelopes: envelopes(60)});
    assert.deepEqual(tl.stopFrames, [240]);
  });

  it('finds band hits where drums and guitar land together', () => {
    assert.deepEqual(buildTimelineApi(song(60)).tuttiFrames(), [345]);
    // A looser tolerance (seconds) also takes the ghost note 1.25 s before.
    assert.deepEqual(buildTimelineApi(song(60)).tuttiFrames(1.5), [270, 345]);
  });

  it('slices notes by time', () => {
    const tl = buildTimelineApi(song(60));
    assert.deepEqual(
      tl.drumsBetween(2, 5.75).map(n => n.t),
      [2.01, 3, 4.5],
    );
    assert.equal(tl.guitarBetween(0, 10).length, 1);
    assert.deepEqual(tl.syllablesBetween(0, 10), []);
  });

  it('interpolates envelopes and names the missing ones', () => {
    const tl = buildTimelineApi(song(60), {envelopes: envelopes(60)});
    assert.equal(tl.envelopeAt('mix', 100), 0.5);
    assert.ok(Math.abs(tl.envelopeAt('mix', 239.5) - 0.255) < 1e-9);
    assert.throws(() => tl.envelopeAt('drums', 0), /no 'drums' envelope/);
    assert.throws(
      () => buildTimelineApi(song(60)).envelopeAt('mix', 0),
      /needs envelopes/,
    );
  });

  it('reads bars and beats through the grid', () => {
    const tl = buildTimelineApi(song(60));
    assert.equal(tl.frameOfBeat(2, 1), 270);
    assert.equal(tl.beats.length, 16);
    assert.equal(tl.beatAt(275)?.beat, 1);
  });

  it('finds the same musical events at 30 fps', () => {
    const tl = buildTimelineApi(song(30), {envelopes: envelopes(30)});
    assert.equal(tl.fps, 30);
    assert.deepEqual(tl.hitFrames.any, [0, 60, 90, 173]);
    assert.deepEqual(tl.downbeatHitFrames, [0, 60]);
    assert.deepEqual(tl.stopFrames, [120]);
    assert.deepEqual(tl.tuttiFrames(), [173]);
    assert.equal(tl.frameOfBeat(2, 1), 135);
    assert.equal(tl.envelopeAt('mix', 50), 0.5);
  });
});
