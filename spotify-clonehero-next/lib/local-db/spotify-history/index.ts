import {type Transaction} from 'kysely';
import type {
  ArtistTrackPlaybackStats,
  ArtistTrackPlays,
} from '@/lib/spotify-sdk/HistoryDumpParsing';
import {normalizeStrForMatching} from '../normalize';
import type {DB} from '../types';
import {getLocalDb} from '../client';

const MAX_VARIABLE_NUMBER = 32766;
const BATCH_SIZE = Math.floor(MAX_VARIABLE_NUMBER / 10);

/**
 * Playback stats are optional: a history restored from the OPFS cache written
 * before they were captured has counts but no timestamps.
 */
export async function upsertSpotifyHistory(
  trx: Transaction<DB>,
  history: ArtistTrackPlays,
  stats?: ArtistTrackPlaybackStats,
) {
  // First, delete all existing history
  await trx.deleteFrom('spotify_history').execute();

  // Convert the ArtistTrackPlays Map to rows
  const rows: Array<{
    artist: string;
    artist_normalized: string;
    name: string;
    name_normalized: string;
    play_count: number;
    first_played_at: string | null;
    last_played_at: string | null;
    total_ms_played: number;
    skip_count: number;
  }> = [];

  for (const [artist, tracksMap] of history.entries()) {
    for (const [trackName, playCount] of tracksMap.entries()) {
      const trackStats = stats?.get(artist)?.get(trackName);
      rows.push({
        artist,
        artist_normalized: normalizeStrForMatching(artist),
        name: trackName,
        name_normalized: normalizeStrForMatching(trackName),
        play_count: playCount,
        first_played_at: trackStats?.firstPlayedAt ?? null,
        last_played_at: trackStats?.lastPlayedAt ?? null,
        total_ms_played: trackStats?.totalMsPlayed ?? 0,
        skip_count: trackStats?.skipCount ?? 0,
      });
    }
  }

  // Insert rows in batches
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    await trx.insertInto('spotify_history').values(batch).execute();
  }
}

export async function hasSpotifyHistory() {
  const db = await getLocalDb();
  const result = await db
    .selectFrom('spotify_history')
    .select(db.fn.countAll().as('count'))
    .executeTakeFirst();
  return result?.count ?? 0 > 0;
}
