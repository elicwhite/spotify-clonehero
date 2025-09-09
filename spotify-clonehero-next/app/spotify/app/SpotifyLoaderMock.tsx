'use client';

import {useEffect, useMemo, useState} from 'react';
import SpotifyLoaderCard from './SpotifyLoaderCard';
import {SpotifyLibraryUpdateProgress} from '@/lib/spotify-sdk/SpotifyFetching';

function generateMockProgress(): SpotifyLibraryUpdateProgress {
  return {
    playlists: {
      snapshot1: {
        id: '1',
        name: 'Discover Weekly',
        total: 30,
        fetched: 18,
        status: 'fetching',
        owner: {displayName: 'Spotify', externalUrl: ''},
        externalUrl: '',
        collaborative: false,
      },
      snapshot2: {
        id: '2',
        name: 'My Liked Songs',
        total: 247,
        fetched: 247,
        status: 'done',
        owner: {displayName: 'You', externalUrl: ''},
        externalUrl: '',
        collaborative: false,
      },
      snapshot3: {
        id: '3',
        name: 'Road Trip Vibes',
        total: 45,
        fetched: 32,
        status: 'fetching',
        owner: {displayName: 'You', externalUrl: ''},
        externalUrl: '',
        collaborative: false,
      },
      snapshot4: {
        id: '4',
        name: 'Release Radar',
        total: 30,
        fetched: 30,
        status: 'done',
        owner: {displayName: 'Spotify', externalUrl: ''},
        externalUrl: '',
        collaborative: false,
      },
      snapshot5: {
        id: '5',
        name: 'Chill Indie Folk',
        total: 89,
        fetched: 12,
        status: 'fetching',
        owner: {displayName: 'You', externalUrl: ''},
        externalUrl: '',
        collaborative: false,
      },
      snapshot6: {
        id: '6',
        name: 'Daily Mix 1',
        total: 50,
        fetched: 50,
        status: 'done',
        owner: {displayName: 'Spotify', externalUrl: ''},
        externalUrl: '',
        collaborative: false,
      },
      snapshot7: {
        id: '7',
        name: 'Workout Hits',
        total: 67,
        fetched: 45,
        status: 'fetching',
        owner: {displayName: 'You', externalUrl: ''},
        externalUrl: '',
        collaborative: false,
      },
      snapshot8: {
        id: '8',
        name: 'Jazz Classics',
        total: 156,
        fetched: 156,
        status: 'done',
        owner: {displayName: 'You', externalUrl: ''},
        externalUrl: '',
        collaborative: false,
      },
    },
    albums: {
      album1: {
        id: 'album1',
        name: 'Random Access Memories',
        artistName: 'Daft Punk',
        totalTracks: 13,
        fetched: 8,
        status: 'fetching',
        addedAt: '2023-01-15T10:30:00Z',
      },
      album2: {
        id: 'album2',
        name: 'Abbey Road',
        artistName: 'The Beatles',
        totalTracks: 17,
        fetched: 17,
        status: 'done',
        addedAt: '2023-02-20T14:45:00Z',
      },
    },
    rateLimitCountdown: null,
    updateStatus: 'fetching',
  };
}

export default function SpotifyLoaderMock() {
  const [progress, setProgress] = useState<SpotifyLibraryUpdateProgress>(
    generateMockProgress(),
  );

  useEffect(() => {
    const interval = setInterval(() => {
      setProgress(prev => ({
        ...prev,
        playlists: Object.fromEntries(
          Object.entries(prev.playlists).map(([snapshotId, playlist]) => {
            if (
              playlist.status === 'fetching' &&
              playlist.fetched < playlist.total
            ) {
              const increment = Math.floor(Math.random() * 3) + 1;
              const newFetched = Math.min(
                playlist.fetched + increment,
                playlist.total,
              );
              return [
                snapshotId,
                {
                  ...playlist,
                  fetched: newFetched,
                  status: newFetched < playlist.total ? 'fetching' : 'done',
                },
              ];
            }
            return [snapshotId, playlist];
          }),
        ),
        albums: Object.fromEntries(
          Object.entries(prev.albums).map(([albumId, album]) => {
            if (
              album.status === 'fetching' &&
              (album.fetched ?? 0) < (album.totalTracks ?? 0)
            ) {
              const increment = Math.floor(Math.random() * 2) + 1;
              const newFetched = Math.min(
                (album.fetched ?? 0) + increment,
                album.totalTracks ?? 0,
              );
              return [
                albumId,
                {
                  ...album,
                  fetched: newFetched,
                  status:
                    newFetched < (album.totalTracks ?? 0) ? 'fetching' : 'done',
                },
              ];
            }
            return [albumId, album];
          }),
        ),
      }));
    }, 1500);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const rateLimitInterval = setInterval(() => {
      if (Math.random() < 0.1 && !progress.rateLimitCountdown) {
        setProgress(prev => ({
          ...prev,
          rateLimitCountdown: {retryAfterSeconds: 15},
        }));
      }
    }, 5000);
    return () => clearInterval(rateLimitInterval);
  }, [progress.rateLimitCountdown]);

  useEffect(() => {
    if (
      progress.rateLimitCountdown &&
      progress.rateLimitCountdown.retryAfterSeconds > 0
    ) {
      const countdownInterval = setInterval(() => {
        setProgress(prev => ({
          ...prev,
          rateLimitCountdown: prev.rateLimitCountdown
            ? {
                retryAfterSeconds: Math.max(
                  0,
                  prev.rateLimitCountdown.retryAfterSeconds - 1,
                ),
              }
            : null,
        }));
      }, 1000);
      return () => clearInterval(countdownInterval);
    }
  }, [progress.rateLimitCountdown]);

  return <SpotifyLoaderCard progress={progress} />;
}
