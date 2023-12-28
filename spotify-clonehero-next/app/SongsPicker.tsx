'use client';

import {useCallback, useReducer} from 'react';
import SongsTable from './SongsTable';

import {ChartInfo, ChartResponseEncore, selectChart} from './chartSelection';
import {SongAccumulator} from '@/lib/local-songs-folder/scanLocalCharts';
import getChorusChartDb, {findMatchingCharts} from '@/lib/chorusChartDb';
import {scanForInstalledCharts} from '@/lib/local-songs-folder';
import Button from '@/components/Button';

export type RecommendedChart =
  | {
      type: 'best-chart-installed';
    }
  | {
      type: 'better-chart-found';
      betterChart: ChartResponseEncore;
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
    const before = Date.now();
    songsDispatch({
      type: 'reset',
    });
    // Start this early, await it later;
    const chorusChartsPromise = getChorusChartDb();

    let songs: SongAccumulator[] = [];

    try {
      const scanResult = await scanForInstalledCharts(() => {
        songsDispatch({
          type: 'increment-counter',
        });
      });
      songs = scanResult.installedCharts;
    } catch (e) {
      console.log('User canceled picker', e);
      return;
    }

    const chorusCharts = await chorusChartsPromise;

    const songsWithRecommendation: SongWithRecommendation[] = songs.map(
      song => {
        let recommendation: RecommendedChart;

        const matchingCharts = findMatchingCharts(
          song.artist,
          song.song,
          chorusCharts,
        );

        if (matchingCharts.length == 0) {
          recommendation = {
            type: 'best-chart-installed',
          };
        } else {
          const currentSong = {
            ...song.data,
            get file() {
              return song.file;
            },
            modifiedTime: song.modifiedTime,
          };

          const possibleCharts: (typeof currentSong | ChartInfo)[] = [
            currentSong,
          ].concat(matchingCharts);

          const {chart: recommendedChart, reasons} =
            selectChart(possibleCharts);

          if (recommendedChart == currentSong) {
            recommendation = {
              type: 'best-chart-installed',
            };
          } else if (Array.isArray(reasons)) {
            recommendation = {
              type: 'better-chart-found',
              betterChart: recommendedChart as unknown as ChartResponseEncore,
              reasons: reasons,
            };
          } else {
            throw new Error('Unexpected chart comparison');
          }
        }

        return {
          ...song,
          recommendedChart: recommendation,
        };
      },
    );

    songsDispatch({
      type: 'set-songs',
      songs: songsWithRecommendation,
    });

    const after = Date.now();
    console.log('Took', (after - before) / 1000, 'ss');
  }, [songsDispatch]);

  return (
    <>
      <p className="mb-4 text-center">
        This tool is in-progress.
        <br />
        The goal is to be a browser based chart library manager, <br />
        enabling you to easily update charts with new versions
      </p>

      <button
        disabled={songsState.songs == null && songsState.songsCounted > 0}
        className="bg-blue-500 text-white px-4 py-2 rounded-md transition-all ease-in-out duration-300 hover:bg-blue-600 dark:bg-blue-400 dark:hover:bg-blue-500"
        onClick={handler}>
        {songsState.songs == null && songsState.songsCounted == 0
          ? 'Select Clone Hero Songs Folder'
          : 'Rescan'}
      </button>
      {songsState.songs == null && (
        <h1>{songsState.songsCounted} songs scanned</h1>
      )}
      {songsState.songs && <SongsTable songs={songsState.songs} />}
    </>
  );
}
