import _ from 'lodash';
import {SngHeader, SngStream} from 'parse-sng';
import {parseChartFile} from '@eliwhite/scan-chart';

import {
  getBasename,
  getExtension,
  hasAudioExtension,
  hasAudioName,
  hasChartExtension,
  hasChartName,
  hasIniName,
  hasVideoName,
} from '@/lib/src-shared/utils';
import {ChartResponseEncore} from '@/lib/chartSelection';

export type ParsedChart = ReturnType<typeof parseChartFile>;
export type Files = {fileName: string; data: Uint8Array}[];

export async function getChartAndAudioFiles(chart: ChartResponseEncore) {
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
    (async () => findAudioFiles(files))(),
  ]);

  return {metadata: chart, chart: parsedChart, audioFiles};
}

async function getChartFiles(chartData: ChartResponseEncore) {
  console.log('chart', chartData);
  const chartUrl = `https://files.enchor.us/${
    chartData.md5 + (chartData.hasVideoBackground ? '_novideo' : '')
  }.sng`;

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

async function getIniContents(files: Files) {
  const iniFile = files.find(f => hasIniName(f.fileName));
  if (!iniFile) {
    throw new Error('No ini file found');
  }

  return new TextDecoder().decode(iniFile.data);
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

function findAudioFiles(files: Files): Files {
  return files.filter(
    f =>
      hasAudioExtension(f.fileName) &&
      hasAudioName(f.fileName) &&
      !['preview', 'crowd'].includes(getBasename(f.fileName).toLowerCase()),
  );
}
