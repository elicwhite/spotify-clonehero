import {redirect} from 'next/navigation';
import AccountClient from './AccountClient';
import getSpotifyApi from '@/lib/spotify-server/getSpotifyApi';
import {createClient} from '@/lib/supabase/server';

export default async function AccountPage() {
  const supabase = await createClient();
  const {data, error} = await supabase.auth.getUser();

  if (error || !data?.user) {
    redirect('/auth/login?next=/account');
  }

  const hasSpotifyIdentity =
    data?.user?.identities?.find(i => i.provider === 'spotify') != null;

  // Load saved songs server-side
  const {data: savedRows} = await supabase
    .from('user_saved_songs')
    .select('song_hash,difficulty,enchor_songs(name,artist,charter,hash)')
    .eq('user_id', data.user.id);

  const rows = savedRows ?? [];

  const initialSavedSongs = rows
    .map(row => {
      const s = row.enchor_songs;
      if (!s) return null;

      return {
        hash: s.hash as string,
        title: (s.name ?? '') as string,
        artist: (s.artist ?? '') as string,
        charter: (s.charter ?? '') as string,
        difficulty: row.difficulty as string | undefined,
      };
    })
    .filter(Boolean) as Array<{
    hash: string;
    title: string;
    artist: string;
    charter: string;
    difficulty?: string;
  }>;

  return (
    <AccountClient
      initialSavedSongs={initialSavedSongs}
      spotifyLinked={hasSpotifyIdentity}
    />
  );
}
