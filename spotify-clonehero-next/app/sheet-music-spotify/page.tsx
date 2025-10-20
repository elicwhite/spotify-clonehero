import dynamic from 'next/dynamic';

// const SheetMusicSpotify = dynamic(() => import('./SheetMusicSpotify'));
const SpotifyLibrary = dynamic(() => import('./SpotifyLibrary'));

export default function Page() {
  return <SpotifyLibrary />;
}
