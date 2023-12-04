'use client';

import scanLocalCharts, {SongAccumulator} from '@/lib/scanLocalCharts';
import {levenshteinEditDistance} from 'levenshtein-edit-distance';
import {useCallback} from 'react';

export default function Page() {
  const handler = useCallback(async () => {
    let spotifyDataHandle;
    let songsDirectoryHandle;

    try {
      spotifyDataHandle = await window.showDirectoryPicker({
        id: 'spotify-dump',
      });
    } catch {
      console.log('User canceled picker');
      return;
    }

    alert('Now select your Clone Hero songs directory');

    try {
      songsDirectoryHandle = await window.showDirectoryPicker({
        id: 'clone-hero-songs',
      });
    } catch {
      console.log('User canceled picker');
      return;
    }

    const results = await getAllSpotifyPlays(spotifyDataHandle);
    const artistTrackPlays = createPlaysMapOfSpotifyData(results);

    const installedSongs: SongAccumulator[] = [];
    await scanLocalCharts(songsDirectoryHandle, installedSongs, () => {});
    const isInstalled = await createIsInstalledFilter(installedSongs);
    const notInstalledSongs = filterInstalledSongs(
      artistTrackPlays,
      isInstalled,
    );

    console.log(notInstalledSongs);
  }, []);

  return (
    <main className="flex max-h-screen flex-col items-center justify-between p-24">
      <button
        className="bg-blue-500 text-white px-4 py-2 rounded-md transition-all ease-in-out duration-300 hover:bg-blue-600 dark:bg-blue-400 dark:hover:bg-blue-500"
        onClick={handler}>
        Scan Spotify Dump
      </button>
    </main>
  );
}

function filterInstalledSongs(
  spotifySongs: Map<string, Map<string, number>>,
  isInstalled: (artist: string, song: string) => boolean,
): [artist: string, song: string, playCount: number][] {
  const filtered: Map<string, Map<string, number>> = new Map();

  for (const [artist, songs] of spotifySongs.entries()) {
    for (const [song, playCount] of songs.entries()) {
      if (!isInstalled(artist, song)) {
        if (filtered.get(artist) == null) {
          filtered.set(artist, new Map());
        }

        filtered.get(artist)!.set(song, playCount);
      }
    }
  }

  const artistsSortedByListens = [...filtered.entries()]
    .toSorted((a, b) => {
      const aTotal = [...a[1].values()].reduce((a, b) => a + b, 0);
      const bTotal = [...b[1].values()].reduce((a, b) => a + b, 0);

      return bTotal - aTotal;
    })
    .map(([artist]) => artist);

  console.log('artists', artistsSortedByListens.length);

  const results: [artist: string, song: string, playCount: number][] = [];

  for (const [artist, songs] of spotifySongs.entries()) {
    for (const [song, playCount] of songs.entries()) {
      if (!isInstalled(artist, song)) {
        results.push([artist, song, playCount]);
      }
    }
  }

  results.sort((a, b) => {
    return b[2] - a[2];
  });

  return results;
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

    const file = await entry.getFile();
    const text = await file.text();
    const json = JSON.parse(text);

    json;
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
  const artistsTracks = new Map<string, Map<string, number>>();

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

async function createIsInstalledFilter(installedSongs: SongAccumulator[]) {
  const installedArtistsSongs = new Map<string, string[]>();

  for (const installedSong of installedSongs) {
    const {artist, song} = installedSong;

    if (installedArtistsSongs.get(artist) == null) {
      installedArtistsSongs.set(artist, []);
    }

    installedArtistsSongs.get(artist)!.push(song);
  }

  return function isInstalled(artist: string, song: string) {
    let likelyArtist;

    for (const installedArtist of installedArtistsSongs.keys()) {
      const artistDistance = levenshteinEditDistance(installedArtist, artist);
      if (artistDistance <= 1) {
        likelyArtist = installedArtist;
      }
    }

    if (likelyArtist == null) {
      return false;
    }

    const artistSongs = installedArtistsSongs.get(likelyArtist);

    if (artistSongs == null) {
      return false;
    }

    let likelySong;

    for (const installedSong of artistSongs) {
      const songDistance = levenshteinEditDistance(installedSong, song);
      if (songDistance <= 1) {
        likelySong = installedSong;
      }
    }

    if (likelySong != null) {
      return true;
    }

    // Some installed songs have (2x double bass) suffixes.
    return artistSongs.some(artistSong => artistSong.includes(song));
  };
}
