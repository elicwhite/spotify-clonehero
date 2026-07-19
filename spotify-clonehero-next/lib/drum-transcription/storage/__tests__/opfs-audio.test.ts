/**
 * Opus-at-rest storage tests (plan 0063 Part A): both storage generations —
 * current (`song.opus`) and legacy (`full.pcm` + `original.<ext>`) — and the
 * generation-aware read path that picks between them.
 */

import {installFakeOPFS} from './fake-opfs';

const decodeAudio = jest.fn(async () => ({
  duration: 1,
  sampleRate: 44100,
  length: 44100,
  numberOfChannels: 2,
}));
const interleaveAudioBuffer = jest.fn(
  () => new Float32Array([0.1, 0.2, 0.3, 0.4]),
);

jest.mock('../../audio/decoder', () => ({
  decodeAudio: (...args: unknown[]) => decodeAudio(...(args as [])),
  interleaveAudioBuffer: (...args: unknown[]) =>
    interleaveAudioBuffer(...(args as [])),
}));

import * as opfs from '../opfs';

const AUDIO_META = {
  name: 'song',
  originalFileName: 'song.mp3',
  durationMs: 1000,
  originalSampleRate: 44100,
  fileSizeBytes: 1234,
};

describe('Opus-at-rest audio storage', () => {
  let fake: ReturnType<typeof installFakeOPFS>;

  beforeEach(() => {
    fake = installFakeOPFS();
    decodeAudio.mockClear();
    interleaveAudioBuffer.mockClear();
  });

  it('storeAudioOpus writes only song.opus + meta.json (no full.pcm/original.<ext>)', async () => {
    const meta = await opfs.createProject('song');
    const opusBytes = new Uint8Array([1, 2, 3, 4]);

    await opfs.storeAudioOpus(meta.id, opusBytes, AUDIO_META, 44100);

    const paths = [...fake.store.keys()];
    expect(paths).toEqual(
      expect.arrayContaining([
        `/drum-transcription/${meta.id}/audio/song.opus`,
        `/drum-transcription/${meta.id}/audio/meta.json`,
      ]),
    );
    expect(paths).not.toEqual(
      expect.arrayContaining([`/drum-transcription/${meta.id}/audio/full.pcm`]),
    );
    expect(paths.some(p => p.includes('/audio/original.'))).toBe(false);
  });

  it('storeAudioOpus updates project duration', async () => {
    const meta = await opfs.createProject('song');
    await opfs.storeAudioOpus(meta.id, new Uint8Array([1]), AUDIO_META, 44100);
    const updated = await opfs.getProject(meta.id);
    expect(updated.durationSeconds).toBe(1);
  });

  it('readSongOpus round-trips the stored bytes', async () => {
    const meta = await opfs.createProject('song');
    const opusBytes = new Uint8Array([9, 8, 7, 6, 5]);
    await opfs.storeAudioOpus(meta.id, opusBytes, AUDIO_META, 44100);

    const readBack = await opfs.readSongOpus(meta.id);
    expect(readBack).not.toBeNull();
    expect(new Uint8Array(readBack!)).toEqual(opusBytes);
  });

  it('readSongOpus returns null for a legacy project (no song.opus)', async () => {
    const meta = await opfs.createProject('legacy');
    await opfs.storeAudio(meta.id, new Float32Array([0.1, 0.2]), AUDIO_META, 1);
    await expect(opfs.readSongOpus(meta.id)).resolves.toBeNull();
  });

  it('hasSongOpus reflects generation', async () => {
    const current = await opfs.createProject('current');
    await opfs.storeAudioOpus(current.id, new Uint8Array([1]), AUDIO_META, 1);
    await expect(opfs.hasSongOpus(current.id)).resolves.toBe(true);

    const legacy = await opfs.createProject('legacy');
    await opfs.storeAudio(legacy.id, new Float32Array([0.1]), AUDIO_META, 1);
    await expect(opfs.hasSongOpus(legacy.id)).resolves.toBe(false);
  });

  describe('loadFullMixPcm (generation-aware open path)', () => {
    it('legacy project: reads full.pcm directly, without decoding', async () => {
      const meta = await opfs.createProject('legacy');
      const pcm = new Float32Array([0.5, -0.5, 0.25, -0.25]);
      await opfs.storeAudio(meta.id, pcm, AUDIO_META, 2);

      const loaded = await opfs.loadFullMixPcm(meta.id);
      expect(loaded).toEqual(pcm);
      expect(decodeAudio).not.toHaveBeenCalled();
    });

    it('current project: decodes song.opus in memory', async () => {
      const meta = await opfs.createProject('current');
      const opusBytes = new Uint8Array([1, 2, 3]);
      await opfs.storeAudioOpus(meta.id, opusBytes, AUDIO_META, 44100);

      const loaded = await opfs.loadFullMixPcm(meta.id);
      expect(decodeAudio).toHaveBeenCalledTimes(1);
      expect(interleaveAudioBuffer).toHaveBeenCalledTimes(1);
      expect(loaded).toEqual(new Float32Array([0.1, 0.2, 0.3, 0.4]));
    });
  });

  describe('hasStoredAudio (generation-aware)', () => {
    it('true for a legacy project (full.pcm)', async () => {
      const meta = await opfs.createProject('legacy');
      await opfs.storeAudio(meta.id, new Float32Array([0.1]), AUDIO_META, 1);
      await expect(opfs.hasStoredAudio(meta.id)).resolves.toBe(true);
    });

    it('true for a current project (song.opus)', async () => {
      const meta = await opfs.createProject('current');
      await opfs.storeAudioOpus(meta.id, new Uint8Array([1]), AUDIO_META, 1);
      await expect(opfs.hasStoredAudio(meta.id)).resolves.toBe(true);
    });

    it('false when neither is stored', async () => {
      const meta = await opfs.createProject('empty');
      await expect(opfs.hasStoredAudio(meta.id)).resolves.toBe(false);
    });
  });
});
