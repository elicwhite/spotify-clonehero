import {
  DEFAULT_PANEL_HEIGHT,
  MAX_PANEL_HEIGHT,
  MIN_PANEL_HEIGHT,
  PANEL_HEIGHT_STORAGE_KEY,
  clampPanelHeight,
  loadPanelHeight,
  savePanelHeight,
} from '../panelHeight';

/** Minimal in-memory Storage stand-in. */
function fakeStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
    removeItem: (k: string) => {
      data.delete(k);
    },
    clear: () => data.clear(),
    key: () => null,
    get length() {
      return data.size;
    },
  } as Storage;
}

describe('panelHeight: clamp', () => {
  it('clamps within [MIN, MAX]', () => {
    expect(clampPanelHeight(0)).toBe(MIN_PANEL_HEIGHT);
    expect(clampPanelHeight(MIN_PANEL_HEIGHT - 1)).toBe(MIN_PANEL_HEIGHT);
    expect(clampPanelHeight(MAX_PANEL_HEIGHT + 1)).toBe(MAX_PANEL_HEIGHT);
    expect(clampPanelHeight(300)).toBe(300);
  });

  it('falls back to the default for non-finite input', () => {
    expect(clampPanelHeight(Number.NaN)).toBe(DEFAULT_PANEL_HEIGHT);
    expect(clampPanelHeight(Number.POSITIVE_INFINITY)).toBe(
      DEFAULT_PANEL_HEIGHT,
    );
  });
});

describe('panelHeight: load', () => {
  it('returns the default when nothing is stored', () => {
    expect(loadPanelHeight(fakeStorage())).toBe(DEFAULT_PANEL_HEIGHT);
  });

  it('returns the default when there is no storage at all (SSR)', () => {
    expect(loadPanelHeight(null)).toBe(DEFAULT_PANEL_HEIGHT);
  });

  it('reads and clamps a stored value', () => {
    const storage = fakeStorage({[PANEL_HEIGHT_STORAGE_KEY]: '320'});
    expect(loadPanelHeight(storage)).toBe(320);
  });

  it('clamps an out-of-range stored value', () => {
    const storage = fakeStorage({[PANEL_HEIGHT_STORAGE_KEY]: '9999'});
    expect(loadPanelHeight(storage)).toBe(MAX_PANEL_HEIGHT);
  });

  it('falls back to the default on unparseable content', () => {
    const storage = fakeStorage({[PANEL_HEIGHT_STORAGE_KEY]: 'not-a-number'});
    expect(loadPanelHeight(storage)).toBe(DEFAULT_PANEL_HEIGHT);
  });

  it('falls back to the default when storage throws', () => {
    const storage: Storage = {
      getItem: () => {
        throw new Error('blocked');
      },
    } as unknown as Storage;
    expect(loadPanelHeight(storage)).toBe(DEFAULT_PANEL_HEIGHT);
  });
});

describe('panelHeight: save + round trip', () => {
  it('persists a clamped value under the shared key', () => {
    const storage = fakeStorage();
    savePanelHeight(280, storage);
    expect(storage.getItem(PANEL_HEIGHT_STORAGE_KEY)).toBe('280');
    expect(loadPanelHeight(storage)).toBe(280);
  });

  it('clamps before writing', () => {
    const storage = fakeStorage();
    savePanelHeight(MAX_PANEL_HEIGHT + 500, storage);
    expect(loadPanelHeight(storage)).toBe(MAX_PANEL_HEIGHT);
  });

  it('swallows a storage write error', () => {
    const storage: Storage = {
      setItem: () => {
        throw new Error('quota exceeded');
      },
    } as unknown as Storage;
    expect(() => savePanelHeight(280, storage)).not.toThrow();
  });

  it('uses one key regardless of caller — the shared-across-pages invariant', () => {
    // Two independent "host pages" sharing the same underlying storage (as
    // they do in a real browser — one origin, one localStorage) must read
    // back what the other wrote, because both go through the same key.
    const storage = fakeStorage();
    savePanelHeight(333, storage); // simulates /drum-transcription
    expect(loadPanelHeight(storage)).toBe(333); // /drum-edit reads the same value
  });
});
