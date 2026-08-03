/**
 * @jest-environment jsdom
 */

/**
 * `AudioManager`'s track identity: which files become which tracks, and
 * therefore what `trackNames` offers UI built on top of it (the Stems mixer,
 * waveform source pickers) and what `setVolume` accepts.
 */

import {AudioManager} from '../audioManager';
import {installFakeWebAudio} from './fakeWebAudio';

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

describe('AudioManager track grouping', () => {
  it('names one track per file, by basename', async () => {
    const am = await makeAudioManager(['song.ogg', 'vocals.wav', 'click.wav']);
    expect([...am.trackNames].sort()).toEqual(['click', 'song', 'vocals']);
  });

  it('has no drums track when the package ships no drums audio', async () => {
    const am = await makeAudioManager(['song.ogg', 'guitar.ogg']);
    expect(am.trackNames).not.toContain('drums');
    // A phantom track would also be addressable; it isn't.
    expect(() => am.setVolume('drums', 0.5)).toThrow();
  });

  it('folds every drums-named file into exactly one drums track', async () => {
    const am = await makeAudioManager([
      'song.ogg',
      'drums_1.ogg',
      'drums_2.ogg',
      'drums_3.ogg',
    ]);
    expect(am.trackNames.filter(name => name === 'drums')).toHaveLength(1);
    expect([...am.trackNames].sort()).toEqual(['drums', 'song']);
    expect(() => am.setVolume('drums', 0.5)).not.toThrow();
  });
});
