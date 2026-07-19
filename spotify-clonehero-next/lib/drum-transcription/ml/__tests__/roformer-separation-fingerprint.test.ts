/**
 * Fingerprint-basis priority tests (plan 0063 Part A/B):
 * ensureProjectStemFingerprint must hash the stored Opus-at-rest bytes for
 * current projects, falling back to the legacy original-upload bytes, then
 * decoded full-mix PCM, for older projects.
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
jest.mock('../../storage/stem-cache', () => ({
  computeStemFingerprint: (...args: unknown[]) =>
    (computeStemFingerprint as any)(...args),
  storeCachedStem: jest.fn(),
  loadCachedStem: jest.fn(),
  hasCachedStem: jest.fn(),
  storeCachedStemOpus: jest.fn(),
  loadCachedStemOpus: jest.fn(),
  hasCachedStemOpus: jest.fn(),
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

import {
  ensureProjectStemFingerprint,
  DRUM_SEPARATOR_ID,
} from '../roformer-separation';

describe('ensureProjectStemFingerprint', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getProject.mockResolvedValue({id: 'p1', stemFingerprint: undefined});
  });

  it('returns the persisted fingerprint without recomputing', async () => {
    getProject.mockResolvedValue({id: 'p1', stemFingerprint: 'already-set'});
    const fp = await ensureProjectStemFingerprint('p1');
    expect(fp).toBe('already-set');
    expect(readSongOpus).not.toHaveBeenCalled();
  });

  it('current project: hashes the stored song.opus bytes', async () => {
    readSongOpus.mockResolvedValue(new Uint8Array([1, 2, 3]).buffer);
    const fp = await ensureProjectStemFingerprint('p1');
    expect(computeStemFingerprint).toHaveBeenCalledWith(
      expect.any(ArrayBuffer),
      DRUM_SEPARATOR_ID,
    );
    expect(fp).toBe(`fp(1,2,3)|${DRUM_SEPARATOR_ID}`);
    expect(readOriginalAudio).not.toHaveBeenCalled();
    expect(loadFullMixPcm).not.toHaveBeenCalled();
    expect(updateProject).toHaveBeenCalledWith('p1', {stemFingerprint: fp});
  });

  it('legacy project (no song.opus): falls back to the stored original upload', async () => {
    readSongOpus.mockResolvedValue(null);
    readOriginalAudio.mockResolvedValue({
      data: new Uint8Array([4, 5]).buffer,
      extension: 'mp3',
    });
    const fp = await ensureProjectStemFingerprint('p1');
    expect(fp).toBe(`fp(4,5)|${DRUM_SEPARATOR_ID}`);
    expect(loadFullMixPcm).not.toHaveBeenCalled();
  });

  it('oldest projects (neither song.opus nor original): falls back to decoded full-mix PCM', async () => {
    readSongOpus.mockResolvedValue(null);
    readOriginalAudio.mockResolvedValue(null);
    loadFullMixPcm.mockResolvedValue(new Float32Array([1, 2]));
    const fp = await ensureProjectStemFingerprint('p1');
    expect(loadFullMixPcm).toHaveBeenCalledWith('p1');
    expect(fp).toContain(`|${DRUM_SEPARATOR_ID}`);
  });
});
