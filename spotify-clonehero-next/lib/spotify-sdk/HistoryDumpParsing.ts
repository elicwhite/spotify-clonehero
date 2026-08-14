import {readJsonFile} from '@/lib/fileSystemHelpers';
import {upsertSpotifyHistory} from '@/lib/local-db/spotify-history';
import {getLocalDb} from '@/lib/local-db/client';

const LEGACY_HISTORY_DUMP_FILE = 'spotifyHistoryDump.json';

export type ArtistTrackPlays = Map<string, Map<string, number>>;

/** Playback detail that sits alongside the play counts. */
export type TrackPlaybackStats = {
  firstPlayedAt: string | null;
  lastPlayedAt: string | null;
  totalMsPlayed: number;
  skipCount: number;
};
export type ArtistTrackPlaybackStats = Map<
  string,
  Map<string, TrackPlaybackStats>
>;

export type SpotifyHistoryImportResult =
  | {status: 'imported'; plays: ArtistTrackPlays}
  | {status: 'invalid-selection'; message: string};

class SpotifyHistorySelectionError extends Error {}

/**
 * Remove the OPFS copy of an imported history that this module used to keep
 * beside the `spotify_history` table. The table is the only store now, so the
 * file is a stale second copy of the user's listening history and is deleted
 * wherever it is still found.
 */
export async function discardLegacyHistoryDumpCache() {
  try {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(LEGACY_HISTORY_DUMP_FILE);
  } catch {
    // Not having the file is the ordinary case, not a failure.
  }
}

export async function tryProcessSpotifyDump(
  spotifyDataHandle: FileSystemDirectoryHandle,
): Promise<SpotifyHistoryImportResult> {
  try {
    const results = await getAllSpotifyPlays(spotifyDataHandle);
    const {plays: artistTrackPlays, stats} =
      createPlaysMapOfSpotifyData(results);

    const db = await getLocalDb();
    await db.transaction().execute(async trx => {
      await upsertSpotifyHistory(trx, artistTrackPlays, stats);
    });
    return {status: 'imported', plays: artistTrackPlays};
  } catch (error) {
    if (error instanceof SpotifyHistorySelectionError) {
      return {status: 'invalid-selection', message: error.message};
    }
    throw error;
  }
}

async function getAllSpotifyPlays(handle: FileSystemDirectoryHandle) {
  let hasPdf = false;
  const results = [];
  for await (const entry of handle.values()) {
    if (entry.kind !== 'file') {
      throw new SpotifyHistorySelectionError(
        `Spotify History: Did not expect to see subfolders. Found folder ${entry.name}. Are you sure you selected your Spotify Extended Streaming History?`,
      );
    }

    if (entry.name.endsWith('.pdf') && entry.name.startsWith('ReadMeFirst')) {
      hasPdf = true;
      continue;
    }

    if (!entry.name.endsWith('.json')) {
      continue;
      //   console.error(
      //     `Did not expect to see file ${entry.name} in a Spotify history folder`,
      //   );
      //   throw new Error('Select the folder with your Spotify streaming history.');
    }

    const json = await readJsonFile(entry);
    if (Array.isArray(json)) {
      results.push(...json);
    } else {
      console.error(
        `Expected ${entry.name} to contain an array. Received ${typeof json}`,
      );
      throw new SpotifyHistorySelectionError(
        `Spotify History: Unexpected file contents in ${entry.name}. Are you sure you selected your Spotify Extended Streaming History?`,
      );
    }
  }

  if (!hasPdf) {
    throw new SpotifyHistorySelectionError(
      `Spotify History: Expected to find a ReadMeFirst.pdf file. Are you sure you selected your Spotify Extended Streaming History?`,
    );
  }

  return results;
}

type SpotifyHistoryEntry = {
  reason_end: 'fwdbtn' | 'trackdone' | 'backbtn' | 'clickrow'; // There are other options, but it doesn't matter
  master_metadata_album_artist_name: string;
  master_metadata_track_name: string;
  ts?: string;
  ms_played?: number;
};

function createPlaysMapOfSpotifyData(history: SpotifyHistoryEntry[]) {
  const artistsTracks: ArtistTrackPlays = new Map<
    string,
    Map<string, number>
  >();
  const stats: ArtistTrackPlaybackStats = new Map();

  for (const song of history) {
    const artist = song.master_metadata_album_artist_name;
    if (artist == null) {
      // For some reason these don't have any information about what played
      continue;
    }
    const track = song.master_metadata_track_name;
    const finished = song.reason_end === 'trackdone';

    // A play count still means a finished play. The surrounding detail covers
    // every entry, including the skips a play count cannot see.
    recordPlaybackStats(stats, artist, track, song);

    if (!finished) {
      continue;
    }

    let tracksPlays = artistsTracks.get(artist);
    if (tracksPlays == null) {
      tracksPlays = new Map();
      artistsTracks.set(artist, tracksPlays);
    }
    tracksPlays.set(track, (tracksPlays.get(track) ?? 0) + 1);
  }

  return {plays: artistsTracks, stats};
}

function recordPlaybackStats(
  stats: ArtistTrackPlaybackStats,
  artist: string,
  track: string,
  song: SpotifyHistoryEntry,
) {
  let trackStats = stats.get(artist);
  if (trackStats == null) {
    trackStats = new Map();
    stats.set(artist, trackStats);
  }
  const existing = trackStats.get(track) ?? {
    firstPlayedAt: null,
    lastPlayedAt: null,
    totalMsPlayed: 0,
    skipCount: 0,
  };

  const timestamp = typeof song.ts === 'string' ? song.ts : null;
  if (timestamp != null) {
    if (existing.firstPlayedAt == null || timestamp < existing.firstPlayedAt) {
      existing.firstPlayedAt = timestamp;
    }
    if (existing.lastPlayedAt == null || timestamp > existing.lastPlayedAt) {
      existing.lastPlayedAt = timestamp;
    }
  }
  if (typeof song.ms_played === 'number' && Number.isFinite(song.ms_played)) {
    existing.totalMsPlayed += Math.max(0, Math.round(song.ms_played));
  }
  if (song.reason_end === 'fwdbtn') {
    existing.skipCount += 1;
  }

  trackStats.set(track, existing);
}
