import {type NextRequest} from 'next/server';
import {updateSession} from './lib/supabase/middleware';
import {
  REGION_ALLOWED,
  REGION_COOKIE,
  REGION_EEA,
  VERCEL_COUNTRY_HEADER,
  isEeaCountry,
} from './lib/analytics/region';

export async function proxy(request: NextRequest) {
  const response = await updateSession(request);

  // Stamp a region cookie so RegionAwareAnalytics can decide whether to
  // load gtag.js at all. EEA/UK/CH visitors never get GA — there's no
  // analytics processing to consent to. Cookie is long-lived (1 year) so
  // the classification persists across sessions; we only re-write when
  // the desired value differs from what the browser sent, since Vercel's
  // edge cache treats Set-Cookie as private. (The Supabase auth
  // middleware already sets cookies on every response, so this just
  // rides along with the existing cost.)
  const country = request.headers.get(VERCEL_COUNTRY_HEADER);
  const desired = isEeaCountry(country) ? REGION_EEA : REGION_ALLOWED;
  const existing = request.cookies.get(REGION_COOKIE)?.value;
  if (existing !== desired) {
    response.cookies.set(REGION_COOKIE, desired, {
      maxAge: 60 * 60 * 24 * 365,
      sameSite: 'lax',
      secure: true,
      path: '/',
    });
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - api routes (to avoid interfering with API calls)
     * - wasm files (for SQLocal)
     * Feel free to modify this pattern to include more paths.
     */
    '/((?!_next/static|_next/image|favicon.ico|api|.*\\.(?:svg|png|jpg|jpeg|gif|webp|wasm)$).*)',
  ],
};
