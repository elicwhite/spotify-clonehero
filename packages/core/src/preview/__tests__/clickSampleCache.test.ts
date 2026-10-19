/**
 * @jest-environment jsdom
 */

/**
 * `generateClickSample` renders a constant few-hundred-sample buffer through
 * an `OfflineAudioContext`. Every click track a page builds asks for the same
 * handful of samples, and pages rebuild their click track on every tempo edit
 * and every fader move, so the render must happen once per distinct sample
 * and never again.
 */

import {generateClickSample} from '../clickTrack';

let constructions = 0;

class FakeOfflineAudioContext {
  length: number;
  constructor(_channels: number, length: number, _sampleRate: number) {
    this.length = length;
    constructions++;
  }
  createOscillator() {
    return {
      frequency: {value: 0},
      connect() {},
      start() {},
      stop() {},
    };
  }
  createGain() {
    return {
      gain: {setValueAtTime() {}, linearRampToValueAtTime() {}},
      connect() {},
    };
  }
  startRendering() {
    const data = new Float32Array(this.length);
    data.fill(0.5);
    return Promise.resolve({getChannelData: () => data});
  }
}

beforeAll(() => {
  // @ts-expect-error - test stub
  window.OfflineAudioContext = FakeOfflineAudioContext;
});

beforeEach(() => {
  constructions = 0;
});

describe('generateClickSample caching', () => {
  it('renders once for repeated calls with the same parameters', async () => {
    await generateClickSample(1000, 0.05, 8000, 1);
    expect(constructions).toBe(1);

    await generateClickSample(1000, 0.05, 8000, 1);
    // Concurrent callers (the click's voices render in parallel) share the
    // one render rather than racing to start their own.
    await Promise.all([
      generateClickSample(1000, 0.05, 8000, 1),
      generateClickSample(1000, 0.05, 8000, 1),
    ]);

    expect(constructions).toBe(1);
  });

  it('renders once per distinct parameter set', async () => {
    await generateClickSample(1234, 0.05, 8000, 1);
    expect(constructions).toBe(1);

    // Each argument is part of the identity of a sample.
    await generateClickSample(1234, 0.06, 8000, 1);
    await generateClickSample(1234, 0.05, 4000, 1);
    await generateClickSample(1234, 0.05, 8000, 0.6);
    expect(constructions).toBe(4);

    await generateClickSample(1234, 0.05, 8000, 1);
    expect(constructions).toBe(4);
  });

  it('hands every caller its own copy', async () => {
    const first = await generateClickSample(777, 0.05, 8000, 1);
    first[0] = -1;
    const second = await generateClickSample(777, 0.05, 8000, 1);

    expect(second).not.toBe(first);
    expect(second[0]).toBe(0.5);
  });
});
