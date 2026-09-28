/**
 * The highway's pure parts: the floor model, the screen move, which song
 * second a frame shows and the karaoke replay that reaches it, the pixel
 * checks the smoke test is built on, and the invented test chart (as
 * scan-chart parses it).
 */
import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {noteTypes, parseChartAndIni} from '@eliwhite/scan-chart';
import {STRIKELINE_WORLD_Y} from '../../../spotify-clonehero-next/lib/preview/highway/cameraFit';
import {
  FLOOR_FAR_Y,
  floorCorners,
  HIGHWAY_SPEED,
  highwayInstrumentOf,
  noteWorldY,
  STRIKELINE_Y,
} from '../src/highway/floor';
import {
  drawReplayed,
  type Karaoke,
  type Replay,
} from '../src/highway/karaokeReplay';
import {moveQuad} from '../src/highway/screenMove';
import {differenceOf, litFraction} from '../src/highway/smokeCheck';
import {
  songPositionAt,
  type SongPositionInput,
} from '../src/highway/songPosition';
import {
  TEST_CHART_RESOLUTION,
  TEST_PROBE_NOTE,
  testChartFiles,
  testChartSeconds,
} from '../src/highway/testChart';

const near = (a: number, b: number, eps = 1e-6) =>
  assert.ok(Math.abs(a - b) <= eps, `${a} is not within ${eps} of ${b}`);

describe('the floor', () => {
  it('puts a note on the strikeline at its own time and moves it at HIGHWAY_SPEED', () => {
    assert.equal(STRIKELINE_Y, STRIKELINE_WORLD_Y);
    near(noteWorldY(12.5, 12.5), STRIKELINE_Y);
    near(noteWorldY(13.5, 12.5) - noteWorldY(12.5, 12.5), HIGHWAY_SPEED);
  });

  it('lists its corners far-left, far-right, near-right, near-left', () => {
    const [fl, fr, nr, nl] = floorCorners('drums');
    assert.deepEqual(
      [fl.X < 0, fr.X > 0, nr.X > 0, nl.X < 0],
      [true, true, true, true],
    );
    assert.equal(fl.Y, FLOOR_FAR_Y);
    assert.ok(nr.Y < STRIKELINE_Y);
  });

  it('draws drums on the drum floor and every other instrument on the five-fret one', () => {
    assert.equal(highwayInstrumentOf({instrument: 'drums'}), 'drums');
    for (const instrument of ['guitar', 'bass', 'keys', 'rhythm'])
      assert.equal(highwayInstrumentOf({instrument}), 'guitar');
  });
});

describe('moveQuad', () => {
  it('scales and turns about the origin, then translates', () => {
    const square = [
      {x: 110, y: 100},
      {x: 120, y: 100},
      {x: 120, y: 110},
      {x: 110, y: 110},
    ] as const;
    const turned = moveQuad(
      {scale: 2, rotate: 90, origin: {x: 100, y: 100}, x: 10, y: 0},
      square,
    );
    // (110, 100) is 10 px right of the origin: doubled and turned a quarter
    // clockwise on screen it is 20 px below it, then moved 10 px right.
    near(turned[0].x, 110);
    near(turned[0].y, 120);
    near(turned[2].x, 90);
    near(turned[2].y, 140);
    const moved = moveQuad(
      {scale: 1, rotate: 0, origin: {x: 0, y: 0}, x: 5, y: -5},
      square,
    );
    assert.deepEqual(moved[2], {x: 125, y: 105});
  });
});

describe('songPositionAt', () => {
  const segments = [
    {videoStart: 0, videoEnd: 2, songStart: 30, songEnd: 32},
    {videoStart: 2, videoEnd: 4, songStart: 80, songEnd: 82},
  ];

  it('plays film time through the edit, from the first frame of the segment', () => {
    assert.deepEqual(songPositionAt({frame: 60, fps: 60, segments}), {
      songSec: 31,
      playback: {fromFrame: 0},
    });
    assert.deepEqual(songPositionAt({frame: 150, fps: 60, segments}), {
      songSec: 80.5,
      playback: {fromFrame: 120},
    });
  });

  it('keeps one segment across a cut when pinned, a frame before its cut a seek', () => {
    assert.deepEqual(
      songPositionAt({frame: 150, fps: 60, segments, segmentIndex: 0}),
      {songSec: 32.5, playback: {fromFrame: 0}},
    );
    assert.deepEqual(
      songPositionAt({frame: 100, fps: 60, segments, segmentIndex: 1}),
      {songSec: 79.66666666666667, playback: {fromFrame: 100}},
    );
  });

  it('starts playback at the frame that plays playbackFromSec', () => {
    assert.deepEqual(
      songPositionAt({frame: 150, fps: 60, segments, playbackFromSec: 80.25}),
      {songSec: 80.5, playback: {fromFrame: 135}},
    );
    assert.deepEqual(songPositionAt({frame: 45, fps: 30, playbackFromSec: 1}), {
      songSec: 1.5,
      playback: {fromFrame: 30},
    });
  });

  it('plays film time from frame 0 without an edit, and seeks to an explicit time', () => {
    assert.deepEqual(songPositionAt({frame: 45, fps: 30}), {
      songSec: 1.5,
      playback: {fromFrame: 0},
    });
    assert.deepEqual(songPositionAt({frame: 9, fps: 30, songTimeSec: 4.25}), {
      songSec: 4.25,
      playback: {fromSec: 4.25},
    });
  });
});

describe('drawReplayed', () => {
  const LINES: Karaoke = {
    lyrics: [{msTime: 1000, text: 'la'}],
    phrases: [{msTime: 1000, msLength: 500}],
  };
  const NONE: Karaoke = {lyrics: [], phrases: []};
  const segments = [
    {videoStart: 0, videoEnd: 2, songStart: 30, songEnd: 32},
    {videoStart: 2, videoEnd: 4, songStart: 80, songEnd: 82},
  ];

  /** A stage that records what it was asked to do. */
  const recorder = () => {
    const log: string[] = [];
    return {
      log,
      target: {
        setKaraoke: (k: Karaoke) => log.push(`lines ${k.lyrics.length}`),
        draw: (sec: number) => log.push(sec.toFixed(4)),
      },
    };
  };
  const run = (
    frames: readonly number[],
    input: Omit<SongPositionInput, 'frame'>,
    karaoke = LINES,
  ) => {
    const {log, target} = recorder();
    let replay: Replay | null = null;
    for (const frame of frames) {
      log.push(`frame ${frame}`);
      replay = drawReplayed(
        target,
        'stage',
        karaoke,
        {...input, frame},
        replay,
      ).replay;
    }
    return log;
  };

  it("replays the segment's film frames up to the first frame drawn, then only the new ones", () => {
    const log = run([123, 124, 126], {fps: 60, segments});
    assert.deepEqual(log, [
      'frame 123',
      'lines 1',
      '80.0000',
      '80.0167',
      '80.0333',
      '80.0500',
      'frame 124',
      '80.0667',
      'frame 126',
      '80.0833',
      '80.1000',
    ]);
  });

  it('replays a segment that starts off the frame grid from its first whole frame, each frame at its own song time', () => {
    // The cut to the second segment falls between frames 120 and 121, and
    // plays song 80.004 s there: neither is on the 60 fps grid.
    const offGrid = [
      {videoStart: 0, videoEnd: 2.0083, songStart: 30, songEnd: 32.0083},
      {videoStart: 2.0083, videoEnd: 4, songStart: 80.004, songEnd: 81.9957},
    ];
    const songOf = (frame: number) => (80.004 + frame / 60 - 2.0083).toFixed(4);
    assert.deepEqual(
      songPositionAt({frame: 123, fps: 60, segments: offGrid}).playback,
      {fromFrame: 121},
    );
    assert.deepEqual(run([123, 124], {fps: 60, segments: offGrid}), [
      'frame 123',
      'lines 1',
      songOf(121),
      songOf(122),
      songOf(123),
      'frame 124',
      songOf(124),
    ]);
    // Frame 120 still plays the first segment, from film frame 0.
    assert.equal(
      run([120], {fps: 60, segments: offGrid}).filter(l => /^\d/.test(l))
        .length,
      121,
    );
  });

  it('starts again from the segment start when frames go back', () => {
    const log = run([122, 121], {fps: 60, segments});
    assert.deepEqual(log, [
      'frame 122',
      'lines 1',
      '80.0000',
      '80.0167',
      '80.0333',
      'frame 121',
      'lines 1',
      '80.0000',
      '80.0167',
    ]);
  });

  it('replays nothing without karaoke lines', () => {
    const log = run([130, 131], {fps: 60, segments}, NONE);
    assert.deepEqual(log, [
      'frame 130',
      'lines 0',
      '80.1667',
      'frame 131',
      '80.1833',
    ]);
  });

  it('replays an explicit time on the song-second grid, and seeks to a time off it', () => {
    assert.deepEqual(
      run([0], {fps: 10, songTimeSec: 5.2, playbackFromSec: 5}),
      ['frame 0', 'lines 1', '5.0000', '5.1000', '5.2000'],
    );
    assert.deepEqual(
      run([0, 1], {fps: 10, songTimeSec: 5.25, playbackFromSec: 5}),
      ['frame 0', 'lines 1', '5.2500', 'frame 1', 'lines 1', '5.2500'],
    );
  });
});

/** A width x height picture from a function of the pixel. */
const picture = (
  width: number,
  height: number,
  rgb: (x: number, y: number) => number[],
) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      data.set([...rgb(x, y), 255], (y * width + x) * 4);
  return {data, width, height, colorSpace: 'srgb'} as unknown as ImageData;
};

describe('the smoke pixel checks', () => {
  it('measures how much of a frame is lit', () => {
    const half = picture(10, 10, x => (x < 5 ? [0, 0, 0] : [200, 40, 40]));
    near(litFraction(half), 0.5);
  });

  it('finds where two pictures differ', () => {
    const base = picture(20, 20, () => [10, 10, 10]);
    const dot = picture(20, 20, (x, y) =>
      x >= 12 && x < 16 && y >= 4 && y < 8 ? [250, 20, 20] : [10, 10, 10],
    );
    assert.deepEqual(differenceOf(dot, base), {x: 13.5, y: 5.5, count: 16});
    assert.equal(differenceOf(base, base), null);
  });
});

describe('the test chart', () => {
  const parsed = parseChartAndIni(testChartFiles()).parsedChart;
  const drums = parsed?.trackData.find(
    t => t.instrument === 'drums' && t.difficulty === 'expert',
  );

  it('parses as a 120 BPM chart with drums, guitar and sung phrases', () => {
    assert.ok(parsed && drums);
    assert.equal(parsed.resolution, TEST_CHART_RESOLUTION);
    assert.ok(
      parsed.trackData.some(
        t => t.instrument === 'guitar' && t.difficulty === 'expert',
      ),
    );
    const phrases = parsed.vocalTracks?.parts?.['vocals']?.notePhrases ?? [];
    assert.equal(phrases.length, 7);
    assert.ok(phrases.every(p => p.lyrics.length === 4));
  });

  it('has its probe snare alone in the red lane at 4.5 s', () => {
    const notes = (drums?.noteEventGroups ?? [])
      .flat()
      .filter(n => n.tick === TEST_PROBE_NOTE.tick);
    const red = notes.filter(n => n.type === noteTypes.redDrum);
    assert.equal(red.length, 1);
    near((red[0]?.msTime ?? 0) / 1000, testChartSeconds(TEST_PROBE_NOTE.tick));
    near(testChartSeconds(TEST_PROBE_NOTE.tick), 4.5);
  });
});
