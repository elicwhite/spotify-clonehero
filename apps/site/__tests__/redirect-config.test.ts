/**
 * Route-model redirects (plan 0074, 2026-08-03): `/difficulties` was renamed
 * to `/drum-difficulties`, and `/drum-edit`, `/guitar-edit` and `/bass-edit`
 * were folded into `/chart-editor`. Plan 0106 (2026-08-14) retired `/spotify`,
 * `/spotify/app` and `/spotifyhistory` into `/find-music`.
 *
 * Asserts on the array `next.config.js` actually returns, not on its source
 * text, so a redirect that names the right route but doesn't route (wrong key,
 * unreachable entry, `permanent` belonging to a different entry) fails here.
 * `NODE_ENV` is forced to `development` before the require so the file's
 * conditional `withSentryConfig` wrapping is skipped — that branch is a build
 * concern, not a routing one.
 */

type Redirect = {source: string; destination: string; permanent: boolean};

function loadRedirects(): Promise<Redirect[]> {
  const previous = process.env.NODE_ENV;
  (process.env as any).NODE_ENV = 'development';
  try {
    jest.resetModules();
    const config = require('../next.config.js');
    return config.redirects();
  } finally {
    (process.env as any).NODE_ENV = previous;
  }
}

describe('next.config.js redirects', () => {
  it.each([
    ['/difficulties', '/drum-difficulties'],
    ['/drum-edit', '/chart-editor'],
    ['/guitar-edit', '/chart-editor'],
    ['/bass-edit', '/chart-editor'],
    ['/spotify', '/find-music'],
    ['/spotify/app', '/find-music'],
    ['/spotifyhistory', '/find-music'],
  ])('permanently redirects %s to %s', async (source, destination) => {
    const redirects = await loadRedirects();
    expect(redirects).toContainEqual({source, destination, permanent: true});
  });
});
