import {createClient} from '@/lib/supabase/server';

export async function getServerSupabase() {
  return createClient();
}

export type ProtectedAccessToken = {
  access_token: string;
  expires_at: Date;
};

export function isTokenExpired(token: ProtectedAccessToken) {
  return token.expires_at < new Date();
}

export async function getSpotifyAccessToken(
  userId: string,
): Promise<ProtectedAccessToken | null> {
  const supabase = await getServerSupabase();

  const {data, error} = await supabase
    .from('spotify_tokens')
    .select('access_token, refresh_token, expires_at')
    .eq('user_id', userId)
    .single();

  if (error || !data) return null;

  const expiresAt = new Date(data.expires_at);
  const conservativeExpiresAt = expiresAt.getTime() - 30_000;
  if (conservativeExpiresAt > Date.now()) {
    return {
      access_token: data.access_token,
      expires_at: new Date(conservativeExpiresAt),
    };
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  let tokenResp: Response | null = null;

  try {
    tokenResp = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization:
          'Basic ' +
          Buffer.from(clientId + ':' + clientSecret).toString('base64'),
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: data.refresh_token,
      }),
    });
  } catch (error) {
    console.error('Failed to refresh Spotify access token', error);
    return null;
  }

  if (!tokenResp.ok) return null;

  const tokenJson = await tokenResp.json();

  const newAccessToken = tokenJson.access_token as string;

  const newExpiresAt = new Date(tokenJson.expires_in);

  await supabase
    .from('spotify_tokens')
    .update({
      access_token: newAccessToken,
      expires_at: newExpiresAt.toISOString(),
    })
    .eq('user_id', userId);

  return {
    access_token: newAccessToken,
    expires_at: new Date(newExpiresAt.getTime() - 30_000),
  };
}

export async function unlinkSpotify(userId: string) {
  const supabase = await getServerSupabase();

  await supabase.from('spotify_tokens').delete().eq('user_id', userId);
}
