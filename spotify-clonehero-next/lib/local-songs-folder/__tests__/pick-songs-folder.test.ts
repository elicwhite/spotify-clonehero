/** @jest-environment jsdom */

jest.mock('idb-keyval', () => ({
  get: jest.fn(async () => undefined),
  set: jest.fn(async () => undefined),
}));
jest.mock('filenamify/browser', () => jest.fn());
jest.mock('../scanLocalCharts', () => jest.fn());
jest.mock('../../local-db/local-charts', () => ({
  upsertLocalCharts: jest.fn(),
}));

/**
 * `lib/local-songs-folder` caches the picked handle in a module-level variable
 * for the life of the page. Each test loads the module fresh, so one test's
 * picked folder cannot stand in for another's stored folder.
 */
async function loadSongsFolder() {
  jest.resetModules();
  const idb = await import('idb-keyval');
  const songsFolder = await import('@/lib/local-songs-folder');
  return {
    ...songsFolder,
    get: idb.get as jest.MockedFunction<typeof idb.get>,
    set: idb.set as jest.MockedFunction<typeof idb.set>,
  };
}

function grantedHandle(name: string) {
  return {
    name,
    queryPermission: jest.fn(async () => 'granted' as PermissionState),
    requestPermission: jest.fn(async () => 'granted' as PermissionState),
  };
}

function pickerReturning(handle: unknown) {
  const picker = jest.fn(async () => handle);
  Object.defineProperty(window, 'showDirectoryPicker', {
    configurable: true,
    value: picker,
  });
  return picker;
}

describe('picking a different Songs folder', () => {
  beforeEach(() => {
    jest.spyOn(window, 'alert').mockImplementation(() => {});
  });

  it('shows the picker even when a folder is already stored', async () => {
    const {getCachedSongsDirectoryHandle, pickSongsDirectory, get, set} =
      await loadSongsFolder();
    const stored = grantedHandle('Old Songs');
    get.mockResolvedValue(stored);
    // Cache the stored folder the way a page load does.
    await expect(getCachedSongsDirectoryHandle()).resolves.toBe(stored);

    const picked = grantedHandle('New Songs');
    const picker = pickerReturning(picked);

    await expect(pickSongsDirectory()).resolves.toBe(picked);
    expect(picker).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith('songsDirectoryHandle', picked);

    // The new folder replaces the cached one for every later caller.
    await expect(getCachedSongsDirectoryHandle()).resolves.toBe(picked);
  });

  it('shows no alert: this picker is one the user chose', async () => {
    const {pickSongsDirectory} = await loadSongsFolder();
    pickerReturning(grantedHandle('Songs'));

    await pickSongsDirectory();

    expect(window.alert).not.toHaveBeenCalled();
  });

  it('keeps the stored folder when the pick is cancelled', async () => {
    const {pickSongsDirectory, scanSongsDirectory, set} =
      await loadSongsFolder();
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: jest.fn(async () => {
        throw new DOMException('The user aborted a request.', 'AbortError');
      }),
    });

    await expect(pickSongsDirectory()).resolves.toBeNull();
    await expect(scanSongsDirectory(pickSongsDirectory)).resolves.toBeNull();
    expect(set).not.toHaveBeenCalled();
  });
});
