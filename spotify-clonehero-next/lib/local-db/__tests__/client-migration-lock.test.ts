/** @jest-environment jsdom */

jest.mock('sqlocal/kysely', () => ({SQLocalKysely: jest.fn()}));

import {LOCAL_DB_MIGRATION_LOCK} from '@/lib/web-locks';
import {getLocalDb} from '../client';

/**
 * Kysely's SQLite adapter makes `acquireMigrationLock` a no-op because it
 * assumes one connection. SQLocal gives every tab its own connection to the same
 * OPFS file, so this lock is the only thing serializing two migrators.
 *
 * `SQLocalKysely` is mocked as a bare `jest.fn()`, so opening the database fails
 * immediately. That is deliberate: these tests are about what wraps the open, not
 * what the open does.
 */
describe('local database migration lock', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('opens and migrates inside the cross-tab lock', async () => {
    const request = jest.fn(
      async (_name: string, _options: unknown, callback: () => Promise<void>) =>
        callback(),
    );
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: {request},
    });

    await expect(getLocalDb()).rejects.toBeDefined();

    expect(request).toHaveBeenCalledWith(
      LOCAL_DB_MIGRATION_LOCK,
      {mode: 'exclusive'},
      expect.any(Function),
    );
  });

  // A browser without Web Locks still opens the database correctly with one tab.
  // Refusing to open it would remove a working case to prevent a race that needs
  // two.
  it('still opens the database when Web Locks are unavailable', async () => {
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: undefined,
    });

    const {SQLocalKysely} = jest.requireMock('sqlocal/kysely') as {
      SQLocalKysely: jest.Mock;
    };

    await expect(getLocalDb()).rejects.toBeDefined();
    expect(SQLocalKysely).toHaveBeenCalled();
  });

  // The open above fails synchronously, so the failure path used to run before
  // the cached promise was assigned, and the rejected promise then replaced the
  // reset. Every later call returned that first rejection, so `Try again` could
  // not recover and only a reload could.
  it('retries after a failed open instead of replaying the first rejection', async () => {
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: undefined,
    });

    const {SQLocalKysely} = jest.requireMock('sqlocal/kysely') as {
      SQLocalKysely: jest.Mock;
    };

    await expect(getLocalDb()).rejects.toBeDefined();
    await expect(getLocalDb()).rejects.toBeDefined();

    expect(SQLocalKysely).toHaveBeenCalledTimes(2);
  });
});
