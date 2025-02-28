'use client';

import {useCallback, useState} from 'react';
import {Highway} from './Highway';
import EncoreAutocomplete from '@/components/EncoreAutocomplete';
import {ChartResponseEncore} from '@/lib/chartSelection';
import {useSearchParams} from 'next/navigation';
import {
  Files,
  getChartAndAudioFiles,
  ParsedChart,
} from '@/lib/preview/chorus-chart-processing';

/*
Things I need from scan-chart
* Contents of TrackParser
* List of audio files / references to Audio Files
*/

const DEBUG = true;

export default function Preview() {
  const [rendering, setRendering] = useState<null | {
    metadata: ChartResponseEncore;
    chart: ParsedChart;
    audioFiles: Files;
  }>(null);
  // const [alreadyInstalled, setAlreadyInstalled] = useState<{
  //   songName: string;
  //   handle: FileSystemFileHandle;
  // } | null>(null);

  const searchParams = useSearchParams();
  const md5 = searchParams.get('md5');

  // useEffect(
  //   function checkForAlreadyInstalledPreview() {
  //     if (md5 != null) {
  //       return;
  //     }

  //     async function run() {
  //       const downloadLocation = await getPreviewDownloadDirectory();

  //       const chartData = await getChartInfo(downloadLocation);
  //       if (chartData == null) {
  //         return;
  //       }
  //       const name = chartData.chart.name;
  //       if (chartData.chartFileName == null || name == null) {
  //         return;
  //       }
  //       const fileHandle = await downloadLocation.getFileHandle(
  //         chartData.chartFileName,
  //       );
  //       console.log('Found', name, 'already cached');

  //       setAlreadyInstalled({
  //         songName: name,
  //         handle: fileHandle,
  //       });
  //     }
  //     run();
  //   },
  //   [md5],
  // );

  const playSelectedChart = useCallback(
    async (chartResponse: ChartResponseEncore) => {
      const {metadata, chart, audioFiles} =
        await getChartAndAudioFiles(chartResponse);

      setRendering({
        metadata,
        chart,
        audioFiles,
      });
    },
    [],
  );

  // const playMd5 = useCallback(async () => {
  //   async function run() {
  //     if (md5 == null) {
  //       return;
  //     }

  //     playChartBuffers(await processFileUrlAsStream(getDownloadURLForMd5(md5)));
  //   }
  //   run();
  // }, [md5, playChartBuffers]);

  return (
    <div className="flex flex-col w-full flex-1">
      <div className="flex flex-row gap-10">
        {md5 == null && (
          <EncoreAutocomplete onChartSelected={playSelectedChart} />
        )}
        {/* {md5 != null && <Button onClick={playMd5}>Play Preview</Button>} */}
        {/* {alreadyInstalled != null && (
          <Button onClick={() => playSngFile(alreadyInstalled?.handle)}>
            Play {alreadyInstalled?.songName}
          </Button>
        )} */}
      </div>
      {rendering != null && (
        <Highway
          metadata={rendering.metadata}
          chart={rendering.chart}
          audioFiles={rendering.audioFiles}></Highway>
      )}
    </div>
  );
}

// function getChartDataFromBuffer(
//   type: 'mid' | 'chart',
//   arrayBuffer: ArrayBuffer,
// ): ChartParser | MidiParser {
//   if (type == 'mid') {
//     return parseMidi(arrayBuffer);
//   } else if (type == 'chart') {
//     return scanParseChart(arrayBuffer);
//   }

//   throw new Error('No .chart or .mid file found');
// }

// async function getChartInfo(
//   folder: FileSystemDirectoryHandle,
// ): Promise<ScannedChart> {
//   return new Promise((resolve, reject) => {
//     const emitter = scanCharts(folder);

//     let foundChart: ScannedChart;
//     emitter.on('chart', chart => {
//       foundChart = chart;
//     });

//     emitter.on('end', async () => {
//       resolve(foundChart);
//     });
//   });
// }

// async function processFileUrlAsStream(
//   URL: string,
// ): Promise<Map<string, ArrayBuffer> | undefined> {
//   const response = await fetch(URL, {
//     headers: {
//       accept: '*/*',
//       'accept-language': 'en-US,en;q=0.9',
//       'sec-fetch-dest': 'empty',
//     },
//     referrerPolicy: 'no-referrer',
//     body: null,
//     method: 'GET',
//     credentials: 'omit',
//   });

//   const body = response.body;
//   if (body == null) {
//     return;
//   }

//   return await processSngStream(body);
// }

// async function processSngStream(
//   stream: ReadableStream<Uint8Array>,
// ): Promise<Map<string, ArrayBuffer> | undefined> {
//   return new Promise((resolve, reject) => {
//     const sngStream = new SngStream(stream);

//     const files = new Map<string, ArrayBuffer>();

//     sngStream.on('file', async (file, fileStream, nextFile) => {
//       files.set(file, await readStreamIntoArrayBuffer(fileStream));

//       if (nextFile) {
//         nextFile();
//       } else {
//         resolve(files);
//       }
//     });

//     sngStream.on('error', error => reject(error));

//     sngStream.start();
//   });
// }

// async function readStreamIntoArrayBuffer(
//   stream: ReadableStream,
// ): Promise<ArrayBuffer> {
//   const reader = stream.getReader();
//   const chunks = [];

//   while (true) {
//     const {done, value} = await reader.read();

//     if (done) {
//       break;
//     }

//     chunks.push(value);
//   }

//   return new Blob(chunks).arrayBuffer();
// }

// function getDownloadURLForMd5(md5: string): string {
//   return `https://files.enchor.us/${md5}.sng`;
// }
