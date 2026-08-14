'use client';

import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ChevronDown,
  ChevronRight,
  Download,
  Check,
  ExternalLink,
  RotateCw,
  UserX,
  X,
} from 'lucide-react';
import {useVirtual} from 'react-virtual';
import {Button} from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {cn} from '@/lib/utils';
import {downloadSong} from '@/lib/local-songs-folder';
import MusicPreviewButton, {
  type MusicPreviewProvider,
} from '@/components/MusicPreviewButton';
import {AudioContext} from '@/app/AudioProvider';
import type {AppleMusicLibraryClient} from '@/lib/apple-music';
import FindMusicInstrumentIcon from './FindMusicInstrumentIcon';
import {
  INSTRUMENTS,
  type FindMusicChart,
  type FindMusicFilters,
  type FindMusicSong,
  type FindMusicView,
  type RadarSong,
} from './types';
import {dismissRadarSong} from './queries';
import {
  applyMusicFilters,
  applyRadarFilters,
  scoreMusicSong,
  scoreRadarSong,
  sortMusicSongs,
  sortRadarSongs,
} from './model';

type MusicSort = {
  key: 'score' | 'plays' | 'artist' | 'song' | 'updated';
  direction: 'asc' | 'desc';
};

const PLAYS_SORT: MusicSort = {key: 'plays', direction: 'desc'};
const SCORE_SORT: MusicSort = {key: 'score', direction: 'desc'};

type DownloadState = 'idle' | 'downloading' | 'done' | 'error';

export default function FindMusicTable({
  view,
  music,
  radar,
  filters,
  radarLoading,
  spotifyPreviewEnabled,
  appleMusicClient,
  preferredPreviewProvider,
  onClearFilters,
}: {
  view: FindMusicView;
  music: FindMusicSong[];
  radar: RadarSong[];
  filters: FindMusicFilters;
  radarLoading: boolean;
  spotifyPreviewEnabled: boolean;
  appleMusicClient: AppleMusicLibraryClient | null;
  preferredPreviewProvider: MusicPreviewProvider | undefined;
  onClearFilters: () => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Play count is the honest default when a history import exists: it needs no
  // explaining and it does not tie. The composite score only leads when there
  // are no plays to sort by.
  const [chosenSort, setChosenSort] = useState<MusicSort | null>(null);
  const [dismissed, setDismissed] = useState<{
    songs: Set<string>;
    artists: Set<string>;
  }>({songs: new Set(), artists: new Set()});
  const historyLoaded = useMemo(
    () => music.some(song => song.playCount > 0),
    [music],
  );
  const sort = chosenSort ?? (historyLoaded ? PLAYS_SORT : SCORE_SORT);
  const [downloadStates, setDownloadStates] = useState<
    Record<string, DownloadState>
  >({});
  const {currentTrack, pause} = useContext(AudioContext);

  const rows = useMemo(() => {
    if (view === 'radar') {
      const remaining = radar.filter(
        song =>
          !dismissed.songs.has(song.key) &&
          !dismissed.artists.has(song.artist.toLocaleLowerCase('en-US')),
      );
      return sortRadarSongs(applyRadarFilters(remaining, filters));
    }
    return sortMusicSongs(applyMusicFilters(music, filters), sort);
  }, [dismissed, filters, music, radar, sort, view]);

  const dismiss = useCallback((song: RadarSong, scope: 'song' | 'artist') => {
    setDismissed(current => ({
      songs:
        scope === 'song' ? new Set(current.songs).add(song.key) : current.songs,
      artists:
        scope === 'artist'
          ? new Set(current.artists).add(song.artist.toLocaleLowerCase('en-US'))
          : current.artists,
    }));
    void dismissRadarSong(song.key, scope).catch(error => {
      console.error('Failed to save recommendation dismissal', error);
    });
  }, []);

  useEffect(() => {
    if (
      currentTrack?.key &&
      !rows.some(song => song.key === currentTrack.key)
    ) {
      pause();
    }
  }, [currentTrack, pause, rows]);

  const toggleExpanded = useCallback((key: string) => {
    setExpanded(current => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const install = useCallback(async (chart: FindMusicChart) => {
    setDownloadStates(current => ({...current, [chart.md5]: 'downloading'}));
    try {
      const result = await downloadSong(
        chart.artist,
        chart.name,
        chart.charter,
        `https://files.enchor.us/${chart.md5}.sng`,
        {asSng: true, source: 'find_music', md5: chart.md5},
      );
      if (result.status === 'canceled') {
        setDownloadStates(current => ({...current, [chart.md5]: 'idle'}));
        return;
      }
      setDownloadStates(current => ({...current, [chart.md5]: 'done'}));
    } catch (error) {
      console.error('Failed to install chart', error);
      setDownloadStates(current => ({...current, [chart.md5]: 'error'}));
    }
  }, []);

  if (view === 'radar' && radarLoading) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg border bg-card p-10 text-center">
        <div>
          <RotateCw className="mx-auto mb-3 h-5 w-5 animate-spin text-primary" />
          <h2 className="font-semibold">
            Recommendations are building artist affinity
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Your music remains usable while the matching pass finishes.
          </p>
        </div>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg border border-dashed bg-card p-10 text-center">
        <div>
          <h2 className="font-semibold">
            {view === 'radar'
              ? 'No recommendations match'
              : 'No songs match the current filters'}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Filters are applied together. Clear them to see every available
            match.
          </p>
          <Button className="mt-4" variant="outline" onClick={onClearFilters}>
            Clear all filters
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-card shadow-sm">
      <div className="flex items-center border-b px-4 py-2 text-xs text-muted-foreground">
        <span>
          <b className="text-foreground">{rows.length.toLocaleString()}</b>{' '}
          {view === 'radar' ? 'recommendations' : 'songs'} shown
        </span>
      </div>
      <div
        data-testid="results-scroll"
        className="flex min-h-0 flex-1 flex-col overflow-x-auto overflow-y-hidden">
        {view === 'music' ? (
          <MusicHeader
            sort={sort}
            onSort={setChosenSort}
            listenEnabled={spotifyPreviewEnabled || appleMusicClient !== null}
          />
        ) : (
          <RadarHeader
            listenEnabled={spotifyPreviewEnabled || appleMusicClient !== null}
          />
        )}
        <VirtualRows
          rows={rows}
          view={view}
          onDismiss={dismiss}
          expanded={expanded}
          onToggle={toggleExpanded}
          downloadStates={downloadStates}
          onInstall={install}
          spotifyPreviewEnabled={spotifyPreviewEnabled}
          appleMusicClient={appleMusicClient}
          preferredPreviewProvider={preferredPreviewProvider}
        />
      </div>
    </div>
  );
}

function SortButton({
  label,
  sortKey,
  sort,
  onSort,
  className,
}: {
  label: string;
  sortKey: MusicSort['key'];
  sort: MusicSort;
  onSort: (sort: MusicSort) => void;
  className?: string;
}) {
  const active = sort.key === sortKey;
  return (
    <button
      className={cn('text-left hover:text-foreground', className)}
      onClick={() =>
        onSort({
          key: sortKey,
          direction: active && sort.direction === 'desc' ? 'asc' : 'desc',
        })
      }>
      {label} {active ? (sort.direction === 'desc' ? '▼' : '▲') : ''}
    </button>
  );
}

function MusicHeader({
  sort,
  onSort,
  listenEnabled,
}: {
  sort: MusicSort;
  onSort: (sort: MusicSort) => void;
  listenEnabled: boolean;
}) {
  return (
    <div
      className={cn(
        'grid shrink-0 gap-2 border-b bg-background px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground',
        listenEnabled
          ? 'min-w-[1096px] grid-cols-[34px_minmax(150px,1fr)_minmax(220px,1.5fr)_170px_80px_150px_120px_100px]'
          : 'min-w-[918px] grid-cols-[34px_minmax(150px,1fr)_minmax(220px,1.5fr)_80px_150px_120px_100px]',
      )}>
      <span />
      <SortButton label="Artist" sortKey="artist" sort={sort} onSort={onSort} />
      <SortButton label="Song" sortKey="song" sort={sort} onSort={onSort} />
      {listenEnabled ? <span className="text-center">Listen</span> : null}
      <SortButton
        label="Plays"
        sortKey="plays"
        sort={sort}
        onSort={onSort}
        className="text-right"
      />
      <SortButton
        label="Relevance"
        sortKey="score"
        sort={sort}
        onSort={onSort}
      />
      <SortButton
        label="Updated"
        sortKey="updated"
        sort={sort}
        onSort={onSort}
      />
      <span>Installed</span>
    </div>
  );
}

function RadarHeader({listenEnabled}: {listenEnabled: boolean}) {
  return (
    <div
      className={cn(
        'grid shrink-0 gap-2 border-b bg-background px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground',
        listenEnabled
          ? 'min-w-[1112px] grid-cols-[34px_minmax(150px,1fr)_minmax(220px,1.5fr)_170px_170px_120px_100px_76px]'
          : 'min-w-[934px] grid-cols-[34px_minmax(150px,1fr)_minmax(220px,1.5fr)_170px_120px_100px_76px]',
      )}>
      <span />
      <span>Artist</span>
      <span>Song</span>
      {listenEnabled ? <span className="text-center">Listen</span> : null}
      <span>Why it is here</span>
      <span>Updated</span>
      <span>Installed</span>
      <span className="text-center">Hide</span>
    </div>
  );
}

function VirtualRows({
  rows,
  view,
  expanded,
  onToggle,
  onDismiss,
  downloadStates,
  onInstall,
  spotifyPreviewEnabled,
  appleMusicClient,
  preferredPreviewProvider,
}: {
  rows: Array<FindMusicSong | RadarSong>;
  view: FindMusicView;
  expanded: Set<string>;
  onToggle: (key: string) => void;
  onDismiss: (song: RadarSong, scope: 'song' | 'artist') => void;
  downloadStates: Record<string, DownloadState>;
  onInstall: (chart: FindMusicChart) => Promise<void>;
  spotifyPreviewEnabled: boolean;
  appleMusicClient: AppleMusicLibraryClient | null;
  preferredPreviewProvider: MusicPreviewProvider | undefined;
}) {
  const listenEnabled = spotifyPreviewEnabled || appleMusicClient !== null;
  const flatRows = useMemo(() => {
    const flat: Array<
      | {kind: 'song'; song: FindMusicSong | RadarSong}
      | {kind: 'chart'; chart: FindMusicChart; parentKey: string}
    > = [];
    for (const song of rows) {
      flat.push({kind: 'song', song});
      if (expanded.has(song.key)) {
        for (const chart of song.charts) {
          flat.push({kind: 'chart', chart, parentKey: song.key});
        }
      }
    }
    return flat;
  }, [expanded, rows]);
  const parentRef = useRef<HTMLDivElement>(null);
  const previousViewRef = useRef(view);
  const scrollPositionsRef = useRef<Record<FindMusicView, number>>({
    music: 0,
    radar: 0,
  });
  const rowVirtualizer = useVirtual({
    parentRef,
    size: flatRows.length,
    overscan: 12,
  });

  useLayoutEffect(() => {
    const scrollElement = parentRef.current;
    if (!scrollElement) return;
    const previousView = previousViewRef.current;
    if (previousView !== view) {
      scrollPositionsRef.current[previousView] = scrollElement.scrollTop;
      scrollElement.scrollTop = scrollPositionsRef.current[view];
      previousViewRef.current = view;
    }
  }, [view]);

  return (
    <div
      ref={parentRef}
      data-testid="results-rows"
      className={cn(
        'min-h-0 flex-1 overflow-y-auto overscroll-contain',
        listenEnabled
          ? view === 'music'
            ? 'min-w-[1096px]'
            : 'min-w-[1112px]'
          : view === 'music'
            ? 'min-w-[918px]'
            : 'min-w-[934px]',
      )}
      onScroll={event => {
        scrollPositionsRef.current[view] = event.currentTarget.scrollTop;
      }}>
      <div
        className="relative w-full"
        style={{height: `${rowVirtualizer.totalSize}px`}}>
        {rowVirtualizer.virtualItems.map(virtualRow => {
          const item = flatRows[virtualRow.index];
          return (
            <div
              key={
                item.kind === 'song'
                  ? item.song.key
                  : `${item.parentKey}-${item.chart.md5}`
              }
              className="absolute left-0 top-0 w-full"
              style={{
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
              }}>
              {item.kind === 'song' ? (
                <SongRow
                  song={item.song}
                  view={view}
                  expanded={expanded.has(item.song.key)}
                  onToggle={() => onToggle(item.song.key)}
                  onDismiss={onDismiss}
                  spotifyPreviewEnabled={spotifyPreviewEnabled}
                  appleMusicClient={appleMusicClient}
                  preferredPreviewProvider={preferredPreviewProvider}
                />
              ) : (
                <ChartRow
                  chart={item.chart}
                  view={view}
                  listenEnabled={listenEnabled}
                  downloadState={downloadStates[item.chart.md5] ?? 'idle'}
                  onInstall={() => onInstall(item.chart)}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SongRow({
  song,
  view,
  expanded,
  onToggle,
  onDismiss,
  spotifyPreviewEnabled,
  appleMusicClient,
  preferredPreviewProvider,
}: {
  song: FindMusicSong | RadarSong;
  view: FindMusicView;
  expanded: boolean;
  onToggle: () => void;
  onDismiss?: (song: RadarSong, scope: 'song' | 'artist') => void;
  spotifyPreviewEnabled: boolean;
  appleMusicClient: AppleMusicLibraryClient | null;
  preferredPreviewProvider: MusicPreviewProvider | undefined;
}) {
  const appleActions =
    view === 'music'
      ? (song as FindMusicSong).providerActions.filter(
          action => action.provider === 'appleMusic',
        )
      : [];
  const spotifyActions =
    view === 'music'
      ? (song as FindMusicSong).providerActions.filter(
          action => action.provider === 'spotify',
        )
      : [];
  const listenEnabled = spotifyPreviewEnabled || appleMusicClient !== null;
  const score =
    view === 'music'
      ? scoreMusicSong(song as FindMusicSong)
      : scoreRadarSong(song as RadarSong);
  const installed = song.charts.filter(chart => chart.isInstalled).length;
  const newest = latestModified(song.charts);

  return (
    <div
      data-testid="song-row"
      data-song-key={song.key}
      onClick={onToggle}
      className={cn(
        'grid h-full w-full cursor-pointer items-center gap-2 border-b px-3 text-left text-sm hover:bg-muted/50',
        view === 'music'
          ? listenEnabled
            ? 'grid-cols-[34px_minmax(150px,1fr)_minmax(220px,1.5fr)_170px_80px_150px_120px_100px]'
            : 'grid-cols-[34px_minmax(150px,1fr)_minmax(220px,1.5fr)_80px_150px_120px_100px]'
          : listenEnabled
            ? 'grid-cols-[34px_minmax(150px,1fr)_minmax(220px,1.5fr)_170px_170px_120px_100px_76px]'
            : 'grid-cols-[34px_minmax(150px,1fr)_minmax(220px,1.5fr)_170px_120px_100px_76px]',
      )}>
      <button
        type="button"
        aria-expanded={expanded}
        aria-label={`${expanded ? 'Hide' : 'Show'} chart versions for ${song.artist} — ${song.song}`}
        className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        onClick={event => {
          event.stopPropagation();
          onToggle();
        }}>
        {expanded ? (
          <ChevronDown className="h-4 w-4" />
        ) : (
          <ChevronRight className="h-4 w-4" />
        )}
      </button>
      <span className="truncate text-muted-foreground">{song.artist}</span>
      <span className="block min-w-0 truncate font-medium">{song.song}</span>
      {listenEnabled ? (
        <div
          className="min-w-0 overflow-hidden"
          onClick={event => event.stopPropagation()}>
          <div
            role="group"
            aria-label={`Listening actions for ${song.song} by ${song.artist}`}
            data-testid="provider-actions"
            className="flex max-w-full flex-nowrap items-center gap-1.5 overflow-x-auto overflow-y-hidden overscroll-x-contain whitespace-nowrap py-1 [&>*]:shrink-0">
            <MusicPreviewButton
              artist={song.artist}
              song={song.song}
              trackKey={song.key}
              preferredProvider={preferredPreviewProvider}
              spotifyEnabled={spotifyPreviewEnabled}
              spotifyActions={
                spotifyActions.length > 0
                  ? spotifyActions
                  : song.spotifyUrl
                    ? [
                        {
                          artist: song.artist,
                          song: song.song,
                          url: song.spotifyUrl,
                        },
                      ]
                    : []
              }
              appleMusicClient={appleMusicClient}
              appleMusicActions={appleActions}
              compact
            />
          </div>
        </div>
      ) : null}
      {view === 'music' ? (
        <span className="text-right font-mono text-xs text-muted-foreground">
          {(song as FindMusicSong).playCount.toLocaleString()}
        </span>
      ) : null}
      <Relevance score={score} song={song} view={view} />
      <span className="font-mono text-xs text-muted-foreground">
        {formatDate(newest)}
      </span>
      <InstalledCount
        songInstalled={song.hasInstalledChart}
        installed={installed}
        total={song.charts.length}
      />
      {view === 'radar' && onDismiss ? (
        <DismissButton song={song as RadarSong} onDismiss={onDismiss} />
      ) : null}
    </div>
  );
}

function DismissButton({
  song,
  onDismiss,
}: {
  song: RadarSong;
  onDismiss: (song: RadarSong, scope: 'song' | 'artist') => void;
}) {
  return (
    <span
      className="flex items-center justify-center gap-0.5"
      onClick={event => event.stopPropagation()}>
      <Button
        size="icon"
        variant="ghost"
        className="h-7 w-7"
        aria-label={`Not interested in ${song.song} by ${song.artist}`}
        title="Not interested"
        onClick={() => onDismiss(song, 'song')}>
        <X className="h-3.5 w-3.5" />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="h-7 w-7"
        aria-label={`Show less from ${song.artist}`}
        title={`Less from ${song.artist}`}
        onClick={() => onDismiss(song, 'artist')}>
        <UserX className="h-3.5 w-3.5" />
      </Button>
    </span>
  );
}

function Relevance({
  score,
  song,
  view,
}: {
  score: {value: number; parts: Array<{label: string; points: number}>};
  song: FindMusicSong | RadarSong;
  view: FindMusicView;
}) {
  return (
    <TooltipProvider delayDuration={180}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            aria-label={`Relevance ${score.value} of 100. Why ${song.song} is relevant`}
            className="flex w-full min-w-0 items-center gap-2 rounded-md px-1 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background">
            <span className="w-6 text-right font-mono text-xs font-bold">
              {score.value}
            </span>
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
              <span
                className="block h-full rounded-full bg-fuchsia-700 dark:bg-fuchsia-400"
                style={{width: `${score.value}%`}}
                aria-hidden="true"
              />
            </span>
          </span>
        </TooltipTrigger>
        <TooltipContent
          side="left"
          align="center"
          sideOffset={10}
          className="z-[70] w-[min(88vw,360px)] bg-popover p-0 text-popover-foreground shadow-xl">
          <div className="border-b px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Evidence ledger
            </p>
            <p className="mt-1 truncate text-sm font-semibold">
              {song.artist} — {song.song}
            </p>
          </div>
          <dl className="divide-y">
            {score.parts.map(part => (
              <div key={part.label} className="px-4 py-3">
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-sm font-semibold">{part.label}</dt>
                  <dd className="shrink-0 font-mono text-sm font-bold">
                    +{part.points}
                  </dd>
                </div>
                <dd className="mt-1 break-words text-xs leading-5 text-muted-foreground">
                  {relevanceEvidence(song, view, part.label)}
                </dd>
              </div>
            ))}
          </dl>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function relevanceEvidence(
  song: FindMusicSong | RadarSong,
  view: FindMusicView,
  label: string,
) {
  if (view === 'music') {
    const music = song as FindMusicSong;
    switch (label) {
      case 'Listening history':
        return music.playCount > 0
          ? `${music.playCount.toLocaleString()} plays in Spotify history`
          : 'No plays in the loaded Spotify history';
      case 'Spotify playlists':
        return music.playlists.length > 0
          ? music.playlists.join(', ')
          : 'Not found in a scanned Spotify playlist';
      case 'Spotify albums':
        return music.albums.length > 0
          ? music.albums.join(', ')
          : 'Not found in a scanned saved album';
      case 'Apple Music library':
        return music.inAppleMusicLibrary
          ? 'Found in the Apple Music library saved in this browser'
          : 'Not found in the saved Apple Music library';
    }
  }

  const radar = song as RadarSong;
  switch (label) {
    case 'Artist affinity':
      return `${radar.artistPlayCount.toLocaleString()} plays across this artist in your history`;
    case 'Saved-library coverage':
      return `${radar.savedLibrarySongCount.toLocaleString()} distinct saved songs by this artist across the libraries loaded in this browser`;
    case 'Available charts':
      return `${radar.charts.length.toLocaleString()} chart versions available on Chorus`;
    case 'Instrument coverage': {
      const labels = INSTRUMENTS.filter(([id]) =>
        radar.charts.some(chart => chart.instrumentPresence[id]),
      ).map(([, , name]) => name);
      if (labels.length > 0) return labels.join(', ');
      return radar.charts.some(chart => chart.hasOtherInstruments)
        ? 'Other instruments'
        : 'No instrument data';
    }
    case 'Chart freshness':
      return `Newest chart updated ${formatDate(latestModified(radar.charts))}`;
    default:
      return 'No supporting evidence';
  }
}

function InstalledCount({
  songInstalled,
  installed,
  total,
}: {
  songInstalled: boolean;
  installed: number;
  total: number;
}) {
  if (!songInstalled)
    return <span className="text-xs text-muted-foreground">—</span>;
  if (installed === 0)
    return (
      <span className="text-[11px] font-medium leading-tight text-emerald-700 dark:text-emerald-400">
        <Check className="mr-1 inline h-3 w-3" /> other version
      </span>
    );
  return (
    <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
      <Check className="mr-1 inline h-3 w-3" />
      {installed === total ? 'all' : `${installed} of ${total}`}
    </span>
  );
}

function ChartRow({
  chart,
  view,
  listenEnabled,
  downloadState,
  onInstall,
}: {
  chart: FindMusicChart;
  view: FindMusicView;
  listenEnabled: boolean;
  downloadState: DownloadState;
  onInstall: () => Promise<void>;
}) {
  // The instrument badges flow under the columns that carry no per-chart value
  // (listen, the view-specific metric, and the spacer before the date).
  const instrumentSpan =
    2 + (listenEnabled ? 1 : 0) + (view === 'music' ? 1 : 0);
  return (
    <div
      data-testid="chart-row"
      className={cn(
        'grid h-full items-center gap-2 border-b border-l-2 border-l-primary bg-muted/35 px-3 text-xs',
        view === 'music'
          ? listenEnabled
            ? 'grid-cols-[34px_minmax(150px,1fr)_minmax(220px,1.5fr)_170px_80px_150px_120px_100px]'
            : 'grid-cols-[34px_minmax(150px,1fr)_minmax(220px,1.5fr)_80px_150px_120px_100px]'
          : listenEnabled
            ? 'grid-cols-[34px_minmax(150px,1fr)_minmax(220px,1.5fr)_170px_170px_120px_100px_76px]'
            : 'grid-cols-[34px_minmax(150px,1fr)_minmax(220px,1.5fr)_170px_120px_100px_76px]',
      )}>
      <span />
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="truncate font-medium">{chart.charter}</span>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7 shrink-0"
          asChild>
          <a
            href={`https://www.enchor.us/chart/${chart.md5}`}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open chart by ${chart.charter} on Enchor`}>
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </Button>
      </span>
      <span
        className={cn(
          'min-w-0 pl-2',
          instrumentSpan === 4
            ? 'col-span-4'
            : instrumentSpan === 3
              ? 'col-span-3'
              : 'col-span-2',
        )}>
        <InstrumentBadges chart={chart} />
      </span>
      <span className="font-mono text-xs text-muted-foreground">
        <span className="sr-only">Updated </span>
        {formatDate(chart.modifiedTime)}
      </span>
      {chart.isInstalled || downloadState === 'done' ? (
        <span className="font-medium text-emerald-600 dark:text-emerald-400">
          <Check className="mr-1 inline h-3 w-3" /> Installed
        </span>
      ) : (
        <Button
          size="xs"
          variant={downloadState === 'error' ? 'destructive' : 'outline'}
          disabled={downloadState === 'downloading'}
          onClick={event => {
            event.stopPropagation();
            void onInstall();
          }}>
          {downloadState === 'downloading' ? (
            <RotateCw className="h-3 w-3 animate-spin" />
          ) : (
            <Download className="h-3 w-3" />
          )}
          {downloadState === 'error' ? 'Retry' : 'Install'}
        </Button>
      )}
      {view === 'radar' ? <span /> : null}
    </div>
  );
}

function InstrumentBadges({chart}: {chart: FindMusicChart}) {
  const available = INSTRUMENTS.filter(([id]) => chart.instrumentPresence[id]);
  if (available.length === 0) {
    return (
      <span className="text-muted-foreground">
        {chart.hasOtherInstruments ? 'Other instruments' : 'No instrument data'}
      </span>
    );
  }
  return (
    <span className="flex flex-wrap gap-1.5">
      {available.map(([id, , name]) => {
        const difficulty = chart.instruments[id];
        const hasIntensity = difficulty != null && difficulty >= 0;
        return (
          <span
            key={id}
            title={
              hasIntensity
                ? `${name}: intensity ${difficulty}`
                : `${name}: intensity unavailable`
            }
            className="inline-flex h-8 min-w-11 items-center justify-center gap-1.5 rounded-md border bg-background px-2 text-secondary-foreground">
            <FindMusicInstrumentIcon instrument={id} size={19} />
            <small className="font-mono text-xs font-semibold leading-none text-foreground">
              {hasIntensity ? difficulty : '?'}
            </small>
          </span>
        );
      })}
    </span>
  );
}

function latestModified(charts: FindMusicChart[]) {
  return charts.reduce(
    (latest, chart) =>
      chart.modifiedTime > latest ? chart.modifiedTime : latest,
    '',
  );
}

function formatDate(value: string) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
