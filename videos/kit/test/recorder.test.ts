/**
 * The recorder's pure parts: a take checked against the film's edit (a
 * pinned one too), the real pointer as a cursor script, the manifest
 * helpers, and where a spec's take sits in a film (film-time.ts, spec.ts)
 * on a synthetic timeline.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {describe, it} from 'node:test';
import {defineStoryboard} from '../src/clock/storyboard';
import {tempoTimeline} from '../src/music/tempo';
import {songTimeAt} from '../src/music/songTime';
import {recordedCursorPath} from '../src/recorder/frameData';
import {
  recordedFrameAt,
  type RecordedFrame,
  type RecordingManifest,
} from '../src/recorder/manifest';
import {assertTakeMatchesEdit} from '../src/recorder/takeCheck';
import {loadTimeline} from '../scripts/recorder/film-time';
import {overComponent, songTimeRanges} from '../scripts/recorder/manifest';
import {takeFrames} from '../scripts/recorder/spec';

const FPS = 60;

/** The film's edit: film 0-3 s plays song 10-13 s, then a splice to song 40 s. */
const EDIT = [
  {videoStart: 0, videoEnd: 3, songStart: 10, songEnd: 13},
  {videoStart: 3, videoEnd: 6, songStart: 40, songEnd: 43},
];
const songAt = (segments: typeof EDIT) => (f: number) => {
  const segment = segments.findIndex(s => f / FPS < s.videoEnd);
  const i = segment < 0 ? segments.length - 1 : segment;
  return {songSec: songTimeAt(f / FPS, segments, i), segment: i, pinned: false};
};
/** A take pinned to one segment: its mapping carried on past the segment's ends. */
const pinnedTo = (segments: typeof EDIT, segment: number) => (f: number) => ({
  songSec: songTimeAt(f / FPS, segments, segment),
  segment,
  pinned: true,
});

const take = (
  frames: RecordedFrame[],
  extra: Partial<RecordingManifest> = {},
): RecordingManifest => ({
  version: 1,
  id: 'test-take',
  app: 'web',
  description: '',
  fps: FPS,
  viewport: {width: 1920, height: 1080, deviceScaleFactor: 2},
  range: {
    from: frames[0]?.f ?? 0,
    to: frames[frames.length - 1]?.f ?? 0,
    count: frames.length,
  },
  components: {},
  interactions: [],
  frames,
  encoding: null,
  pageErrors: [],
  recordedAt: '2026-01-01T00:00:00.000Z',
  ...extra,
});

const parked = (f: number): RecordedFrame => ({
  f,
  cursor: {x: 1916, y: 1076, down: false, visible: false, over: null},
});
const at = (
  f: number,
  x: number,
  y: number,
  events?: string[],
  down = false,
): RecordedFrame => ({
  f,
  cursor: {x, y, down, visible: true, over: 'window', events},
});

describe('assertTakeMatchesEdit', () => {
  const frames = Array.from({length: 120}, (_, i) => parked(120 + i));
  const recorded = take(frames, {
    songTime: songTimeRanges(songAt(EDIT), 120, 239, FPS),
  });

  it('passes a take recorded for this edit, across the splice', () => {
    assert.equal(recorded.songTime?.ranges.length, 2);
    assert.doesNotThrow(() =>
      assertTakeMatchesEdit(recorded, EDIT, {from: 150, to: 230}),
    );
  });

  it('fails a take recorded for another edit, naming the frame and both times', () => {
    const moved = EDIT.map((s, i) => (i === 1 ? {...s, songStart: 40.1} : s));
    assert.throws(
      () =>
        assertTakeMatchesEdit(
          recorded,
          moved,
          {from: 150, to: 231},
          'record.mjs --spec x',
        ),
      /test-take was recorded for another edit of the music: at film frame 180 it shows song 40\.000 s, where the film plays 40\.100 s.*Re-record it: record\.mjs --spec x/,
    );
  });

  it('checks a take pinned past a splice against its own segment', () => {
    const pinned = take(frames, {
      id: 'pinned-take',
      songTime: songTimeRanges(pinnedTo(EDIT, 0), 120, 239, FPS),
    });
    assert.deepEqual(
      pinned.songTime?.ranges.map(r => [r.segment, r.pinned, r.fromFrame]),
      [[0, true, 120]],
    );
    // Past the splice at frame 180 the take plays song 13 s on, where the
    // edit has cut to song 40 s: right for a pinned take.
    assert.doesNotThrow(() =>
      assertTakeMatchesEdit(pinned, EDIT, {from: 150, to: 231}),
    );
    const moved = EDIT.map((s, i) => (i === 0 ? {...s, songStart: 10.5} : s));
    assert.throws(
      () => assertTakeMatchesEdit(pinned, moved, {from: 150, to: 231}),
      /at film frame 150 it shows song 12\.500 s, where the film plays 13\.000 s/,
    );
    const late = take(frames, {
      id: 'pinned-late-take',
      songTime: songTimeRanges(pinnedTo(EDIT, 1), 120, 239, FPS),
    });
    assert.throws(
      () => assertTakeMatchesEdit(late, EDIT.slice(0, 1), {from: 150, to: 231}),
      /pinned-late-take was recorded pinned to segment 1 of the music's edit, which the edit no longer has/,
    );
    // Checked as if it followed the edit, it would fail at the splice.
    const unpinned = take(frames, {
      id: 'unpinned-take',
      songTime: songTimeRanges(
        f => ({...pinnedTo(EDIT, 0)(f), pinned: false}),
        120,
        239,
        FPS,
      ),
    });
    assert.throws(
      () => assertTakeMatchesEdit(unpinned, EDIT, {from: 150, to: 231}),
      /at film frame 180 it shows song 13\.000 s, where the film plays 40\.000 s/,
    );
  });

  it('checks only the frames the scene shows, and nothing for a take without song times', () => {
    const moved = EDIT.map((s, i) => (i === 1 ? {...s, songStart: 40.1} : s));
    assert.doesNotThrow(() =>
      assertTakeMatchesEdit(recorded, moved, {from: 120, to: 180}),
    );
    assert.doesNotThrow(() =>
      assertTakeMatchesEdit(take(frames), moved, {from: 0, to: 1000}),
    );
  });
});

describe('recordedCursorPath', () => {
  const frames = [
    parked(0),
    at(1, 100, 100),
    at(2, 110, 100),
    at(3, 110, 100, ['press'], true),
    at(4, 110, 100, [], true),
    at(5, 110, 100, ['release']),
    parked(6),
    parked(7),
    at(8, 400, 300),
    at(9, 400, 300, ['press'], true),
    ...Array.from({length: 10}, (_, i) =>
      at(10 + i, 400 + 10 * i, 300, [], true),
    ),
    at(20, 500, 300, ['release']),
    parked(21),
  ];
  const script = recordedCursorPath(take(frames));

  it('records every time the pointer appears and hides', () => {
    assert.deepEqual(script.visible, [
      {appearAt: 1, hideAt: 6},
      {appearAt: 8, hideAt: 21},
    ]);
  });

  it('keys only the frames the pointer moved, linear and without an arc', () => {
    assert.deepEqual(
      script.path.map(k => [k.at, k.x, k.y, k.arc]),
      [
        [1, 100, 100, 0],
        [2, 110, 100, 0],
        [8, 400, 300, 0],
        // Frames 9 and 10 hold the pointer still: no keys.
        ...Array.from({length: 9}, (_, i) => [11 + i, 410 + 10 * i, 300, 0]),
        [20, 500, 300, 0],
      ],
    );
    assert.equal(script.path[0]?.ease?.(0.25), 0.25);
  });

  it('tells short presses (clicks) from long ones (drags), within the asked frames', () => {
    assert.deepEqual(script.clicks, [3]);
    assert.deepEqual(script.drags, [[9, 20]]);
    const early = recordedCursorPath(take(frames), {to: 7});
    assert.deepEqual(
      [early.clicks, early.drags, early.visible],
      [[3], [], [{appearAt: 1, hideAt: 6}]],
    );
  });

  it('clamps a film frame into the take', () => {
    const t = take(frames);
    assert.equal(recordedFrameAt(t, -40).f, 0);
    assert.equal(recordedFrameAt(t, 8.4).f, 8);
    assert.equal(recordedFrameAt(t, 900).f, 21);
  });
});

describe('the recorder scripts', () => {
  it('names the smallest component under the pointer', () => {
    const boxes = {
      window: {x: 0, y: 0, width: 1920, height: 1080},
      panel: {x: 100, y: 100, width: 800, height: 600},
      button: {x: 200, y: 200, width: 100, height: 40},
    };
    assert.equal(overComponent({x: 210, y: 210}, boxes), 'button');
    assert.equal(overComponent({x: 150, y: 150}, boxes), 'panel');
    assert.equal(overComponent({x: 1500, y: 900}, boxes), 'window');
  });

  it('places a take in its scene, with handles, from a film timeline and storyboard', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-recorder-test-'));
    const file = path.join(dir, 'timeline.json');
    fs.writeFileSync(
      file,
      JSON.stringify(tempoTimeline({bpm: 120, durationSec: 20, fps: FPS})),
    );
    // A bar is 2 s: 120 frames.
    const storyboard = defineStoryboard([
      {id: 'intro', from: 0, to: 240, bar: 0},
      {id: 'demo', from: 240, to: 480, bar: 2},
    ]);
    // Half a second of handle: 30 frames.
    const tl = loadTimeline(file, {storyboard, handleSec: 0.5});
    const placed = tl.place({id: 'demo-take', scene: 'demo'});
    assert.deepEqual(
      [placed.from, placed.to, placed.beat(1), placed.beat(0, 2)],
      [210, 509, 360, 300],
    );
    assert.equal(tl.place({id: 'x', scene: 'demo', window: {bars: 1}}).to, 360);
    assert.equal(tl.place({id: 'x', scene: 'demo', window: {tail: 5}}).to, 484);
    assert.doesNotThrow(() => tl.place({id: 'x', scene: 'demo', songBar: 2}));
    assert.throws(
      () => tl.place({id: 'x', scene: 'demo', songBar: 5}),
      /made for demo opening on song bar 5, but the edit plays song bar 2/,
    );
    const frames = takeFrames(
      {id: 'x', description: '', scene: 'demo'},
      {tl, preroll: 90},
    );
    assert.deepEqual(
      [frames.start, frames.from, frames.to, frames.beat?.(1)],
      [120, 210, 509, 360],
    );
    fs.rmSync(dir, {recursive: true, force: true});
  });

  it('takes explicit frames, and part of a take for tests', () => {
    const spec = {id: 'x', description: '', frames: {from: 0, to: 44}};
    assert.deepEqual(takeFrames(spec, {preroll: 10}), {
      start: -10,
      from: 0,
      to: 44,
      beat: null,
    });
    assert.deepEqual(takeFrames(spec, {preroll: 10, override: [5, 9]}), {
      start: -5,
      from: 5,
      to: 9,
      beat: null,
    });
    assert.throws(
      () => takeFrames({id: 'x', description: ''}, {preroll: 0}),
      /needs `frames` or `scene`/,
    );
  });
});
