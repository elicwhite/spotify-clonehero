import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {snapToEvent} from '../src/clock/cues';
import {
  anticipation,
  decayPulse,
  framesSince,
  framesUntil,
  landOn,
  nextEvent,
  prevEvent,
  pulseAt,
} from '../src/clock/events';
import {oneTake} from '../src/clock/oneTake';
import {defineStoryboard} from '../src/clock/storyboard';
import {beatGrid} from '../src/music/beatGrid';
import {tempoTimeline} from '../src/music/tempo';

// 120 BPM at 60 fps: a bar is 120 frames.
const {frameOfBeat} = beatGrid(
  tempoTimeline({bpm: 120, durationSec: 30, fps: 60}),
);

const board = defineStoryboard([
  {id: 'title', from: 0, to: 600, bar: 0},
  {id: 'feature', from: 600, to: 1200, bar: 5, accent: 'blue'},
  {id: 'end', from: 1180, to: 1500, bar: null},
]);

describe('defineStoryboard', () => {
  it('gives a scene its bar and a beat function counted from it', () => {
    assert.equal(board.sceneBar('feature'), 5);
    const beat = board.sceneBeat(frameOfBeat, 'feature');
    assert.equal(beat(0), 600);
    assert.equal(beat(1, 2), 780);
  });

  it('keeps extra fields and gives SceneWindow props', () => {
    assert.equal(board.scene('feature').accent, 'blue');
    assert.deepEqual(board.window('end'), {
      from: 1180,
      durationInFrames: 320,
      name: 'end',
    });
  });

  it('refuses the bar of a scene off the bar grid', () => {
    assert.throws(() => board.sceneBar('end'), /does not start on a bar/);
  });

  it('checks bar-aligned scenes against the timeline', () => {
    assert.deepEqual(
      board.checkStoryboard(bar => frameOfBeat(bar)),
      [],
    );
    const moved = defineStoryboard([{id: 'a', from: 610, to: 700, bar: 5}]);
    assert.deepEqual(
      moved.checkStoryboard(bar => frameOfBeat(bar)),
      ['a starts at 610, but bar 5 is at 600'],
    );
  });

  it('knows how long the film is', () => {
    assert.equal(board.durationInFrames, 1500);
  });

  it('refuses malformed scenes', () => {
    assert.throws(() => defineStoryboard([]), /no scenes/);
    assert.throws(() =>
      defineStoryboard([
        {id: 'a', from: 0, to: 10, bar: 0},
        {id: 'a', from: 10, to: 20, bar: null},
      ]),
    );
    assert.throws(() =>
      defineStoryboard([{id: 'a', from: 10, to: 10, bar: 0}]),
    );
    assert.throws(() =>
      defineStoryboard([{id: 'a', from: 0.5, to: 10, bar: null}]),
    );
    assert.throws(() =>
      defineStoryboard([{id: 'a', from: 0, to: 10, bar: 1.5}]),
    );
  });
});

describe('oneTake', () => {
  const take = oneTake([
    {id: 'hook', durationInFrames: 90, title: 'Hook'},
    {id: 'title', durationInFrames: 120},
    {id: 'sources', durationInFrames: 180},
  ]);

  it('lays scenes end to end from their durations', () => {
    assert.deepEqual(
      take.scenes.map(s => [s.id, s.from, s.to]),
      [
        ['hook', 0, 90],
        ['title', 90, 210],
        ['sources', 210, 390],
      ],
    );
    assert.equal(take.durationInFrames, 390);
    assert.equal(take.scene('title').from, 90);
    assert.equal(take.scene('hook').title, 'Hook');
    assert.deepEqual(take.window('sources'), {
      from: 210,
      durationInFrames: 180,
      name: 'sources',
    });
  });

  it('is a storyboard of scenes off the bar grid', () => {
    assert.equal(take.scene('title').bar, null);
    assert.throws(() => take.sceneBar('title'), /does not start on a bar/);
    assert.deepEqual(
      take.checkStoryboard(() => 0),
      [],
    );
  });

  it('refuses fractional or empty durations and repeated ids', () => {
    assert.throws(() => oneTake([{id: 'a', durationInFrames: 0}]));
    assert.throws(() => oneTake([{id: 'a', durationInFrames: 1.5}]));
    assert.throws(() =>
      oneTake([
        {id: 'a', durationInFrames: 1},
        {id: 'a', durationInFrames: 1},
      ]),
    );
  });
});

describe('snapToEvent', () => {
  const hits = [100, 118, 121, 130];

  it('snaps to the nearest event within reach', () => {
    assert.equal(snapToEvent(120, hits, 2), 121);
    assert.equal(snapToEvent(101, hits, 2), 100);
  });

  it('breaks a tie toward the earlier event', () => {
    assert.equal(snapToEvent(119.5, hits, 2), 118);
    assert.equal(snapToEvent(119.5, [121, 118], 2), 118);
  });

  it('keeps the target when nothing is near', () => {
    assert.equal(snapToEvent(110, hits, 2), 110);
    assert.equal(snapToEvent(110, [], 50), 110);
  });
});

describe('events', () => {
  const hits = [10, 20, 40];

  it('measures time since and until events', () => {
    assert.equal(framesSince(hits, 25), 5);
    assert.equal(framesSince(hits, 20), 0);
    assert.equal(framesSince(hits, 5), Infinity);
    assert.equal(framesUntil(hits, 25), 15);
    assert.equal(framesUntil(hits, 40), Infinity);
  });

  it('finds the next and previous events', () => {
    assert.equal(nextEvent(hits, 20), 20);
    assert.equal(nextEvent(hits, 21), 40);
    assert.equal(nextEvent(hits, 41), null);
    assert.equal(prevEvent(hits, 39.5), 20);
    assert.equal(prevEvent(hits, 9), null);
  });

  it('decays a pulse to exactly zero', () => {
    assert.equal(decayPulse(0, 6), 1);
    assert.equal(decayPulse(3, 6), 0.25);
    assert.equal(decayPulse(6, 6), 0);
    assert.equal(decayPulse(-1, 6), 0);
    assert.equal(pulseAt(hits, 23, 6, 1), 0.5);
  });

  it('rises before an event', () => {
    assert.equal(anticipation(hits, 30, 10, 1), 0);
    assert.equal(anticipation(hits, 35, 10, 1), 0.5);
  });

  it('leads reveals onto their frames', () => {
    assert.deepEqual(landOn([10, 20], 3), [7, 17]);
  });
});
