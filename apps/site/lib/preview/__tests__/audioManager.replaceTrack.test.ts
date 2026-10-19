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

import {AudioManager, type TrackPcm} from '../audioManager';
import {
  FakeAudioContext,
  FakeGainNode,
  installFakeWebAudio,
} from './fakeWebAudio';

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

function pcm(length = 8): TrackPcm {
  return {samples: new Float32Array(length), sampleRate: 8000};
}

/** The gain nodes the manager created, in creation order. */
function gainNodes(): FakeGainNode[] {
  const context = (window as unknown as {ctx: FakeAudioContext}).ctx;
  return context.createdGains;
}

describe('AudioManager.replaceTrack', () => {
  it('keeps every other track and the track list untouched', async () => {
    const am = await makeAudioManager(['song.ogg', 'click.wav']);
    am.setVolume('song', 0.25);

    await am.replaceTrack('click', pcm(16));

    expect([...am.trackNames].sort()).toEqual(['click', 'song']);
    expect(am.getVolume('song')).toBe(0.25);
  });

  it('carries the replaced track’s own volume across the swap', async () => {
    // The click sits wherever the user left its fader; regenerating it for a
    // new tempo map must not reset that, and must not un-silence a click the
    // user never asked to hear.
    const am = await makeAudioManager(['song.ogg', 'click.wav']);
    am.setVolume('click', 0);
    await am.replaceTrack('click', pcm(16));
    expect(am.getVolume('click')).toBe(0);

    am.setVolume('click', 0.6);
    await am.replaceTrack('click', pcm(16));
    expect(am.getVolume('click')).toBe(0.6);
  });

  it('leaves the playhead where it was', async () => {
    const am = await makeAudioManager(['song.ogg', 'click.wav']);
    await am.seekTo(12);
    expect(am.currentTime).toBe(12);

    await am.replaceTrack('click', pcm(16));

    expect(am.currentTime).toBe(12);
  });

  it('is a no-op on a manager built without that track', async () => {
    const am = await makeAudioManager(['song.ogg']);
    await expect(am.replaceTrack('click', pcm(16))).resolves.toBeUndefined();
    expect(am.trackNames).toEqual(['song']);
  });

  it('does nothing once the manager has been destroyed', async () => {
    const am = await makeAudioManager(['song.ogg', 'click.wav']);
    am.destroy();
    await expect(am.replaceTrack('click', pcm(16))).resolves.toBeUndefined();
  });

  it('reuses the existing context rather than opening another', async () => {
    // The whole point: a fresh AudioManager would mean a second
    // AudioContext, another worklet load, and a re-decode of every stem.
    const am = await makeAudioManager(['song.ogg', 'click.wav']);
    const context = (window as unknown as {ctx: FakeAudioContext}).ctx;
    const worklets = context.audioWorklet.addModule.mock.calls.length;

    await am.replaceTrack('click', pcm(16));

    expect((window as unknown as {ctx: unknown}).ctx).toBe(context);
    expect(context.audioWorklet.addModule.mock.calls).toHaveLength(worklets);
  });

  it('never decodes: synthesized samples go straight into a buffer', async () => {
    // The WAV encode and the matching decode existed only to move samples
    // from one Float32Array to another. A tempo edit pays for neither.
    const am = await makeAudioManager(['song.ogg', 'click.wav']);
    const context = (window as unknown as {ctx: FakeAudioContext}).ctx;
    const decode = jest.spyOn(context, 'decodeAudioData');

    await am.replaceTrack('click', pcm(16));

    expect(decode).not.toHaveBeenCalled();
    decode.mockRestore();
  });

  it('replaces one track with several buffers and levels them as given', async () => {
    const am = await makeAudioManager(['song.ogg', 'click.wav']);
    am.setVolume('click', 1);
    const before = gainNodes().length;

    await am.replaceTrack('click', [pcm(), pcm(), pcm()], [1, 0.75, 0.1]);

    // Track volume 1 => (1*1)/2, times each buffer's own linear gain.
    const created = gainNodes().slice(before);
    expect(created).toHaveLength(3);
    expect(created.map(node => node.gain.value)).toEqual([0.5, 0.375, 0.05]);
  });
});

describe('AudioManager buffer gains', () => {
  it('groups every click file into one track, in the order given', async () => {
    const am = await makeAudioManager([
      'song.ogg',
      'click_0.wav',
      'click_1.wav',
    ]);
    expect([...am.trackNames].sort()).toEqual(['click', 'song']);
  });

  it('multiplies the linear buffer gain by the x-squared track volume', async () => {
    // The two curves are deliberately different. A buffer gain replaces
    // amplitude that used to be baked into the samples, and baked-in
    // amplitude is linear; the track fader keeps the x-squared curve every
    // other stem uses. Getting this wrong changes how loud every persisted
    // click setting sounds.
    const am = await makeAudioManager(['click_0.wav', 'click_1.wav']);
    const nodes = gainNodes().slice(-2);

    am.setVolume('click', 0.5);
    expect(nodes.map(node => node.gain.value)).toEqual([0.125, 0.125]);

    am.setBufferGain('click', 1, 0.25);
    expect(nodes.map(node => node.gain.value)).toEqual([0.125, 0.03125]);

    // A later track-volume change keeps the per-buffer balance.
    am.setVolume('click', 1);
    expect(nodes.map(node => node.gain.value)).toEqual([0.5, 0.125]);
  });

  it('ignores unknown tracks and out-of-range buffer indexes', async () => {
    const am = await makeAudioManager(['click_0.wav']);
    expect(() => am.setBufferGain('nope', 0, 0.5)).not.toThrow();
    expect(() => am.setBufferGain('click', 4, 0.5)).not.toThrow();
    expect(() => am.setBufferGain('click', -1, 0.5)).not.toThrow();
  });
});
