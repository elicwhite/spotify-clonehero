import dynamic from 'next/dynamic';

const SpotifyHistory = dynamic(() => import('./SpotifyHistory'), {
  ssr: false,
});

export default function Page() {
  return <SpotifyHistory />;
}
