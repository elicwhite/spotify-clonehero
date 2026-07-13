import {computeStemFingerprint} from '../storage/stem-cache';

describe('computeStemFingerprint', () => {
  const audio = new Uint8Array([1, 2, 3, 4, 5]);
  const separatorId = 'model-a.onnx|drums|stereo|44100';

  it('is deterministic for the same audio + separator id', async () => {
    const a = await computeStemFingerprint(audio, separatorId);
    const b = await computeStemFingerprint(
      new Uint8Array([1, 2, 3, 4, 5]),
      separatorId,
    );
    expect(a).toBe(b);
  });

  it('accepts an ArrayBuffer and matches the Uint8Array result', async () => {
    const buf = audio.slice().buffer;
    expect(await computeStemFingerprint(buf, separatorId)).toBe(
      await computeStemFingerprint(audio, separatorId),
    );
  });

  it('changes when the audio bytes change', async () => {
    const a = await computeStemFingerprint(audio, separatorId);
    const b = await computeStemFingerprint(
      new Uint8Array([1, 2, 3, 4, 6]),
      separatorId,
    );
    expect(a).not.toBe(b);
  });

  it('changes when the separator id changes (e.g. model bump)', async () => {
    const a = await computeStemFingerprint(audio, separatorId);
    const b = await computeStemFingerprint(
      audio,
      'model-b.onnx|drums|stereo|44100',
    );
    expect(a).not.toBe(b);
  });

  it('is not fooled by moving bytes across the audio/id boundary', async () => {
    // audio="ab" id="c" vs audio="a" id="bc" — the NUL separator between
    // audio and id must keep these distinct.
    const a = await computeStemFingerprint(
      new TextEncoder().encode('ab'),
      'c',
    );
    const b = await computeStemFingerprint(new TextEncoder().encode('a'), 'bc');
    expect(a).not.toBe(b);
  });

  it('produces a 64-char lowercase hex SHA-256 digest', async () => {
    const fp = await computeStemFingerprint(audio, separatorId);
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });
});
