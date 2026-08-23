/**
 * `metadataBase` is baked into the prerendered HTML at build time, so a wrong
 * value here ships an `og:image` that unfurl services (Discord, Slack,
 * Bluesky) cannot fetch, and the card renders without its image. The
 * production answer must not depend on a deploy-time variable: a build that
 * runs outside Vercel has none of them.
 *
 * `NODE_ENV` is written the way `redirect-config.test.ts` writes it — the
 * type says the value is fixed, and for the duration of one test it is not.
 */

import {getSiteUrl} from '../lib/site-url';

/**
 * Every variable the answer must not depend on. `VERCEL_PROJECT_PRODUCTION_URL`
 * and `VERCEL_ENV` are the pair the removed production branch read, so a guard
 * that clears and sets only `VERCEL_URL` would pass with that branch restored.
 */
const VERCEL_VARS = {
  VERCEL_ENV: 'production',
  VERCEL_PROJECT_PRODUCTION_URL: 'my-app.vercel.app',
  VERCEL_URL: 'my-app-abc123-team.vercel.app',
};

const OVERRIDE = 'NEXT_PUBLIC_SITE_URL';
const previous = {...process.env};

function setNodeEnv(value: string) {
  (process.env as any).NODE_ENV = value;
}

beforeEach(() => {
  delete process.env[OVERRIDE];
  for (const name of Object.keys(VERCEL_VARS)) delete process.env[name];
  setNodeEnv('production');
});

afterAll(() => {
  process.env = previous;
});

describe('getSiteUrl', () => {
  it('is the canonical domain in a production build with no env set', () => {
    expect(getSiteUrl().toString()).toBe('https://musiccharts.tools/');
  });

  // The regression this guards has shipped twice. Vercel's own variables are
  // no longer an input, and a build that resolves them must not start
  // preferring them again.
  it('ignores every Vercel-supplied URL', () => {
    Object.assign(process.env, VERCEL_VARS);
    expect(getSiteUrl().toString()).toBe('https://musiccharts.tools/');
  });

  it('prefers an explicit NEXT_PUBLIC_SITE_URL', () => {
    process.env[OVERRIDE] = 'https://preview.example.com';
    expect(getSiteUrl().toString()).toBe('https://preview.example.com/');
  });

  it('is localhost in development', () => {
    setNodeEnv('development');
    expect(getSiteUrl().toString()).toBe('http://localhost:3000/');
  });
});
