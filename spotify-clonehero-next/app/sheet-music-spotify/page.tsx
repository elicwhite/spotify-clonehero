import dynamic from 'next/dynamic';

const SheetMusicSpotify = dynamic(() => import('./SheetMusicSpotify'));

export default function Page() {
  return <SheetMusicSpotify />;
}
