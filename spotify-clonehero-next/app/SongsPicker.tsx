'use client';

import {useCallback, useState, useReducer, useRef, useEffect} from 'react';
import SongsTable from './SongsTable';

import {searchEncore as searchForChartEncore} from './searchForChart';
import {ChartResponse} from './chartSelection';
import {compareToCurrentChart} from './compareToCurrentChart';
import scanLocalCharts, {SongAccumulator} from '@/lib/scanLocalCharts';

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

export type SongWithRecommendation = SongAccumulator & {
  recommendedChart: RecommendedChart;
};

type SongState = {
  songs: SongWithRecommendation[] | null;
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
      songs: SongWithRecommendation[];
    }
  | {
      type: 'set-recommendation';
      song: SongWithRecommendation;
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
      directoryHandle = await window.showDirectoryPicker({
        id: 'clone-hero-songs',
      });
    } catch {
      console.log('User canceled picker');
      return;
    }
    const songs: SongAccumulator[] = [];

    await scanLocalCharts(directoryHandle, songs, () => {
      songsDispatch({
        type: 'increment-counter',
      });
    });

    const songsWithRecommendation: SongWithRecommendation[] = songs.map(
      song => ({
        ...song,
        recommendedChart: {
          type: 'not-checked',
        },
      }),
    );

    songsDispatch({
      type: 'set-songs',
      songs: songsWithRecommendation,
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
  }, [songsState.songs]);

  return (
    <>
      <p className="mb-4 text-center">
        This tool is in-progress.
        <br />
        The goal is to be a browser based chart library manager, <br />
        enabling you to easily update charts with new versions
      </p>

      <button
        className="bg-blue-500 text-white px-4 py-2 rounded-md transition-all ease-in-out duration-300 hover:bg-blue-600 dark:bg-blue-400 dark:hover:bg-blue-500"
        onClick={handler}>
        Scan Clone Hero Songs Library
      </button>
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
