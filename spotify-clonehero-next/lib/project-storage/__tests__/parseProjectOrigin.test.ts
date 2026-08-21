/**
 * Reading a tool's identity out of the editor's `?from=` parameter
 * (plan 0105 Stage 1).
 *
 * This is the guard that has to be in place BEFORE the tool routes become
 * redirects. After that change a project is created at `/chart-editor` with
 * no chart yet, so without `from` every landing page would stamp its own
 * charts `chart-editor` — and an origin lost that way is not recoverable by
 * any later analysis.
 */

import {parseProjectOrigin, PROJECT_ORIGINS} from '../types';

test('every real origin round-trips', () => {
  for (const origin of PROJECT_ORIGINS) {
    expect(parseProjectOrigin(origin)).toBe(origin);
  }
});

test('a chart started on the editor itself has no from parameter', () => {
  expect(parseProjectOrigin(null)).toBeNull();
  expect(parseProjectOrigin(undefined)).toBeNull();
  expect(parseProjectOrigin('')).toBeNull();
});

test('anything that is not a tool is rejected', () => {
  // The value comes from the URL, so anyone can type anything into it.
  expect(parseProjectOrigin('tempo-map')).toBeNull();
  expect(parseProjectOrigin('TEMPO')).toBeNull();
  expect(parseProjectOrigin('constructor')).toBeNull();
  expect(parseProjectOrigin('__proto__')).toBeNull();
});
