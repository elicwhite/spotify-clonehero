'use client';

import {useCallback, useState} from 'react';

type SongAccumulator = Array<{
  artist: string;
  song: string;
  lastModified: number;
}>;

async function processSongDirectory(
  directoryName: string,
  directoryHandle: FileSystemDirectoryHandle,
  accumulator: SongAccumulator,
  incrementCounter: Function,
) {
  let newestDate = 0;
  let hasSongini = false;

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
      if (subName == 'song.ini') {
        hasSongini = true;
      }

      const file = await subHandle.getFile();
      if (file.lastModified > newestDate) {
        newestDate = file.lastModified;
      }
    }
  }

  if (hasSongini) {
    const [artist, song] = directoryName.split(' - ');
    accumulator.push({
      artist,
      song,
      lastModified: newestDate,
    });
    incrementCounter();
  }
}

export default function SongsPicker() {
  const [counter, setCounter] = useState(0);

  const handler = useCallback(async () => {
    setCounter(0);
    const directoryHandle = await window.showDirectoryPicker();
    const songs: SongAccumulator = [];

    await processSongDirectory('Songs', directoryHandle, songs, () =>
      setCounter(n => n + 1),
    );

    console.log(songs);
  }, [setCounter]);

  return (
    <>
      <button onClick={() => handler()}>Click me</button>
      <h1>{counter}</h1>
    </>
  );
}
