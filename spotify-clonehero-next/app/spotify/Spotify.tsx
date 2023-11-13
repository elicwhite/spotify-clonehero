'use client';

import {signIn, signOut, useSession} from 'next-auth/react';

import {useSpotifyTracks} from '@/lib/spotify-sdk/SpotifyFetching';
import Button from '@/components/Button';

export default function Spotify() {
  const session = useSession();

  if (!session || session.status !== 'authenticated') {
    return (
      <div>
        <h1>Spotify Web API Typescript SDK in Next.js</h1>
        <Button onClick={() => signIn('spotify')}>Sign in with Spotify</Button>
      </div>
    );
  }

  return (
    <div>
      <div>
        <p>Logged in as {session.data.user?.name}</p>
        <Button onClick={() => signOut()}>Sign out</Button>
      </div>
      <LoggedIn />
    </div>
  );
}

function LoggedIn() {
  const [tracks, update] = useSpotifyTracks();
  console.log(tracks);

  return (
    <>
      <Button onClick={update}>Refresh Your Saved Tracks from Spotify</Button>
    </>
  );
}
