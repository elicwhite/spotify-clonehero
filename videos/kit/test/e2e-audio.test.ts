/**
 * The audio tools end to end, on the synthetic chart folder
 * (test/fixtures/synthetic-song.ts): a soundtrack edit of it, the highway
 * sync check and the logo sting's events against the timeline it writes, a
 * loop bed from one steady loop, and an SFX mix over that bed. Needs ffmpeg;
 * everything is written to a scratch folder that is deleted afterwards.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {after, before, describe, it} from 'node:test';
import {buildTimelineApi} from '../src/music/api';
import type {Timeline} from '../src/music/contract';
import {timelineProblems} from '../src/music/validate';
import {stingEvents} from '../blender/stingEvents';
import {buildLoopBed, type Arrangement} from '../scripts/audio/loopBed';
import {
  SAMPLE_RATE,
  allocStereo,
  readWav,
  writeWav,
} from '../scripts/audio/pcm';
import {buildSfxMix} from '../scripts/audio/sfx';
import {
  buildSoundtrack,
  soundtrackFiles,
  type SoundtrackResult,
} from '../scripts/audio/soundtrack';
import type {SoundtrackConfig} from '../scripts/audio/soundtrackConfig';
import {chartTickTimes, checkSync} from '../scripts/qa/highwaySync';
import {writeSyntheticSong} from './fixtures/synthetic-song';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-e2e-audio-'));
after(() => fs.rmSync(dir, {recursive: true, force: true}));

const FPS = 30;
const STEMS = ['drums', 'bass', 'guitar', 'rhythm', 'vocals'];

/**
 * 32 bars at 120 BPM (2 s a bar); the film plays song bars 2-5, 12-15 and
 * 26-27, 20 s, with a duck, a vocal mute and lift, and a ring-out.
 */
const config: SoundtrackConfig = {
  durationSec: 20,
  fps: FPS,
  stems: STEMS,
  drumStem: 'drums',
  vocalStem: 'vocals',
  songBars: [
    [2, 5],
    [12, 15],
    [26, 27],
  ],
  crossfade: {
    default: {
      lengthSec: 0.03,
      guardSec: 0.004,
      lookbackSec: 0.03,
      marginSec: 0.005,
    },
    stems: {
      drums: {
        lengthSec: 0.02,
        guardSec: 0.004,
        lookbackSec: 0.03,
        marginSec: 0.005,
      },
    },
  },
  lanes: [
    {
      kind: 'ramp',
      stems: ['bass', 'guitar', 'rhythm'],
      gainDb: -7,
      from: 1,
      to: 3,
      rampIn: {beats: 1},
      rampOut: {beats: 1},
    },
    {
      kind: 'mute',
      stems: ['vocals'],
      edges: [
        {at: [6, 0], mute: true},
        {at: [8, 0], mute: false},
      ],
      muteFadeSec: 0.025,
      unmuteFadeSec: 0.05,
    },
    {
      kind: 'ramp',
      stems: ['vocals'],
      gainDb: 2,
      from: 4,
      to: 6,
      rampIn: {sec: 0.05},
      rampOut: {beats: 1},
    },
  ],
  tail: {
    send: [8, 2.25],
    sendRampSec: 0.01,
    rt60Sec: 6.5,
    wetDb: -8,
    preDelaySec: 0.015,
    brightHz: 7000,
    darkHz: 900,
    darkenSec: 1.5,
    lowCutHz: 120,
    dryFade: {from: [9, 1], to: [9, 3]},
    seed: 1,
  },
  startFadeSec: 0.01,
  finalFadeSec: 0.2,
  master: {lufs: -14, ceilingDbtp: -1},
};

describe('a soundtrack from a chart folder', () => {
  const song = writeSyntheticSong(path.join(dir, 'song'), 32, 120);
  const out = path.join(dir, 'generated');
  let result: SoundtrackResult;
  before(() => {
    result = buildSoundtrack(config, {chart: song.folder, out});
  });

  it('passes every check, with no drum hit moved by a sample', () => {
    assert.deepEqual(result.problems, []);
    const drums = result.report.drums;
    assert.ok(drums, 'the drum checks ran');
    assert.ok(drums.editLag.notes > 0, 'drum hits were compared');
    assert.equal(drums.editLag.maxAbsLagSamples, 0);
    assert.ok(Math.abs(result.report.loudness.ffmpeg.lufs + 14) <= 0.5);
  });

  it('writes every file, and a timeline that keeps the contract', () => {
    const files = soundtrackFiles(out, STEMS);
    for (const f of [
      files.mix,
      files.peaks,
      files.envelopes,
      ...Object.values(files.stems),
    ]) {
      assert.ok(fs.existsSync(f), f);
    }
    const written: unknown = JSON.parse(
      fs.readFileSync(files.timeline, 'utf8'),
    );
    assert.deepEqual(timelineProblems(written), []);
    assert.equal(readWav(files.mix).l.length, config.durationSec * SAMPLE_RATE);
  });

  it('puts every note on the strikeline on its timeline frame', () => {
    const times = chartTickTimes(song.folder);
    for (const instrument of ['drums', 'guitar'] as const) {
      const notes = result.timeline.notes[instrument].length;
      assert.ok(notes > 0, `${instrument} notes`);
      const r = checkSync(result.timeline, instrument, times[instrument]!);
      assert.equal(r.notes, notes, instrument);
      assert.equal(r.missing, 0, instrument);
      assert.deepEqual(r.wrongFrame, [], instrument);
      assert.ok(
        r.maxOffsetMs <= 500 / FPS,
        `${instrument} within half a frame`,
      );
    }
  });

  it("times the logo sting on the film's own hits", () => {
    const timeline: Timeline = result.timeline;
    const length = 90;
    const start = timeline.durationFrames - length;
    const events = stingEvents(timeline, start, length, 0.5);
    const inside = (f: number) => f >= start && f < start + length;
    assert.deepEqual(
      events.kicks,
      buildTimelineApi(timeline).hitFrames.kick.filter(inside),
    );
    assert.ok(events.kicks.length >= 2, 'an entrance and an impact');
    const impact = events.kicks[1]!;
    assert.ok(events.flashes.length > 0);
    for (const f of events.flashes) {
      assert.ok(
        f.frame > impact && f.frame <= impact + 0.5 * FPS,
        `flash at ${f.frame}`,
      );
      assert.ok(f.lane >= 0 && f.lane <= 4);
    }
    assert.deepEqual(
      events.sheens,
      timeline.beats
        .filter(b => b.downbeat && inside(b.frame))
        .map(b => b.frame),
    );
    assert.deepEqual(
      [events.fps, events.start, events.length],
      [FPS, start, length],
    );
  });
});

describe('a loop bed and an SFX mix over it', () => {
  // One steady loop, 4 beats at 120 BPM: two sines with whole cycles in the loop.
  const library = path.join(dir, 'loops');
  const loop = allocStereo(2 * SAMPLE_RATE);
  for (let i = 0; i < loop.l.length; i++) {
    const t = i / SAMPLE_RATE;
    loop.l[i] = loop.r[i] =
      0.25 * Math.sin(2 * Math.PI * 220 * t) +
      0.25 * Math.sin(2 * Math.PI * 330 * t);
  }
  writeWav(path.join(library, 'steady.wav'), loop);
  const arrangement: Arrangement = {
    bpm: 120,
    tracks: [
      {file: 'steady.wav', startBeat: 0, beats: 16, loopBeats: 4, stem: 'pad'},
    ],
    loudness: {lufs: -20, truePeakDb: -1},
  };
  const bed = path.join(dir, 'bed.wav');

  it('brings a steady loop to the target with one static gain', () => {
    const report = buildLoopBed({arrangement, library, out: bed});
    assert.deepEqual(report.problems, []);
    assert.ok(report.loudness);
    assert.equal(report.loudness.limiterMaxReductionDb, 0);
    assert.ok(Math.abs(report.loudness.output.lufs + 20) <= 0.5);
    // Every sample is the loop's times the one gain (to 24-bit precision).
    const g = 10 ** (report.loudness.gainDb / 20);
    const written = readWav(bed);
    assert.equal(written.l.length, 8 * SAMPLE_RATE);
    let worst = 0;
    for (let i = 0; i < written.l.length; i++) {
      worst = Math.max(
        worst,
        Math.abs(written.l[i]! - loop.l[i % loop.l.length]! * g),
      );
    }
    assert.ok(worst < 1e-6, `largest difference from a linear gain: ${worst}`);
  });

  it("renders a stem at the full bed's gain", () => {
    const stem = path.join(dir, 'bed-pad.wav');
    const report = buildLoopBed({arrangement, library, out: stem, stem: 'pad'});
    assert.deepEqual(report.problems, []);
    // The only track is the stem, so it is the bed itself, byte for byte.
    assert.ok(fs.readFileSync(stem).equals(fs.readFileSync(bed)));
  });

  it('places the cues over the bed and meets the loudness target', () => {
    const out = path.join(dir, 'mix.wav');
    const report = buildSfxMix({
      cues: [
        {frame: 15, kind: 'click'},
        {frame: 60, kind: 'whoosh', pan: {from: -0.5, to: 0.5}},
        {frame: 120, kind: 'impact', gain: -2},
      ],
      fps: FPS,
      bed,
      out,
      loudness: {lufs: -16, truePeakDb: -1.5},
    });
    assert.deepEqual(report.problems, []);
    assert.deepEqual([report.cues, report.cuesPastTheEnd], [3, 0]);
    assert.ok(
      report.loudness && Math.abs(report.loudness.output.lufs + 16) <= 0.5,
    );
    assert.equal(readWav(out).l.length, 8 * SAMPLE_RATE);
  });

  it('starts each sound on its frame', () => {
    const out = path.join(dir, 'cues.wav');
    buildSfxMix({
      cues: [{frame: 45, kind: 'click'}],
      fps: FPS,
      length: 90,
      out,
      loudness: null,
    });
    const mix = readWav(out);
    const at = Math.round((45 / FPS) * SAMPLE_RATE);
    const first = mix.l.findIndex(v => Math.abs(v) > 1e-4);
    assert.ok(
      first >= at && first < at + SAMPLE_RATE / 1000,
      `first sound at ${first}, cue at ${at}`,
    );
  });
});
