'use client';

import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Menu, Sparkles} from 'lucide-react';
import {usePathname} from 'next/navigation';
import {toast} from 'sonner';
import type {User} from '@supabase/supabase-js';
import SupportedBrowserWarning from '../SupportedBrowserWarning';
import {SPOTIFY_SCOPES} from '@/app/auth/spotifyScopes';
import {createClient} from '@/lib/supabase/client';
import {useChorusChartDb} from '@/lib/chorusChartDb';
import {
  CHORUS_UNAVAILABLE_MESSAGE,
  isChorusUnavailableError,
} from '@/lib/chorus-errors';
import {localDbExists} from '@/lib/local-db/client';
import {
  onPlaylistCacheUpdated,
  useSpotifyLibraryUpdate,
} from '@/lib/spotify-sdk/SpotifyFetching';
import {tryProcessSpotifyDump} from '@/lib/spotify-sdk/HistoryDumpParsing';
import {
  getLocalScanWarning,
  tryScanForInstalledCharts,
} from '@/lib/local-songs-folder';
import {Button} from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import FindMusicSidebar from './FindMusicSidebar';
import FindMusicTable from './FindMusicTable';
import FindMusicWelcome from './FindMusicWelcome';
import type {FindMusicWelcomeProps} from './FindMusicWelcome';
import {useAppleMusicSource} from './useAppleMusicSource';
import {
  clearFindMusicActivation,
  hasFindMusicActivation,
  markFindMusicActivated,
} from './activation';
import {
  freshEmptyFilters,
  loadFindMusicFilters,
  saveFindMusicFilters,
} from './filterPersistence';
import {getFindMusicSongs, getFindMusicStats, getRadarSongs} from './queries';
import {FIND_MUSIC_RECOMMENDATIONS_PATH, findMusicPathForView} from './routes';
import {
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
  spotifyLibraryTracks: 0,
  appleMusicLibraryTracks: 0,
  chorusCharts: 0,
  localCharts: 0,
  historyUpdatedAt: null,
  libraryUpdatedAt: null,
  spotifyLibraryUpdatedAt: null,
  appleMusicLibraryUpdatedAt: null,
  appleMusicStorefront: null,
  localUpdatedAt: null,
};

export default function FindMusicClient() {
  const pathname = usePathname();
  const supabase = useMemo(() => createClient(), []);
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [hasSpotify, setHasSpotify] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [filters, setFilters] = useState<FindMusicFilters>(freshEmptyFilters);
  const [filtersHydrated, setFiltersHydrated] = useState(false);
  const [stats, setStats] = useState(EMPTY_STATS);
  const [committed, setCommitted] = useState<Snapshot>({music: [], radar: []});
  const [pending, setPending] = useState<Snapshot | null>(null);
  const [pendingCounts, setPendingCounts] = useState({added: 0, changed: 0});
  const [initializing, setInitializing] = useState(true);
  const [sourceAccessChecked, setSourceAccessChecked] = useState(false);
  const [sourceAccessEnabled, setSourceAccessEnabled] = useState(false);
  const [catalogConsent, setCatalogConsent] = useState(false);
  const [historyStatusOverride, setHistoryStatus] =
    useState<SourceStatus | null>(null);
  const [localStatusOverride, setLocalStatus] = useState<SourceStatus | null>(
    null,
  );
  const [chorusError, setChorusError] = useState<string | null>(null);
  const initializedRef = useRef(false);
  const committedRef = useRef<Snapshot>({music: [], radar: []});
  const chorusStartedRef = useRef(false);
  const sourceAccessEnabledRef = useRef(false);
  const activeControllersRef = useRef<AbortController[]>([]);
  const refreshInFlightRef = useRef<Promise<void> | null>(null);
  const refreshAgainRef = useRef(false);

  const view: FindMusicView =
    pathname === FIND_MUSIC_RECOMMENDATIONS_PATH ? 'radar' : 'music';

  const [spotifyProgress, refreshSpotifyLibrary] =
    useSpotifyLibraryUpdate(sourceAccessEnabled);
  const [chorusProgress, refreshChorusIndex] = useChorusChartDb(true);

  const historyStatus = useMemo<SourceStatus>(
    () =>
      historyStatusOverride ??
      (initializing
        ? {phase: 'loading', summary: 'Checking saved local data…'}
        : stats.historySongs > 0
          ? readySource(
              `${stats.historySongs.toLocaleString()} songs with plays`,
              formatFreshness(stats.historyUpdatedAt),
            )
          : {phase: 'idle', summary: 'No history folder loaded'}),
    [
      historyStatusOverride,
      initializing,
      stats.historySongs,
      stats.historyUpdatedAt,
    ],
  );
  const localStatus = useMemo<SourceStatus>(
    () =>
      localStatusOverride ??
      (initializing
        ? {phase: 'loading', summary: 'Checking saved local data…'}
        : stats.localCharts > 0
          ? readySource(
              `${stats.localCharts.toLocaleString()} installed charts`,
              formatFreshness(stats.localUpdatedAt),
            )
          : {phase: 'idle', summary: 'No Songs folder scanned'}),
    [
      localStatusOverride,
      initializing,
      stats.localCharts,
      stats.localUpdatedAt,
    ],
  );
  const hasTasteSource =
    hasSpotify ||
    stats.appleMusicLibraryTracks > 0 ||
    stats.libraryTracks > 0 ||
    stats.historySongs > 0;
  const hasIndexedTasteData =
    stats.spotifyLibraryTracks > 0 ||
    stats.appleMusicLibraryTracks > 0 ||
    stats.historySongs > 0;

  // `initializing` means "the local index has not been opened yet", which is a
  // page-wide condition every source card reports as loading. It belongs to the
  // effect that opens the index, so it is always cleared by the same code that
  // raises it. Activating a source never raises it: scanning one source must
  // leave the other cards interactive so scans can run in parallel.
  const enableSourceAccess = useCallback(() => {
    sourceAccessEnabledRef.current = true;
    setSourceAccessEnabled(true);
    setCatalogConsent(true);
  }, []);

  const activateSourceAccess = useCallback(() => {
    clearFindMusicActivation(window.sessionStorage);
    enableSourceAccess();
  }, [enableSourceAccess]);

  const activateSourceAccessForNavigation = useCallback(() => {
    markFindMusicActivated(window.sessionStorage);
    enableSourceAccess();
  }, [enableSourceAccess]);

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
      try {
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
      } finally {
        // Released with no await between it and the loop's exit check, so a
        // source finishing here cannot join a run that will never re-query.
        refreshInFlightRef.current = null;
      }
    })();

    refreshInFlightRef.current = run;
    await run;
  }, [querySnapshot]);

  const replaceSnapshot = useCallback(async () => {
    const [next, nextStats] = await Promise.all([
      querySnapshot(),
      getFindMusicStats(),
    ]);
    initializedRef.current = true;
    committedRef.current = next;
    setCommitted(next);
    setStats(nextStats);
    setPending(null);
    setPendingCounts({added: 0, changed: 0});
    setInitializing(false);
  }, [querySnapshot]);

  const spotifyPreviewAvailable = authChecked && hasSpotify;
  const {viewModel: appleMusicSource, actions: appleMusicActions} =
    useAppleMusicSource({
      view,
      enabled: sourceAccessEnabled,
      initializing,
      stats,
      spotifyPreviewAvailable,
      stageSnapshot,
      replaceSnapshot,
      onActivate: activateSourceAccess,
      onActivateForNavigation: activateSourceAccessForNavigation,
    });

  const applyPending = useCallback(() => {
    if (!pending) return;
    committedRef.current = pending;
    setCommitted(pending);
    setPending(null);
    setPendingCounts({added: 0, changed: 0});
  }, [pending]);

  const runChorusRefresh = useCallback(async () => {
    if (!hasIndexedTasteData) return;
    const controller = new AbortController();
    activeControllersRef.current.push(controller);
    setChorusError(null);
    try {
      await refreshChorusIndex(controller);
      await stageSnapshot();
    } catch (error) {
      if (!controller.signal.aborted) {
        if (isChorusUnavailableError(error)) {
          setChorusError(CHORUS_UNAVAILABLE_MESSAGE);
          toast.error(CHORUS_UNAVAILABLE_MESSAGE);
        } else {
          setChorusError(
            error instanceof Error ? error.message : String(error),
          );
          toast.error('Could not refresh the Chorus index');
        }
      }
    }
  }, [hasIndexedTasteData, refreshChorusIndex, stageSnapshot]);

  useEffect(() => {
    let canceled = false;
    queueMicrotask(() => {
      if (canceled) return;
      try {
        setFilters(loadFindMusicFilters(window.localStorage));
      } catch {
        setFilters(freshEmptyFilters());
      }
      setFiltersHydrated(true);
    });
    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    if (!filtersHydrated) return;
    try {
      saveFindMusicFilters(window.localStorage, filters);
    } catch {
      // Filtering remains usable when local storage is unavailable.
    }
  }, [filters, filtersHydrated]);

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
    let canceled = false;
    void (async () => {
      const navigationActivation = hasFindMusicActivation(
        window.sessionStorage,
      );
      let existingDatabase = false;
      try {
        existingDatabase = await localDbExists();
      } catch {
        // An unsupported OPFS implementation remains inactive until the user
        // chooses a source, when the ordinary error path can explain it.
      }
      if (canceled) return;
      if (navigationActivation) {
        clearFindMusicActivation(window.sessionStorage);
      }
      const shouldEnableSourceAccess =
        sourceAccessEnabledRef.current ||
        navigationActivation ||
        existingDatabase;
      sourceAccessEnabledRef.current = shouldEnableSourceAccess;
      setSourceAccessEnabled(shouldEnableSourceAccess);
      if (!shouldEnableSourceAccess) setInitializing(false);
      setCatalogConsent(current => current || navigationActivation);
      setSourceAccessChecked(true);
    })();
    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    if (!sourceAccessChecked || !sourceAccessEnabled) return;
    if (!initializedRef.current) setInitializing(true);
    void stageSnapshot().catch(error => {
      console.error('Could not load Find Music data', error);
      setInitializing(false);
      toast.error('Could not read the local music database');
    });
  }, [sourceAccessChecked, sourceAccessEnabled, stageSnapshot]);

  useEffect(() => {
    if (
      !initializedRef.current ||
      !catalogConsent ||
      !hasIndexedTasteData ||
      chorusStartedRef.current
    )
      return;
    chorusStartedRef.current = true;
    void runChorusRefresh();
  }, [catalogConsent, hasIndexedTasteData, initializing, runChorusRefresh]);

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
    activateSourceAccessForNavigation();
    const currentFindMusicPath = findMusicPathForView(view);
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(currentFindMusicPath)}`;
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
  }, [activateSourceAccessForNavigation, supabase, user, view]);

  const runHistoryRefresh = useCallback(async () => {
    if (!('showDirectoryPicker' in window)) {
      toast.error('This browser cannot open local folders');
      return;
    }
    activateSourceAccess();
    setHistoryStatus({
      phase: 'loading',
      summary: 'Waiting for history folder…',
    });
    try {
      const handle = await window.showDirectoryPicker({id: 'spotify-dump'});
      setHistoryStatus({phase: 'loading', summary: 'Reading Spotify history…'});
      const historyResult = await tryProcessSpotifyDump(handle);
      if (historyResult.status === 'invalid-selection') {
        setHistoryStatus({
          phase: 'error',
          summary: 'History import failed',
          detail: historyResult.message,
        });
        toast.error(historyResult.message);
        return;
      }
      const plays = historyResult.plays;
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
  }, [activateSourceAccess, stageSnapshot]);

  const runLibraryRefresh = useCallback(async () => {
    activateSourceAccess();
    if (!user || !hasSpotify) {
      await connectSpotify();
      return;
    }
    const controller = new AbortController();
    activeControllersRef.current.push(controller);
    try {
      const result = await refreshSpotifyLibrary(controller, {concurrency: 3});
      if (result.status === 'unauthenticated') {
        toast.info('Reconnect Spotify to refresh your library');
        return;
      }
      if (result.status === 'unavailable') {
        toast.info('Spotify is unavailable here');
        return;
      }
      await stageSnapshot();
    } catch (error) {
      if (!controller.signal.aborted) {
        toast.error(
          error instanceof Error ? error.message : 'Spotify refresh failed',
        );
      }
    }
  }, [
    activateSourceAccess,
    connectSpotify,
    hasSpotify,
    refreshSpotifyLibrary,
    stageSnapshot,
    user,
  ]);

  const runLocalScan = useCallback(async () => {
    activateSourceAccess();
    setLocalStatus({phase: 'loading', summary: 'Waiting for Songs folder…'});
    try {
      const result = await tryScanForInstalledCharts(count => {
        setLocalStatus({
          phase: 'loading',
          summary: `Scanning… ${count.toLocaleString()} charts found`,
        });
      });
      if (result == null) {
        setLocalStatus(null);
        return;
      }
      if (result.status === 'partial') {
        toast.warning(getLocalScanWarning(result.issues.length));
      }
      setLocalStatus({
        phase: 'ready',
        summary:
          result.status === 'partial'
            ? `${result.installedCharts.length.toLocaleString()} charts found before some locations were skipped`
            : `${result.installedCharts.length.toLocaleString()} installed charts`,
        detail: 'Scanned just now',
      });
      await stageSnapshot();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLocalStatus({
        phase: 'error',
        summary: 'Local scan failed',
        detail: message,
      });
      toast.error(message);
    }
  }, [activateSourceAccess, stageSnapshot]);

  const spotifyLibraryStatus = useMemo<SourceStatus>(() => {
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
    if (initializing) {
      return {phase: 'loading', summary: 'Checking saved local data…'};
    }
    if ((stats.spotifyLibraryTracks ?? 0) > 0) {
      return {
        phase: 'ready',
        summary: `${stats.playlists.toLocaleString()} playlists · ${stats.albums.toLocaleString()} albums`,
        detail: `${(stats.spotifyLibraryTracks ?? 0).toLocaleString()} library tracks`,
      };
    }
    return {
      phase: 'idle',
      summary: authChecked && hasSpotify ? 'Ready to scan' : 'Not connected',
    };
  }, [authChecked, hasSpotify, initializing, spotifyProgress, stats]);

  const chorusStatus = useMemo<SourceStatus>(() => {
    if (initializing) {
      return {phase: 'loading', summary: 'Checking saved local data…'};
    }
    if (!hasTasteSource && stats.chorusCharts === 0) {
      return {
        phase: 'idle',
        summary:
          'Connect Spotify, Apple Music, or History to download the index',
      };
    }
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
          detail:
            chorusProgress.status === 'complete'
              ? 'Refreshed just now'
              : 'Stored in this browser',
        }
      : {phase: 'idle', summary: 'Index not downloaded yet'};
  }, [
    chorusError,
    chorusProgress,
    hasTasteSource,
    initializing,
    stats.chorusCharts,
  ]);

  const busy =
    initializing ||
    historyStatus.phase === 'loading' ||
    spotifyLibraryStatus.phase === 'loading' ||
    appleMusicSource.refreshing ||
    chorusStatus.phase === 'loading';

  const clearFilters = useCallback(() => {
    setFilters(freshEmptyFilters());
  }, []);

  const closeMobileSidebar = useCallback(() => {
    setMobileSidebarOpen(false);
  }, []);

  const sourceProps: FindMusicWelcomeProps = {
    authenticated: Boolean(user),
    hasSpotify,
    appleMusicConnected: appleMusicSource.connected,
    canDisconnectAppleMusic: appleMusicSource.canDisconnect,
    historyStatus,
    spotifyLibraryStatus,
    appleMusicStatus: appleMusicSource.status,
    localStatus,
    chorusStatus,
    onConnectSpotify: connectSpotify,
    onConnectAppleMusic: appleMusicActions.connect,
    onDisconnectAppleMusic: appleMusicActions.disconnect,
    onRefreshHistory: runHistoryRefresh,
    onRefreshSpotifyLibrary: runLibraryRefresh,
    onRefreshAppleMusic: appleMusicActions.refresh,
    onScanLocal: runLocalScan,
    onRefreshChorus: runChorusRefresh,
  };

  return (
    <SupportedBrowserWarning>
      {/* `pt-12 sm:pt-0` is a page-specific mobile affordance, not a gutter
          workaround: it clears the floating account control on small
          screens. The outer gutter is `SiteMain`'s to give or withhold, and
          this route is registered there as full-bleed. */}
      <div
        data-testid="find-music-page"
        className="flex min-h-0 w-full flex-1 flex-col overflow-hidden pt-12 sm:pt-0">
        <header className="border-b px-3 py-3 md:px-5">
          <div className="flex items-center gap-2.5">
            <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
              <SheetTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="-ml-1 h-8 w-8 shrink-0 lg:hidden"
                  aria-label="Open filters and sources">
                  <Menu className="h-5 w-5" aria-hidden="true" />
                </Button>
              </SheetTrigger>
              <SheetContent
                side="left"
                className="w-[min(92vw,340px)] gap-0 overflow-hidden p-0 sm:max-w-[340px]">
                <SheetHeader className="sr-only">
                  <SheetTitle>Find music controls</SheetTitle>
                  <SheetDescription>
                    Browse results, filter songs, and connect music sources.
                  </SheetDescription>
                </SheetHeader>
                <FindMusicSidebar
                  {...sourceProps}
                  variant="drawer"
                  view={view}
                  onViewChange={closeMobileSidebar}
                  filters={filters}
                  onFiltersChange={setFilters}
                  onClearFilters={clearFilters}
                  musicCount={pending?.music.length ?? committed.music.length}
                  radarCount={pending?.radar.length ?? committed.radar.length}
                />
              </SheetContent>
            </Sheet>
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
              <h1 className="text-base font-semibold tracking-tight">
                Find charts for music you love
              </h1>
              <p className="text-sm text-muted-foreground">
                Matches your listening data against Chorus.
              </p>
            </div>
          </div>
        </header>
        <div
          data-testid="find-music-layout"
          className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)] lg:grid-cols-[292px_minmax(0,1fr)]">
          <div
            data-testid="find-music-desktop-sidebar"
            className="hidden min-h-0 lg:block">
            <FindMusicSidebar
              {...sourceProps}
              view={view}
              onViewChange={closeMobileSidebar}
              filters={filters}
              onFiltersChange={setFilters}
              onClearFilters={clearFilters}
              musicCount={pending?.music.length ?? committed.music.length}
              radarCount={pending?.radar.length ?? committed.radar.length}
            />
          </div>
          <section
            aria-label="Find music results"
            data-testid="find-music-results"
            className="flex min-h-0 min-w-0 flex-col overflow-hidden p-4 md:p-5">
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
              <FindMusicWelcome {...sourceProps} />
            ) : (
              <FindMusicTable
                view={view}
                music={committed.music}
                radar={committed.radar}
                filters={filters}
                radarLoading={view === 'radar' && busy}
                spotifyPreviewEnabled={spotifyPreviewAvailable}
                appleMusicClient={appleMusicSource.client}
                preferredPreviewProvider={
                  appleMusicSource.preferredPreviewProvider
                }
                onClearFilters={clearFilters}
              />
            )}
          </section>
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
    error instanceof DOMException &&
    (error.name === 'AbortError' || error.name === 'NotAllowedError')
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
