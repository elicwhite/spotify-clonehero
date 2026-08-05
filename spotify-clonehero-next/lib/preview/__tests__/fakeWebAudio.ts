/**
 * Minimal Web Audio stubs for `AudioManager` tests. The real constructor
 * decodes audio, loads a SoundTouch worklet, and creates buffer sources;
 * these stub just enough of that graph for the manager to reach `ready`.
 *
 * Not a test file — jest's `testMatch` only picks up `*.test.ts(x)`.
 */

export class FakeAudioParam {
  value = 1;
  setValueAtTime(v: number) {
    this.value = v;
  }
}

export class FakeAudioBufferSource {
  buffer: unknown = null;
  playbackRate = new FakeAudioParam();
  connect() {}
  disconnect() {}
  start() {}
  stop() {}
  addEventListener() {}
  removeEventListener() {}
}

export class FakeGainNode {
  gain = new FakeAudioParam();
  /** The node(s) this gain is currently connected to, so tests can assert
   *  routing (direct to destination vs. through the worklet). */
  connectedTo: unknown[] = [];
  connect(target: unknown) {
    this.connectedTo.push(target);
  }
  disconnect() {
    this.connectedTo = [];
  }
}

export class FakeWorkletNode {
  parameters = {
    get(name: string) {
      void name;
      return new FakeAudioParam();
    },
  };
  port = {
    postMessage: jest.fn(),
  };
  connect() {}
  disconnect() {}
}

export class FakeAudioContext {
  state: 'running' | 'suspended' | 'closed' = 'suspended';
  currentTime = 0;
  baseLatency = 0;
  outputLatency = 0;
  destination = {} as AudioNode;
  audioWorklet = {
    addModule: jest.fn().mockResolvedValue(undefined),
  };
  createBufferSource() {
    return new FakeAudioBufferSource() as unknown as AudioBufferSourceNode;
  }
  createGain() {
    return new FakeGainNode() as unknown as GainNode;
  }
  decodeAudioData(_buf: ArrayBuffer): Promise<AudioBuffer> {
    return Promise.resolve({duration: 60, length: 60} as AudioBuffer);
  }
  resume(): Promise<void> {
    this.state = 'running';
    return Promise.resolve();
  }
  suspend(): Promise<void> {
    this.state = 'suspended';
    return Promise.resolve();
  }
  close(): Promise<void> {
    this.state = 'closed';
    return Promise.resolve();
  }
}

/** Installs the stubs on `global`. Call from `beforeAll`. */
export function installFakeWebAudio(): void {
  // @ts-expect-error - test stub
  global.AudioContext = FakeAudioContext;
  // @ts-expect-error - test stub
  global.AudioWorkletNode = FakeWorkletNode;
  global.requestAnimationFrame =
    global.requestAnimationFrame ??
    ((cb: FrameRequestCallback) => {
      void cb;
      return 0;
    });
  global.cancelAnimationFrame = global.cancelAnimationFrame ?? (() => {});
}
