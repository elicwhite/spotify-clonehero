import assert from 'node:assert/strict';
import {afterEach, beforeEach, describe, it} from 'node:test';
import {publicUrl} from '../src/load/load';

// A render serves the public folder under a static base; staticFile reads it
// from the page's window. Each test file runs in its own process.
const page = globalThis as {window?: unknown};

describe('publicUrl', () => {
  beforeEach(() => {
    page.window = {remotion_staticBase: '/static-0123abcd'};
  });
  afterEach(() => {
    delete page.window;
  });

  it('serves a public path under the static base, encoded per segment', () => {
    assert.equal(
      publicUrl('generated/rec/take one/manifest.json'),
      '/static-0123abcd/generated/rec/take%20one/manifest.json',
    );
  });

  it('allows a leading slash', () => {
    assert.equal(
      publicUrl('/generated/timeline.json'),
      '/static-0123abcd/generated/timeline.json',
    );
  });

  it('refuses a URL that is already served, instead of doubling it', () => {
    const url = publicUrl('generated/rec/a/manifest.json');
    assert.throws(
      () => publicUrl(url),
      /already prefixed with the static base/,
    );
  });
});
