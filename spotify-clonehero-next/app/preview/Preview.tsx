'use client';

import {useCallback, useEffect, useState} from 'react';
import {Highway} from './Highway';
import {getPreviewDownloadDirectory} from '@/lib/local-songs-folder';
import {Button} from '@/components/ui/button';
import {parseMidi} from '@/lib/preview/midi';
import {
  ChartParser,
  parseChart as scanParseChart,
} from '@/lib/preview/chart-parser';
import EncoreAutocomplete from '@/components/EncoreAutocomplete';
import {ChartResponseEncore} from '@/lib/chartSelection';
import {MidiParser} from '@/lib/preview/midi-parser';
import {ScannedChart, scanCharts} from 'scan-chart-web';
import {SngStream} from 'parse-sng';
import {useSearchParams} from 'next/navigation';

/*
Things I need from scan-chart
* Contents of TrackParser
* List of audio files / references to Audio Files
*/

const DEBUG = true;

export default function Preview() {
  const [chart, setChart] = useState<ChartParser | MidiParser | undefined>();
  const [audioFiles, setAudioFiles] = useState<ArrayBuffer[]>([]);
  const [alreadyInstalled, setAlreadyInstalled] = useState<{
    songName: string;
    handle: FileSystemFileHandle;
  } | null>(null);

  const searchParams = useSearchParams();
  const md5 = searchParams.get('md5');

  useEffect(
    function checkForAlreadyInstalledPreview() {
      if (md5 != null) {
        return;
      }

      async function run() {
        const downloadLocation = await getPreviewDownloadDirectory();

        const chartData = await getChartInfo(downloadLocation);
        if (chartData == null) {
          return;
        }
        const name = chartData.chart.name;
        if (chartData.chartFileName == null || name == null) {
          return;
        }
        const fileHandle = await downloadLocation.getFileHandle(
          chartData.chartFileName,
        );
        console.log('Found', name, 'already cached');

        setAlreadyInstalled({
          songName: name,
          handle: fileHandle,
        });
      }
      run();
    },
    [md5],
  );

  const playBuffers = useCallback((buffers: Map<string, ArrayBuffer>) => {
    let chartData: undefined | ChartParser | MidiParser;
    let songs: ArrayBuffer[] = [];
    for (const fileName of buffers.keys()) {
      console.log('found', fileName);
      if (fileName.toLowerCase().endsWith('.mid')) {
        chartData = getChartDataFromBuffer('mid', buffers.get(fileName)!);
      } else if (fileName.toLowerCase().endsWith('.chart')) {
        chartData = getChartDataFromBuffer('chart', buffers.get(fileName)!);
      }

      if (
        ['.ogg', '.mp3', '.wav', '.opus'].some(ext =>
          fileName.toLowerCase().endsWith(ext),
        )
      ) {
        songs.push(buffers.get(fileName)!);
      }
    }

    setChart(chartData);
    setAudioFiles(songs);
  }, []);

  const playChartBuffers = useCallback(
    async (buffers: Map<string, ArrayBuffer> | undefined) => {
      if (!buffers || buffers?.size == 0) {
        console.error('Could not parse chart files');
        return;
      }

      playBuffers(buffers);
    },
    [playBuffers],
  );

  const playSngFile = useCallback(
    async (sngFile: FileSystemFileHandle) => {
      const file = await sngFile.getFile();
      const stream = file.stream();
      const buffers = await processSngStream(stream);
      playChartBuffers(buffers);
    },
    [playChartBuffers],
  );

  const playSelectedChart = useCallback(
    async (chart: ChartResponseEncore) => {
      const chartFiles = await processFileUrlAsStream(chart.file);

      playChartBuffers(chartFiles);
    },
    [playChartBuffers],
  );

  const playMd5 = useCallback(async () => {
    async function run() {
      if (md5 == null) {
        return;
      }

      playChartBuffers(await processFileUrlAsStream(getDownloadURLForMd5(md5)));
    }
    run();
  }, [md5, playChartBuffers]);

  return (
    <div className="flex flex-col w-full flex-1">
      <div className="flex flex-row gap-10">
        {md5 == null && (
          <EncoreAutocomplete onChartSelected={playSelectedChart} />
        )}
        {md5 != null && <Button onClick={playMd5}>Play Preview</Button>}
        {alreadyInstalled != null && (
          <Button onClick={() => playSngFile(alreadyInstalled?.handle)}>
            Play {alreadyInstalled?.songName}
          </Button>
        )}
      </div>
      {chart && audioFiles.length > 0 && (
        <Highway chart={chart} audioFiles={audioFiles}></Highway>
      )}
    </div>
  );
}

function getChartDataFromBuffer(
  type: 'mid' | 'chart',
  arrayBuffer: ArrayBuffer,
): ChartParser | MidiParser {
  if (type == 'mid') {
    return parseMidi(arrayBuffer);
  } else if (type == 'chart') {
    return scanParseChart(arrayBuffer);
  }

  throw new Error('No .chart or .mid file found');
}

async function getChartInfo(
  folder: FileSystemDirectoryHandle,
): Promise<ScannedChart> {
  return new Promise((resolve, reject) => {
    const emitter = scanCharts(folder);

    let foundChart: ScannedChart;
    emitter.on('chart', chart => {
      foundChart = chart;
    });

    emitter.on('end', async () => {
      resolve(foundChart);
    });
  });
}

async function processFileUrlAsStream(
  URL: string,
): Promise<Map<string, ArrayBuffer> | undefined> {
  const response = await fetch(URL, {
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

  const body = response.body;
  if (body == null) {
    return;
  }

  return await processSngStream(body);
}

async function processSngStream(
  stream: ReadableStream<Uint8Array>,
): Promise<Map<string, ArrayBuffer> | undefined> {
  return new Promise((resolve, reject) => {
    const sngStream = new SngStream(stream);

    const files = new Map<string, ArrayBuffer>();

    sngStream.on('file', async (file, fileStream, nextFile) => {
      files.set(file, await readStreamIntoArrayBuffer(fileStream));

      if (nextFile) {
				nextFile();
			} else {
				resolve(files);
			}
    });

    sngStream.on('error', error => reject(error));

    sngStream.start();
  });
}

async function readStreamIntoArrayBuffer(
  stream: ReadableStream,
): Promise<ArrayBuffer> {
  const reader = stream.getReader();
  const chunks = [];

  while (true) {
    const {done, value} = await reader.read();

    if (done) {
      break;
    }

    chunks.push(value);
  }

  return new Blob(chunks).arrayBuffer();
}

function getDownloadURLForMd5(md5: string): string {
  return `https://files.enchor.us/${md5}.sng`;
}
