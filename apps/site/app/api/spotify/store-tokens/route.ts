import {NextResponse} from 'next/server';
import {createClient} from '@/lib/supabase/server';

export async function POST() {
  try {
    const supabase = await createClient();

    const [{data: sessionData}, {data: userData}] = await Promise.all([
      supabase.auth.getSession(),
      supabase.auth.getUser(),
    ]);

    const user = userData?.user;
    const session = sessionData?.session;

    if (!user || !session) {
      return NextResponse.json(
        {ok: false, error: 'Not authenticated'},
        {status: 401},
      );
    }

    // Supabase exposes provider tokens on the session immediately after an OAuth flow
    // Fields may be undefined when not returning from an OAuth flow; handle gracefully
    const accessToken = (session as any).provider_token as string | undefined;
    const refreshToken = (session as any).provider_refresh_token as
      | string
      | undefined;
    const expiresInSec = (session as any).provider_token_expires_in as
      | number
      | undefined;

    if (!accessToken) {
      return NextResponse.json(
        {ok: false, error: 'No provider token on session'},
        {status: 200},
      );
    }

    const expiresAt = new Date(Date.now() + (expiresInSec ?? 3600) * 1000);

    const {error: upsertError} = await supabase.from('spotify_tokens').upsert(
      {
        user_id: user.id,
        access_token: accessToken,
        refresh_token: refreshToken ?? '',
        expires_at: expiresAt.toISOString(),
      },
      {onConflict: 'user_id'},
    );

    if (upsertError) {
      return NextResponse.json(
        {ok: false, error: upsertError.message},
        {status: 500},
      );
    }

    return NextResponse.json({ok: true});
  } catch (err: any) {
    return NextResponse.json(
      {ok: false, error: err?.message ?? 'Unexpected error'},
      {status: 500},
    );
  }
}
