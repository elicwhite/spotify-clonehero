'use client';

import dynamic from 'next/dynamic';

const SpotifyTest = dynamic(() => import('./SpotifyTest'), {
  ssr: false,
});

export default function Page() {
  return <SpotifyTest />;
}
