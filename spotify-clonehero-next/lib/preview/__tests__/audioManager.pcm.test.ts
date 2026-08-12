/**
 * @jest-environment jsdom
 */

/**
 * `AudioManager` taking audio it is handed as PCM rather than as an encoded
 * file.
 *
 * This is the editor's whole playback path: a chart package's audio is
 * decoded once, interleaved for the waveform and the leading-silence pad,
 * and then played from those same samples. What matters is that the samples
 * reach the graph in the right shape — a stereo track has to arrive as two
 * channels, not one channel of doubled length — and that a track whose PCM
 * is still the buffer it was decoded into reuses that buffer instead of
 * rebuilding it sample by sample.
 */

import {AudioManager} from '../audioManager';
import {rememberDecodedBuffer} from '../decodedPcm';
import {FakeAudioContext, installFakeWebAudio} from './fakeWebAudio';

beforeAll(() => {
  installFakeWebAudio();
});

afterEach(() => {
  jest.restoreAllMocks();
});

/** Interleaved stereo PCM: left counts up, right counts down. */
function stereoRamp(frames: number): Float32Array {
  const samples = new Float32Array(frames * 2);
  for (let i = 0; i < frames; i++) {
    samples[i * 2] = i;
    samples[i * 2 + 1] = -i;
  }
  return samples;
}

async function managerWith(
  fileName: string,
  pcm: {samples: Float32Array; sampleRate: number; channels?: number},
): Promise<AudioManager> {
  const am = new AudioManager([{fileName, pcm}], () => {});
  await am.ready;
  return am;
}

/** Counts the buffers a manager built for itself, so a test can tell a reused
 *  buffer from a rebuilt one without reaching into its private tracks. */
function watchBufferBuilds(): jest.SpyInstance {
  return jest.spyOn(FakeAudioContext.prototype, 'createBuffer');
}

describe('AudioManager PCM sources', () => {
  it('de-interleaves stereo PCM into the buffer’s own channels', async () => {
    const am = await managerWith('song.wav', {
      samples: stereoRamp(4),
      sampleRate: 44100,
      channels: 2,
    });

    const read = am.getTrackPcm('song');
    expect(read).not.toBeNull();
    expect(read!.channels).toBe(2);
    // Round-tripped through the AudioBuffer, the interleaved layout survives.
    expect(Array.from(read!.data)).toEqual([0, -0, 1, -1, 2, -2, 3, -3]);
  });

  it('treats PCM with no channel count as mono, as the click track is', async () => {
    const am = await managerWith('click.wav', {
      samples: new Float32Array([1, 2, 3, 4]),
      sampleRate: 8000,
    });
    const read = am.getTrackPcm('click');
    expect(read!.channels).toBe(1);
    expect(Array.from(read!.data)).toEqual([1, 2, 3, 4]);
  });

  it('gives an empty track a frame of silence, not a frame of NaN', async () => {
    // Web Audio rejects a zero-length buffer, so an undecodable-to-empty
    // track has to become something. Reading a frame that isn't there would
    // put NaN into the graph.
    const am = await managerWith('song.wav', {
      samples: new Float32Array(0),
      sampleRate: 44100,
      channels: 2,
    });
    const read = am.getTrackPcm('song')!;
    expect(read.data.length).toBe(2);
    expect(Array.from(read.data)).toEqual([0, 0]);
  });

  it('reuses the AudioBuffer those exact samples were decoded from', async () => {
    const decoded = new FakeAudioContext().createBuffer(2, 4, 44100);
    const samples = stereoRamp(4);
    decoded.getChannelData(0).set([0, 1, 2, 3]);
    decoded.getChannelData(1).set([-0, -1, -2, -3]);
    rememberDecodedBuffer(samples, decoded);

    const builds = watchBufferBuilds();
    const am = await managerWith('song.wav', {
      samples,
      sampleRate: 44100,
      channels: 2,
    });

    expect(builds).not.toHaveBeenCalled();
    expect(Array.from(am.getTrackPcm('song')!.data)).toEqual([
      0, -0, 1, -1, 2, -2, 3, -3,
    ]);
  });

  it('rebuilds rather than reusing a remembered buffer of another format', async () => {
    // What a MONO file leaves behind: one channel, while the interleaved PCM
    // the rest of the editor carries has been upmixed to stereo.
    const decoded = new FakeAudioContext().createBuffer(1, 4, 44100);
    const samples = stereoRamp(4);
    rememberDecodedBuffer(samples, decoded);

    const builds = watchBufferBuilds();
    const am = await managerWith('song.wav', {
      samples,
      sampleRate: 44100,
      channels: 2,
    });

    expect(builds).toHaveBeenCalledTimes(1);
    expect(Array.from(am.getTrackPcm('song')!.data)).toEqual([
      0, -0, 1, -1, 2, -2, 3, -3,
    ]);
  });

  it('rebuilds rather than reusing a remembered buffer at another rate', async () => {
    const decoded = new FakeAudioContext().createBuffer(2, 4, 48000);
    const samples = stereoRamp(4);
    rememberDecodedBuffer(samples, decoded);

    const builds = watchBufferBuilds();
    await managerWith('song.wav', {samples, sampleRate: 44100, channels: 2});

    expect(builds).toHaveBeenCalledTimes(1);
  });
});
