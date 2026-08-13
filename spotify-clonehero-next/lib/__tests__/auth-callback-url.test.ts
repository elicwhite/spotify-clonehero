/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "https://musiccharts.tools"}
 */
import {getAuthCallbackUrl} from '@/lib/supabase/auth-callback-url';

describe('getAuthCallbackUrl', () => {
  const origin = 'https://musiccharts.tools';

  test('builds the callback URL with no next path', () => {
    expect(getAuthCallbackUrl()).toBe(`${origin}/auth/callback`);
  });

  test('adds the next path as a query parameter', () => {
    expect(getAuthCallbackUrl('/account')).toBe(
      `${origin}/auth/callback?next=%2Faccount`,
    );
  });

  test('encodes a next path that has a query string of its own', () => {
    expect(getAuthCallbackUrl('/find-music?view=playlists')).toBe(
      `${origin}/auth/callback?next=%2Ffind-music%3Fview%3Dplaylists`,
    );
  });

  test('treats an empty next path as absent', () => {
    expect(getAuthCallbackUrl('')).toBe(`${origin}/auth/callback`);
  });

  test('treats a null next path as absent, as URLSearchParams.get returns', () => {
    expect(getAuthCallbackUrl(null)).toBe(`${origin}/auth/callback`);
  });
});
