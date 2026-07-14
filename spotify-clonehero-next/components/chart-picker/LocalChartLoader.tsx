'use client';

import {useCallback} from 'react';
import {toast} from 'sonner';
import ChartDropZone from '@/components/chart-picker/ChartDropZone';
import type {LoadedFiles} from '@/components/chart-picker/chart-file-readers';
import {readChart, type ChartDocument} from '@/lib/chart-edit';
import {
  findAudioFiles,
  type Files,
  type ParsedChart,
} from '@/lib/preview/chorus-chart-processing';
import {ChartResponseEncore} from '@/lib/chartSelection';

export interface LocalChart {
  metadata: ChartResponseEncore;
  chart: ParsedChart;
  chartDoc: ChartDocument;
  audioFiles: Files;
}

/**
 * Chart selector (folder / .zip / .sng) for playing a local chart in the
 * sheet-music viewer or the preview editor. Parses the chart client-side
 * and hands the same {metadata, chart, audioFiles} shape that the
 * Encore-backed pages feed to their viewers, plus the editable
 * `chartDoc` for consumers built on the chart-editor shell. Local charts
 * have no Encore identity, so `md5` is empty and save/practice
 * persistence is inert.
 */
export default function LocalChartLoader({
  onLoaded,
  id,
}: {
  onLoaded: (chart: LocalChart) => void;
  id: string;
}) {
  const handleLoaded = useCallback(
    (loaded: LoadedFiles) => {
      try {
        const chartDoc = readChart(loaded.files);
        const {parsedChart} = chartDoc;

        if (!parsedChart.trackData.some(t => t.instrument === 'drums')) {
          toast.error('No drum track found in this chart');
          return;
        }

        const audioFiles = findAudioFiles(loaded.files);
        if (audioFiles.length === 0) {
          toast.error('No audio files found in this chart');
          return;
        }

        const m = parsedChart.metadata;
        onLoaded({
          metadata: {
            name: m.name ?? loaded.originalName,
            artist: m.artist ?? 'Unknown Artist',
            charter: m.charter ?? 'Unknown Charter',
            song_length: m.song_length ?? null,
            md5: '',
            hasVideoBackground: false,
            albumArtMd5: '',
            notesData: {} as ChartResponseEncore['notesData'],
            modifiedTime: '',
            file: '',
          },
          chart: parsedChart,
          chartDoc,
          audioFiles,
        });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Failed to parse chart');
      }
    },
    [onLoaded],
  );

  return <ChartDropZone onLoaded={handleLoaded} id={id} />;
}
