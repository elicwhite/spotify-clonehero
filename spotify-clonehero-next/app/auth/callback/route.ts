import {NextResponse} from 'next/server';
// The client you created from the Server-Side Auth instructions
import {createClient} from '@/lib/supabase/server';
import storeSpotifyToken from '@/app/api/spotify/store-tokens/storeSpotifyToken';

export async function GET(request: Request) {
  const {searchParams, origin} = new URL(request.url);
  const code = searchParams.get('code');
  // if "next" is in param, use it as the redirect URL
  let next = searchParams.get('next') ?? '/';
  if (!next.startsWith('/')) {
    // if "next" is not a relative URL, use the default
    next = '/';
  }

  const oauthError = searchParams.get('error');
  const oauthErrorCode = searchParams.get('error_code');
  if (oauthError || oauthErrorCode) {
    const nextParam = next ? `&next=${encodeURIComponent(next)}` : '';
    const errorParam = oauthErrorCode || oauthError || 'oauth_error';
    return NextResponse.redirect(
      `${origin}/auth/login?error=${errorParam}${nextParam}`,
    );
  }

  const supabase = await createClient();

  if (code) {
    const {error: exchangeCodeError} =
      await supabase.auth.exchangeCodeForSession(code);
    const {data, error} = await supabase.auth.getSession();

    if (!exchangeCodeError) {
      const appMetadata = data?.session?.user?.app_metadata;

      const providersIncludeSpotify =
        appMetadata?.provider == 'spotify' ||
        (appMetadata?.providers || []).includes('spotify');
      if (providersIncludeSpotify) {
        await storeSpotifyToken();
      }

      const forwardedHost = request.headers.get('x-forwarded-host'); // original origin before load balancer
      const isLocalEnv = process.env.NODE_ENV === 'development';
      if (isLocalEnv) {
        // we can be sure that there is no load balancer in between, so no need to watch for X-Forwarded-Host
        return NextResponse.redirect(`${origin}${next}`);
      } else if (forwardedHost) {
        return NextResponse.redirect(`https://${forwardedHost}${next}`);
      } else {
        return NextResponse.redirect(`${origin}${next}`);
      }
    } else {
      console.log('Auth callback error', error);
    }
  } else {
    return NextResponse.redirect(`${origin}${next}`);
  }
  // return the user to an error page with instructions
  return NextResponse.redirect(`${origin}/auth/login?error=invalid_token`);
}
