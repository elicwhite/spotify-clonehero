/**
 * Fingerprint-basis priority tests (plan 0066 Phase 2c):
 * ensureProjectStemFingerprint must hash the stored verbatim original-upload
 * bytes for current projects (matching what `/tempo` hashes for the same
 * file), falling back to the legacy Opus-at-rest bytes, then decoded
 * full-mix PCM, for older projects.
 */

jest.mock('onnxruntime-web', () => ({}));
jest.mock('../../../lyrics-align/model-cache', () => ({
  getCachedModel: jest.fn(),
}));
jest.mock('../../../tempo-map/stem-separation', () => ({
  separateDrumStem: jest.fn(),
}));
jest.mock('../../../audio/opus-encoder', () => ({
  encodePcmToOpus: jest.fn(async () => new Uint8Array([1])),
}));

const computeStemFingerprint = jest.fn(
  async (bytes: ArrayBuffer | Uint8Array, separatorId: string) => {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    return `fp(${Array.from(b).join(',')})|${separatorId}`;
  },
);
jest.mock('../../../audio-pipeline/stem-cache', () => ({
  computeStemFingerprint: (...args: unknown[]) =>
    (computeStemFingerprint as any)(...args),
  ROFORMER_SEPARATOR_ID:
    'https://huggingface.co/elicwhite/bs-roformer-sw-6stem-onnx/resolve/main/bs_roformer_sw_6stem_fp16.onnx|drums|stereo|44100|overlap0.25|fp16|libsoxr',
  storeStem: jest.fn(),
  loadStem: jest.fn(),
  hasStem: jest.fn(),
  storeStemOpus: jest.fn(),
  loadStemOpus: jest.fn(),
  hasStemOpus: jest.fn(),
}));

const getProject = jest.fn();
const updateProject = jest.fn(async () => {});
const readSongOpus = jest.fn();
const readOriginalAudio = jest.fn();
const loadFullMixPcm = jest.fn();

jest.mock('../../storage/opfs', () => ({
  getProject: (...args: unknown[]) => (getProject as any)(...args),
  updateProject: (...args: unknown[]) => (updateProject as any)(...args),
  readSongOpus: (...args: unknown[]) => (readSongOpus as any)(...args),
  readOriginalAudio: (...args: unknown[]) =>
    (readOriginalAudio as any)(...args),
  loadFullMixPcm: (...args: unknown[]) => (loadFullMixPcm as any)(...args),
}));

import {ensureProjectStemFingerprint} from '../roformer-separation';
import {ROFORMER_SEPARATOR_ID} from '../../../audio-pipeline/stem-cache';

describe('ensureProjectStemFingerprint', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getProject.mockResolvedValue({id: 'p1', stemFingerprint: undefined});
  });

  it('returns the persisted fingerprint without recomputing', async () => {
    getProject.mockResolvedValue({id: 'p1', stemFingerprint: 'already-set'});
    const fp = await ensureProjectStemFingerprint('p1');
    expect(fp).toBe('already-set');
    expect(readOriginalAudio).not.toHaveBeenCalled();
  });

  it('current project: hashes the stored verbatim original bytes', async () => {
    readOriginalAudio.mockResolvedValue({
      data: new Uint8Array([1, 2, 3]).buffer,
      extension: 'mp3',
    });
    const fp = await ensureProjectStemFingerprint('p1');
    expect(computeStemFingerprint).toHaveBeenCalledWith(
      expect.any(ArrayBuffer),
      ROFORMER_SEPARATOR_ID,
    );
    expect(fp).toBe(`fp(1,2,3)|${ROFORMER_SEPARATOR_ID}`);
    expect(readSongOpus).not.toHaveBeenCalled();
    expect(loadFullMixPcm).not.toHaveBeenCalled();
    expect(updateProject).toHaveBeenCalledWith('p1', {stemFingerprint: fp});
  });

  it('opus-at-rest project (no stored original): falls back to song.opus bytes', async () => {
    readOriginalAudio.mockResolvedValue(null);
    readSongOpus.mockResolvedValue(new Uint8Array([4, 5]).buffer);
    const fp = await ensureProjectStemFingerprint('p1');
    expect(fp).toBe(`fp(4,5)|${ROFORMER_SEPARATOR_ID}`);
    expect(loadFullMixPcm).not.toHaveBeenCalled();
  });

  it('oldest projects (neither original nor song.opus): falls back to decoded full-mix PCM', async () => {
    readOriginalAudio.mockResolvedValue(null);
    readSongOpus.mockResolvedValue(null);
    loadFullMixPcm.mockResolvedValue(new Float32Array([1, 2]));
    const fp = await ensureProjectStemFingerprint('p1');
    expect(loadFullMixPcm).toHaveBeenCalledWith('p1');
    expect(fp).toContain(`|${ROFORMER_SEPARATOR_ID}`);
  });
});
