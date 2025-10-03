'use client';

import _ from 'lodash';
import {parseChartFile} from '@eliwhite/scan-chart';
import {useSearchParams} from 'next/navigation';

import EncoreAutocomplete from '@/components/EncoreAutocomplete';
import {Button} from '@/components/ui/button';
import {useCallback, useEffect, useState} from 'react';
import {ChartResponseEncore} from '@/lib/chartSelection';
import SongView from './SongView';
import {
  Files,
  getChartAndAudioFiles,
  ParsedChart,
} from '@/lib/preview/chorus-chart-processing';
import {searchAdvanced} from '@/lib/search-encore';

export default function MyComponent({md5}: {md5: string}) {
  const searchParams = useSearchParams();
  // const md5 = searchParams.get('md5');
  const [rendering, setRendering] = useState<null | {
    metadata: ChartResponseEncore;
    chart: ParsedChart;
    audioFiles: Files;
  }>(null);

  console.log('---', rendering?.chart);

  useEffect(() => {
    async function run() {
      const chartResponse = await searchAdvanced({hash: md5});
      const track = chartResponse.data[0];
      if (!track) {
        console.error('No track found for md5', md5);
        return;
      }
      const {chart, audioFiles} = await getChartAndAudioFiles(track);
      setRendering({
        metadata: track,
        chart,
        audioFiles,
      });
    }

    run();
  }, [md5]);

  return (
    <>
      {rendering != null && (
        <SongView
          metadata={rendering.metadata}
          chart={rendering.chart}
          audioFiles={rendering.audioFiles}></SongView>
      )}
    </>
  );
}
