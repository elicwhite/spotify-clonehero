'use client';

import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ChevronDown,
  ChevronRight,
  Download,
  Check,
  RotateCw,
} from 'lucide-react';
import {useVirtual} from 'react-virtual';
import {Button} from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import {cn} from '@/lib/utils';
import {downloadSong} from '@/lib/local-songs-folder';
import SpotifyPreviewButton from '@/components/SpotifyPreviewButton';
import {AudioContext} from '@/app/AudioProvider';
import FindMusicInstrumentIcon from './FindMusicInstrumentIcon';
import {
  INSTRUMENTS,
  type FindMusicChart,
  type FindMusicFilters,
  type FindMusicSong,
  type FindMusicView,
  type RadarSong,
} from './types';
import {
  applyMusicFilters,
  applyRadarFilters,
  scoreMusicSong,
  scoreRadarSong,
  sortMusicSongs,
  sortRadarSongs,
} from './model';

type MusicSort = {
  key: 'score' | 'artist' | 'song' | 'plays' | 'updated';
  direction: 'asc' | 'desc';
};

type DownloadState = 'idle' | 'downloading' | 'done' | 'error';

export default function FindMusicTable({
  view,
  music,
  radar,
  filters,
  radarLoading,
  previewEnabled,
  onClearFilters,
}: {
  view: FindMusicView;
  music: FindMusicSong[];
  radar: RadarSong[];
  filters: FindMusicFilters;
  radarLoading: boolean;
  previewEnabled: boolean;
  onClearFilters: () => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<MusicSort>({
    key: 'score',
    direction: 'desc',
  });
  const [downloadStates, setDownloadStates] = useState<
    Record<string, DownloadState>
  >({});
  const {currentTrack, pause} = useContext(AudioContext);

  const rows = useMemo(() => {
    if (view === 'radar') {
      return sortRadarSongs(applyRadarFilters(radar, filters));
    }
    return sortMusicSongs(applyMusicFilters(music, filters), sort);
  }, [filters, music, radar, sort, view]);

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
      await downloadSong(
        chart.artist,
        chart.name,
        chart.charter,
        `https://files.enchor.us/${chart.md5}.sng`,
        {asSng: true, source: 'unknown', md5: chart.md5},
      );
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
          <h2 className="font-semibold">Radar is building artist affinity</h2>
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
              ? 'No Radar candidates match'
              : 'No songs match the current filters'}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Filters combine with AND. Clear them to see every available match.
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
      {view === 'radar' && (
        <div className="border-b bg-muted/45 px-4 py-2 text-xs text-muted-foreground">
          Songs you have not played or saved, by artists you demonstrably like.
          Scores are transparent affinity arithmetic—not a machine-learning
          model.
        </div>
      )}
      <div className="flex items-center border-b px-4 py-2 text-xs text-muted-foreground">
        <span>
          <b className="text-foreground">{rows.length.toLocaleString()}</b>{' '}
          {view === 'radar' ? 'candidates' : 'songs'} shown
        </span>
      </div>
      <div
        data-testid="results-scroll"
        className="flex min-h-0 flex-1 flex-col overflow-x-auto overflow-y-hidden">
        {view === 'music' ? (
          <MusicHeader
            sort={sort}
            onSort={setSort}
            previewEnabled={previewEnabled}
          />
        ) : (
          <RadarHeader previewEnabled={previewEnabled} />
        )}
        <VirtualRows
          rows={rows}
          view={view}
          expanded={expanded}
          onToggle={toggleExpanded}
          downloadStates={downloadStates}
          onInstall={install}
          previewEnabled={previewEnabled}
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
  previewEnabled,
}: {
  sort: MusicSort;
  onSort: (sort: MusicSort) => void;
  previewEnabled: boolean;
}) {
  return (
    <div
      className={cn(
        'grid shrink-0 gap-2 border-b bg-background px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground',
        previewEnabled
          ? 'min-w-[1008px] grid-cols-[34px_minmax(130px,1fr)_minmax(170px,1.35fr)_100px_130px_76px_70px_110px_100px]'
          : 'min-w-[900px] grid-cols-[34px_minmax(130px,1fr)_minmax(170px,1.35fr)_130px_76px_70px_110px_100px]',
      )}>
      <span />
      <SortButton label="Artist" sortKey="artist" sort={sort} onSort={onSort} />
      <SortButton label="Song" sortKey="song" sort={sort} onSort={onSort} />
      {previewEnabled ? <span className="text-center">Preview</span> : null}
      <SortButton
        label="Relevance"
        sortKey="score"
        sort={sort}
        onSort={onSort}
      />
      <SortButton
        label="Plays"
        sortKey="plays"
        sort={sort}
        onSort={onSort}
        className="text-right"
      />
      <span className="text-right">Charts</span>
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

function RadarHeader({previewEnabled}: {previewEnabled: boolean}) {
  return (
    <div
      className={cn(
        'grid shrink-0 gap-2 border-b bg-background px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground',
        previewEnabled
          ? 'min-w-[979px] grid-cols-[34px_minmax(140px,1fr)_minmax(180px,1.3fr)_100px_150px_85px_110px_100px]'
          : 'min-w-[871px] grid-cols-[34px_minmax(140px,1fr)_minmax(180px,1.3fr)_150px_85px_110px_100px]',
      )}>
      <span />
      <span>Artist</span>
      <span>Song</span>
      {previewEnabled ? <span className="text-center">Preview</span> : null}
      <span>Why it is here</span>
      <span className="text-right">Charts</span>
      <span>Newest</span>
      <span>Installed</span>
    </div>
  );
}

function VirtualRows({
  rows,
  view,
  expanded,
  onToggle,
  downloadStates,
  onInstall,
  previewEnabled,
}: {
  rows: Array<FindMusicSong | RadarSong>;
  view: FindMusicView;
  expanded: Set<string>;
  onToggle: (key: string) => void;
  downloadStates: Record<string, DownloadState>;
  onInstall: (chart: FindMusicChart) => Promise<void>;
  previewEnabled: boolean;
}) {
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
  const rowVirtualizer = useVirtual({
    parentRef,
    size: flatRows.length,
    overscan: 12,
  });

  return (
    <div
      ref={parentRef}
      data-testid="results-rows"
      className={cn(
        'min-h-0 flex-1 overflow-y-auto overscroll-contain',
        previewEnabled
          ? view === 'music'
            ? 'min-w-[1008px]'
            : 'min-w-[979px]'
          : view === 'music'
            ? 'min-w-[900px]'
            : 'min-w-[871px]',
      )}>
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
                  previewEnabled={previewEnabled}
                />
              ) : (
                <ChartRow
                  chart={item.chart}
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
  previewEnabled,
}: {
  song: FindMusicSong | RadarSong;
  view: FindMusicView;
  expanded: boolean;
  onToggle: () => void;
  previewEnabled: boolean;
}) {
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
      className={cn(
        'grid h-full w-full items-center gap-2 border-b px-3 text-left text-sm hover:bg-muted/50',
        view === 'music'
          ? previewEnabled
            ? 'grid-cols-[34px_minmax(130px,1fr)_minmax(170px,1.35fr)_100px_130px_76px_70px_110px_100px]'
            : 'grid-cols-[34px_minmax(130px,1fr)_minmax(170px,1.35fr)_130px_76px_70px_110px_100px]'
          : previewEnabled
            ? 'grid-cols-[34px_minmax(140px,1fr)_minmax(180px,1.3fr)_100px_150px_85px_110px_100px]'
            : 'grid-cols-[34px_minmax(140px,1fr)_minmax(180px,1.3fr)_150px_85px_110px_100px]',
      )}>
      <button
        type="button"
        aria-expanded={expanded}
        aria-label={`${expanded ? 'Hide' : 'Show'} chart versions for ${song.artist} — ${song.song}`}
        className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        onClick={onToggle}>
        {expanded ? (
          <ChevronDown className="h-4 w-4" />
        ) : (
          <ChevronRight className="h-4 w-4" />
        )}
      </button>
      <span className="truncate text-muted-foreground">{song.artist}</span>
      <span className="block min-w-0 truncate font-medium">{song.song}</span>
      {previewEnabled ? (
        <SpotifyPreviewButton
          artist={song.artist}
          song={song.song}
          trackKey={song.key}
          compact
        />
      ) : null}
      <Relevance score={score} song={song} view={view} />
      {view === 'music' ? (
        <span className="text-right font-mono text-xs">
          {(song as FindMusicSong).playCount || '—'}
        </span>
      ) : null}
      <span className="text-right font-mono text-xs">{song.charts.length}</span>
      <span className="font-mono text-xs text-muted-foreground">
        {formatDate(newest)}
      </span>
      <InstalledCount
        songInstalled={song.hasInstalledChart}
        installed={installed}
        total={song.charts.length}
      />
    </div>
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
    <Sheet>
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label={`Relevance ${score.value} of 100. View why ${song.song} is relevant`}
          className="flex w-full min-w-0 items-center gap-2 rounded-md px-1 py-2 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background">
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
        </button>
      </SheetTrigger>
      <SheetContent className="w-[min(92vw,420px)] overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Why this song is relevant</SheetTitle>
          <SheetDescription>
            {song.artist} — {song.song}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 rounded-lg border bg-card p-4 text-card-foreground">
          <div className="flex items-end justify-between gap-4">
            <span className="text-sm font-medium">Relevance score</span>
            <span className="font-mono text-3xl font-bold">
              {score.value}
              <span className="text-sm font-normal text-muted-foreground">
                /100
              </span>
            </span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-fuchsia-700 dark:bg-fuchsia-400"
              style={{width: `${score.value}%`}}
            />
          </div>
        </div>

        <div className="mt-6">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Evidence ledger
          </h3>
          <dl className="mt-2 divide-y rounded-lg border bg-card text-card-foreground">
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
        </div>
        <p className="mt-4 text-xs leading-5 text-muted-foreground">
          Each source contributes independently. The total is capped at 100.
        </p>
      </SheetContent>
    </Sheet>
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
      case 'Installed chart': {
        const exact = music.charts.filter(chart => chart.isInstalled).length;
        if (!music.hasInstalledChart) return 'No local chart found';
        if (exact === 0)
          return 'Installed locally, but the local charter is not among these Chorus versions';
        return `${exact} of ${music.charts.length} matching Chorus versions installed`;
      }
    }
  }

  const radar = song as RadarSong;
  switch (label) {
    case 'Artist affinity':
      return `${radar.artistPlayCount.toLocaleString()} plays across this artist in your history`;
    case 'Available charts':
      return `${radar.charts.length.toLocaleString()} chart versions available on Chorus`;
    case 'Instrument coverage': {
      const labels = INSTRUMENTS.filter(([id]) =>
        radar.charts.some(chart => {
          const difficulty = chart.instruments[id];
          return difficulty != null && difficulty >= 0;
        }),
      ).map(([, , name]) => name);
      return labels.length > 0 ? labels.join(', ') : 'No instrument data';
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
  downloadState,
  onInstall,
}: {
  chart: FindMusicChart;
  downloadState: DownloadState;
  onInstall: () => Promise<void>;
}) {
  return (
    <div className="grid h-full grid-cols-[34px_minmax(160px,1fr)_minmax(180px,1.1fr)_250px_90px_110px] items-center gap-2 border-b border-l-2 border-l-primary bg-muted/35 px-3 text-xs">
      <span />
      <span
        className="truncate font-mono text-[10px] text-muted-foreground"
        title={chart.md5}>
        {chart.md5.slice(0, 10)}
      </span>
      <span className="truncate font-medium">{chart.charter}</span>
      <InstrumentBadges chart={chart} />
      <span className="font-mono text-muted-foreground">
        {formatDuration(chart.songLength)}
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
    </div>
  );
}

function InstrumentBadges({chart}: {chart: FindMusicChart}) {
  const available = INSTRUMENTS.filter(([id]) => {
    const difficulty = chart.instruments[id];
    return difficulty != null && difficulty >= 0;
  });
  if (available.length === 0) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <span className="flex flex-wrap gap-1.5">
      {available.map(([id, , name]) => {
        const difficulty = chart.instruments[id] as number;
        return (
          <span
            key={id}
            title={`${name}: difficulty ${difficulty}`}
            className="inline-flex h-7 min-w-9 items-center justify-center gap-1 rounded-md border bg-background px-1.5 text-secondary-foreground">
            <FindMusicInstrumentIcon instrument={id} size={18} />
            <small className="font-mono text-[9px] font-bold text-muted-foreground">
              {difficulty}
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

function formatDuration(milliseconds: number | null) {
  if (!milliseconds) return '—';
  const seconds = Math.floor(milliseconds / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
