/**
 * The soundtrack config: song-bar ranges must add up to the film, the config
 * is checked before any audio is read, and automation lanes resolve to gain
 * breakpoints on the film's beat grid. Also the chart helper that finds the
 * last note of a chart of any size without spreading into Math.max.
 */
import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {lastNoteTick} from '../scripts/audio/chart';
import {SILENCE_DB} from '../scripts/audio/edit';
import {
  assertSoundtrackConfig,
  editSegments,
  lanePoints,
  type SoundtrackConfig,
} from '../scripts/audio/soundtrackConfig';

/** Song bars of 2 s each (120 BPM, 4/4), as a chart parse gives them. */
const BARS = Array.from({length: 48}, (_, i) => ({t: 2 * i}));

describe('editSegments (the bar-sum check)', () => {
  it('lays the ranges end to end from video time 0', () => {
    const segs = editSegments(
      BARS,
      [
        [2, 5],
        [12, 15],
        [30, 31],
      ],
      20,
      30,
    );
    assert.deepEqual(
      segs.map(s => [
        s.videoStart,
        s.videoEnd,
        s.songStart,
        s.songEnd,
        s.firstBar,
        s.lastBar,
      ]),
      [
        [0, 8, 4, 12, 2, 5],
        [8, 16, 24, 32, 12, 15],
        [16, 20, 60, 64, 30, 31],
      ],
    );
  });

  it('rejects ranges that do not add up to the film', () => {
    assert.throws(
      () =>
        editSegments(
          BARS,
          [
            [2, 5],
            [12, 15],
          ],
          20,
          30,
        ),
      /last 16\.000000 s, but durationSec is 20.*short/s,
    );
    assert.throws(() => editSegments(BARS, [[2, 12]], 20, 30), /over/);
  });

  it('ends the last segment on the film end, within a frame of its bar line', () => {
    // 133 BPM: no whole number of 4/4 bars is a whole number of 60 fps frames.
    const bar = (4 * 60) / 133;
    const bars = Array.from({length: 40}, (_, i) => ({t: i * bar}));
    const frames = Math.round(8 * bar * 60);
    const segs = editSegments(
      bars,
      [
        [2, 5],
        [20, 23],
      ],
      frames / 60,
      60,
    );
    const last = segs[1]!;
    assert.equal(last.videoEnd, frames / 60);
    assert.ok(
      Math.abs(
        last.songEnd - last.songStart - (last.videoEnd - last.videoStart),
      ) < 1e-12,
    );
    assert.ok(Math.abs(last.songEnd - bars[24]!.t) < 1 / 60);
    assert.throws(
      () =>
        editSegments(
          bars,
          [
            [2, 5],
            [20, 23],
          ],
          (frames + 2) / 60,
          60,
        ),
      /within a frame/,
    );
  });

  it('rejects malformed and out-of-chart ranges', () => {
    assert.throws(() => editSegments(BARS, [], 20, 30), /empty/);
    assert.throws(() => editSegments(BARS, [[5, 2]], 20, 30), /first <= last/);
    assert.throws(
      () => editSegments(BARS, [[1.5, 3]], 20, 30),
      /whole bar numbers/,
    );
    assert.throws(
      () => editSegments(BARS, [[40, 47]], 16, 30),
      /outside the chart/,
    );
  });
});

const base: SoundtrackConfig = {
  durationSec: 20,
  fps: 30,
  stems: ['drums', 'bass', {name: 'keys', files: ['keys_1', 'keys_2']}],
  songBars: [[0, 9]],
  crossfade: {
    default: {
      lengthSec: 0.03,
      guardSec: 0.004,
      lookbackSec: 0.03,
      marginSec: 0.005,
    },
  },
  tail: {
    send: [8, 2],
    sendRampSec: 0.01,
    rt60Sec: 3,
    wetDb: -8,
    preDelaySec: 0.015,
    brightHz: 7000,
    darkHz: 900,
    darkenSec: 1.5,
    lowCutHz: 120,
    dryFade: {from: [9, 0], to: [9, 2]},
    seed: 1,
  },
  startFadeSec: 0.01,
  finalFadeSec: 0.2,
  master: {lufs: -14, ceilingDbtp: -1},
};

/** The message of the error `f` throws. */
const thrown = (f: () => void): string => {
  try {
    f();
  } catch (err) {
    return (err as Error).message;
  }
  assert.fail('expected it to throw');
};

describe('assertSoundtrackConfig', () => {
  it('passes a well-formed config', () => {
    assert.doesNotThrow(() => assertSoundtrackConfig(base));
  });

  it('names every problem at once', () => {
    const message = thrown(() =>
      assertSoundtrackConfig({
        ...base,
        durationSec: 20.01,
        stems: ['drums', 'drums', 'mix'],
        drumStem: 'kit',
        lanes: [
          {
            kind: 'ramp',
            stems: ['vox'],
            gainDb: -6,
            from: 1,
            to: [3, 0.5],
            rampIn: {beats: 1},
            rampOut: {sec: 0.1},
          },
          {
            kind: 'mute',
            stems: ['bass'],
            edges: [{at: 4, mute: false}],
            muteFadeSec: 0.02,
            unmuteFadeSec: 0.05,
          },
        ],
      }),
    );
    for (const re of [
      /not a whole number of frames/,
      /stem names repeat/,
      /"mix" is reserved/,
      /drumStem names "kit"/,
      /names "vox"/,
      /unmutes a stem that already is/,
    ]) {
      assert.match(message, re);
    }
    // A stem that is neither a name nor {name, files} is named, not a TypeError later.
    for (const [stems, bad] of [
      [[null], 0],
      [[['drums']], 0],
      [['drums', null], 1],
    ] as const) {
      assert.match(
        thrown(() => assertSoundtrackConfig({...base, stems})),
        new RegExp(`stems\\[${bad}\\] must be a name or \\{name, files\\}`),
      );
    }
  });

  it('refuses values that would turn into NaN and silence', () => {
    const message = thrown(() =>
      assertSoundtrackConfig({
        ...base,
        crossfade: {
          default: {
            lengthSec: 0,
            guardSec: -1,
            lookbackSec: 0.03,
            marginSec: NaN,
          },
        },
        tail: {...base.tail!, rt60Sec: 0, darkenSec: -1},
      }),
    );
    for (const re of [
      /crossfade.default.lengthSec must be above 0/,
      /crossfade.default.guardSec must be at least 0/,
      /crossfade.default.marginSec must be a number/,
      /tail.rt60Sec must be above 0/,
      /tail.darkenSec must be above 0/,
    ]) {
      assert.match(message, re);
    }
  });

  it('narrows a value that arrives untyped', () => {
    const value: unknown = JSON.parse(JSON.stringify(base));
    assertSoundtrackConfig(value);
    assert.equal(value.fps, 30);
    assert.throws(() => assertSoundtrackConfig('config'), /must be an object/);
  });
});

describe('lanePoints', () => {
  // 2 s bars, 0.5 s beats.
  const timeOfBeat = (bar: number, beat = 0) => bar * 2 + beat * 0.5;

  it('ramps into and out of a gain, spans in beats or seconds', () => {
    const points = lanePoints(
      {
        kind: 'ramp',
        stems: ['bass'],
        gainDb: -7,
        from: 1,
        to: [3, 2],
        rampIn: {beats: 1},
        rampOut: {sec: 0.1},
      },
      timeOfBeat,
    );
    assert.deepEqual(points, [
      {atSec: 1.5, gainDb: 0},
      {atSec: 2, gainDb: -7},
      {atSec: 6.9, gainDb: -7},
      {atSec: 7, gainDb: 0},
    ]);
  });

  it('fades out into each mute edge and back in before each unmute edge', () => {
    const points = lanePoints(
      {
        kind: 'mute',
        stems: ['vocals'],
        edges: [
          {at: 2, mute: true},
          {at: [4, 2], mute: false},
        ],
        muteFadeSec: 0.025,
        unmuteFadeSec: 0.05,
      },
      timeOfBeat,
    );
    assert.deepEqual(points, [
      {atSec: 4 - 0.025, gainDb: 0},
      {atSec: 4, gainDb: SILENCE_DB},
      {atSec: 9 - 0.05, gainDb: SILENCE_DB},
      {atSec: 9, gainDb: 0},
    ]);
  });

  it('rejects mute edges out of film order, or with no room for a fade', () => {
    const lane = (edges: {at: number; mute: boolean}[]) => ({
      kind: 'mute' as const,
      stems: ['vocals'],
      edges,
      muteFadeSec: 0.025,
      unmuteFadeSec: 0.05,
    });
    assert.throws(
      () =>
        lanePoints(
          lane([
            {at: 4, mute: true},
            {at: 2, mute: false},
          ]),
          timeOfBeat,
        ),
      /runs backwards/,
    );
    assert.throws(
      () =>
        lanePoints(
          lane([
            {at: 2, mute: true},
            {at: 2, mute: false},
          ]),
          timeOfBeat,
        ),
      /runs backwards/,
    );
  });

  it('rejects a ramp whose ramps overlap', () => {
    assert.throws(
      () =>
        lanePoints(
          {
            kind: 'ramp',
            stems: ['bass'],
            gainDb: -3,
            from: 1,
            to: [1, 1],
            rampIn: {beats: 1},
            rampOut: {beats: 2},
          },
          timeOfBeat,
        ),
      /runs backwards/,
    );
  });
});

describe('lastNoteTick', () => {
  it('handles a chart with very many notes (no Math.max spread)', () => {
    const groups = Array.from({length: 400_000}, (_, i) => [
      {tick: i * 48, length: 0},
      {tick: i * 48, length: i === 123 ? 30_000_000 : 24},
    ]);
    // What the spread did with this many groups:
    assert.throws(() => Math.max(...groups.map(g => g[0]!.tick)), RangeError);
    assert.equal(
      lastNoteTick([{noteEventGroups: groups}]),
      123 * 48 + 30_000_000,
    );
    assert.equal(lastNoteTick([{noteEventGroups: []}]), 0);
  });
});
