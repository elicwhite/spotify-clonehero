/**
 * @jest-environment jsdom
 */

/**
 * `AudioManager.replaceTrack` — swapping one track's audio in place.
 *
 * This is what keeps the synthesized metronome click in step with a tempo
 * map the user is editing. The properties that matter are the ones a full
 * manager rebuild would break: no other track is disturbed, the track keeps
 * the volume the mixer gave it, and the playhead doesn't move.
 */

import {AudioManager} from '../audioManager';
import {FakeAudioContext, installFakeWebAudio} from './fakeWebAudio';

beforeAll(() => {
  installFakeWebAudio();
});

async function makeAudioManager(fileNames: string[]): Promise<AudioManager> {
  const am = new AudioManager(
    fileNames.map(fileName => ({fileName, data: new Uint8Array(8)})),
    () => {},
  );
  await am.ready;
  return am;
}

describe('AudioManager.replaceTrack', () => {
  it('keeps every other track and the track list untouched', async () => {
    const am = await makeAudioManager(['song.ogg', 'click.wav']);
    am.setVolume('song', 0.25);

    await am.replaceTrack('click', new Uint8Array(16));

    expect([...am.trackNames].sort()).toEqual(['click', 'song']);
    expect(am.getVolume('song')).toBe(0.25);
  });

  it('carries the replaced track’s own volume across the swap', async () => {
    // The click sits wherever the user left its fader; regenerating it for a
    // new tempo map must not reset that, and must not un-silence a click the
    // user never asked to hear.
    const am = await makeAudioManager(['song.ogg', 'click.wav']);
    am.setVolume('click', 0);
    await am.replaceTrack('click', new Uint8Array(16));
    expect(am.getVolume('click')).toBe(0);

    am.setVolume('click', 0.6);
    await am.replaceTrack('click', new Uint8Array(16));
    expect(am.getVolume('click')).toBe(0.6);
  });

  it('leaves the playhead where it was', async () => {
    const am = await makeAudioManager(['song.ogg', 'click.wav']);
    await am.seekTo(12);
    expect(am.currentTime).toBe(12);

    await am.replaceTrack('click', new Uint8Array(16));

    expect(am.currentTime).toBe(12);
  });

  it('is a no-op on a manager built without that track', async () => {
    const am = await makeAudioManager(['song.ogg']);
    await expect(
      am.replaceTrack('click', new Uint8Array(16)),
    ).resolves.toBeUndefined();
    expect(am.trackNames).toEqual(['song']);
  });

  it('does nothing once the manager has been destroyed', async () => {
    const am = await makeAudioManager(['song.ogg', 'click.wav']);
    am.destroy();
    await expect(
      am.replaceTrack('click', new Uint8Array(16)),
    ).resolves.toBeUndefined();
  });

  it('reuses the existing context rather than opening another', async () => {
    // The whole point: a fresh AudioManager would mean a second
    // AudioContext, another worklet load, and a re-decode of every stem.
    const am = await makeAudioManager(['song.ogg', 'click.wav']);
    const context = (window as unknown as {ctx: FakeAudioContext}).ctx;
    const worklets = context.audioWorklet.addModule.mock.calls.length;

    await am.replaceTrack('click', new Uint8Array(16));

    expect((window as unknown as {ctx: unknown}).ctx).toBe(context);
    expect(context.audioWorklet.addModule.mock.calls).toHaveLength(worklets);
  });
});
