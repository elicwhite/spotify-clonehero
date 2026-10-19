/**
 * @jest-environment jsdom
 */

import {AudioManager} from '../audioManager';
import {
  installFakeWebAudio,
  FakeAudioContext,
  FakeGainNode,
  FakeWorkletNode,
} from './fakeWebAudio';

/** Captures every gain node the manager creates, so tests can inspect what
 *  each one is connected to. */
class TrackingAudioContext extends FakeAudioContext {
  gainNodes: FakeGainNode[] = [];
  override createGain() {
    const node = new FakeGainNode();
    this.gainNodes.push(node);
    return node as unknown as GainNode;
  }
}

/** Captures the worklet node the manager creates, so tests can inspect its
 *  `port.postMessage` calls (the 'clear' contract). */
class TrackingWorkletNode extends FakeWorkletNode {
  static instances: TrackingWorkletNode[] = [];
  constructor() {
    super();
    TrackingWorkletNode.instances.push(this);
  }
}

beforeAll(() => {
  installFakeWebAudio();
  global.requestAnimationFrame = () => 0;
  global.cancelAnimationFrame = () => {};
  // @ts-expect-error - test stub
  global.AudioContext = TrackingAudioContext;
});

beforeEach(() => {
  TrackingWorkletNode.instances = [];
  // @ts-expect-error - test stub
  global.AudioWorkletNode = TrackingWorkletNode;
});

async function makeAudioManager(): Promise<{
  am: AudioManager;
  ctx: TrackingAudioContext;
  worklet: TrackingWorkletNode;
}> {
  const am = new AudioManager(
    [{fileName: 'song.ogg', data: new Uint8Array(8)}],
    jest.fn(),
  );
  await am.ready;
  const ctx = (window as unknown as {ctx: TrackingAudioContext}).ctx;
  const worklet = TrackingWorkletNode.instances[0];
  return {am, ctx, worklet};
}

describe('AudioManager worklet routing', () => {
  test('at default tempo 1.0, gain nodes connect directly to destination', async () => {
    const {ctx} = await makeAudioManager();

    expect(ctx.gainNodes.length).toBeGreaterThan(0);
    for (const gainNode of ctx.gainNodes) {
      expect(gainNode.connectedTo).toEqual([ctx.destination]);
    }
  });

  test('setTempo(0.8) routes gains through the worklet and clears it', async () => {
    const {am, ctx, worklet} = await makeAudioManager();

    am.setTempo(0.8);

    for (const gainNode of ctx.gainNodes) {
      expect(gainNode.connectedTo).toEqual([worklet]);
    }
    expect(worklet.port.postMessage).toHaveBeenCalledWith({type: 'clear'});
  });

  test('setTempo(1.0) after a non-default tempo routes back to destination and clears again', async () => {
    const {am, ctx, worklet} = await makeAudioManager();

    am.setTempo(0.8);
    worklet.port.postMessage.mockClear();

    am.setTempo(1.0);

    for (const gainNode of ctx.gainNodes) {
      expect(gainNode.connectedTo).toEqual([ctx.destination]);
    }
    expect(worklet.port.postMessage).toHaveBeenCalledWith({type: 'clear'});
  });

  test('play() at tempo 0.8 clears the worklet; at tempo 1.0 it does not', async () => {
    const {am, worklet} = await makeAudioManager();

    worklet.port.postMessage.mockClear();
    await am.play({time: 0});
    expect(worklet.port.postMessage).not.toHaveBeenCalled();

    am.setTempo(0.8);
    worklet.port.postMessage.mockClear();
    await am.play({time: 5});
    expect(worklet.port.postMessage).toHaveBeenCalledWith({type: 'clear'});
  });

  test('seekTo() at tempo 0.8 clears the worklet; at tempo 1.0 it does not', async () => {
    const {am, worklet} = await makeAudioManager();

    worklet.port.postMessage.mockClear();
    await am.seekTo(0);
    expect(worklet.port.postMessage).not.toHaveBeenCalled();

    am.setTempo(0.8);
    worklet.port.postMessage.mockClear();
    await am.seekTo(5);
    expect(worklet.port.postMessage).toHaveBeenCalledWith({type: 'clear'});
  });
});
