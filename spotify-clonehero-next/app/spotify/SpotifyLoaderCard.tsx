'use client';

import {useState, useEffect} from 'react';
import {Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card';
import {Loader2, User, Clock, Check} from 'lucide-react';
import {Icons} from '@/components/icons';

interface Playlist {
  id: string;
  name: string;
  creator: string;
  totalSongs: number;
  scannedSongs: number;
  isScanning: boolean;
  coverUrl?: string;
}

// Mock data for demonstration
const mockPlaylists: Playlist[] = [
  {
    id: '1',
    name: 'Discover Weekly',
    creator: 'Spotify',
    totalSongs: 30,
    scannedSongs: 18,
    isScanning: true,
  },
  {
    id: '2',
    name: 'My Liked Songs',
    creator: 'You',
    totalSongs: 247,
    scannedSongs: 247,
    isScanning: false,
  },
  {
    id: '3',
    name: 'Road Trip Vibes',
    creator: 'You',
    totalSongs: 45,
    scannedSongs: 32,
    isScanning: true,
  },
  {
    id: '4',
    name: 'Release Radar',
    creator: 'Spotify',
    totalSongs: 30,
    scannedSongs: 30,
    isScanning: false,
  },
  {
    id: '5',
    name: 'Chill Indie Folk',
    creator: 'You',
    totalSongs: 89,
    scannedSongs: 12,
    isScanning: true,
  },
  {
    id: '6',
    name: 'Daily Mix 1',
    creator: 'Spotify',
    totalSongs: 50,
    scannedSongs: 50,
    isScanning: false,
  },
  {
    id: '7',
    name: 'Workout Hits',
    creator: 'You',
    totalSongs: 67,
    scannedSongs: 45,
    isScanning: true,
  },
  {
    id: '8',
    name: 'Jazz Classics',
    creator: 'You',
    totalSongs: 156,
    scannedSongs: 156,
    isScanning: false,
  },
];

const CircularProgress = ({
  value,
  size = 20,
}: {
  value: number;
  size?: number;
}) => {
  const radius = (size - 4) / 2;
  const circumference = radius * 2 * Math.PI;
  const strokeDasharray = circumference;
  const strokeDashoffset = circumference - (value / 100) * circumference;
  const isComplete = value >= 100;

  return (
    <div
      className="relative flex items-center justify-center"
      style={{width: size, height: size}}>
      <svg
        width={size}
        height={size}
        className={`transform -rotate-90 transition-opacity duration-500 ${isComplete ? 'opacity-0' : 'opacity-100'}`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="currentColor"
          strokeWidth="2"
          fill="transparent"
          className="text-muted-foreground/20"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="currentColor"
          strokeWidth="2"
          fill="transparent"
          strokeDasharray={strokeDasharray}
          strokeDashoffset={strokeDashoffset}
          className="text-primary transition-all duration-300 ease-in-out"
          strokeLinecap="round"
        />
      </svg>

      <div
        className={`absolute inset-0 flex items-center justify-center transition-all duration-500 ${
          isComplete ? 'opacity-100 scale-100' : 'opacity-0 scale-75'
        }`}>
        <Check className="h-3 w-3 text-green-600 dark:text-green-400" />
      </div>
    </div>
  );
};

export default function SpotifyLoaderCard() {
  const [playlists, setPlaylists] = useState<Playlist[]>(mockPlaylists);
  const [isRateLimited, setIsRateLimited] = useState(false);
  const [rateLimitCountdown, setRateLimitCountdown] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setPlaylists(prev =>
        prev.map(playlist => {
          if (
            playlist.isScanning &&
            playlist.scannedSongs < playlist.totalSongs
          ) {
            const newScanned = Math.min(
              playlist.scannedSongs + Math.floor(Math.random() * 3) + 1,
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
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const rateLimitInterval = setInterval(() => {
      if (Math.random() < 0.1 && !isRateLimited) {
        setIsRateLimited(true);
        setRateLimitCountdown(15);
      }
    }, 5000);

    return () => clearInterval(rateLimitInterval);
  }, [isRateLimited]);

  useEffect(() => {
    if (isRateLimited && rateLimitCountdown > 0) {
      const countdownInterval = setInterval(() => {
        setRateLimitCountdown(prev => {
          if (prev <= 1) {
            setIsRateLimited(false);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      return () => clearInterval(countdownInterval);
    }
  }, [isRateLimited, rateLimitCountdown]);

  const getProgressPercentage = (scanned: number, total: number) => {
    return Math.round((scanned / total) * 100);
  };

  const fullyFetchedPlaylists = playlists.filter(
    p => p.scannedSongs === p.totalSongs,
  ).length;
  const totalPlaylists = playlists.length;
  const scanningPlaylists = playlists.filter(p => p.isScanning);

  const totalRemainingSongs = scanningPlaylists.reduce(
    (acc, p) => acc + (p.totalSongs - p.scannedSongs),
    0,
  );
  const estimatedMinutesRemaining = Math.ceil(totalRemainingSongs / 10);
  const timeRemainingText =
    estimatedMinutesRemaining > 0
      ? `~${estimatedMinutesRemaining}m remaining`
      : 'Almost done!';

  return (
    <div className="bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-2xl">
        <CardHeader className="pb-4">
          <CardTitle className="text-2xl font-bold text-center flex items-center justify-center gap-2">
            <Icons.spotify className="h-6 w-6 text-primary" />
            Inspecting Spotify Library
          </CardTitle>
          <p className="text-muted-foreground text-center text-sm">
            Scanning your playlists for analysis...
          </p>

          <div className="flex items-center justify-center gap-6 mt-4 pt-4 border-t">
            <div className="text-center">
              <div className="text-lg font-semibold text-foreground">
                {fullyFetchedPlaylists} / {totalPlaylists}
              </div>
              <div className="text-xs text-muted-foreground">
                Playlists Complete
              </div>
            </div>
            <div className="text-center">
              <div className="text-lg font-semibold text-foreground">
                {timeRemainingText}
              </div>
              <div className="text-xs text-muted-foreground">
                Estimated Time
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isRateLimited && (
            <div className="mx-6 mb-4 p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg">
              <div className="flex items-center gap-2 text-amber-800 dark:text-amber-200">
                <Clock className="h-4 w-4" />
                <span className="text-sm font-medium">
                  Rate limited - continuing in {rateLimitCountdown} seconds
                </span>
              </div>
            </div>
          )}

          <div className="h-96 overflow-y-auto px-6 pb-6">
            <div className="space-y-2">
              {playlists.map(playlist => (
                <div
                  key={playlist.id}
                  className="flex items-center gap-3 p-2 rounded-md border bg-card hover:bg-accent/5 transition-colors">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <h3 className="font-medium text-sm truncate text-foreground">
                      {playlist.name}
                    </h3>
                    <span className="text-xs text-muted-foreground flex items-center gap-1 flex-shrink-0">
                      {playlist.creator === 'You' ? (
                        <User className="h-3 w-3" />
                      ) : (
                        <div className="w-3 h-3 bg-primary rounded-full flex items-center justify-center">
                          <div className="w-1.5 h-1.5 bg-primary-foreground rounded-full" />
                        </div>
                      )}
                      {playlist.creator}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-xs text-muted-foreground">
                      {playlist.scannedSongs} / {playlist.totalSongs}
                    </span>
                    <div className="flex items-center gap-1">
                      <CircularProgress
                        value={getProgressPercentage(
                          playlist.scannedSongs,
                          playlist.totalSongs,
                        )}
                      />
                      {playlist.isScanning && (
                        <Loader2 className="h-3 w-3 animate-spin text-accent" />
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
