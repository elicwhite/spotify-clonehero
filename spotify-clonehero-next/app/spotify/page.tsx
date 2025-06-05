'use client';

import dynamic from 'next/dynamic';

const Spotify = dynamic(() => import('./Spotify'));

export default function Page() {
  return <Spotify />;
}
