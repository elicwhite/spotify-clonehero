'use client';

import {useCallback, useReducer} from 'react';
import SongsTable from './SongsTable';

import {SongAccumulator} from '@/lib/local-songs-folder/scanLocalCharts';
import {
  useChorusChartDb,
  findMatchingCharts,
  findMatchingChartsExact,
} from '@/lib/chorusChartDb';
import {scanForInstalledCharts} from '@/lib/local-songs-folder';
import {Button} from '@/components/ui/button';
import {sendGAEvent} from '@next/third-parties/google';
import {
  ChartInfo,
  ChartResponseEncore,
  RankingGroups,
  selectChart,
} from '@/lib/chartSelection';
import SupportedBrowserWarning from './SupportedBrowserWarning';
import {Searcher} from 'fast-fuzzy';

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

/* TODO:
- Show progress indicator while downloading db from Enchor
- Make sure songs are replaced to the original directory
*/
export default function CompareChartsToLocal({
  rankingGroups,
  exact,
}: {
  rankingGroups: RankingGroups;
  exact: boolean;
}) {
  const [songsState, songsDispatch] = useReducer(songsReducer, {
    songs: null,
    songsCounted: 0,
    chorusCharts: null,
  });

  const [chorusChartProgress, fetchChorusCharts] = useChorusChartDb();

  const handler = useCallback(async () => {
    const before = Date.now();
    songsDispatch({
      type: 'reset',
    });

    sendGAEvent({
      event: 'scan_for_updates',
    });

    // Start this early, await it later;

    const abortController = new AbortController();
    const chorusChartsPromise = fetchChorusCharts(abortController);

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

    const searcher = new Searcher(chorusCharts, {
      keySelector: chart => chart.artist,
      threshold: 1,
      useDamerau: false,
      useSellers: false,
    });

    const songsWithRecommendation: SongWithRecommendation[] = songs.map(
      song => {
        let recommendation: RecommendedChart;

        const matchingCharts = exact
          ? findMatchingChartsExact(song.artist, song.song, chorusCharts)
          : findMatchingCharts(song.artist, song.song, searcher);

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

          const {chart: recommendedChart, reasons} = selectChart(
            possibleCharts,
            rankingGroups,
          );

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
  }, [exact, rankingGroups]);

  return (
    <>
      <SupportedBrowserWarning>
        <Button
          disabled={songsState.songs == null && songsState.songsCounted > 0}
          onClick={handler}>
          {songsState.songs == null && songsState.songsCounted == 0
            ? 'Select Clone Hero Songs Folder'
            : 'Rescan'}
        </Button>
        {songsState.songs == null && (
          <h1>{songsState.songsCounted} songs scanned</h1>
        )}
        {songsState.songs && <SongsTable songs={songsState.songs} />}
      </SupportedBrowserWarning>
    </>
  );
}
