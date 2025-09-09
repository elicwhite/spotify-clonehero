'use client';

import {useCallback, useEffect, useMemo, useRef, useState, memo} from 'react';
import {useInView} from 'react-intersection-observer';
import {Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card';
import {Loader2, User, Users, Clock, Check, Info, Disc3} from 'lucide-react';
import {Icons} from '@/components/icons';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  MAX_PLAYLIST_TRACKS_TO_FETCH,
  SpotifyLibraryUpdateProgress,
} from '@/lib/spotify-sdk/SpotifyFetching';
import useInterval from 'use-interval';

/* 
For some reason this isn't actually updating in real time when clearing the indexeddb cache.
*/

export type LoaderPlaylist = {
  id: string;
  name: string;
  totalSongs: number;
  scannedSongs: number;
  isScanning: boolean;
  creator?: string;
  coverUrl?: string;
  isCollaborative?: boolean;
  isAlbum?: boolean;
};

type Props = {
  progress: SpotifyLibraryUpdateProgress;
  autoScroll?: boolean;
};

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

export default function SpotifyLoaderCard({
  progress,
  autoScroll = true,
}: Props) {
  const rateLimitCountdown =
    progress.rateLimitCountdown?.retryAfterSeconds ?? 0;
  const isRateLimited = rateLimitCountdown > 0;

  const [countdown, setCountdown] = useState(rateLimitCountdown);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<{[id: string]: HTMLDivElement | null}>({});
  const prevFirstScanningId = useRef<string | null>(null);
  const [inViewMap, setInViewMap] = useState<{[id: string]: boolean}>({});
  const [etaTick, setEtaTick] = useState(0);
  const scanStartTimeRef = useRef<number | null>(null);
  const initialCachedCountsRef = useRef<{[id: string]: number}>({});

  const handleRowRef = useCallback((id: string, el: HTMLDivElement | null) => {
    itemRefs.current[id] = el;
  }, []);

  const handleInViewChange = useCallback((id: string, inView: boolean) => {
    setInViewMap(prev =>
      prev[id] === inView ? prev : {...prev, [id]: inView},
    );
  }, []);

  useInterval(
    () => {
      setCountdown(prev => (prev > 0 ? prev - 1 : 0));
    },
    countdown > 0 ? 1000 : null,
  );

  const allItems: LoaderPlaylist[] = useMemo(() => {
    return Object.values(progress.playlists)
      .map(p => {
        return {
          id: p.id,
          name: p.name,
          totalSongs: p.total,
          scannedSongs: p.fetched,
          isScanning: p.status === 'fetching',
          creator: p.owner.displayName,
          isCollaborative: p.collaborative,
          isAlbum: false,
        };
      })
      .concat(
        Object.values(progress.albums).map(a => {
          return {
            id: a.id,
            name: a.name,
            totalSongs: a.totalTracks ?? 0,
            scannedSongs: a.fetched ?? 0,
            isScanning: a.status === 'fetching',
            creator: a.artistName ?? '',
            isAlbum: true,
            isCollaborative: false,
          };
        }),
      );
  }, [progress.playlists, progress.albums]);

  const fullyFetchedPlaylists = useMemo(
    () =>
      allItems.filter(
        p =>
          p.totalSongs === 0 ||
          p.scannedSongs >= p.totalSongs ||
          p.totalSongs > MAX_PLAYLIST_TRACKS_TO_FETCH,
      ).length,
    [allItems],
  );
  const totalPlaylists = allItems.length;
  const scanningPlaylists = useMemo(
    () => allItems.filter(p => p.isScanning),
    [allItems],
  );

  // Aggregate song counts for fresh scanning only (excluding cached songs and skipped playlists)
  const {totalSongsToScan, totalSongsScannedFresh} = useMemo(() => {
    return allItems.reduce(
      (acc, playlist) => {
        if (playlist.totalSongs > MAX_PLAYLIST_TRACKS_TO_FETCH) return acc;

        // Get initial cached count (stored when scanning started)
        const initialCached = initialCachedCountsRef.current[playlist.id] || 0;

        // Songs that need fresh scanning = total - initially cached
        const songsToScan = Math.max(0, playlist.totalSongs - initialCached);

        // Songs scanned fresh = current scanned - initially cached
        const songsScannedFresh = Math.max(
          0,
          (playlist.scannedSongs || 0) - initialCached,
        );

        acc.totalSongsToScan += songsToScan;
        acc.totalSongsScannedFresh += songsScannedFresh;
        return acc;
      },
      {totalSongsToScan: 0, totalSongsScannedFresh: 0},
    );
  }, [allItems]);

  const totalRemainingSongs = scanningPlaylists.reduce(
    (acc, p) => acc + Math.max(0, p.totalSongs - p.scannedSongs),
    0,
  );
  const estimatedSecondsRemainingHeuristic = Math.ceil(
    (totalRemainingSongs / 10) * 60,
  );
  const hasStarted = useMemo(
    () => allItems.some(p => p.isScanning || p.scannedSongs > 0),
    [allItems],
  );

  // Helper function to format seconds into a pretty time string
  const formatTimeRemaining = (seconds: number): string => {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.ceil(seconds / 60)}m`;
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.ceil((seconds % 3600) / 60);
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  };

  // Initialize scan start timestamp and cache initial cached counts when scanning begins
  useEffect(() => {
    if (
      (progress.updateStatus === 'fetching' || hasStarted) &&
      !scanStartTimeRef.current
    ) {
      scanStartTimeRef.current = Date.now();

      // Store initial cached counts for each item
      allItems.forEach(item => {
        if (!initialCachedCountsRef.current[item.id]) {
          initialCachedCountsRef.current[item.id] = item.scannedSongs || 0;
        }
      });
    }
    if (progress.updateStatus === 'complete') {
      // keep the timestamp for now; could be reset if needed later
    }
  }, [progress.updateStatus, hasStarted, allItems]);

  // Tick periodically during fetching to refresh ETA calculations
  useEffect(() => {
    if (progress.updateStatus !== 'fetching') return;
    const interval = setInterval(() => setEtaTick(t => t + 1), 5000);
    return () => clearInterval(interval);
  }, [progress.updateStatus]);

  // Compute ETA using observed rate since scan started (only for fresh scanning)
  const observedEtaSeconds = useMemo(() => {
    if (!scanStartTimeRef.current) return null;
    const elapsedMs = Date.now() - scanStartTimeRef.current;
    const elapsedSeconds = elapsedMs / 1000;
    const songsScannedFresh = totalSongsScannedFresh;
    const totalSongsToScanCount = totalSongsToScan;
    const remaining = Math.max(0, totalSongsToScanCount - songsScannedFresh);
    if (elapsedSeconds <= 0 || songsScannedFresh <= 0) return null;
    const ratePerSecond = songsScannedFresh / elapsedSeconds;
    if (ratePerSecond <= 0) return null;
    return Math.ceil(remaining / ratePerSecond);
  }, [totalSongsScannedFresh, totalSongsToScan, etaTick]);
  const timeRemainingText = (() => {
    // Prefer explicit update status when provided
    if (progress.updateStatus === 'idle') return 'Ready to scan';
    if (progress.updateStatus === 'complete') return 'Finished!';
    if (progress.updateStatus === 'fetching') {
      const etaSeconds =
        observedEtaSeconds ?? estimatedSecondsRemainingHeuristic;
      if (scanningPlaylists.length > 0 && etaSeconds > 0) {
        return `~${formatTimeRemaining(etaSeconds)} remaining`;
      }
      if (scanningPlaylists.length > 0) return 'Almost done!';
      return 'Scanning...';
    }

    return 'Ready to scan';

    // // Fallback to inferred heuristics
    // if (!hasStarted) return 'Ready to scan';
    // if (fullyFetchedPlaylists === totalPlaylists) return 'Finished!';
    // if (scanningPlaylists.length > 0 && estimatedMinutesRemaining > 0)
    //   return `~${estimatedMinutesRemaining}m remaining`;
    // if (scanningPlaylists.length > 0) return 'Almost done!';
    // return 'Ready to scan';
  })();

  useEffect(() => {
    // Find the first in-progress playlist
    const firstScanning = allItems.find(p => p.isScanning) || null;
    const currentId = firstScanning?.id ?? null;

    if (!autoScroll) {
      prevFirstScanningId.current = currentId;
      return;
    }

    // Only act when the first in-progress changes (i.e., previous completed)
    if (currentId === prevFirstScanningId.current) return;

    prevFirstScanningId.current = currentId;
    if (!currentId) return;

    const container = containerRef.current;
    const target = itemRefs.current[currentId];
    if (!container || !target) return;

    const isVisible = inViewMap[currentId];
    if (!isVisible) {
      target.scrollIntoView({behavior: 'smooth', block: 'center'});
    }
  }, [allItems]);

  return (
    <div className="bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-2xl">
        <CardHeader className="pb-4">
          <CardTitle className="text-2xl font-bold text-center flex items-center justify-center gap-2">
            <Icons.spotify className="h-6 w-6" style={{color: '#1ED760'}} />
            Inspecting Spotify Library
          </CardTitle>
          <p className="text-muted-foreground text-center text-sm">
            Scanning your playlists for songs...
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
                  Rate limited - continuing in {countdown} seconds
                </span>
              </div>
            </div>
          )}

          <div ref={containerRef} className="h-96 overflow-y-auto px-6 pb-6">
            <div className="border rounded-lg bg-card overflow-hidden">
              {allItems.map(playlist => (
                <PlaylistRow
                  key={playlist.id}
                  playlist={playlist}
                  onRef={handleRowRef}
                  onInViewChange={handleInViewChange}
                  root={containerRef.current}
                />
              ))}
            </div>
            {/* Albums are merged into the same list above */}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

const PlaylistRow = memo(function PlaylistRow({
  playlist,
  onRef,
  onInViewChange,
  root,
}: {
  playlist: LoaderPlaylist;
  onRef: (id: string, el: HTMLDivElement | null) => void;
  onInViewChange: (id: string, inView: boolean) => void;
  root: Element | null;
}) {
  const {ref, inView} = useInView({root, threshold: 0});
  const getProgressPercentage = useCallback(
    (scanned: number, total: number) => {
      if (total === 0) return 100;
      return Math.round((scanned / total) * 100);
    },
    [],
  );

  useEffect(() => {
    onInViewChange(playlist.id, inView);
  }, [inView, onInViewChange, playlist.id]);

  const setRefs = useCallback(
    (el: HTMLDivElement | null) => {
      onRef(playlist.id, el);
      // forward to intersection observer ref
      (ref as (el: Element | null) => void)(el);
    },
    [onRef, playlist.id, ref],
  );

  return (
    <div
      ref={setRefs}
      className="flex items-center gap-3 p-3 hover:bg-accent/5 transition-colors border-b">
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <h3 className="font-medium text-sm truncate text-foreground">
          {playlist.name}
        </h3>
        {playlist.creator && (
          <span className="text-xs text-muted-foreground flex items-center gap-1 flex-shrink-0">
            {playlist.isAlbum ? (
              <Disc3 className="h-3 w-3" />
            ) : playlist.isCollaborative ? (
              <Users className="h-3 w-3" />
            ) : (
              <User className="h-3 w-3" />
            )}
            {playlist.creator}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        {playlist.totalSongs > MAX_PLAYLIST_TRACKS_TO_FETCH ? (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-xs text-muted-foreground underline decoration-dotted cursor-default">
                  Skipping Playlist. Too long.
                </span>
              </TooltipTrigger>
              <TooltipContent>
                Skipping playlists with over {MAX_PLAYLIST_TRACKS_TO_FETCH}{' '}
                songs. Has {playlist.totalSongs} songs
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : (
          <span className="text-xs text-muted-foreground">
            {playlist.scannedSongs} / {playlist.totalSongs}
          </span>
        )}
        <div className="flex items-center gap-1">
          {playlist.totalSongs > MAX_PLAYLIST_TRACKS_TO_FETCH ? (
            <Info className="h-3 w-3 text-muted-foreground" />
          ) : (
            <>
              <CircularProgress
                value={getProgressPercentage(
                  Math.min(playlist.scannedSongs, playlist.totalSongs),
                  playlist.totalSongs,
                )}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
});

PlaylistRow.displayName = 'PlaylistRow';
