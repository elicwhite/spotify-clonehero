'use client';

import {useCallback, useState, useReducer, useRef, useEffect} from 'react';
import SongsTable from './SongsTable';

import {
  ChartResponse,
  ChartResponseEncore,
  selectChart,
} from './chartSelection';
import {compareToCurrentChart} from './compareToCurrentChart';
import scanLocalCharts, {
  SongAccumulator,
} from '@/lib/local-songs-folder/scanLocalCharts';
import getChorusChartDb, {findMatchingCharts} from '@/lib/chorusChartDb';
import {scanForInstalledCharts} from '@/lib/local-songs-folder';

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
      reasons: string[];
    };

export type SongWithRecommendation = SongAccumulator & {
  recommendedChart: RecommendedChart;
};

type SongState = {
  songs: SongWithRecommendation[] | null;
  songsCounted: number;
  songsCheckedForUpdates: number;
  chorusCharts: ChartResponseEncore[] | null;
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
    }
  | {
      type: 'set-chorus-songs';
      charts: ChartResponseEncore[];
    };

function songsReducer(state: SongState, action: SongStateActions): SongState {
  switch (action.type) {
    case 'reset':
      return {
        songs: null,
        songsCounted: 0,
        songsCheckedForUpdates: 0,
        chorusCharts: state.chorusCharts,
      };
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
    case 'set-chorus-songs':
      return {...state, chorusCharts: action.charts};
    default:
      throw new Error('unrecognized action');
  }
}

export default function SongsPicker() {
  const [songsState, songsDispatch] = useReducer(songsReducer, {
    songs: null,
    songsCounted: 0,
    songsCheckedForUpdates: 0,
    chorusCharts: null,
  });

  const handler = useCallback(async () => {
    songsDispatch({
      type: 'reset',
    });
    const chorusChartsPromise = getChorusChartDb();

    let songs: SongAccumulator[] = [];

    try {
      const scanResult = await scanForInstalledCharts(() => {
        songsDispatch({
          type: 'increment-counter',
        });
      });
      songs = scanResult.installedCharts;
    } catch {
      console.log('User canceled picker');
      return;
    }

    const chorusCharts = await chorusChartsPromise;

    songsDispatch({
      type: 'set-chorus-songs',
      charts: chorusCharts,
    });

    const songsWithRecommendation: SongWithRecommendation[] = songs.map(
      song => {
        return {
          ...song,
          recommendedChart: {
            type: 'not-checked',
          },
        };
      },
    );

    songsDispatch({
      type: 'set-songs',
      songs: songsWithRecommendation,
    });
  }, [songsDispatch]);

  const checkForUpdates = useCallback(async () => {
    if (songsState.songs == null || songsState.chorusCharts == null) {
      return;
    }

    const before = Date.now();
    for await (const song of songsState.songs) {
      // Yield to React so we can update the UI
      console.log('Processing song', song.song);
      // await Promise.resolve();
      let recommendation: RecommendedChart;

      const matchingCharts = findMatchingCharts(
        song.artist,
        song.song,
        songsState.chorusCharts,
      );

      const {chart: recommendedChart, reasons} = selectChart(
        matchingCharts.map(chart => ({
          ...chart,
          uploadedAt: chart.modifiedTime,
          lastModified: chart.modifiedTime,
          file: `https://files.enchor.us/${chart.md5}.sng`,
        })),
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
        } else if (Array.isArray(result)) {
          recommendation = {
            type: 'better-chart-found',
            betterChart: recommendedChart,
            reasons: result,
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
    }
    const after = Date.now();
    console.log('Took', (after - before) / 1000, 'ss');
  }, [songsState.chorusCharts, songsState.songs]);

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
        </>
      )}
      {songsState.songs && <SongsTable songs={songsState.songs} />}
    </>
  );
}
