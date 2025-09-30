import {readJsonFile, writeFile} from '@/lib/fileSystemHelpers';
import {
  hasSpotifyHistory,
  upsertSpotifyHistory,
} from '@/lib/local-db/spotify-history';
import {getLocalDb} from '@/lib/local-db/client';

export type ArtistTrackPlays = Map<string, Map<string, number>>;

export async function getSpotifyDumpArtistTrackPlays() {
  const root = await navigator.storage.getDirectory();
  let installedChartsCacheHandle: FileSystemFileHandle;
  try {
    installedChartsCacheHandle = await root.getFileHandle(
      'spotifyHistoryDump.json',
    );
  } catch {
    // Cache dump doesn't exist, return null
    return null;
  }

  const cachedInstalledCharts = await readJsonFile(installedChartsCacheHandle);
  const artistTrackPlays = deserialize(cachedInstalledCharts);

  if (artistTrackPlays != null) {
    const hasHistoryInDb = await hasSpotifyHistory();

    if (!hasHistoryInDb) {
      const db = await getLocalDb();
      await db.transaction().execute(async trx => {
        await upsertSpotifyHistory(trx, artistTrackPlays);
      });
    }
  }

  return artistTrackPlays;
}

export async function processSpotifyDump(
  spotifyDataHandle: FileSystemDirectoryHandle,
) {
  const results = await getAllSpotifyPlays(spotifyDataHandle);
  const artistTrackPlays = createPlaysMapOfSpotifyData(results);

  await cacheArtistTrackPlays(artistTrackPlays);
  return artistTrackPlays;
}

async function cacheArtistTrackPlays(artistTrackPlays: ArtistTrackPlays) {
  const serialized = serialize(artistTrackPlays);
  const root = await navigator.storage.getDirectory();
  const installedChartsCacheHandle = await root.getFileHandle(
    'spotifyHistoryDump.json',
    {
      create: true,
    },
  );

  await Promise.all([
    writeFile(installedChartsCacheHandle, serialized),
    getLocalDb().then(db => {
      return db.transaction().execute(async trx => {
        await upsertSpotifyHistory(trx, artistTrackPlays);
      });
    }),
  ]);
}

function deserialize(cachedInstalledCharts: any): ArtistTrackPlays | null {
  if (cachedInstalledCharts == null) {
    return null;
  }

  if (!Array.isArray(cachedInstalledCharts)) {
    throw new Error('Expected cached Spotify dump to be an array');
  }

  return new Map(
    cachedInstalledCharts.map(([artist, tracks]) => {
      return [artist, new Map(tracks)];
    }),
  );
}

function serialize(artistTrackPlays: ArtistTrackPlays) {
  return JSON.stringify(
    Array.from(artistTrackPlays.entries()).map(([artist, tracks]) => {
      return [artist, Array.from(tracks.entries())];
    }),
  );
}

async function getAllSpotifyPlays(handle: FileSystemDirectoryHandle) {
  let hasPdf = false;
  const results = [];
  for await (const entry of handle.values()) {
    if (entry.kind !== 'file') {
      throw new Error(
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
      throw new Error(
        `Spotify History: Unexpected file contents in ${entry.name}. Are you sure you selected your Spotify Extended Streaming History?`,
      );
    }
  }

  if (!hasPdf) {
    throw new Error(
      `Spotify History: Expected to find a ReadMeFirst.pdf file. Are you sure you selected your Spotify Extended Streaming History?`,
    );
  }

  return results;
}

type SpotifyHistoryEntry = {
  reason_end: 'fwdbtn' | 'trackdone' | 'backbtn' | 'clickrow'; // There are other options, but it doesn't matter
  master_metadata_album_artist_name: string;
  master_metadata_track_name: string;
};

function createPlaysMapOfSpotifyData(history: SpotifyHistoryEntry[]) {
  const artistsTracks: ArtistTrackPlays = new Map<
    string,
    Map<string, number>
  >();

  for (const song of history) {
    if (song.reason_end != 'trackdone') {
      continue;
    }

    const artist = song.master_metadata_album_artist_name;
    if (artist == null) {
      // For some reason these don't have any information about what played
      continue;
    }
    const track = song.master_metadata_track_name;

    let tracksPlays = artistsTracks.get(artist);
    if (tracksPlays == null) {
      tracksPlays = new Map();
      artistsTracks.set(artist, tracksPlays);
    }
    tracksPlays.set(track, (tracksPlays.get(track) ?? 0) + 1);
  }

  return artistsTracks;
}
