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
  key: 'score' | 'plays' | 'artist' | 'song' | 'updated';
  direction: 'asc' | 'desc';
};
export type HoldState<T> = {
  committed: T[];
  pending: T[] | null;
  pendingNewCount: number;
  pendingChangedCount: number;
};

export type RadarCandidateSummary = Pick<
  RadarSong,
  'key' | 'artist' | 'song' | 'artistPlayCount' | 'savedLibrarySongCount'
> & {
  chartCount: number;
  availableInstrumentCount: number;
};

type Keyed = {key: string};

type RadarCandidateSummaryEvidence = Pick<
  RadarCandidateSummary,
  | 'artistPlayCount'
  | 'savedLibrarySongCount'
  | 'chartCount'
  | 'availableInstrumentCount'
>;

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

  const parts: ScorePart[] = [
    {label: 'Listening history', points: historyPoints},
    {
      label: 'Spotify playlists',
      points: Math.min(24, song.playlists.length * 12),
    },
    {
      label: 'Spotify albums',
      points: Math.min(20, song.albums.length * 10),
    },
  ];
  if (song.inAppleMusicLibrary) {
    parts.push({label: 'Apple Music library', points: 20});
  }
  return makeScore(parts);
}

function latestModifiedTime(charts: FindMusicChart[]): number {
  let latest = 0;
  for (const chart of charts) {
    const time = Date.parse(chart.modifiedTime);
    if (Number.isFinite(time)) latest = Math.max(latest, time);
  }
  return latest;
}

function scoreRadarEvidence({
  artistPlayCount,
  savedLibrarySongCount,
  chartCount,
  availableInstrumentCount,
}: RadarCandidateSummaryEvidence): Score {
  const safeArtistPlayCount = safeCount(artistPlayCount);
  const affinityPoints = Math.min(
    55,
    Math.round((55 * Math.log1p(safeArtistPlayCount)) / Math.log(101)),
  );

  const parts: ScorePart[] = [
    {label: 'Artist affinity', points: affinityPoints},
  ];
  const safeSavedLibrarySongCount = safeCount(savedLibrarySongCount);
  if (safeSavedLibrarySongCount > 0) {
    parts.push({
      label: 'Saved-library coverage',
      points: Math.min(25, safeSavedLibrarySongCount * 5),
    });
  }
  parts.push(
    {
      label: 'Available charts',
      points: Math.min(15, safeCount(chartCount) * 3),
    },
    {
      label: 'Instrument coverage',
      points: safeCount(availableInstrumentCount) * 4,
    },
  );
  return makeScore(parts);
}

/**
 * Discovery evidence: affinity leads, with breadth supporting. The counts come
 * from the candidate query rather than the hydrated chart list, so the score
 * shown is the score that ranked the row.
 */
export function scoreRadarSong(song: RadarSong): Score {
  return scoreRadarEvidence(song);
}

function scoreRadarCandidate(candidate: RadarCandidateSummary): Score {
  return scoreRadarEvidence(candidate);
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

function applyFilters<T extends FindMusicSong | RadarSong>(
  songs: T[],
  filters: FindMusicFilters,
): T[] {
  const exclusions = exclusionTerms(filters);
  return songs.flatMap(song => {
    if (!passesInstallFilter(song, filters)) return [];
    if (!matchesText(song, filters.query)) return [];
    const withInstruments = withFilteredCharts(song, filters.instruments);
    if (!withInstruments) return [];
    const included = withoutExcludedCharts(withInstruments, exclusions);
    return included ? [included] : [];
  });
}

export function applyMusicFilters(
  songs: FindMusicSong[],
  filters: FindMusicFilters,
): FindMusicSong[] {
  return applyFilters(songs, filters);
}

export function applyRadarFilters(
  songs: RadarSong[],
  filters: FindMusicFilters,
): RadarSong[] {
  return applyFilters(songs, filters);
}

function exclusionTerms(
  filters: Pick<FindMusicFilters, 'exclusions' | 'exclusionDraft'>,
): string[] {
  return [...filters.exclusions, filters.exclusionDraft]
    .map(term => term.trim().toLocaleLowerCase('en-US'))
    .filter(Boolean);
}

/**
 * An artist or song exclusion is about the music, so it drops the row. A
 * charter exclusion is about one person's work, so it drops only their
 * versions — blocking a charter should not cost access to songs other people
 * also charted.
 */
function withoutExcludedCharts<T extends FindMusicSong | RadarSong>(
  song: T,
  terms: string[],
): T | null {
  if (terms.length === 0) return song;

  const identityFields = [song.artist, song.song].map(value =>
    value.toLocaleLowerCase('en-US'),
  );
  if (terms.some(term => identityFields.some(field => field.includes(term))))
    return null;

  const charts = song.charts.filter(chart => {
    const charter = chart.charter.toLocaleLowerCase('en-US');
    return !terms.some(term => charter.includes(term));
  });
  if (charts.length === 0) return null;
  return charts.length === song.charts.length ? song : {...song, charts};
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
      case 'plays':
        primary = safeCount(left.playCount) - safeCount(right.playCount);
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
  return sortRadarRankables(songs, scoreRadarSong);
}

/**
 * The radar score saturates well below its own maximum, so its tiebreaks —
 * artist play count first, and that is constant across an artist's songs — end
 * up doing the ranking. Left alone the list block-sorts by artist. Keep each
 * artist's best few and let the rest of the catalog through.
 */
export function capPerArtist<T extends {artist: string}>(
  rows: T[],
  perArtist: number,
  // Display names come from MIN(chart.artist), so two songs by one artist can
  // carry different spellings. Callers with a normalized name should pass it.
  keyOf: (row: T) => string = row => row.artist.toLocaleLowerCase('en-US'),
): T[] {
  if (perArtist <= 0) return [];
  const counts = new Map<string, number>();
  return rows.filter(row => {
    const artist = keyOf(row);
    const taken = counts.get(artist) ?? 0;
    if (taken >= perArtist) return false;
    counts.set(artist, taken + 1);
    return true;
  });
}

export function sortRadarCandidateSummaries<T extends RadarCandidateSummary>(
  candidates: T[],
): T[] {
  return sortRadarRankables(candidates, scoreRadarCandidate);
}

function sortRadarRankables<
  T extends Pick<
    RadarSong,
    'key' | 'artist' | 'song' | 'artistPlayCount' | 'savedLibrarySongCount'
  >,
>(rows: T[], score: (row: T) => Score): T[] {
  return [...rows].sort(
    (left, right) =>
      score(right).value - score(left).value ||
      safeCount(right.artistPlayCount) - safeCount(left.artistPlayCount) ||
      safeCount(right.savedLibrarySongCount) -
        safeCount(left.savedLibrarySongCount) ||
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
