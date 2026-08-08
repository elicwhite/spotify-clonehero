'use client';

import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Sparkles} from 'lucide-react';
import {toast} from 'sonner';
import type {User} from '@supabase/supabase-js';
import SupportedBrowserWarning from '../SupportedBrowserWarning';
import {SPOTIFY_SCOPES} from '@/app/auth/spotifyScopes';
import {createClient} from '@/lib/supabase/client';
import {useChorusChartDb} from '@/lib/chorusChartDb';
import {
  onPlaylistCacheUpdated,
  useSpotifyLibraryUpdate,
} from '@/lib/spotify-sdk/SpotifyFetching';
import {processSpotifyDump} from '@/lib/spotify-sdk/HistoryDumpParsing';
import {scanForInstalledCharts} from '@/lib/local-songs-folder';
import FindMusicSidebar from './FindMusicSidebar';
import FindMusicTable from './FindMusicTable';
import {getFindMusicSongs, getFindMusicStats, getRadarSongs} from './queries';
import {
  EMPTY_FILTERS,
  type FindMusicFilters,
  type FindMusicSong,
  type FindMusicStats,
  type FindMusicView,
  type RadarSong,
  type SourceStatus,
} from './types';

type Snapshot = {music: FindMusicSong[]; radar: RadarSong[]};

const EMPTY_STATS: FindMusicStats = {
  historySongs: 0,
  playlists: 0,
  albums: 0,
  libraryTracks: 0,
  chorusCharts: 0,
  localCharts: 0,
  historyUpdatedAt: null,
  libraryUpdatedAt: null,
  localUpdatedAt: null,
};

export default function FindMusicClient() {
  const supabase = useMemo(() => createClient(), []);
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [hasSpotify, setHasSpotify] = useState(false);
  const [view, setView] = useState<FindMusicView>('music');
  const [filters, setFilters] = useState<FindMusicFilters>(() => ({
    ...EMPTY_FILTERS,
    instruments: new Set(),
    evidence: new Set(),
  }));
  const [stats, setStats] = useState(EMPTY_STATS);
  const [committed, setCommitted] = useState<Snapshot>({music: [], radar: []});
  const [pending, setPending] = useState<Snapshot | null>(null);
  const [pendingCounts, setPendingCounts] = useState({added: 0, changed: 0});
  const [initializing, setInitializing] = useState(true);
  const [historyStatusOverride, setHistoryStatus] =
    useState<SourceStatus | null>(null);
  const [localStatusOverride, setLocalStatus] = useState<SourceStatus | null>(
    null,
  );
  const [chorusError, setChorusError] = useState<string | null>(null);
  const initializedRef = useRef(false);
  const committedRef = useRef<Snapshot>({music: [], radar: []});
  const chorusStartedRef = useRef(false);
  const activeControllersRef = useRef<AbortController[]>([]);
  const refreshInFlightRef = useRef<Promise<void> | null>(null);
  const refreshAgainRef = useRef(false);

  const [spotifyProgress, refreshSpotifyLibrary] = useSpotifyLibraryUpdate();
  const [chorusProgress, refreshChorusIndex] = useChorusChartDb(true);

  const historyStatus = useMemo<SourceStatus>(
    () =>
      historyStatusOverride ??
      (stats.historySongs > 0
        ? readySource(
            `${stats.historySongs.toLocaleString()} songs with plays`,
            formatFreshness(stats.historyUpdatedAt),
          )
        : {phase: 'idle', summary: 'No history folder loaded'}),
    [historyStatusOverride, stats.historySongs, stats.historyUpdatedAt],
  );
  const localStatus = useMemo<SourceStatus>(
    () =>
      localStatusOverride ??
      (stats.localCharts > 0
        ? readySource(
            `${stats.localCharts.toLocaleString()} installed charts`,
            formatFreshness(stats.localUpdatedAt),
          )
        : {phase: 'idle', summary: 'No Songs folder scanned'}),
    [localStatusOverride, stats.localCharts, stats.localUpdatedAt],
  );

  const querySnapshot = useCallback(async (): Promise<Snapshot> => {
    const [music, radar] = await Promise.all([
      getFindMusicSongs(),
      getRadarSongs(),
    ]);
    return {music, radar};
  }, []);

  const stageSnapshot = useCallback(async () => {
    if (refreshInFlightRef.current) {
      refreshAgainRef.current = true;
      return refreshInFlightRef.current;
    }

    const run = (async () => {
      do {
        refreshAgainRef.current = false;
        const [next, nextStats] = await Promise.all([
          querySnapshot(),
          getFindMusicStats(),
        ]);
        setStats(nextStats);

        if (!initializedRef.current) {
          initializedRef.current = true;
          committedRef.current = next;
          setCommitted(next);
          setInitializing(false);
          continue;
        }

        const counts = diffSnapshots(committedRef.current, next);
        if (counts.added > 0 || counts.changed > 0) {
          setPending(next);
          setPendingCounts(counts);
        }
      } while (refreshAgainRef.current);
    })();

    refreshInFlightRef.current = run;
    try {
      await run;
    } finally {
      refreshInFlightRef.current = null;
    }
  }, [querySnapshot]);

  const applyPending = useCallback(() => {
    if (!pending) return;
    committedRef.current = pending;
    setCommitted(pending);
    setPending(null);
    setPendingCounts({added: 0, changed: 0});
  }, [pending]);

  const runChorusRefresh = useCallback(async () => {
    const controller = new AbortController();
    activeControllersRef.current.push(controller);
    setChorusError(null);
    try {
      await refreshChorusIndex(controller);
      await stageSnapshot();
    } catch (error) {
      if (!controller.signal.aborted) {
        const message = error instanceof Error ? error.message : String(error);
        setChorusError(message);
        toast.error('Could not refresh the Chorus index');
      }
    }
  }, [refreshChorusIndex, stageSnapshot]);

  useEffect(() => {
    let canceled = false;
    void supabase.auth.getUser().then(({data}) => {
      if (canceled) return;
      const nextUser = data?.user ?? null;
      setUser(nextUser);
      setHasSpotify(
        Boolean(
          nextUser?.identities?.some(
            identity => identity.provider === 'spotify',
          ),
        ),
      );
      setAuthChecked(true);
    });
    return () => {
      canceled = true;
    };
  }, [supabase]);

  useEffect(() => {
    void stageSnapshot().catch(error => {
      console.error('Could not load Find Music data', error);
      setInitializing(false);
      toast.error('Could not read the local music database');
    });
  }, [stageSnapshot]);

  useEffect(() => {
    if (!initializedRef.current || chorusStartedRef.current) return;
    chorusStartedRef.current = true;
    void runChorusRefresh();
  }, [initializing, runChorusRefresh]);

  useEffect(() => {
    if (spotifyProgress.updateStatus !== 'fetching') return;
    return onPlaylistCacheUpdated(() => {
      void stageSnapshot();
    });
  }, [spotifyProgress.updateStatus, stageSnapshot]);

  useEffect(() => {
    const controllers = activeControllersRef.current;
    return () => {
      controllers.forEach(controller => controller.abort());
    };
  }, []);

  const connectSpotify = useCallback(async () => {
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent('/find-music')}`;
    const result = user
      ? await supabase.auth.linkIdentity({
          provider: 'spotify',
          options: {redirectTo, scopes: SPOTIFY_SCOPES},
        })
      : await supabase.auth.signInWithOAuth({
          provider: 'spotify',
          options: {redirectTo, scopes: SPOTIFY_SCOPES},
        });
    if (result.error) {
      toast.error(result.error.message);
      return;
    }
    if (result.data?.url) window.location.href = result.data.url;
  }, [supabase, user]);

  const runHistoryRefresh = useCallback(async () => {
    if (!('showDirectoryPicker' in window)) {
      toast.error('This browser cannot open local folders');
      return;
    }
    setHistoryStatus({
      phase: 'loading',
      summary: 'Waiting for history folder…',
    });
    try {
      const handle = await window.showDirectoryPicker({id: 'spotify-dump'});
      setHistoryStatus({phase: 'loading', summary: 'Reading Spotify history…'});
      const plays = await processSpotifyDump(handle);
      const songCount = Array.from(plays.values()).reduce(
        (sum, songs) => sum + songs.size,
        0,
      );
      setHistoryStatus({
        phase: 'ready',
        summary: `${songCount.toLocaleString()} songs with plays`,
        detail: 'Refreshed just now',
      });
      await stageSnapshot();
    } catch (error) {
      if (isPickerCancel(error)) {
        setHistoryStatus(null);
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      setHistoryStatus({
        phase: 'error',
        summary: 'History import failed',
        detail: message,
      });
      toast.error(message);
    }
  }, [stageSnapshot]);

  const runLibraryRefresh = useCallback(async () => {
    if (!user || !hasSpotify) {
      await connectSpotify();
      return;
    }
    const controller = new AbortController();
    activeControllersRef.current.push(controller);
    try {
      await refreshSpotifyLibrary(controller, {concurrency: 3});
      await stageSnapshot();
    } catch (error) {
      if (!controller.signal.aborted) {
        toast.error(
          error instanceof Error ? error.message : 'Spotify refresh failed',
        );
      }
    }
  }, [connectSpotify, hasSpotify, refreshSpotifyLibrary, stageSnapshot, user]);

  const runLocalScan = useCallback(async () => {
    setLocalStatus({phase: 'loading', summary: 'Waiting for Songs folder…'});
    try {
      const result = await scanForInstalledCharts(count => {
        setLocalStatus({
          phase: 'loading',
          summary: `Scanning… ${count.toLocaleString()} charts found`,
        });
      });
      setLocalStatus({
        phase: 'ready',
        summary: `${result.installedCharts.length.toLocaleString()} installed charts`,
        detail: 'Scanned just now',
      });
      await stageSnapshot();
    } catch (error) {
      if (isPickerCancel(error)) {
        setLocalStatus(null);
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      setLocalStatus({
        phase: 'error',
        summary: 'Local scan failed',
        detail: message,
      });
      toast.error(message);
    }
  }, [stageSnapshot]);

  const libraryStatus = useMemo<SourceStatus>(() => {
    if (spotifyProgress.updateStatus === 'fetching') {
      const playlists = Object.values(spotifyProgress.playlists);
      const albums = Object.values(spotifyProgress.albums);
      const done = playlists.filter(item => item.status === 'done').length;
      const albumsDone = albums.filter(item => item.status === 'done').length;
      const total = playlists.length + albums.length;
      const complete = done + albumsDone;
      return {
        phase: 'loading',
        summary: `${done}/${playlists.length} playlists · ${albumsDone}/${albums.length} albums`,
        progress: total > 0 ? (complete / total) * 100 : 0,
        detail: spotifyProgress.rateLimitCountdown
          ? `Spotify rate limit · retrying in ${spotifyProgress.rateLimitCountdown.retryAfterSeconds}s`
          : 'Matches are held until you re-rank',
      };
    }
    if (spotifyProgress.updateStatus === 'error') {
      return {phase: 'error', summary: 'Spotify library refresh failed'};
    }
    if (stats.libraryTracks > 0) {
      return {
        phase: 'ready',
        summary: `${stats.playlists.toLocaleString()} playlists · ${stats.albums.toLocaleString()} albums`,
        detail: `${stats.libraryTracks.toLocaleString()} library tracks`,
      };
    }
    return {
      phase: 'idle',
      summary: authChecked && hasSpotify ? 'Ready to scan' : 'Not connected',
    };
  }, [authChecked, hasSpotify, spotifyProgress, stats]);

  const chorusStatus = useMemo<SourceStatus>(() => {
    if (chorusError) {
      return {
        phase: 'error',
        summary: 'Index refresh failed',
        detail: chorusError,
      };
    }
    if (
      chorusProgress.status === 'fetching' ||
      chorusProgress.status === 'fetching-dump' ||
      chorusProgress.status === 'updating-db'
    ) {
      const hasTotal = chorusProgress.numTotal > 0;
      const progress = hasTotal
        ? (chorusProgress.numFetched / chorusProgress.numTotal) * 100
        : null;
      return {
        phase: 'loading',
        summary:
          chorusProgress.status === 'fetching-dump'
            ? 'Downloading the Chorus index…'
            : hasTotal
              ? `Refreshing… ${chorusProgress.numFetched.toLocaleString()} / ${chorusProgress.numTotal.toLocaleString()}`
              : 'Checking for new Chorus charts…',
        ...(progress == null ? {} : {progress}),
      };
    }
    return stats.chorusCharts > 0
      ? {
          phase: 'ready',
          summary: `${stats.chorusCharts.toLocaleString()} charts`,
          detail: 'Refreshed on page load',
        }
      : {phase: 'idle', summary: 'Index not downloaded yet'};
  }, [chorusError, chorusProgress, stats.chorusCharts]);

  const busy =
    initializing ||
    historyStatus.phase === 'loading' ||
    libraryStatus.phase === 'loading' ||
    chorusStatus.phase === 'loading';

  const clearFilters = useCallback(() => {
    setFilters({...EMPTY_FILTERS, instruments: new Set(), evidence: new Set()});
  }, []);

  return (
    <SupportedBrowserWarning>
      <div
        data-testid="find-music-page"
        className="-m-4 flex min-h-0 w-[calc(100%+2rem)] flex-1 flex-col overflow-hidden pt-12 sm:pt-0">
        <header className="border-b px-4 py-3 md:px-5">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="text-base font-semibold tracking-tight">
              Find charts for music you love
            </h1>
            <p className="text-sm text-muted-foreground">
              Matches your listening data against Chorus. Everything stays in
              this browser.
            </p>
          </div>
        </header>
        <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,auto)_minmax(0,1fr)] lg:grid-cols-[292px_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]">
          <FindMusicSidebar
            view={view}
            onViewChange={setView}
            filters={filters}
            onFiltersChange={setFilters}
            onClearFilters={clearFilters}
            historyStatus={historyStatus}
            libraryStatus={libraryStatus}
            localStatus={localStatus}
            chorusStatus={chorusStatus}
            onRefreshHistory={() => void runHistoryRefresh()}
            onRefreshLibrary={() => void runLibraryRefresh()}
            onScanLocal={() => void runLocalScan()}
            onRefreshChorus={() => void runChorusRefresh()}
            onConnectSpotify={() => void connectSpotify()}
            authenticated={Boolean(user)}
            hasSpotify={hasSpotify}
            musicCount={pending?.music.length ?? committed.music.length}
            radarCount={pending?.radar.length ?? committed.radar.length}
          />
          <main className="flex min-h-0 min-w-0 flex-col overflow-hidden p-4 md:p-5">
            {pending && (
              <div
                data-testid="held-matches"
                className="mb-3 flex shrink-0 flex-wrap items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-50" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
                </span>
                <span className="font-medium">
                  {pendingCounts.added.toLocaleString()} new match
                  {pendingCounts.added === 1 ? '' : 'es'} held
                </span>
                {pendingCounts.changed > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {pendingCounts.changed.toLocaleString()} matches have
                    updated evidence
                  </span>
                )}
                <span className="text-xs text-muted-foreground">
                  The visible list will not move until you apply them.
                </span>
                <button
                  className="ml-auto rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
                  onClick={applyPending}>
                  Re-rank now
                </button>
              </div>
            )}

            {initializing ? (
              <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto rounded-lg border bg-card p-8">
                <div className="text-center">
                  <Sparkles className="mx-auto mb-3 h-6 w-6 animate-pulse text-primary" />
                  <p className="font-medium">Opening your local music index</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Reading the shared OPFS SQLite database…
                  </p>
                </div>
              </div>
            ) : committed.music.length === 0 &&
              stats.historySongs === 0 &&
              stats.libraryTracks === 0 ? (
              <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="mx-auto mt-[8vh] max-w-xl pb-8">
                  <h2 className="text-lg font-semibold">
                    Nothing connected yet
                  </h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Add Spotify history or your library from the sidebar. The
                    Chorus index refreshes automatically, and a Songs-folder
                    scan marks charts already installed.
                  </p>
                  <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
                    <li>
                      Pick an unzipped Spotify Extended Streaming History
                      folder.
                    </li>
                    <li>Connect Spotify to scan playlists and saved albums.</li>
                    <li>Pick your Clone Hero or YARG Songs folder.</li>
                  </ol>
                </div>
              </div>
            ) : (
              <FindMusicTable
                view={view}
                music={committed.music}
                radar={committed.radar}
                filters={filters}
                radarLoading={view === 'radar' && busy}
                previewEnabled={authChecked && hasSpotify}
                onClearFilters={clearFilters}
              />
            )}
          </main>
        </div>
      </div>
    </SupportedBrowserWarning>
  );
}

function diffSnapshots(current: Snapshot, next: Snapshot) {
  const currentMusic = new Map(
    current.music.map(song => [song.key, fingerprint(song)]),
  );
  const currentRadar = new Map(
    current.radar.map(song => [song.key, fingerprint(song)]),
  );
  const nextMusicKeys = new Set(next.music.map(song => song.key));
  const nextRadarKeys = new Set(next.radar.map(song => song.key));
  let added = 0;
  let changed = 0;
  for (const song of next.music) {
    const before = currentMusic.get(song.key);
    if (before == null) added += 1;
    else if (before !== fingerprint(song)) changed += 1;
  }
  for (const song of next.radar) {
    const before = currentRadar.get(song.key);
    if (before == null) added += 1;
    else if (before !== fingerprint(song)) changed += 1;
  }
  for (const key of currentMusic.keys()) {
    if (!nextMusicKeys.has(key)) changed += 1;
  }
  for (const key of currentRadar.keys()) {
    if (!nextRadarKeys.has(key)) changed += 1;
  }
  return {added, changed};
}

function fingerprint(song: FindMusicSong | RadarSong) {
  return JSON.stringify(song);
}

function isPickerCancel(error: unknown) {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.message === 'User canceled picker')
  );
}

function formatFreshness(value: string | null) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return `Updated ${date.toLocaleString()}`;
}

function readySource(
  summary: string,
  detail: string | undefined,
): SourceStatus {
  return detail == null
    ? {phase: 'ready', summary}
    : {phase: 'ready', summary, detail};
}
