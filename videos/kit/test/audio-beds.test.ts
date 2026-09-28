/**
 * The pure parts of the SFX mixer and the loop-bed arranger: cue checks, the
 * pan law, sample-exact cue placement, sweeps, arrangement checks, and the
 * loudness report readers that must fail rather than pass a NaN.
 */
import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {biquad, biquadSteps, butterworth} from '../scripts/audio/dsp';
import {addTrack, assertArrangement} from '../scripts/audio/loopBed';
import {loudnessProblems} from '../scripts/audio/loudness';
import {SAMPLE_RATE, allocStereo, type Stereo} from '../scripts/audio/pcm';
import {
  KINDS,
  assertCues,
  panGains,
  placeCues,
  type SfxCue,
} from '../scripts/audio/sfx';
import {mulberry32} from '../src/motion/random';

/** The problems an assertion function names when it throws (none when it passes). */
function problemsOf(check: () => void): string[] {
  try {
    check();
    return [];
  } catch (e) {
    return (e as Error).message.split('\n- ').slice(1);
  }
}

describe('SFX cues', () => {
  it('names every malformed cue', () => {
    const problems = problemsOf(() =>
      assertCues([
        {frame: 1.5, kind: 'click'},
        {frame: 3, kind: 'boom' as SfxCue['kind']},
        {frame: 4, kind: 'pop', pan: 2},
        {frame: 5, kind: 'pop', pan: {from: -1, to: 1.5}},
        {frame: 6, kind: 'tick', gain: NaN},
        {frame: 7, kind: 'whoosh', pan: {from: 0.5, to: -0.5}, gain: -3},
      ]),
    );
    assert.equal(problems.length, 5, problems.join(' | '));
    assert.match(problems[1]!, /unknown kind "boom"/);
  });

  it('pans at constant power, with a centred sound at unity in both channels', () => {
    for (const p of [-1, -0.8, -0.3, 0, 0.4, 1]) {
      const [l, r] = panGains(p);
      assert.ok(Math.abs(l * l + r * r - 2) < 1e-12, `power at ${p}`);
    }
    const [l, r] = panGains(0);
    assert.ok(Math.abs(l - 1) < 1e-12 && Math.abs(r - 1) < 1e-12);
    assert.ok(panGains(-1)[1] < 1e-12, 'hard left has no right');
  });

  it('places each sound on its frame, to the sample, at its level', () => {
    const fps = 24;
    const mix = allocStereo(2 * SAMPLE_RATE);
    const sound = new Float32Array([1, 0.5]);
    placeCues(
      mix,
      [{frame: 7, kind: 'tick', gain: 3}],
      fps,
      new Map([['tick', sound]]),
    );
    const at = Math.round((7 / fps) * SAMPLE_RATE);
    const g = 10 ** ((KINDS.tick.levelDb + 3) / 20);
    assert.equal(
      mix.l.findIndex(v => v !== 0),
      at,
    );
    assert.ok(
      Math.abs(mix.l[at]! - g) < 1e-6 &&
        Math.abs(mix.r[at + 1]! - 0.5 * g) < 1e-6,
    );
  });

  it('cuts a sound that runs past the end of the mix', () => {
    const mix = allocStereo(10);
    placeCues(
      mix,
      [{frame: 0, kind: 'pop'}],
      30,
      new Map([['pop', new Float32Array(50).fill(1)]]),
    );
    assert.equal(mix.l.length, 10);
  });
});

describe('loop-bed arrangements', () => {
  // 110 BPM: a beat is 26181.8 samples, so slices round differently.
  const beatSamples = (60 / 110) * SAMPLE_RATE;
  const period = (): Stereo => {
    const p = allocStereo(Math.round(4 * beatSamples));
    const rnd = mulberry32(9);
    for (let i = 0; i < p.l.length; i++) p.l[i] = p.r[i] = 2 * rnd() - 1;
    return p;
  };

  it('steps a sweep without gaps, overlaps or filter restarts', () => {
    const track = {
      file: 'pad.wav',
      startBeat: 1,
      beats: 7,
      loopBeats: 4,
      offsetBeats: 1,
    };
    const steady = allocStereo(Math.round(10 * beatSamples));
    const swept = allocStereo(steady.l.length);
    addTrack(steady, {...track, lowpassHz: 1200}, period(), beatSamples);
    addTrack(
      swept,
      {...track, sweep: [1200, 1200, 1200]},
      period(),
      beatSamples,
    );
    assert.deepEqual(swept.l, steady.l);
  });

  it('places a track on its beat, sample-exact, with the stepped filter state carried', () => {
    const steps = [
      {from: 0, f: butterworth('lp', 800)},
      {from: 500, f: butterworth('lp', 800)},
    ];
    const x = Float64Array.from({length: 1000}, (_, i) => Math.sin(i / 3));
    assert.deepEqual(biquadSteps(x, steps), biquad(x, steps[0]!.f));
    const mix = allocStereo(Math.round(8 * beatSamples));
    const impulse = allocStereo(Math.round(4 * beatSamples));
    impulse.l[0] = 1;
    addTrack(
      mix,
      {file: 'click.wav', startBeat: 3, beats: 4, loopBeats: 4},
      impulse,
      beatSamples,
    );
    assert.equal(
      mix.l.findIndex(v => v !== 0),
      Math.round(3 * beatSamples),
    );
  });

  it('names every malformed track', () => {
    const problems = problemsOf(() =>
      assertArrangement({
        bpm: 120,
        tracks: [
          {file: 'a.wav', startBeat: -1, beats: 4, loopBeats: 4},
          {
            file: 'b.wav',
            startBeat: 0,
            beats: 2,
            loopBeats: 0,
            fadeInBeats: 2,
            fadeOutBeats: 1,
          },
          {
            file: 'c.wav',
            startBeat: 0,
            beats: 4,
            loopBeats: 4,
            stretch: 'toString',
          },
        ],
      }),
    );
    for (const re of [
      /startBeat must be at least 0/,
      /loopBeats must be above 0/,
      /fades are longer/,
      /stretch must be/,
    ]) {
      assert.ok(
        problems.some(p => re.test(p)),
        `${re} in ${problems.join(' | ')}`,
      );
    }
  });
});

describe('loudness reports', () => {
  it('fails a reading that is off target, over the ceiling or unreadable', () => {
    const target = {lufs: -14, truePeakDb: -1.5};
    assert.deepEqual(
      loudnessProblems({lufs: -14.3, truePeakDb: -1.6}, target),
      [],
    );
    assert.equal(
      loudnessProblems({lufs: -15, truePeakDb: -1.6}, target).length,
      1,
    );
    assert.equal(
      loudnessProblems({lufs: -14, truePeakDb: -1.2}, target).length,
      1,
    );
    assert.equal(
      loudnessProblems({lufs: NaN, truePeakDb: NaN}, target).length,
      2,
    );
  });
});
