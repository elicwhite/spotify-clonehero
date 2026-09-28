import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {beatGrid} from '../src/music/beatGrid';
import type {Beat, Segment} from '../src/music/contract';
import {makeTimeline} from '../src/music/make';
import {
  segmentIndexAt,
  segmentIndexOfSong,
  songTimeAt,
  videoTimeOfSong,
} from '../src/music/songTime';
import {tempoTimeline} from '../src/music/tempo';
import {TIMELINE_VERSION, timelineProblems} from '../src/music/validate';

const FPS = 60;

/** Beats of a steady 4/4 at `bpm`, starting at bar `firstBar` beat `firstBeat`. */
const steadyBeats = (
  bpm: number,
  count: number,
  {firstBar = 0, firstBeat = 0, t0 = 0} = {},
): Beat[] =>
  Array.from({length: count}, (_, k) => {
    const n = firstBeat + k;
    const t = t0 + (k * 60) / bpm;
    return {
      t,
      frame: Math.round(t * FPS),
      bar: firstBar + Math.floor(n / 4),
      beat: n % 4,
      downbeat: n % 4 === 0,
    };
  });

const tempo = (bpm: number) => ({
  bpm,
  beatSec: 60 / bpm,
  barSec: (4 * 60) / bpm,
});

describe('beatGrid', () => {
  // 120 BPM: a beat is 0.5 s = 30 frames, a bar 120 frames.
  const grid = beatGrid({
    fps: FPS,
    beats: steadyBeats(120, 16),
    tempo: tempo(120),
  });

  it('reads listed beats straight from the list', () => {
    assert.equal(grid.frameOfBeat(0), 0);
    assert.equal(grid.frameOfBeat(1), 120);
    assert.equal(grid.frameOfBeat(2, 3), 330);
    assert.equal(grid.timeOfBeat(3, 1), 6.5);
  });

  it('interpolates fractional beats', () => {
    assert.equal(grid.frameOfBeat(1, 0.5), 135);
    assert.equal(grid.exactFrameOfBeat(1, 0.25), 127.5);
  });

  it('counts past the end of a bar into the next', () => {
    assert.equal(grid.frameOfBeat(1, 4), grid.frameOfBeat(2));
  });

  it('extrapolates at the tempo past both ends of the list', () => {
    assert.equal(grid.frameOfBeat(4), 480);
    assert.equal(grid.frameOfBeat(6, 2), 780);
    assert.equal(grid.frameOfBeat(-1), -120);
  });

  it('follows a changing tempo inside the list', () => {
    const beats = [
      ...steadyBeats(120, 4),
      ...steadyBeats(60, 4, {firstBar: 1, t0: 2}),
    ];
    const g = beatGrid({fps: FPS, beats, tempo: tempo(120)});
    assert.equal(g.timeOfBeat(1, 1), 3);
    assert.equal(g.timeOfBeat(0, 3.5), 1.75);
    assert.equal(g.timeOfBeat(1, 3), 5);
  });

  it('places a list that starts mid-bar', () => {
    const g = beatGrid({
      fps: FPS,
      beats: steadyBeats(120, 6, {firstBeat: 2}),
      tempo: tempo(120),
    });
    // Bar 0's listed beats are 2 and 3; bar 1 starts one second in.
    assert.equal(g.timeOfBeat(0, 2), 0);
    assert.equal(g.timeOfBeat(1), 1);
    assert.equal(g.timeOfBeat(0), -1);
  });

  it('refuses a timeline without beats', () => {
    assert.throws(() => beatGrid({fps: FPS, beats: [], tempo: tempo(120)}));
  });

  it('finds the beat playing at a frame', () => {
    assert.equal(grid.beatAt(-1), null);
    assert.deepEqual(grid.beatAt(0), steadyBeats(120, 1)[0]);
    assert.equal(grid.beatAt(149)?.frame, 120);
    assert.equal(grid.beatAt(150)?.frame, 150);
    assert.equal(grid.beatAt(150)?.beat, 1);
    assert.equal(grid.beatAt(10_000)?.frame, 450);
  });
});

describe('songTime', () => {
  // Video 0-4 s plays song 10-14 s; video 4-6 s plays song 30-32 s.
  const segments: Segment[] = [
    {videoStart: 0, videoEnd: 4, songStart: 10, songEnd: 14},
    {videoStart: 4, videoEnd: 6, songStart: 30, songEnd: 32},
  ];

  it('finds the segment playing at a video time', () => {
    assert.equal(segmentIndexAt(0, segments), 0);
    assert.equal(segmentIndexAt(3.99, segments), 0);
    assert.equal(segmentIndexAt(4, segments), 1);
    assert.equal(segmentIndexAt(-1, segments), 0);
    assert.equal(segmentIndexAt(9, segments), 1);
  });

  it('maps video time to song time through the edit', () => {
    assert.equal(songTimeAt(1, segments), 11);
    assert.equal(songTimeAt(5, segments), 31);
  });

  it('pins a segment and extrapolates past its ends', () => {
    assert.equal(songTimeAt(5, segments, 0), 15);
    assert.equal(songTimeAt(3, segments, 1), 29);
  });

  it('inverts songTimeAt inside a segment', () => {
    for (const [video, index] of [
      [1.5, 0],
      [5.25, 1],
    ] as const) {
      const song = songTimeAt(video, segments, index);
      assert.equal(videoTimeOfSong(song, segments, index), video);
    }
  });

  it('finds the segment that plays a song second', () => {
    assert.equal(segmentIndexOfSong(10, segments), 0);
    assert.equal(segmentIndexOfSong(13.999, segments), 0);
    assert.equal(segmentIndexOfSong(31, segments), 1);
    assert.equal(segmentIndexOfSong(20, segments), null);
    assert.equal(segmentIndexOfSong(14, segments), null);
  });

  it('refuses an empty edit and a missing segment', () => {
    assert.throws(() => segmentIndexAt(0, []));
    assert.throws(() => songTimeAt(0, segments, 2));
    assert.throws(() => videoTimeOfSong(0, segments, -1));
  });
});

describe('tempoTimeline', () => {
  it('builds a valid timeline from a tempo', () => {
    const tl = tempoTimeline({bpm: 120, durationSec: 10, fps: 30});
    assert.deepEqual(timelineProblems(tl), []);
    assert.equal(tl.durationFrames, 300);
    assert.equal(tl.beats.length, 20);
    assert.equal(tl.bars.length, 5);
    assert.deepEqual(
      tl.beats.slice(0, 5).map(b => [b.frame, b.bar, b.beat, b.downbeat]),
      [
        [0, 0, 0, true],
        [15, 0, 1, false],
        [30, 0, 2, false],
        [45, 0, 3, false],
        [60, 1, 0, true],
      ],
    );
    assert.equal(tl.tempo.barSec, 2);
    assert.deepEqual(tl.segments, [
      {videoStart: 0, videoEnd: 10, songStart: 0, songEnd: 10},
    ]);
    assert.deepEqual(tl.hits, {kick: [], snare: [], crash: [], any: []});
  });

  it('starts the grid on the first beat and honours the meter', () => {
    const tl = tempoTimeline({
      bpm: 90,
      beatsPerBar: 3,
      durationSec: 8,
      fps: 60,
      firstBeatSec: 0.5,
      meta: {title: 'Test Bed', artist: 'Nobody'},
    });
    const grid = beatGrid(tl);
    assert.equal(grid.timeOfBeat(0), 0.5);
    assert.equal(grid.frameOfBeat(1), 30 + 120);
    assert.equal(tl.bars[1]?.t, 2.5);
    assert.equal(tl.meta.title, 'Test Bed');
    // No beat at or past the end.
    assert.ok((tl.beats.at(-1)?.t ?? Infinity) < 8);
  });

  it('keeps long grids on exact frames', () => {
    const tl = tempoTimeline({bpm: 120, durationSec: 600, fps: 60});
    assert.equal(tl.beats.at(-1)?.frame, 1199 * 30);
  });

  it('refuses impossible tempos', () => {
    assert.throws(() => tempoTimeline({bpm: 0, durationSec: 1, fps: 30}));
    assert.throws(() =>
      tempoTimeline({bpm: 120, beatsPerBar: 2.5, durationSec: 1, fps: 30}),
    );
    assert.throws(() =>
      tempoTimeline({bpm: 120, durationSec: 1, fps: 30, firstBeatSec: 1}),
    );
  });
});

describe('makeTimeline', () => {
  const parts = {
    fps: 30,
    durationSec: 4,
    meta: {title: 'Test Bed', artist: 'Nobody'},
    tempo: tempo(120),
    beats: [
      {t: 0.5, bar: 0, beat: 1, downbeat: false},
      {t: 0, bar: 0, beat: 0, downbeat: true},
    ],
    bars: [{t: 0, songBar: 12, section: 'verse'}],
  };

  it('places frames, sorts and fills the defaults', () => {
    const tl = makeTimeline(parts);
    assert.equal(tl.version, TIMELINE_VERSION);
    assert.equal(tl.durationFrames, 120);
    assert.deepEqual(
      tl.beats.map(b => [b.t, b.frame]),
      [
        [0, 0],
        [0.5, 15],
      ],
    );
    assert.deepEqual(tl.bars, [
      {t: 0, songBar: 12, section: 'verse', index: 0, frame: 0},
    ]);
    assert.deepEqual(tl.segments, [
      {videoStart: 0, videoEnd: 4, songStart: 0, songEnd: 4},
    ]);
    assert.deepEqual(tl.notes, {drums: [], guitar: []});
    assert.equal(tl.mix, undefined);
  });

  it('takes the hits from the audible drum notes', () => {
    const note = {
      tick: 0,
      cymbal: false,
      accent: false,
      doubleKick: false,
    } as const;
    const tl = makeTimeline({
      ...parts,
      drums: [
        {...note, t: 1, lane: 'kick', kit: 'kick', ghost: false},
        {...note, t: 1.5, lane: 'red', kit: 'snare', ghost: true},
        {...note, t: 2, lane: 'red', kit: 'snare', ghost: false},
        {...note, t: 2, lane: 'green', kit: 'crash', ghost: false},
      ],
    });
    assert.deepEqual(tl.hits, {kick: [1], snare: [2], crash: [2], any: [1, 2]});
    assert.deepEqual(
      tl.notes.drums.map(d => d.frame),
      [30, 45, 60, 60],
    );
  });

  it('refuses a timeline that breaks the contract', () => {
    assert.throws(() => makeTimeline({...parts, beats: []}), /no beats/);
  });
});

describe('timelineProblems', () => {
  it('names what a malformed timeline lacks', () => {
    const tl = tempoTimeline({bpm: 120, durationSec: 4, fps: 30});
    const {meta: _meta, ...withoutMeta} = tl;
    assert.deepEqual(timelineProblems({...withoutMeta, version: 1}), [
      'version is 1, expected 2',
      'missing meta.title',
      'missing meta.artist',
    ]);
    assert.deepEqual(timelineProblems(null), ['not an object']);
  });
});
