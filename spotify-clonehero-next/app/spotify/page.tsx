import dynamic from 'next/dynamic';

const Spotify = dynamic(() => import('./Spotify'), {
  ssr: false,
});

export default function Page() {
  return <Spotify />;
}
