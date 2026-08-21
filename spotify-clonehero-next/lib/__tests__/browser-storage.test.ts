import {
  collectEarnedPersistence,
  getPersistencePermission,
  getStoragePressure,
  isStoragePersisted,
  requestPersistentStorage,
} from '../browser-storage';

/** Installs a `navigator.storage` for the duration of one test. */
function setStorage(storage: unknown): void {
  Object.defineProperty(navigator, 'storage', {
    value: storage,
    configurable: true,
  });
}

/** Installs a `navigator.permissions` for the duration of one test. */
function setPermissions(permissions: unknown): void {
  Object.defineProperty(navigator, 'permissions', {
    value: permissions,
    configurable: true,
  });
}

/**
 * A `navigator.permissions` that answers `state`, and records what it was
 * asked. The name matters: an unrecognized one throws in a real browser, which
 * reads as 'unknown' and silently stops every browser from ever persisting.
 */
function permissionsAnswering(state: PermissionState) {
  const query = jest.fn(async (_descriptor: {name: string}) => ({state}));
  return {query};
}

const originalStorage = Object.getOwnPropertyDescriptor(navigator, 'storage');
const originalPermissions = Object.getOwnPropertyDescriptor(
  navigator,
  'permissions',
);

afterEach(() => {
  if (originalStorage) {
    Object.defineProperty(navigator, 'storage', originalStorage);
  } else {
    setStorage(undefined);
  }
  if (originalPermissions) {
    Object.defineProperty(navigator, 'permissions', originalPermissions);
  } else {
    setPermissions(undefined);
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

describe('getPersistencePermission', () => {
  it('asks for the persistent-storage permission by name', async () => {
    const permissions = permissionsAnswering('granted');
    setPermissions(permissions);

    expect(await getPersistencePermission()).toBe('granted');
    expect(permissions.query).toHaveBeenCalledWith({
      name: 'persistent-storage',
    });
  });

  it('answers unknown where the API has no query()', async () => {
    setPermissions({});
    expect(await getPersistencePermission()).toBe('unknown');
  });

  it('answers unknown where the name is not recognized', async () => {
    // Querying an unknown permission name is a TypeError, not a 'denied'.
    setPermissions({
      query: async () => {
        throw new TypeError('unsupported permission');
      },
    });
    expect(await getPersistencePermission()).toBe('unknown');

    setPermissions(undefined);
    expect(await getPersistencePermission()).toBe('unknown');
  });
});

describe('requestPersistentStorage', () => {
  it('passes the browser answer through', async () => {
    setStorage({persist: async () => true});
    expect(await requestPersistentStorage()).toBe(true);

    setStorage({persist: async () => false});
    expect(await requestPersistentStorage()).toBe(false);
  });

  it('answers false where the call is missing or fails', async () => {
    setStorage({});
    expect(await requestPersistentStorage()).toBe(false);

    setStorage({
      persist: async () => {
        throw new Error('denied');
      },
    });
    expect(await requestPersistentStorage()).toBe(false);
  });
});

describe('collectEarnedPersistence', () => {
  it('asks when the permission is already granted', async () => {
    const persist = jest.fn(async () => true);
    setStorage({persisted: async () => false, persist});
    setPermissions(permissionsAnswering('granted'));

    expect(await collectEarnedPersistence()).toBe(true);
    expect(persist).toHaveBeenCalled();
  });

  it('reports a refusal from a granted permission', async () => {
    setStorage({persisted: async () => false, persist: async () => false});
    setPermissions(permissionsAnswering('granted'));

    expect(await collectEarnedPersistence()).toBe(false);
  });

  // 'prompt' is the state a browser reports when it would put the question to
  // the user, and 'denied' the state after the user answered no. Asking in
  // either is wrong: the first interrupts a visitor on first paint, and the
  // second overrides an answer they already gave.
  it.each(['prompt', 'denied'] as const)(
    'does not ask when the permission state is %s',
    async state => {
      const persist = jest.fn(async () => true);
      setStorage({persisted: async () => false, persist});
      setPermissions(permissionsAnswering(state));

      expect(await collectEarnedPersistence()).toBe(false);
      expect(persist).not.toHaveBeenCalled();
    },
  );

  it('does not ask when the Permissions API cannot answer', async () => {
    const persist = jest.fn(async () => true);
    setStorage({persisted: async () => false, persist});
    setPermissions(undefined);

    expect(await collectEarnedPersistence()).toBe(false);
    expect(persist).not.toHaveBeenCalled();
  });

  it('reports nothing collected when storage is already persistent', async () => {
    // False here means "nothing changed", not "not persistent". The caller
    // re-reads the quota on a true, and that read is the expensive one.
    const persist = jest.fn(async () => true);
    const query = jest.fn();
    setStorage({persisted: async () => true, persist});
    setPermissions({query});

    expect(await collectEarnedPersistence()).toBe(false);
    expect(persist).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });
});
