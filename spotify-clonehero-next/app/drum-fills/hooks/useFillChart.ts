'use client';

import {useEffect, useState} from 'react';
import {parseChartAndIni} from '@eliwhite/scan-chart';
import {getCachedSongsDirectoryHandle} from '@/lib/local-songs-folder';
import {getFillById, type FillWithSrs} from '@/lib/drum-fills/db';
import {locateAndLoadSong} from '@/lib/drum-fills/practice/songLocator';
import {findAudioFiles} from '@/lib/preview/chorus-chart-processing';
import type {Files, ParsedChart} from '@/lib/preview/chorus-chart-processing';
import {getExpertDrumsTrack} from '@/lib/drum-fills/detection/detectFills';
import {
  buildFillPracticeData,
  buildGroovePattern,
  type FillPracticeData,
} from '@/lib/drum-fills/practice/fillNotes';
import type {ParsedTrackData} from '@/lib/chart-edit/types';
import type {BackingPattern} from '@/lib/drum-fills/practice/backingTrack';

export type FillChartStatus =
  | 'loading'
  | 'ready'
  | 'no-handle'
  | 'not-found'
  | 'error';

export interface FillChartState {
  status: FillChartStatus;
  error: string | null;
  fill: FillWithSrs | null;
  chart: ParsedChart | null;
  track: ParsedTrackData | null;
  audioFiles: Files | null;
  practiceData: FillPracticeData | null;
  groovePattern: BackingPattern | null;
}

const INITIAL: FillChartState = {
  status: 'loading',
  error: null,
  fill: null,
  chart: null,
  track: null,
  audioFiles: null,
  practiceData: null,
  groovePattern: null,
};

/**
 * Load everything the practice screen needs for one fill: the DB row, the parsed
 * chart (re-read from the user's library via the cached directory handle), the
 * song's audio stems, and the derived expected-notes + groove pattern.
 *
 * Heavy work (library walk, chart parse) runs inside the effect, off the render
 * path. State is pushed once when ready.
 */
export function useFillChart(fillId: string): FillChartState {
  const [state, setState] = useState<FillChartState>(INITIAL);

  useEffect(() => {
    let cancelled = false;
    setState(INITIAL);

    (async () => {
      try {
        const fill = await getFillById(fillId);
        if (cancelled) return;
        if (!fill) {
          setState(s => ({...s, status: 'not-found'}));
          return;
        }

        const handle = await getCachedSongsDirectoryHandle();
        if (cancelled) return;
        if (!handle) {
          setState(s => ({...s, status: 'no-handle', fill}));
          return;
        }

        const located = await locateAndLoadSong(handle, {
          libraryPath: fill.libraryPath,
          song: fill.song,
          artist: fill.artist,
          charter: fill.charter,
        });
        if (cancelled) return;
        if (!located) {
          setState(s => ({...s, status: 'not-found', fill}));
          return;
        }

        const chartFiles = located.files.filter(f =>
          ['notes.chart', 'notes.mid', 'song.ini'].includes(
            f.fileName.toLowerCase(),
          ),
        );
        const parsed = parseChartAndIni(chartFiles).parsedChart;
        if (cancelled) return;
        if (!parsed) {
          setState(s => ({
            ...s,
            status: 'error',
            error: 'Could not parse chart.',
            fill,
          }));
          return;
        }

        const track = getExpertDrumsTrack(parsed as never);
        if (!track) {
          setState(s => ({
            ...s,
            status: 'error',
            error: 'Chart has no Expert drums track.',
            fill,
          }));
          return;
        }

        const fillSpan = {
          startTick: fill.startTick,
          endTick: fill.endTick,
          grooveStartTick: fill.grooveStartTick,
          grooveEndTick: fill.grooveEndTick,
          tempoBpm: fill.tempoBpm,
        };
        const practiceData = buildFillPracticeData(
          parsed as never,
          track as ParsedTrackData,
          fillSpan,
        );
        const groovePattern = buildGroovePattern(
          parsed as never,
          track as ParsedTrackData,
          fillSpan,
          {
            grooveBars: practiceData.grooveBars,
            fillBars: practiceData.fillBars,
            beatsPerBar: practiceData.beatsPerBar,
          },
        );

        const audioFiles = findAudioFiles(located.files);

        if (cancelled) return;
        setState({
          status: 'ready',
          error: null,
          fill,
          chart: parsed as ParsedChart,
          track: track as ParsedTrackData,
          audioFiles,
          practiceData,
          groovePattern,
        });
      } catch (err) {
        if (cancelled) return;
        setState(s => ({
          ...s,
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
        }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fillId]);

  return state;
}
