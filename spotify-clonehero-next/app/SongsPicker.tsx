'use client';

import {useCallback, useState, useMemo, useReducer} from 'react';
import ini from 'ini';
import SongsTable from './SongsTable';

import searchForChart from './searchForChart';
import {ChartResponse} from './chartSelection';

export type RecommendedChart =
  | {
      type: 'not-checked';
    }
  | {
      type: 'searching';
    }
  | {
      type: 'best-chart-installed';
    }
  | {
      type: 'better-chart-found';
      betterChart: ChartResponse;
    };

export type SongAccumulator = {
  artist: string;
  song: string;
  lastModified: number;
  charter: string;
  data: {
    artist: string;
    name: string;
    charter: string;
  };
  recommendedChart: RecommendedChart;
};

async function processSongDirectory(
  directoryName: string,
  directoryHandle: FileSystemDirectoryHandle,
  accumulator: SongAccumulator[],
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
      recommendedChart: {
        type: 'not-checked',
      },
    });
    incrementCounter();
  }
}

type SongState = {
  songs: SongAccumulator[] | null;
  songsCounted: number;
};

type SongStateActions =
  | {
      type: 'reset';
    }
  | {
      type: 'increment-counter';
    }
  | {
      type: 'set-songs';
      songs: SongAccumulator[];
    }
  | {
      type: 'set-recommendation';
      song: SongAccumulator;
      recommendation: RecommendedChart;
    };

function songsReducer(state: SongState, action: SongStateActions): SongState {
  switch (action.type) {
    case 'reset':
      return {songs: null, songsCounted: 0};
    case 'increment-counter':
      return {...state, songsCounted: state.songsCounted + 1};
    case 'set-songs':
      return {...state, songs: action.songs};
    case 'set-recommendation':
      if (state.songs == null) {
        throw new Error('Cannot set a recommendation before songs are scanned');
      }

      return {
        ...state,
        songs: state.songs.toSpliced(state.songs.indexOf(action.song), 1, {
          ...action.song,
          recommendedChart: action.recommendation,
        }),
      };
    // return {...state};
    default:
      throw new Error('unrecognized action');
  }
}

export default function SongsPicker() {
  const [songsState, songsDispatch] = useReducer(songsReducer, {
    songs: null,
    songsCounted: 0,
  });

  const [chartUpdates, setChartUpdate] = useState<RecommendedChart[]>([]);

  const handler = useCallback(async () => {
    songsDispatch({
      type: 'reset',
    });
    const directoryHandle = await window.showDirectoryPicker();
    const songs: SongAccumulator[] = [];

    await processSongDirectory('Songs', directoryHandle, songs, () => {
      songsDispatch({
        type: 'increment-counter',
      });
    });

    songsDispatch({
      type: 'set-songs',
      songs,
    });
  }, [songsDispatch]);

  const checkForUpdates = useCallback(async () => {
    if (songsState.songs == null) {
      return;
    }

    for await (const song of songsState.songs) {
      const recommendedChart = await searchForChart(song.artist, song.song);

      debugger;

      songsDispatch({
        type: 'set-recommendation',
        song,
        recommendation: {
          type: 'best-chart-installed',
        },
      });
    }
  }, [songsState.songs]);

  return (
    <>
      <button onClick={() => handler()}>Scan Clone Hero Songs Library</button>
      <h1>{songsState.songsCounted} songs scanned</h1>
      {songsState.songs && (
        <button onClick={() => checkForUpdates()}>
          Check Chorus for Updated Charts
        </button>
      )}
      {songsState.songs && <SongsTable songs={songsState.songs} />}
    </>
  );
}
