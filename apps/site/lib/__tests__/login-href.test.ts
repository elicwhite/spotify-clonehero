import {loginHref} from '@/lib/supabase/login-href';

describe('loginHref', () => {
  test('returns to the current page and its query', () => {
    expect(
      loginHref('/find-music', new URLSearchParams('view=playlists')),
    ).toBe('/auth/login?next=%2Ffind-music%3Fview%3Dplaylists');
  });

  test('returns to a page with no query', () => {
    expect(loginHref('/tempo', new URLSearchParams())).toBe(
      '/auth/login?next=%2Ftempo',
    );
  });

  test('on the login page, keeps its next instead of nesting itself', () => {
    expect(
      loginHref('/auth/login', new URLSearchParams('next=%2Fadd-lyrics')),
    ).toBe('/auth/login?next=%2Fadd-lyrics');
  });

  test('on an auth page with no next, adds none', () => {
    expect(
      loginHref('/auth/login', new URLSearchParams('error=invalid_token')),
    ).toBe('/auth/login');
  });
});
