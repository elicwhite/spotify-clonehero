/**
 * @jest-environment jsdom
 */

import {AudioManager} from '../audioManager';
import {installFakeWebAudio, FakeAudioContext} from './fakeWebAudio';

beforeAll(() => {
  installFakeWebAudio();
  global.requestAnimationFrame = () => 0;
  global.cancelAnimationFrame = () => {};
});

async function makeAudioManager(): Promise<{
  am: AudioManager;
  ctx: FakeAudioContext;
}> {
  const am = new AudioManager(
    [{fileName: 'song.ogg', data: new Uint8Array(8)}],
    () => {},
  );
  await am.ready;
  const ctx = (window as unknown as {ctx: FakeAudioContext}).ctx;
  return {am, ctx};
}

describe('AudioManager.renderedSeconds', () => {
  test('follows the rendered-audio clock, not the song position', async () => {
    const {am, ctx} = await makeAudioManager();
    await am.play({time: 0});
    ctx.currentTime += 12;
    expect(am.renderedSeconds).toBe(12);

    // A seek far into the song moves the song position only.
    await am.play({time: 45});
    expect(am.currentTime).toBeCloseTo(45, 5);
    expect(am.renderedSeconds).toBe(12);

    // So does a slower tempo: the clock counts seconds heard.
    am.setTempo(0.5);
    ctx.currentTime += 10;
    expect(am.currentTime).toBeCloseTo(50, 5);
    expect(am.renderedSeconds).toBe(22);
  });

  test('keeps its last value after destroy', async () => {
    const {am, ctx} = await makeAudioManager();
    await am.play({time: 0});
    ctx.currentTime += 3;
    am.destroy();
    expect(am.renderedSeconds).toBe(3);
  });
});
