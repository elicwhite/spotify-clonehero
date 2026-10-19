import {NextResponse} from 'next/server';
import {getAppleMusicDeveloperToken} from '@/lib/apple-music-server/developer-token';

export const runtime = 'nodejs';

export async function GET() {
  const token = getAppleMusicDeveloperToken();
  if (!token) {
    return NextResponse.json(
      {error: 'Apple Music is not configured'},
      {status: 503},
    );
  }

  return NextResponse.json(token, {
    headers: {'Cache-Control': 'no-store'},
  });
}
