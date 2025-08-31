import {redirect} from 'next/navigation';
import {createClient} from '@/lib/supabase/server';
import AccountClient from './AccountClient';
import getSpotifyApi from '@/lib/spotify-server/getSpotifyApi';

export default async function AccountPage() {
  const supabase = await createClient();
  const {data, error} = await supabase.auth.getUser();

  if (error || !data?.user) {
    redirect('/auth/login?next=/account');
  }

  const hasSpotifyIdentity =
    data?.user?.identities?.find(i => i.provider === 'spotify') != null;

  return (
    <AccountClient initialSavedSongs={[]} spotifyLinked={hasSpotifyIdentity} />
  );
}
