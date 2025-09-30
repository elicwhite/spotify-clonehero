import {sql, type Transaction} from 'kysely';
import type {ArtistTrackPlays} from '@/lib/spotify-sdk/HistoryDumpParsing';
import {normalizeStrForMatching} from '../normalize';
import type {DB} from '../types';
import {getLocalDb} from '../client';

const MAX_VARIABLE_NUMBER = 32766;
const BATCH_SIZE = Math.floor(MAX_VARIABLE_NUMBER / 6);

export async function upsertSpotifyHistory(
  trx: Transaction<DB>,
  history: ArtistTrackPlays,
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
  }> = [];

  for (const [artist, tracksMap] of history.entries()) {
    for (const [trackName, playCount] of tracksMap.entries()) {
      rows.push({
        artist,
        artist_normalized: normalizeStrForMatching(artist),
        name: trackName,
        name_normalized: normalizeStrForMatching(trackName),
        play_count: playCount,
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
