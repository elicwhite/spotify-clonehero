import type {Kysely} from 'kysely';
import type {ChartResponseEncore} from '@/lib/chartSelection';
import type {NotesData} from '@eliwhite/scan-chart';
import type {ArtistTrackPlays} from '@/lib/spotify-sdk/HistoryDumpParsing';
import {upsertCharts} from '../../chorus';
import {upsertSpotifyHistory} from '../../spotify-history';
import {
  appendPlaylistTracks,
  upsertPlaylists,
  upsertTracks,
  type PlaylistLike,
  type TrackLike,
} from '../../spotify';
import type {DB} from '../../types';

export type HistoryEntry = {artist: string; track: string; playCount: number};

export async function seedSpotifyHistory(
  db: Kysely<DB>,
  entries: HistoryEntry[],
): Promise<void> {
  const map: ArtistTrackPlays = new Map();
  for (const e of entries) {
    let inner = map.get(e.artist);
    if (!inner) {
      inner = new Map();
      map.set(e.artist, inner);
    }
    inner.set(e.track, e.playCount);
  }
  await db.transaction().execute(async trx => {
    await upsertSpotifyHistory(trx, map);
  });
}

export type ChorusChartSeed = {
  md5: string;
  name: string;
  artist: string;
  charter: string;
  diff_drums?: number | null;
  diff_guitar?: number | null;
  diff_bass?: number | null;
  diff_keys?: number | null;
  diff_drums_real?: number | null;
  modifiedTime?: string;
  song_length?: number | null;
  hasVideoBackground?: boolean;
  albumArtMd5?: string;
  groupId?: number;
};

const DEFAULT_NOTES_DATA: NotesData = {
  instruments: [],
  hasSoloSections: false,
  hasLyrics: false,
  hasVocals: false,
  hasForcedNotes: false,
  hasTapNotes: false,
  hasOpenNotes: false,
  has2xKick: false,
  has5LaneKeys: false,
  hasFlexLanes: false,
  chartIssues: [],
  noteCounts: [],
  maxNps: [],
  hashes: [],
  tempos: [],
  timeSignatures: [],
  length: 0,
  effectiveLength: 0,
} as unknown as NotesData;

export async function seedChorusCharts(
  db: Kysely<DB>,
  seeds: ChorusChartSeed[],
): Promise<void> {
  const charts: ChartResponseEncore[] = seeds.map(s => ({
    md5: s.md5,
    name: s.name,
    artist: s.artist,
    charter: s.charter,
    diff_drums: s.diff_drums ?? null,
    diff_guitar: s.diff_guitar ?? null,
    diff_bass: s.diff_bass ?? null,
    diff_keys: s.diff_keys ?? null,
    diff_drums_real: s.diff_drums_real ?? null,
    modifiedTime: s.modifiedTime ?? '2024-01-01T00:00:00.000Z',
    song_length: s.song_length ?? null,
    hasVideoBackground: s.hasVideoBackground ?? false,
    albumArtMd5: s.albumArtMd5 ?? '',
    groupId: s.groupId ?? 0,
    file: '',
    notesData: DEFAULT_NOTES_DATA,
  }));
  await db.transaction().execute(async trx => {
    await upsertCharts(trx, charts);
  });
}

/**
 * Seeds a Spotify playlist plus its tracks (the tracks themselves go through
 * the production upsertTracks path, which populates artist_normalized /
 * name_normalized and recalculates the spotify_track_chart_matches table).
 *
 * Uses the production self-fetching helpers — they reach the test DB via
 * the override installed by `installTestDb`.
 */
export async function seedPlaylistWithTracks(
  playlist: PlaylistLike,
  tracks: TrackLike[],
): Promise<void> {
  await upsertPlaylists([playlist]);
  await upsertTracks(tracks);
  await appendPlaylistTracks(playlist.id, tracks);
}
