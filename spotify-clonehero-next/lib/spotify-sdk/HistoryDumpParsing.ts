import {readJsonFile, writeFile} from '@/lib/fileSystemHelpers';

export type ArtistTrackPlays = Map<string, Map<string, number>>;

export async function getSpotifyDumpArtistTrackPlays() {
  const root = await navigator.storage.getDirectory();
  const installedChartsCacheHandle = await root.getFileHandle(
    'spotifyHistoryDump.json',
  );

  const cachedInstalledCharts = await readJsonFile(installedChartsCacheHandle);
  return deserialize(cachedInstalledCharts);
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
  await writeFile(installedChartsCacheHandle, serialized);
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
      throw new Error('Select the folder with your Spotify streaming history.');
    }

    if (entry.name.endsWith('.pdf') && entry.name.startsWith('ReadMeFirst')) {
      hasPdf = true;
      continue;
    }

    if (!entry.name.endsWith('.json')) {
      throw new Error('Select the folder with your Spotify streaming history.');
    }

    const json = await readJsonFile(entry);

    results.push(...json);
  }

  if (!hasPdf) {
    throw new Error('Select the folder with your Spotify streaming history.');
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
