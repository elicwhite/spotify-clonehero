'use client';

import {useEffect, useMemo, useState} from 'react';
import SpotifyLoaderCard, {LoaderPlaylist} from './SpotifyLoaderCard';

function generateMockPlaylists(): LoaderPlaylist[] {
  return [
    {
      id: '1',
      name: 'Discover Weekly',
      totalSongs: 30,
      scannedSongs: 18,
      isScanning: true,
      creator: 'Spotify',
    },
    {
      id: '2',
      name: 'My Liked Songs',
      totalSongs: 247,
      scannedSongs: 247,
      isScanning: false,
      creator: 'You',
    },
    {
      id: '3',
      name: 'Road Trip Vibes',
      totalSongs: 45,
      scannedSongs: 32,
      isScanning: true,
      creator: 'You',
    },
    {
      id: '4',
      name: 'Release Radar',
      totalSongs: 30,
      scannedSongs: 30,
      isScanning: false,
      creator: 'Spotify',
    },
    {
      id: '5',
      name: 'Chill Indie Folk',
      totalSongs: 89,
      scannedSongs: 12,
      isScanning: true,
      creator: 'You',
    },
    {
      id: '6',
      name: 'Daily Mix 1',
      totalSongs: 50,
      scannedSongs: 50,
      isScanning: false,
      creator: 'Spotify',
    },
    {
      id: '7',
      name: 'Workout Hits',
      totalSongs: 67,
      scannedSongs: 45,
      isScanning: true,
      creator: 'You',
    },
    {
      id: '8',
      name: 'Jazz Classics',
      totalSongs: 156,
      scannedSongs: 156,
      isScanning: false,
      creator: 'You',
    },
  ];
}

export default function SpotifyLoaderMock() {
  const [playlists, setPlaylists] = useState<LoaderPlaylist[]>(
    generateMockPlaylists(),
  );
  const [rateLimitCountdown, setRateLimitCountdown] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setPlaylists(prev =>
        prev.map(playlist => {
          if (
            playlist.isScanning &&
            playlist.scannedSongs < playlist.totalSongs
          ) {
            const increment = Math.floor(Math.random() * 3) + 1;
            const newScanned = Math.min(
              playlist.scannedSongs + increment,
              playlist.totalSongs,
            );
            return {
              ...playlist,
              scannedSongs: newScanned,
              isScanning: newScanned < playlist.totalSongs,
            };
          }
          return playlist;
        }),
      );
    }, 1500);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const rateLimitInterval = setInterval(() => {
      if (Math.random() < 0.1 && rateLimitCountdown === 0) {
        setRateLimitCountdown(15);
      }
    }, 5000);
    return () => clearInterval(rateLimitInterval);
  }, [rateLimitCountdown]);

  useEffect(() => {
    if (rateLimitCountdown > 0) {
      const countdownInterval = setInterval(() => {
        setRateLimitCountdown(prev => (prev > 0 ? prev - 1 : 0));
      }, 1000);
      return () => clearInterval(countdownInterval);
    }
  }, [rateLimitCountdown]);

  return (
    <SpotifyLoaderCard
      playlists={playlists}
      rateLimitCountdown={rateLimitCountdown}
      title="Inspecting Spotify Library (Mock)"
    />
  );
}
