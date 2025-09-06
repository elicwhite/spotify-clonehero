import dynamic from 'next/dynamic';

const Spotify = dynamic(() => import('./Spotify'));

export const metadata = {
  title: 'Spotfy Chart Finder',
  description: 'Find Charts for songs in your Spotify Library',
};

export default function Page() {
  return <Spotify />;
}
