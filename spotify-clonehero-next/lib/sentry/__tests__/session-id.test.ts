/** @jest-environment jsdom */

const setUser = jest.fn();

jest.mock('@sentry/nextjs', () => ({
  setUser: (...args: unknown[]) => setUser(...args),
}));

import {SESSION_ID_KEY, identifySession} from '../session-id';

/** Installs a `window.sessionStorage` for the duration of one test. */
function setSessionStorage(storage: unknown): void {
  Object.defineProperty(window, 'sessionStorage', {
    value: storage,
    configurable: true,
  });
}

const realSessionStorage = window.sessionStorage;

beforeEach(() => {
  setUser.mockClear();
  setSessionStorage(realSessionStorage);
  window.sessionStorage.clear();
});

/**
 * The id exists so an issue can say how many browsers it reached. It must stay
 * anonymous while doing that: a value that outlived the tab, or that carried
 * anything about the user, would be a tracking identifier rather than a count.
 */
describe('identifySession', () => {
  it('identifies the session by a random id it stores for the tab', () => {
    identifySession();

    const stored = window.sessionStorage.getItem(SESSION_ID_KEY);
    expect(stored).toEqual(expect.any(String));
    // The id is the whole of what Sentry is told. Any other field here would
    // be information about the user that no error report needs.
    expect(setUser).toHaveBeenCalledWith({id: stored});
    expect(Object.keys(setUser.mock.calls[0][0])).toEqual(['id']);
  });

  it('keeps one id for the life of the tab', () => {
    identifySession();
    const first = window.sessionStorage.getItem(SESSION_ID_KEY);

    identifySession();

    expect(window.sessionStorage.getItem(SESSION_ID_KEY)).toBe(first);
    expect(setUser).toHaveBeenNthCalledWith(2, {id: first});
  });

  it('stores nothing outside the tab', () => {
    identifySession();

    expect(window.localStorage.getItem(SESSION_ID_KEY)).toBeNull();
    expect(document.cookie).not.toContain(SESSION_ID_KEY);
  });

  it('reports errors from a session it cannot count', () => {
    setSessionStorage({
      getItem: () => {
        throw new DOMException('Access denied', 'SecurityError');
      },
      setItem: () => undefined,
    });

    expect(() => identifySession()).not.toThrow();
    expect(setUser).not.toHaveBeenCalled();
  });
});
