'use client';

// import chain from 'lodash/chain';

import _ from 'lodash';
import {SngHeader, SngStream} from 'parse-sng';
import {parseChartFile} from 'scan-chart';
import {useSearchParams} from 'next/navigation';

import {
  getBasename,
  getExtension,
  hasAudioExtension,
  hasAudioName,
  hasChartExtension,
  hasChartName,
  hasVideoName,
} from '@/lib/src-shared/utils';
import EncoreAutocomplete from '@/components/EncoreAutocomplete';
import {Button} from '@/components/ui/button';
import {useCallback, useState} from 'react';
import {ChartResponseEncore} from '@/lib/chartSelection';
import Renderer from './Renderer';

type ParsedChart = ReturnType<typeof parseChartFile>;

export default function MyComponent() {
  const searchParams = useSearchParams();
  const md5 = searchParams.get('md5');
  const [rendering, setRendering] = useState<null | {
    chart: ParsedChart;
    audioFiles: Uint8Array[];
  }>(null);

  const playSelectedChart = useCallback(async (chart: ChartResponseEncore) => {
    const files = await getChartFiles(chart);
    const [parsedChart, audioFiles] = await Promise.all([
      (async () => {
        const {chartData, format} = findChartData(files);
        const iniChartModifiers = Object.assign(
          {
            song_length: 0,
            hopo_frequency: 0,
            eighthnote_hopo: false,
            multiplier_note: 0,
            sustain_cutoff_threshold: -1,
            chord_snap_threshold: 0,
            five_lane_drums: false,
            pro_drums: false,
          },
          chart,
        );
        return parseChartFile(chartData, format, iniChartModifiers);
      })(),
      (async () => findAudioData(files))(),
    ]);
    console.log(parsedChart, audioFiles);
    setRendering({
      chart: parsedChart,
      audioFiles,
    });
    // const chartFiles = await processFileUrlAsStream(chart.file);

    // playChartBuffers(chartFiles);
  }, []);

  return (
    <div className="flex flex-col w-full flex-1">
      <div className="flex flex-row gap-10">
        {md5 == null && (
          <EncoreAutocomplete onChartSelected={playSelectedChart} />
        )}
        {md5 != null && <Button onClick={() => {}}>Play Preview</Button>}
      </div>

      {rendering != null && (
        <Renderer
          chart={rendering.chart}
          audioFiles={rendering.audioFiles}></Renderer>
      )}
    </div>
  );
}

async function getChartFiles(chartData: ChartResponseEncore) {
  const chartUrl = `https://files.enchor.us/${
    chartData.md5 + (chartData.hasVideoBackground ? '_novideo' : '')
  }.sng`;
  console.log('ur', chartUrl);
  const sngResponse = await fetch(chartUrl, {
    headers: {
      accept: '*/*',
      'accept-language': 'en-US,en;q=0.9',
      'sec-fetch-dest': 'empty',
    },
    referrerPolicy: 'no-referrer',
    body: null,
    method: 'GET',
    credentials: 'omit',
  });

  if (!sngResponse.ok) {
    throw new Error('Failed to fetch the .sng file');
  }

  const sngStream = new SngStream(sngResponse.body!, {generateSongIni: true});

  let header: SngHeader;
  sngStream.on('header', h => (header = h));
  const isFileTruncated = (fileName: string) => {
    const MAX_FILE_MIB = 2048;
    const MAX_FILES_MIB = 5000;
    const sortedFiles = _.sortBy(header.fileMeta, f => f.contentsLen);
    let usedSizeMib = 0;
    for (const sortedFile of sortedFiles) {
      usedSizeMib += Number(
        sortedFile.contentsLen / BigInt(1024) / BigInt(1024),
      );
      if (sortedFile.filename === fileName) {
        return (
          usedSizeMib > MAX_FILES_MIB ||
          sortedFile.contentsLen / BigInt(1024) / BigInt(1024) >= MAX_FILE_MIB
        );
      }
    }
  };

  const files: {fileName: string; data: Uint8Array}[] = [];

  return await new Promise<{fileName: string; data: Uint8Array}[]>(
    (resolve, reject) => {
      sngStream.on(
        'file',
        async (
          fileName: string,
          fileStream: ReadableStream<Uint8Array>,
          nextFile,
        ) => {
          const matchingFileMeta = header.fileMeta.find(
            f => f.filename === fileName,
          );
          if (
            hasVideoName(fileName) ||
            isFileTruncated(fileName) ||
            !matchingFileMeta
          ) {
            const reader = fileStream.getReader();
            // eslint-disable-next-line no-constant-condition
            while (true) {
              const result = await reader.read();
              if (result.done) {
                break;
              }
            }
          } else {
            const data = new Uint8Array(Number(matchingFileMeta.contentsLen));
            let offset = 0;
            let readCount = 0;
            const reader = fileStream.getReader();
            // eslint-disable-next-line no-constant-condition
            while (true) {
              const result = await reader.read();
              if (result.done) {
                break;
              }
              readCount++;
              if (readCount % 5 === 0) {
                await new Promise<void>(resolve => setTimeout(resolve, 2));
              } // Allow other processing to happen
              data.set(result.value, offset);
              offset += result.value.length;
            }

            files.push({fileName, data});
          }

          if (nextFile) {
            nextFile();
          } else {
            resolve(files);
          }
        },
      );

      sngStream.on('error', err => reject(err));
      sngStream.start();
    },
  );
}

function findChartData(files: {fileName: string; data: Uint8Array}[]) {
  const chartFiles = _.chain(files)
    .filter(f => hasChartExtension(f.fileName))
    .orderBy(
      [
        f => hasChartName(f.fileName),
        f => getExtension(f.fileName).toLowerCase() === 'mid',
      ],
      ['desc', 'desc'],
    )
    .value();

  return {
    chartData: chartFiles[0].data,
    format: (getExtension(chartFiles[0].fileName).toLowerCase() === 'mid'
      ? 'mid'
      : 'chart') as 'mid' | 'chart',
  };
}
function findAudioData(files: {fileName: string; data: Uint8Array}[]) {
  const audioData: Uint8Array[] = [];

  for (const file of files) {
    if (hasAudioExtension(file.fileName)) {
      if (hasAudioName(file.fileName)) {
        if (
          !['preview', 'crowd'].includes(
            getBasename(file.fileName).toLowerCase(),
          )
        ) {
          audioData.push(file.data);
        }
      }
    }
  }

  return audioData;
}
