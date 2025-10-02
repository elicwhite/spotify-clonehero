// 'use client';

import dynamic from 'next/dynamic';

const SpotifyHistoryTest = dynamic(() => import('./SpotifyHistoryTest'));

export default function Page() {
  return <SpotifyHistoryTest />;
}
