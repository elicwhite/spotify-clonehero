/**
 * @jest-environment jsdom
 */

import {AudioManager} from '../audioManager';
import {
  installFakeWebAudio,
  EventfulSource,
  FakeAudioContext,
} from './fakeWebAudio';

beforeAll(() => {
  installFakeWebAudio();
  global.requestAnimationFrame = () => 0;
  global.cancelAnimationFrame = () => {};
});

async function makeAudioManager(): Promise<{
  am: AudioManager;
  ctx: FakeAudioContext;
  onSongEnded: jest.Mock;
  /** Ends every source the manager started, as the hardware would. */
  endAudio: () => void;
}> {
  const onSongEnded = jest.fn();
  const am = new AudioManager(
    [{fileName: 'song.ogg', data: new Uint8Array(8)}],
    onSongEnded,
  );
  await am.ready;
  const ctx = (window as unknown as {ctx: FakeAudioContext}).ctx;

  const live: EventfulSource[] = [];
  ctx.createBufferSource = () => {
    const source = new EventfulSource();
    live.push(source);
    return source as unknown as AudioBufferSourceNode;
  };

  return {
    am,
    ctx,
    onSongEnded,
    endAudio: () => {
      for (const source of live.splice(0, live.length)) source.fireEnded();
    },
  };
}

describe('AudioManager when the song ends', () => {
  test('holds at the end of the song and stops the clock', async () => {
    const {am, ctx, endAudio, onSongEnded} = await makeAudioManager();
    await am.play({time: 0});
    ctx.currentTime += 5;

    endAudio();

    expect(onSongEnded).toHaveBeenCalledTimes(1);
    expect(am.isPlaying).toBe(false);
    expect(am.currentTime).toBe(am.duration);

    // Nothing the context does afterwards moves the playhead.
    ctx.currentTime += 2000;
    expect(am.currentTime).toBe(am.duration);
    expect(am.chartTime).toBe(am.duration);
  });

  test('playing again leaves the end', async () => {
    const {am, ctx, endAudio} = await makeAudioManager();
    await am.play({time: 0});
    endAudio();

    await am.play({time: 10});
    ctx.currentTime += 3;

    expect(am.isPlaying).toBe(true);
    expect(am.currentTime).toBeCloseTo(13, 5);
  });

  test('seeking leaves the end', async () => {
    const {am, endAudio} = await makeAudioManager();
    await am.play({time: 0});
    endAudio();

    await am.seekTo(10);

    expect(am.currentTime).toBeCloseTo(10, 5);
  });

  test('a stopped manager does not follow the audio clock', async () => {
    const {am, ctx} = await makeAudioManager();
    await am.play({time: 0});
    ctx.currentTime += 5;

    await am.stop();
    ctx.currentTime += 2000;

    expect(am.currentTime).toBe(0);
  });
});
