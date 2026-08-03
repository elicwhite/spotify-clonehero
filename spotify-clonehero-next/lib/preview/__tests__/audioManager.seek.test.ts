/**
 * @jest-environment jsdom
 */

import {AudioManager} from '../audioManager';
import {installFakeWebAudio} from './fakeWebAudio';

beforeAll(() => {
  installFakeWebAudio();
});

async function makeAudioManager(): Promise<AudioManager> {
  const am = new AudioManager(
    [{fileName: 'song.ogg', data: new Uint8Array(8)}],
    () => {},
  );
  await am.ready;
  return am;
}

describe('AudioManager.seekTo', () => {
  test('paused: updates currentTime without starting playback', async () => {
    const am = await makeAudioManager();
    expect(am.isPlaying).toBe(false);
    expect(am.currentTime).toBe(0);

    await am.seekTo(12.5);

    expect(am.isPlaying).toBe(false);
    expect(am.currentTime).toBeCloseTo(12.5, 5);
  });

  test('paused: chart-time variant respects chartDelay', async () => {
    const am = await makeAudioManager();
    am.setChartDelay(2);

    await am.seekToChartTime(10);

    expect(am.isPlaying).toBe(false);
    // currentTime is the audio time = chartTime + delay
    expect(am.currentTime).toBeCloseTo(12, 5);
    // chartTime is what the caller asked for
    expect(am.chartTime).toBeCloseTo(10, 5);
  });

  test('seeking while paused multiple times keeps state paused', async () => {
    const am = await makeAudioManager();

    await am.seekTo(5);
    await am.seekTo(20);
    await am.seekTo(0.5);

    expect(am.isPlaying).toBe(false);
    expect(am.currentTime).toBeCloseTo(0.5, 5);
  });

  test('playing: seekTo keeps playing (delegates to play)', async () => {
    const am = await makeAudioManager();
    await am.play({time: 1});
    expect(am.isPlaying).toBe(true);

    await am.seekTo(30);

    expect(am.isPlaying).toBe(true);
    expect(am.currentTime).toBeCloseTo(30, 1);
  });
});
