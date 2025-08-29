
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export default async function storeSpotifyToken() {

  try {
    const supabase = await createClient()

    const [{ data: sessionData }, { data: userData }] = await Promise.all([
      supabase.auth.getSession(),
      supabase.auth.getUser(),
    ])

    const user = userData?.user
    const session = sessionData?.session

    if (!user || !session) {
      // User is not authenticated
      return null;
    }

    // Supabase exposes provider tokens on the session immediately after an OAuth flow
    // Fields may be undefined when not returning from an OAuth flow; handle gracefully
    const accessToken = session.provider_token as string | undefined
    const refreshToken = session.provider_refresh_token as string | undefined

    if (!accessToken) {
      // No provider token on session
      return null;
    }

    // Pick a likely reasonable default. 
    const expiresAt = new Date(Date.now() + 3600 * 1000)

    const { error: upsertError } = await supabase
      .from('spotify_tokens')
      .upsert({
        user_id: user.id,
        access_token: accessToken,
        refresh_token: refreshToken ?? '',
        expires_at: expiresAt.toISOString(),
      }, { onConflict: 'user_id' })

    if (upsertError) {
      return upsertError.message;
    }

    return 'success';
  } catch (err: any) {
    // Unexpected error
    // err?.message
    return null;
  }
}