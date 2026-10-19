import {
  CHROMA_BINS,
  CHROMA_FPS,
  CHROMA_HOP,
  CHROMA_FFT_SIZE,
  CHROMA_SAMPLE_RATE,
  ChromaStream,
  chromaFrameCount,
  chromagram,
} from '../chroma';
import {
  DEFAULT_FOLLOWER_OPTIONS,
  ScoreFollower,
  bootstrapSpeeds,
  matchWindow,
  trackingSpeeds,
} from '../follower';
import {isReferenceStem} from '../reference';
import {PlayingGate} from '../playing-gate';

/** A tone at `hz`, so a chroma frame lands on one predictable pitch class. */
function tone(hz: number, samples: number): Float32Array {
  const out = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    out[i] = Math.sin((2 * Math.PI * hz * i) / CHROMA_SAMPLE_RATE);
  }
  return out;
}

/** A reference whose chroma changes every `sectionSec`, so a window can only
 *  match in one place. Twelve distinct pitches keeps every section unlike every
 *  other one. */
function distinctReference(sectionSec: number, sections: number) {
  const pitches = [
    261.6, 293.7, 329.6, 349.2, 392.0, 440.0, 493.9, 523.3, 587.3, 659.3, 698.5,
    784.0,
  ];
  const perSection = Math.round(sectionSec * CHROMA_SAMPLE_RATE);
  const audio = new Float32Array(perSection * sections);
  for (let s = 0; s < sections; s++) {
    audio.set(tone(pitches[s % pitches.length], perSection), s * perSection);
  }
  return audio;
}

describe('chroma', () => {
  it('puts a pure tone in one pitch class', () => {
    const {frames, frameCount} = chromagram(tone(440, CHROMA_SAMPLE_RATE));
    expect(frameCount).toBeGreaterThan(5);
    const first = Array.from(frames.slice(0, CHROMA_BINS));
    const loudest = first.indexOf(Math.max(...first));
    // 440 Hz is A, pitch class 9 with C as 0.
    expect(loudest).toBe(9);
  });

  it('normalises every frame to unit length', () => {
    const {frames, frameCount} = chromagram(tone(330, CHROMA_SAMPLE_RATE));
    for (let t = 0; t < frameCount; t++) {
      let norm = 0;
      for (let k = 0; k < CHROMA_BINS; k++) {
        norm += frames[t * CHROMA_BINS + k] ** 2;
      }
      expect(Math.sqrt(norm)).toBeCloseTo(1, 5);
    }
  });

  it('leaves silence out rather than normalising noise into a direction', () => {
    const {frames, frameCount} = chromagram(
      new Float32Array(CHROMA_SAMPLE_RATE),
    );
    expect(frameCount).toBeGreaterThan(0);
    expect(Array.from(frames).every(v => v === 0)).toBe(true);
  });

  it('streams the same frames as the whole-signal path, whatever the block size', () => {
    const audio = tone(392, CHROMA_SAMPLE_RATE * 2);
    const {frames, frameCount} = chromagram(audio);

    const stream = new ChromaStream();
    const collected: {chroma: Float32Array; endSampleIndex: number}[] = [];
    // A block size that is not a multiple of the hop, to exercise the carry.
    const block = 999;
    for (let p = 0; p + block <= audio.length; p += block) {
      collected.push(...stream.push(audio.subarray(p, p + block)));
    }

    expect(collected.length).toBeGreaterThan(frameCount - 3);
    for (let t = 0; t < collected.length; t++) {
      expect(collected[t].endSampleIndex).toBe(
        t * CHROMA_HOP + CHROMA_FFT_SIZE,
      );
      for (let k = 0; k < CHROMA_BINS; k++) {
        expect(collected[t].chroma[k]).toBeCloseTo(
          frames[t * CHROMA_BINS + k],
          5,
        );
      }
    }
  });

  it('counts frames the way the hop implies', () => {
    expect(chromaFrameCount(CHROMA_FFT_SIZE - 1)).toBe(0);
    expect(chromaFrameCount(CHROMA_FFT_SIZE)).toBe(1);
    expect(chromaFrameCount(CHROMA_FFT_SIZE + CHROMA_HOP)).toBe(2);
  });
});

describe('matchWindow', () => {
  const reference = chromagram(distinctReference(4, 10));

  it('finds where an excerpt came from', () => {
    // Take the reference's own frames from 20s in as the observation.
    const startFrame = Math.round(20 * CHROMA_FPS);
    const count = Math.round(8 * CHROMA_FPS);
    const observation = reference.frames.slice(
      startFrame * CHROMA_BINS,
      (startFrame + count) * CHROMA_BINS,
    );

    const match = matchWindow({
      reference: reference.frames,
      referenceFrameCount: reference.frameCount,
      observation,
      observationCount: count,
      refEndLoSec: 0,
      refEndHiSec: 40,
      speeds: [1],
      rivalExclusionSec: 2,
      stride: 1,
    });

    expect(match).not.toBeNull();
    // The window's newest frame sits at 20s + 8s.
    expect(match!.refEndSec).toBeCloseTo(20 + 8 - 1 / CHROMA_FPS, 0);
    expect(match!.margin).toBeGreaterThan(0);
  });

  it('reports a small margin where the reference repeats', () => {
    // Two identical halves: every window matches equally well in both.
    const half = distinctReference(4, 3);
    const looped = new Float32Array(half.length * 2);
    looped.set(half, 0);
    looped.set(half, half.length);
    const repeating = chromagram(looped);

    const count = Math.round(6 * CHROMA_FPS);
    const startFrame = Math.round(2 * CHROMA_FPS);
    const observation = repeating.frames.slice(
      startFrame * CHROMA_BINS,
      (startFrame + count) * CHROMA_BINS,
    );

    const match = matchWindow({
      reference: repeating.frames,
      referenceFrameCount: repeating.frameCount,
      observation,
      observationCount: count,
      refEndLoSec: 0,
      refEndHiSec: 24,
      speeds: [1],
      rivalExclusionSec: 2,
      stride: 1,
    });
    expect(match).not.toBeNull();
    expect(match!.margin).toBeLessThan(0.05);
  });

  it('returns nothing when there is no observation', () => {
    expect(
      matchWindow({
        reference: reference.frames,
        referenceFrameCount: reference.frameCount,
        observation: new Float32Array(0),
        observationCount: 0,
        refEndLoSec: 0,
        refEndHiSec: 10,
        speeds: [1],
        rivalExclusionSec: 2,
      }),
    ).toBeNull();
  });
});

describe('speed candidates', () => {
  it('keeps tracking speeds inside the allowed range', () => {
    const speeds = trackingSpeeds(DEFAULT_FOLLOWER_OPTIONS.maxSpeed, {
      ...DEFAULT_FOLLOWER_OPTIONS,
    });
    for (const s of speeds) {
      expect(s).toBeLessThanOrEqual(DEFAULT_FOLLOWER_OPTIONS.maxSpeed);
      expect(s).toBeGreaterThanOrEqual(DEFAULT_FOLLOWER_OPTIONS.minSpeed);
    }
  });

  it('narrows the cold-start sweep around a remembered speed', () => {
    const speeds = bootstrapSpeeds({
      ...DEFAULT_FOLLOWER_OPTIONS,
      rememberedSpeed: 1.2,
    });
    expect(speeds.length).toBeGreaterThan(2);
    for (const s of speeds) {
      expect(s).toBeGreaterThanOrEqual(1.2 * 0.92 - 1e-9);
      expect(s).toBeLessThanOrEqual(1.2 * 1.08 + 1e-9);
    }
  });

  it('sweeps the whole plausible range on a cold start', () => {
    const speeds = bootstrapSpeeds(DEFAULT_FOLLOWER_OPTIONS);
    expect(speeds[0]).toBeCloseTo(DEFAULT_FOLLOWER_OPTIONS.minSpeed, 3);
    expect(speeds[speeds.length - 1]).toBeLessThanOrEqual(
      DEFAULT_FOLLOWER_OPTIONS.maxSpeed + 1e-9,
    );
    expect(speeds.length).toBeGreaterThan(10);
  });
});

describe('ScoreFollower', () => {
  /** Plays the reference back at `speed`, feeding the follower its own frames,
   *  and returns the position error at the end. */
  function replay(speed: number) {
    const referenceAudio = distinctReference(4, 12);
    const reference = chromagram(referenceAudio);
    const follower = new ScoreFollower(reference.frames, reference.frameCount);

    follower.beginSong(0);
    const totalObsSec = reference.frameCount / CHROMA_FPS / speed;
    let lastTruth = 0;
    for (let i = 0; i < totalObsSec * CHROMA_FPS; i++) {
      const obsSec = i / CHROMA_FPS;
      const refFrame = Math.min(
        reference.frameCount - 1,
        Math.round(obsSec * speed * CHROMA_FPS),
      );
      follower.pushFrame(
        reference.frames.slice(
          refFrame * CHROMA_BINS,
          (refFrame + 1) * CHROMA_BINS,
        ),
        obsSec,
      );
      if (i % 5 === 0) follower.update();
      lastTruth = refFrame / CHROMA_FPS;
    }
    const finalObsSec = (Math.floor(totalObsSec * CHROMA_FPS) - 1) / CHROMA_FPS;
    return {
      error: follower.snapshot(finalObsSec).refTimeSec - lastTruth,
      phase: follower.phase,
    };
  }

  it('locks on and tracks a performance played faster than the record', () => {
    const {error, phase} = replay(1.2);
    expect(phase).toBe('tracking');
    expect(Math.abs(error)).toBeLessThan(3);
  });

  it('locks on at the record’s own speed', () => {
    const {error, phase} = replay(1.0);
    expect(phase).toBe('tracking');
    expect(Math.abs(error)).toBeLessThan(3);
  });

  it('starts idle and reports nothing until a song begins', () => {
    const reference = chromagram(distinctReference(4, 4));
    const follower = new ScoreFollower(reference.frames, reference.frameCount);
    expect(follower.phase).toBe('idle');
    expect(follower.update()).toBeNull();
    follower.pushFrame(new Float32Array(CHROMA_BINS), 0);
    expect(follower.update()).toBeNull();
  });
});

describe('PlayingGate', () => {
  const SR = 22050;
  const BLOCK = 2205;

  /** Quiet room noise. */
  function noise(samples: number, amplitude: number) {
    const out = new Float32Array(samples);
    let seed = 12345;
    for (let i = 0; i < samples; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      out[i] = ((seed / 0x7fffffff) * 2 - 1) * amplitude;
    }
    return out;
  }

  /** Noise with sharp transients on top, which is what a kit looks like to a
   *  flux detector. */
  function hits(samples: number, amplitude: number, everySamples: number) {
    const out = noise(samples, amplitude * 0.05);
    for (let i = 0; i < samples; i += everySamples) {
      for (let k = 0; k < 200 && i + k < samples; k++) {
        out[i + k] += amplitude * Math.exp(-k / 40) * Math.sin(k * 0.6);
      }
    }
    return out;
  }

  function feed(gate: PlayingGate, audio: Float32Array) {
    const events = [];
    for (let p = 0; p + BLOCK <= audio.length; p += BLOCK) {
      events.push(gate.push(audio.subarray(p, p + BLOCK)));
    }
    return events;
  }

  it('stays quiet through a room where nobody is playing', () => {
    const gate = new PlayingGate(SR);
    const events = feed(gate, noise(SR * 12, 0.02));
    expect(events.some(e => e.startedSecondsAgo != null)).toBe(false);
    expect(gate.playing).toBe(false);
  });

  it('reports nothing until it has heard the room', () => {
    const gate = new PlayingGate(SR);
    const events = feed(gate, noise(SR * 1, 0.02));
    expect(events.every(e => e.quietFlux === null)).toBe(true);
  });

  it('starts on transients and dates the start before the hold', () => {
    const gate = new PlayingGate(SR);
    const quiet = noise(SR * 4, 0.01);
    const playing = hits(SR * 12, 0.6, Math.round(SR / 6));
    const audio = new Float32Array(quiet.length + playing.length);
    audio.set(quiet, 0);
    audio.set(playing, quiet.length);

    const events = feed(gate, audio);
    const started = events.find(e => e.startedSecondsAgo != null);
    expect(started).toBeDefined();
    expect(started!.startedSecondsAgo).toBeGreaterThan(1);
    expect(gate.playing).toBe(true);
  });

  it('stops once the transients go away', () => {
    const gate = new PlayingGate(SR);
    const quiet = noise(SR * 4, 0.01);
    const playing = hits(SR * 10, 0.6, Math.round(SR / 6));
    const after = noise(SR * 10, 0.01);
    const audio = new Float32Array(
      quiet.length + playing.length + after.length,
    );
    audio.set(quiet, 0);
    audio.set(playing, quiet.length);
    audio.set(after, quiet.length + playing.length);

    const events = feed(gate, audio);
    expect(events.some(e => e.startedSecondsAgo != null)).toBe(true);
    expect(events.some(e => e.justStopped)).toBe(true);
    expect(gate.playing).toBe(false);
  });
});

describe('isReferenceStem', () => {
  it('takes the stems that make up the performance', () => {
    expect(isReferenceStem('guitar.opus')).toBe(true);
    expect(isReferenceStem('drums_1.opus')).toBe(true);
    expect(isReferenceStem('song.ogg')).toBe(true);
    expect(isReferenceStem('vocals.mp3')).toBe(true);
  });

  it('leaves out crowd, preview and non-audio', () => {
    expect(isReferenceStem('crowd.opus')).toBe(false);
    expect(isReferenceStem('preview.opus')).toBe(false);
    expect(isReferenceStem('notes.mid')).toBe(false);
    expect(isReferenceStem('album.jpg')).toBe(false);
  });
});
