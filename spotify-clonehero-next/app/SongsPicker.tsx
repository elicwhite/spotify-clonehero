'use client';

import {useCallback, useState, useMemo} from 'react';
import ini from 'ini';
import SongsTable from './SongsTable';

export type SongAccumulator = Array<{
  artist: string;
  song: string;
  lastModified: number;
  charter: string;
  data: Object;
}>;

async function processSongDirectory(
  directoryName: string,
  directoryHandle: FileSystemDirectoryHandle,
  accumulator: SongAccumulator,
  incrementCounter: Function,
) {
  let newestDate = 0;
  let songIniData = null;

  for await (const [subName, subHandle] of directoryHandle.entries()) {
    if (subHandle.kind == 'directory') {
      await processSongDirectory(
        subName,
        subHandle,
        accumulator,
        incrementCounter,
      );
    }

    if (subHandle.kind == 'file') {
      const file = await subHandle.getFile();

      if (subName == 'song.ini') {
        const text = await file.text();
        const values = ini.parse(text);
        songIniData = values?.song;
      }

      if (file.lastModified > newestDate) {
        newestDate = file.lastModified;
      }
    }
  }

  if (songIniData) {
    const [artist, song] = directoryName.split(' - ');
    accumulator.push({
      artist: songIniData?.artist,
      song: songIniData?.name,
      lastModified: newestDate,
      charter: songIniData?.charter,
      data: songIniData,
    });
    incrementCounter();
  }
}

export default function SongsPicker() {
  const [counter, setCounter] = useState(0);
  const [songs, setSongs] = useState(null);

  const handler = useCallback(async () => {
    setSongs(null);
    setCounter(0);
    const directoryHandle = await window.showDirectoryPicker();
    const songs: SongAccumulator = [];

    await processSongDirectory('Songs', directoryHandle, songs, () =>
      setCounter(n => n + 1),
    );

    setSongs(songs);
    console.log(songs);
  }, [setCounter]);

  return (
    <>
      <button onClick={() => handler()}>Scan Clone Hero Songs Library</button>
      <h1>{counter} songs scanned</h1>
      {songs && <SongsTable songs={songs} />}
    </>
  );
}
