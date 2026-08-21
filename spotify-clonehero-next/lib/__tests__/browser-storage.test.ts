import {getStoragePressure, isStoragePersisted} from '../browser-storage';

/** Installs a `navigator.storage` for the duration of one test. */
function setStorage(storage: unknown): void {
  Object.defineProperty(navigator, 'storage', {
    value: storage,
    configurable: true,
  });
}

const originalStorage = Object.getOwnPropertyDescriptor(navigator, 'storage');

afterEach(() => {
  if (originalStorage) {
    Object.defineProperty(navigator, 'storage', originalStorage);
  } else {
    setStorage(undefined);
  }
});

describe('getStoragePressure', () => {
  it('reports usage against the quota', async () => {
    setStorage({estimate: async () => ({usage: 250, quota: 1000})});

    expect(await getStoragePressure()).toEqual({
      usageBytes: 250,
      quotaBytes: 1000,
      ratio: 0.25,
    });
  });

  it('reads an unreported quota as no pressure, not as full', async () => {
    setStorage({estimate: async () => ({usage: 500})});

    // Dividing by a missing quota would report an origin holding 500 bytes
    // as 50000% full.
    expect(await getStoragePressure()).toEqual({
      usageBytes: 500,
      quotaBytes: 0,
      ratio: 0,
    });
  });

  it('answers null where the browser has no estimate()', async () => {
    setStorage({});

    expect(await getStoragePressure()).toBeNull();
  });

  it('answers null when estimate() rejects', async () => {
    setStorage({
      estimate: async () => {
        throw new Error('denied');
      },
    });

    expect(await getStoragePressure()).toBeNull();
  });
});

describe('isStoragePersisted', () => {
  it('passes the browser answer through', async () => {
    setStorage({persisted: async () => true});
    expect(await isStoragePersisted()).toBe(true);

    setStorage({persisted: async () => false});
    expect(await isStoragePersisted()).toBe(false);
  });

  it('answers false where the call is missing or fails', async () => {
    setStorage({});
    expect(await isStoragePersisted()).toBe(false);

    setStorage({
      persisted: async () => {
        throw new Error('denied');
      },
    });
    expect(await isStoragePersisted()).toBe(false);
  });
});
