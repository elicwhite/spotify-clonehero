'use client';

import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
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
  type SavedAlbumItem,
} from '@/lib/spotify-sdk/SpotifyFetching';

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
  playlists: LoaderPlaylist[];
  rateLimitCountdown?: number;
  title?: string;
  autoScroll?: boolean;
  albums?: SavedAlbumItem[];
  updateStatus?: 'idle' | 'fetching' | 'complete';
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
  playlists,
  rateLimitCountdown,
  title,
  autoScroll = true,
  albums,
  updateStatus,
}: Props) {
  const isRateLimited = (rateLimitCountdown ?? 0) > 0;
  const [countdown, setCountdown] = useState(rateLimitCountdown ?? 0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<{[id: string]: HTMLDivElement | null}>({});
  const prevFirstScanningId = useRef<string | null>(null);
  const [inViewMap, setInViewMap] = useState<{[id: string]: boolean}>({});

  const handleRowRef = useCallback((id: string, el: HTMLDivElement | null) => {
    itemRefs.current[id] = el;
  }, []);

  const handleInViewChange = useCallback((id: string, inView: boolean) => {
    setInViewMap(prev =>
      prev[id] === inView ? prev : {...prev, [id]: inView},
    );
  }, []);

  useEffect(() => {
    setCountdown(rateLimitCountdown ?? 0);
  }, [rateLimitCountdown]);

  useEffect(() => {
    if (!isRateLimited || countdown <= 0) return;
    const t = setInterval(() => {
      setCountdown(prev => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(t);
  }, [isRateLimited, countdown]);

  const getProgressPercentage = (scanned: number, total: number) => {
    if (total === 0) return 100;
    return Math.round((scanned / total) * 100);
  };

  const allItems = useMemo(() => {
    const albumAsPlaylists: LoaderPlaylist[] = (albums ?? []).map(a => ({
      id: a.id,
      name: a.name,
      totalSongs: a.totalTracks ?? 0,
      scannedSongs: a.fetched ?? 0,
      isScanning: a.status === 'fetching',
      creator: a.artistName,
      isAlbum: true,
    }));
    return [...playlists, ...albumAsPlaylists];
  }, [playlists, albums]);

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

  const totalRemainingSongs = scanningPlaylists.reduce(
    (acc, p) => acc + Math.max(0, p.totalSongs - p.scannedSongs),
    0,
  );
  const estimatedMinutesRemaining = Math.ceil(totalRemainingSongs / 10);
  const hasStarted = useMemo(
    () => allItems.some(p => p.isScanning || p.scannedSongs > 0),
    [allItems],
  );
  const timeRemainingText = (() => {
    // Prefer explicit update status when provided
    if (updateStatus === 'idle') return 'Ready to scan';
    if (updateStatus === 'complete') return 'Finished!';
    if (updateStatus === 'fetching') {
      if (scanningPlaylists.length > 0 && estimatedMinutesRemaining > 0) {
        return `~${estimatedMinutesRemaining}m remaining`;
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
    const firstScanning = playlists.find(p => p.isScanning) || null;
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
  }, [playlists]);

  return (
    <div className="bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-2xl">
        <CardHeader className="pb-4">
          <CardTitle className="text-2xl font-bold text-center flex items-center justify-center gap-2">
            <Icons.spotify className="h-6 w-6 text-primary" />
            {title ?? 'Inspecting Spotify Library'}
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

function PlaylistRow({
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
              {playlist.isScanning && (
                <Loader2 className="h-3 w-3 animate-spin text-accent" />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
