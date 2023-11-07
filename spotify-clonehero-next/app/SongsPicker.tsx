'use client';

import {
  useCallback,
  useState,
  useMemo,
  useReducer,
  useRef,
  useEffect,
} from 'react';
import ini from 'ini';
import SongsTable from './SongsTable';

import searchForChart, {
  searchEncore as searchForChartEncore,
} from './searchForChart';
import {ChartResponse} from './chartSelection';
import {compareToCurrentChart} from './compareToCurrentChart';

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

export type SongIniData = {
  name: string;
  artist: string;
  charter: string;
  diff_drums: number;
};

export type SongAccumulator = {
  artist: string;
  song: string;
  lastModified: number;
  charter: string;
  data: SongIniData;
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
  songsCheckedForUpdates: number;
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
      return {songs: null, songsCounted: 0, songsCheckedForUpdates: 0};
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
        songsCheckedForUpdates: state.songsCheckedForUpdates + 1,
        songs: state.songs.toSpliced(state.songs.indexOf(action.song), 1, {
          ...action.song,
          recommendedChart: action.recommendation,
        }),
      };
    default:
      throw new Error('unrecognized action');
  }
}

export default function SongsPicker() {
  const [songsState, songsDispatch] = useReducer(songsReducer, {
    songs: null,
    songsCounted: 0,
    songsCheckedForUpdates: 0,
  });

  const [shouldAbortUpdateChecking, setShouldAbortUpdateChecking] =
    useState(false);
  const shouldAbortUpdateCheckingRef = useRef(false);

  useEffect(() => {
    shouldAbortUpdateCheckingRef.current = shouldAbortUpdateChecking;
  }, [shouldAbortUpdateChecking]);

  const handler = useCallback(async () => {
    setShouldAbortUpdateChecking(false);
    songsDispatch({
      type: 'reset',
    });
    let directoryHandle;

    try {
      directoryHandle = await window.showDirectoryPicker();
    } catch {
      console.log('User canceled picker');
      return;
    }
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
      let recommendation: RecommendedChart;

      const recommendedChart = await searchForChartEncore(
        song.artist,
        song.song,
      );

      if (recommendedChart == null) {
        recommendation = {
          type: 'best-chart-installed',
        };
      } else {
        const result = compareToCurrentChart(song, recommendedChart);

        if (result == 'current') {
          recommendation = {
            type: 'best-chart-installed',
          };
        } else if (result == 'new') {
          recommendation = {
            type: 'better-chart-found',
            betterChart: recommendedChart,
          };
        } else {
          throw new Error('Unexpected chart comparison');
        }
      }

      songsDispatch({
        type: 'set-recommendation',
        song,
        recommendation,
      });

      if (shouldAbortUpdateCheckingRef.current) {
        break;
      }
    }
  }, [songsState.songs, shouldAbortUpdateChecking]);

  return (
    <>
      <button onClick={() => handler()}>Scan Clone Hero Songs Library</button>
      <h1>{songsState.songsCounted} songs scanned</h1>
      {songsState.songs && (
        <>
          <button onClick={() => checkForUpdates()}>
            Check Chorus for Updated Charts
          </button>
          <h1>{songsState.songsCheckedForUpdates} songs checked for updates</h1>
          {songsState.songsCheckedForUpdates > 0 &&
            !shouldAbortUpdateChecking && (
              <button
                onClick={() => {
                  setShouldAbortUpdateChecking(true);
                }}>
                Stop checking for updates!
              </button>
            )}
        </>
      )}
      {songsState.songs && <SongsTable songs={songsState.songs} />}
    </>
  );
}
