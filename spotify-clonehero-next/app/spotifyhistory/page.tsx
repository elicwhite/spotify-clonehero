// 'use client';

// import dynamic from 'next/dynamic';

// const SpotifyHistory = dynamic(() => import('./SpotifyHistory'));
import SpotifyHistory from './SpotifyHistory';

export default function Page() {
  return <SpotifyHistory />;
}
