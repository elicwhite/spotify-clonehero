import type {
  FindMusicChart,
  FindMusicFilters,
  FindMusicSong,
  InstrumentId,
  RadarSong,
} from './types';

export type ScorePart = {label: string; points: number};
export type Score = {value: number; parts: ScorePart[]};
export type MusicSort = {
  key: 'score' | 'artist' | 'song' | 'updated';
  direction: 'asc' | 'desc';
};
export type HoldState<T> = {
  committed: T[];
  pending: T[] | null;
  pendingNewCount: number;
  pendingChangedCount: number;
};

type Keyed = {key: string};

const INSTRUMENT_IDS: InstrumentId[] = ['guitar', 'bass', 'keys', 'proDrums'];

function safeCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function makeScore(parts: ScorePart[]): Score {
  return {
    value: Math.min(
      100,
      Math.max(
        0,
        parts.reduce((total, part) => total + part.points, 0),
      ),
    ),
    parts,
  };
}

/** Direct song evidence, with independently capped source contributions. */
export function scoreMusicSong(song: FindMusicSong): Score {
  const playCount = safeCount(song.playCount);
  const historyPoints = Math.min(55, Math.round(14 * Math.log2(1 + playCount)));

  return makeScore([
    {label: 'Listening history', points: historyPoints},
    {
      label: 'Spotify playlists',
      points: Math.min(24, song.playlists.length * 12),
    },
    {
      label: 'Spotify albums',
      points: Math.min(20, song.albums.length * 10),
    },
    {
      label: 'Installed chart',
      points: song.hasInstalledChart ? 1 : 0,
    },
  ]);
}

function latestModifiedTime(charts: FindMusicChart[]): number {
  let latest = 0;
  for (const chart of charts) {
    const time = Date.parse(chart.modifiedTime);
    if (Number.isFinite(time)) latest = Math.max(latest, time);
  }
  return latest;
}

/** Discovery evidence: affinity leads, with breadth and freshness supporting. */
export function scoreRadarSong(song: RadarSong): Score {
  const artistPlayCount = safeCount(song.artistPlayCount);
  const affinityPoints = Math.min(
    55,
    Math.round((55 * Math.log1p(artistPlayCount)) / Math.log(101)),
  );
  const availableInstruments = INSTRUMENT_IDS.filter(instrument =>
    song.charts.some(chart => {
      const difficulty = chart.instruments[instrument];
      return (
        (difficulty != null && difficulty >= 0) ||
        chart.instrumentPresence[instrument]
      );
    }),
  ).length;
  const newestYear = song.charts.reduce((latest, chart) => {
    const year = new Date(chart.modifiedTime).getUTCFullYear();
    return Number.isFinite(year) ? Math.max(latest, year) : latest;
  }, 0);
  const recencyPoints =
    newestYear >= 2026
      ? 10
      : newestYear >= 2024
        ? 6
        : newestYear >= 2022
          ? 3
          : 0;

  return makeScore([
    {label: 'Artist affinity', points: affinityPoints},
    {label: 'Available charts', points: Math.min(15, song.charts.length * 3)},
    {label: 'Instrument coverage', points: availableInstruments * 4},
    {label: 'Chart freshness', points: recencyPoints},
  ]);
}

function chartHasInstruments(
  chart: FindMusicChart,
  instruments: Set<InstrumentId>,
): boolean {
  for (const instrument of instruments) {
    const difficulty = chart.instruments[instrument];
    if (
      (difficulty == null || difficulty < 0) &&
      !chart.instrumentPresence[instrument]
    )
      return false;
  }
  return true;
}

function passesInstallFilter(
  song: Pick<FindMusicSong | RadarSong, 'hasInstalledChart'>,
  filters: Pick<FindMusicFilters, 'install'>,
): boolean {
  if (filters.install === 'hide-installed' && song.hasInstalledChart)
    return false;
  return true;
}

function withFilteredCharts<T extends FindMusicSong | RadarSong>(
  song: T,
  instruments: Set<InstrumentId>,
): T | null {
  if (instruments.size === 0) return song;

  // Instruments must coexist on an individual chart version. Return only
  // those versions so expanding a matching song cannot reveal charts that do
  // not satisfy the active filter.
  const charts = song.charts.filter(chart =>
    chartHasInstruments(chart, instruments),
  );
  if (charts.length === 0) return null;
  return charts.length === song.charts.length ? song : {...song, charts};
}

export function applyMusicFilters(
  songs: FindMusicSong[],
  filters: FindMusicFilters,
): FindMusicSong[] {
  return songs.flatMap(song => {
    if (!passesInstallFilter(song, filters)) return [];
    const filteredSong = withFilteredCharts(song, filters.instruments);
    if (!filteredSong) return [];
    return matchesText(filteredSong, filters.query) &&
      !matchesExclusion(filteredSong, filters)
      ? [filteredSong]
      : [];
  });
}

export function applyRadarFilters(
  songs: RadarSong[],
  filters: FindMusicFilters,
): RadarSong[] {
  return songs.flatMap(song => {
    if (!passesInstallFilter(song, filters)) return [];
    const filteredSong = withFilteredCharts(song, filters.instruments);
    if (!filteredSong) return [];
    return matchesText(filteredSong, filters.query) &&
      !matchesExclusion(filteredSong, filters)
      ? [filteredSong]
      : [];
  });
}

function matchesExclusion(
  song: Pick<FindMusicSong | RadarSong, 'artist' | 'song' | 'charts'>,
  filters: Pick<FindMusicFilters, 'exclusions' | 'exclusionDraft'>,
): boolean {
  const terms = [...filters.exclusions, filters.exclusionDraft]
    .map(term => term.trim().toLocaleLowerCase('en-US'))
    .filter(Boolean);
  if (terms.length === 0) return false;

  const fields = [
    song.artist,
    song.song,
    ...song.charts.map(chart => chart.charter),
  ].map(value => value.toLocaleLowerCase('en-US'));
  return terms.some(term => fields.some(field => field.includes(term)));
}

function matchesText(
  song: Pick<FindMusicSong | RadarSong, 'artist' | 'song'>,
  query: string,
): boolean {
  const terms = query
    .trim()
    .toLocaleLowerCase('en-US')
    .split(/\s+/)
    .filter(Boolean);
  if (terms.length === 0) return true;

  const searchable = `${song.artist} ${song.song}`.toLocaleLowerCase('en-US');
  return terms.every(term => searchable.includes(term));
}

function compareText(left: string, right: string): number {
  const normalizedLeft = left.toLocaleLowerCase('en-US');
  const normalizedRight = right.toLocaleLowerCase('en-US');
  if (normalizedLeft < normalizedRight) return -1;
  if (normalizedLeft > normalizedRight) return 1;
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareIdentity(
  left: Pick<FindMusicSong, 'artist' | 'song' | 'key'>,
  right: Pick<FindMusicSong, 'artist' | 'song' | 'key'>,
): number {
  return (
    compareText(left.artist, right.artist) ||
    compareText(left.song, right.song) ||
    compareText(left.key, right.key)
  );
}

export function sortMusicSongs(
  songs: FindMusicSong[],
  sort: MusicSort,
): FindMusicSong[] {
  const direction = sort.direction === 'asc' ? 1 : -1;
  return [...songs].sort((left, right) => {
    let primary = 0;
    switch (sort.key) {
      case 'score':
        primary = scoreMusicSong(left).value - scoreMusicSong(right).value;
        break;
      case 'artist':
        primary = compareText(left.artist, right.artist);
        break;
      case 'song':
        primary = compareText(left.song, right.song);
        break;
      case 'updated':
        primary =
          latestModifiedTime(left.charts) - latestModifiedTime(right.charts);
        break;
    }
    return primary * direction || compareIdentity(left, right);
  });
}

export function sortRadarSongs(songs: RadarSong[]): RadarSong[] {
  return [...songs].sort(
    (left, right) =>
      scoreRadarSong(right).value - scoreRadarSong(left).value ||
      safeCount(right.artistPlayCount) - safeCount(left.artistPlayCount) ||
      compareIdentity(left, right),
  );
}

function stableValue(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map(key => `${JSON.stringify(key)}:${stableValue(record[key])}`)
    .join(',')}}`;
}

export function createHoldState<T extends Keyed>(initial: T[]): HoldState<T> {
  return {
    committed: [...initial],
    pending: null,
    pendingNewCount: 0,
    pendingChangedCount: 0,
  };
}

/** Stage a complete query snapshot without touching visible row references. */
export function stageSnapshot<T extends Keyed>(
  state: HoldState<T>,
  next: T[],
): HoldState<T> {
  const committedByKey = new Map(state.committed.map(row => [row.key, row]));
  let pendingNewCount = 0;
  let pendingChangedCount = 0;

  for (const row of next) {
    const committed = committedByKey.get(row.key);
    if (!committed) pendingNewCount += 1;
    else if (stableValue(committed) !== stableValue(row))
      pendingChangedCount += 1;
  }
  const nextKeys = new Set(next.map(row => row.key));
  for (const key of committedByKey.keys()) {
    if (!nextKeys.has(key)) pendingChangedCount += 1;
  }

  return {
    committed: state.committed,
    pending: [...next],
    pendingNewCount,
    pendingChangedCount,
  };
}

export function applyHeld<T extends Keyed>(state: HoldState<T>): HoldState<T> {
  if (state.pending === null) return state;
  return {
    committed: state.pending,
    pending: null,
    pendingNewCount: 0,
    pendingChangedCount: 0,
  };
}
