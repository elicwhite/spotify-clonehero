'use client';

import _ from 'lodash';
import {parseChartFile} from 'scan-chart';
import {useSearchParams} from 'next/navigation';

import EncoreAutocomplete from '@/components/EncoreAutocomplete';
import {Button} from '@/components/ui/button';
import {useCallback, useState} from 'react';
import {ChartResponseEncore} from '@/lib/chartSelection';
import SongView from './SongView';
import {
  Files,
  getChartAndAudioFiles,
  ParsedChart,
} from '@/lib/preview/chorus-chart-processing';

export default function MyComponent() {
  const searchParams = useSearchParams();
  const md5 = searchParams.get('md5');
  const [rendering, setRendering] = useState<null | {
    metadata: ChartResponseEncore;
    chart: ParsedChart;
    audioFiles: Files;
  }>(null);

  const playSelectedChart = useCallback(
    async (chartResponse: ChartResponseEncore) => {
      const {chart, audioFiles} = await getChartAndAudioFiles(chartResponse);

      setRendering({
        metadata: chartResponse,
        chart,
        audioFiles,
      });
    },
    [],
  );

  return (
    <div className="flex flex-col w-full flex-1 overflow-hidden">
      <div className="flex flex-row gap-10">
        {md5 == null && (
          <EncoreAutocomplete onChartSelected={playSelectedChart} />
        )}
        {/* {md5 != null && <Button onClick={() => {}}>Play Preview</Button>} */}
      </div>

      {rendering != null && (
        <SongView
          metadata={rendering.metadata}
          chart={rendering.chart}
          audioFiles={rendering.audioFiles}></SongView>
      )}
    </div>
  );
}
