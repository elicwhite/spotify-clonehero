'use client';

import {useCallback} from 'react';

export default function Page() {
  const handler = useCallback(async () => {
    let handle;

    try {
      handle = await window.showDirectoryPicker({
        id: 'spotify-dump',
      });
    } catch {
      console.log('User canceled picker');
      return;
    }

    const entries = await handle.values();

    let hasPdf = false;
    const results = [];
    for await (const entry of entries) {
      if (entry.kind !== 'file') {
        throw new Error(
          'Select the folder with your Spotify streaming history.',
        );
      }

      if (entry.name.endsWith('.pdf') && entry.name.startsWith('ReadMeFirst')) {
        hasPdf = true;
        continue;
      }

      if (!entry.name.endsWith('.json')) {
        throw new Error(
          'Select the folder with your Spotify streaming history.',
        );
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
    const artistTrackPlays = createPlaysMapOfSpotifyData(results);

    console.log(artistTrackPlays);
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

type SpotifyHistoryEntry = {
  reason_end: 'fwdbtn' | 'trackdone' | 'backbtn' | 'clickrow'; // There are other options, but it doesn't matter
  master_metadata_album_artist_name: string;
  master_metadata_track_name: string;
};

function createPlaysMapOfSpotifyData(history: SpotifyHistoryEntry[]) {
  const artistsTracks = new Map();

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
