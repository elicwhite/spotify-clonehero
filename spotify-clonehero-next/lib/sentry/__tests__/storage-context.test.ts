const setTag = jest.fn();
const setContext = jest.fn();

jest.mock('@sentry/nextjs', () => ({
  setTag: (...args: unknown[]) => setTag(...args),
  setContext: (...args: unknown[]) => setContext(...args),
}));

import {attachStorageContext} from '../storage-context';

/** Installs a `navigator.storage` for the duration of one test. */
function setStorage(storage: unknown): void {
  Object.defineProperty(navigator, 'storage', {
    value: storage,
    configurable: true,
  });
}

beforeEach(() => {
  setTag.mockClear();
  setContext.mockClear();
});

/**
 * These assertions pin names, not behavior. The tag key and the context field
 * names are what a triager searches on months later, from a saved query
 * written against the first eviction report. A rename that no other test
 * notices turns that query into zero rows, and the readings it was built to
 * find are unrecoverable.
 */
describe('attachStorageContext', () => {
  it('reports the quota reading under stable names', async () => {
    setStorage({
      estimate: async () => ({usage: 250, quota: 1000}),
      persisted: async () => true,
    });

    await attachStorageContext();

    expect(setTag).toHaveBeenCalledWith('storage.persisted', true);
    expect(setContext).toHaveBeenCalledWith('storage', {
      persisted: true,
      estimateAvailable: true,
      usageBytes: 250,
      quotaBytes: 1000,
      ratio: 0.25,
    });
  });

  it('still reports persistence when the browser gives no estimate', async () => {
    setStorage({persisted: async () => false});

    await attachStorageContext();

    // Half a reading is worth reporting: "persistence was refused" explains
    // an eviction on its own.
    expect(setTag).toHaveBeenCalledWith('storage.persisted', false);
    expect(setContext).toHaveBeenCalledWith('storage', {
      persisted: false,
      estimateAvailable: false,
    });
  });

  it('stays quiet when Sentry itself throws', async () => {
    setStorage({
      estimate: async () => ({usage: 1, quota: 2}),
      persisted: async () => true,
    });
    setTag.mockImplementation(() => {
      throw new Error('no client');
    });

    // Called at page load with `void`, so a rejection here would surface as
    // an unhandled rejection — reported by Sentry as an error in the code
    // that only exists to describe storage.
    await expect(attachStorageContext()).resolves.toBeUndefined();

    setTag.mockReset();
  });
});
