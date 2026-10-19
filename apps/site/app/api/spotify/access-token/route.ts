import {NextResponse} from 'next/server';
import {createClient} from '@/lib/supabase/server';
import {getSpotifyAccessToken} from '@/lib/spotify-server/tokens';

export async function GET(request: Request) {
  const supabase = await createClient();
  const {data, error} = await supabase.auth.getUser();
  if (error || !data?.user) {
    return NextResponse.json({error: 'Unauthorized'}, {status: 401});
  }

  const referer = request.headers.get('referer');
  console.log('Referer:', referer);

  const token = await getSpotifyAccessToken(data.user.id);
  if (!token) {
    return NextResponse.json({error: 'No token'}, {status: 404});
  }
  return NextResponse.json(token);
}
