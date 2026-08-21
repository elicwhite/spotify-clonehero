/**
 * @jest-environment jsdom
 */

import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';

import {StoragePanel} from '../storage/StoragePanel';

const getStoragePressure = jest.fn();
const isStoragePersisted = jest.fn();
const getPersistencePermission = jest.fn();
const requestPersistentStorage = jest.fn();
const listStemCacheEntries = jest.fn();
const pruneStemCache = jest.fn();
const getCachedModelBytes = jest.fn();
const measureProjectStorage = jest.fn();
const attachStorageContext = jest.fn();

jest.mock('../../lib/browser-storage', () => ({
  getStoragePressure: () => getStoragePressure(),
  isStoragePersisted: () => isStoragePersisted(),
  getPersistencePermission: () => getPersistencePermission(),
  requestPersistentStorage: () => requestPersistentStorage(),
}));

jest.mock('../../lib/audio-pipeline/stem-cache', () => ({
  listStemCacheEntries: () => listStemCacheEntries(),
  pruneStemCache: (options: unknown) => pruneStemCache(options),
}));

jest.mock('../../lib/lyrics-align/model-cache', () => ({
  getCachedModelBytes: () => getCachedModelBytes(),
}));

jest.mock('../../lib/project-storage/measureProjects', () => ({
  measureProjectStorage: () => measureProjectStorage(),
}));

jest.mock('../../lib/sentry/storage-context', () => ({
  attachStorageContext: () => attachStorageContext(),
}));

const MB = 1024 * 1024;

beforeEach(() => {
  jest.clearAllMocks();
  // A coherent origin: 60 of projects, 200 of stems, 336 of models, and 104
  // the page cannot name, adding up to the 700 reported.
  getStoragePressure.mockResolvedValue({
    usageBytes: 700 * MB,
    quotaBytes: 1000 * MB,
    ratio: 0.7,
  });
  isStoragePersisted.mockResolvedValue(true);
  getPersistencePermission.mockResolvedValue('granted');
  getCachedModelBytes.mockResolvedValue(336 * MB);
  measureProjectStorage.mockResolvedValue({projectCount: 3, bytes: 60 * MB});
  listStemCacheEntries.mockResolvedValue([
    {fingerprint: 'a', sizeBytes: 100 * MB, lastUsedMs: 1},
    {fingerprint: 'b', sizeBytes: 100 * MB, lastUsedMs: 2},
  ]);
  pruneStemCache.mockResolvedValue({
    deletedFingerprints: ['a', 'b'],
    freedBytes: 200 * MB,
    remainingBytes: 0,
  });
});

describe('StoragePanel', () => {
  it('reports usage, the cached stems, and whether storage is kept', async () => {
    render(<StoragePanel />);

    expect(await screen.findByText('700 MB of 1000 MB (70%)')).toBeVisible();
    expect(screen.getByText('2 songs, 200 MB')).toBeVisible();
    // The models are the largest single thing stored. Leaving them out left
    // the user unable to account for the difference between the two numbers
    // above, and the honest reading of that gap is "my charts are enormous".
    expect(screen.getByText('336 MB')).toBeVisible();
    // The user's own work, named. Without it the gap between the total and
    // the caches is unexplained, and the reading available to someone staring
    // at that gap is that their charts are the problem.
    expect(screen.getByText('3 projects, 60 MB')).toBeVisible();
    expect(screen.getByText('Yes')).toBeVisible();
    // 500 used, 60 + 200 + 336 named. Naming the remainder is what stops the
    // rows looking like they disagree with the total — the reading a user
    // reaches for when their charts have just vanished.
    expect(screen.getByText('104 MB')).toBeVisible();
  });

  it('never reports a negative remainder', async () => {
    // The cache walk and the estimate are taken at slightly different moments,
    // and the estimate rounds. Neither is a reason to show a number below zero.
    getStoragePressure.mockResolvedValue({
      usageBytes: 1 * MB,
      quotaBytes: 1000 * MB,
      ratio: 0.001,
    });

    render(<StoragePanel />);

    await screen.findByText('3 projects, 60 MB');
    expect(screen.getByText('0 B')).toBeVisible();
  });

  it('counts a song cached in both roots once', async () => {
    // The cache walk returns an entry per root, and a song separated before
    // the cache bucket existed and re-separated since is in both.
    listStemCacheEntries.mockResolvedValue([
      {fingerprint: 'a', sizeBytes: 100 * MB, lastUsedMs: 1},
      {fingerprint: 'a', sizeBytes: 100 * MB, lastUsedMs: 2},
    ]);

    render(<StoragePanel />);

    expect(await screen.findByText('1 song, 200 MB')).toBeVisible();
  });

  it('empties the cache outright, not to a budget', async () => {
    render(<StoragePanel />);

    const free = await screen.findByRole('button', {name: /Free/});
    await act(async () => {
      fireEvent.click(free);
    });

    // No floor: this is the one caller that means "delete all of it".
    expect(pruneStemCache).toHaveBeenCalledWith({targetBytes: 0});
    await waitFor(() => expect(listStemCacheEntries).toHaveBeenCalledTimes(2));
  });

  it.each(['granted', 'prompt', 'unknown'] as const)(
    'offers the ask when storage is not kept and the permission is %s',
    async permission => {
      // Granted-but-not-taken is a real state: the site collects persistence
      // on load, and the panel can read the old answer while that is still in
      // flight. One click settles it, silently, so the button belongs there
      // too. 'unknown' is Safari and anything without the permission name.
      isStoragePersisted.mockResolvedValue(false);
      getPersistencePermission.mockResolvedValue(permission);

      render(<StoragePanel />);

      expect(
        await screen.findByRole('button', {name: /keep your data/}),
      ).toBeVisible();
    },
  );

  it('does not offer the ask when storage is already persistent', async () => {
    getPersistencePermission.mockResolvedValue('prompt');
    isStoragePersisted.mockResolvedValue(true);

    render(<StoragePanel />);

    await screen.findByText('Yes');
    expect(screen.queryByRole('button', {name: /keep your data/})).toBeNull();
  });

  it('explains a refusal instead of offering a button that cannot work', async () => {
    isStoragePersisted.mockResolvedValue(false);
    getPersistencePermission.mockResolvedValue('denied');

    render(<StoragePanel />);

    expect(await screen.findByText(/site settings/)).toBeVisible();
    expect(screen.queryByRole('button', {name: /keep your data/})).toBeNull();
  });

  it('re-reports the storage state after winning persistence', async () => {
    isStoragePersisted.mockResolvedValue(false);
    getPersistencePermission.mockResolvedValue('prompt');
    requestPersistentStorage.mockResolvedValue(true);
    render(<StoragePanel />);

    const ask = await screen.findByRole('button', {name: /keep your data/});
    await act(async () => {
      fireEvent.click(ask);
    });

    // The Sentry tag written at load says this session is unprotected. Left
    // alone it would say that for the rest of the session's life.
    await waitFor(() => expect(attachStorageContext).toHaveBeenCalled());
  });

  it('says so when the browser reports no estimate', async () => {
    getStoragePressure.mockResolvedValue(null);

    render(<StoragePanel />);

    expect(await screen.findByText('This browser does not say')).toBeVisible();
  });

  it('still renders when the cache cannot be read', async () => {
    // Firefox private browsing has no OPFS at all. This is the page a user
    // opens because their storage misbehaved, so one failed reading must not
    // leave it saying "Reading storage…" for good.
    listStemCacheEntries.mockRejectedValue(new Error('no OPFS'));

    render(<StoragePanel />);

    expect(await screen.findByText('700 MB of 1000 MB (70%)')).toBeVisible();
    // The stems row degrades to None; the rest of the panel still reports.
    expect(screen.getByText('None')).toBeVisible();
    expect(screen.getByText('3 projects, 60 MB')).toBeVisible();
  });

  it('says so when another tab holds the prune lock', async () => {
    // A separation running in a second tab. Saying nothing would look like a
    // button that does nothing.
    pruneStemCache.mockResolvedValue(null);
    render(<StoragePanel />);

    const free = await screen.findByRole('button', {name: /Free/});
    await act(async () => {
      fireEvent.click(free);
    });

    expect(screen.getByRole('status')).toHaveTextContent(/Another tab/);
  });

  it('reports what was freed', async () => {
    render(<StoragePanel />);

    const free = await screen.findByRole('button', {name: /Free/});
    await act(async () => {
      fireEvent.click(free);
    });

    expect(screen.getByRole('status')).toHaveTextContent('Freed 200 MB.');
  });

  it('re-enables the buttons when an action fails', async () => {
    pruneStemCache.mockRejectedValue(new Error('refused'));
    render(<StoragePanel />);

    const free = await screen.findByRole('button', {name: /Free/});
    await act(async () => {
      fireEvent.click(free);
    });

    // Without a finally, one throw leaves a user staring at two dimmed
    // buttons on the page whose job is to give them an action.
    expect(free).toBeEnabled();
    expect(screen.getByRole('status')).toHaveTextContent(/would not let/);
  });

  it('says so when the browser refuses to keep the data', async () => {
    isStoragePersisted.mockResolvedValue(false);
    getPersistencePermission.mockResolvedValue('prompt');
    requestPersistentStorage.mockResolvedValue(false);
    render(<StoragePanel />);

    const ask = await screen.findByRole('button', {name: /keep your data/});
    await act(async () => {
      fireEvent.click(ask);
    });

    expect(screen.getByRole('status')).toHaveTextContent(/did not agree/);
    expect(attachStorageContext).not.toHaveBeenCalled();
  });

  it('hides the free button when nothing is cached', async () => {
    listStemCacheEntries.mockResolvedValue([]);

    render(<StoragePanel />);

    await screen.findByText('700 MB of 1000 MB (70%)');
    expect(screen.queryByRole('button', {name: /Free/})).toBeNull();
  });
});
