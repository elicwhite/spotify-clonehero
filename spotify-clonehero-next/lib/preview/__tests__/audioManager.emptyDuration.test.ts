/**
 * @jest-environment jsdom
 */
/**
 * An AudioManager built with no audio files at all. `Math.max()` over no
 * tracks is `-Infinity`, which would flow into the transport readout and
 * every seek clamp as a frozen playhead with nothing to explain it.
 */

import {AudioManager} from '../audioManager';
import {installFakeWebAudio} from './fakeWebAudio';

beforeAll(() => {
  installFakeWebAudio();
  global.requestAnimationFrame = () => 0;
  global.cancelAnimationFrame = () => {};
});

describe('AudioManager with no audio files', () => {
  it('reports a duration of 0, not -Infinity', async () => {
    const manager = new AudioManager([], () => {});
    await manager.ready;

    expect(manager.trackNames).toEqual([]);
    expect(manager.duration).toBe(0);

    manager.destroy();
  });
});
