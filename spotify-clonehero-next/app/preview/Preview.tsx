'use client';

import {useCallback, useEffect, useState} from 'react';
import {Highway} from './Highway';
import {
  downloadSong,
  emptyDirectory,
  getPreviewDownloadDirectory,
} from '@/lib/local-songs-folder';
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

/*
Things I need from scan-chart
* Contents of TrackParser
* List of audio files / references to Audio Files
*/

const DEBUG = true;

export default function Preview() {
  const [chart, setChart] = useState<ChartParser | MidiParser | undefined>();
  const [audioFiles, setAudioFiles] = useState<File[]>([]);
  const [alreadyInstalled, setAlreadyInstalled] = useState<{
    songName: string;
    handle: FileSystemDirectoryHandle;
  } | null>(null);

  // const midFileFetch =
  //   'https://files.enchor.us/56d31d7c085f5e504b91e272e65d1cd3.sng';
  // const chartFileFetch =
  //   'https://files.enchor.us/c395e1d650182ccae787f37758f20223.sng';

  // Calculate downloaded preview
  useEffect(() => {
    async function run() {
      const downloadLocation = await getPreviewDownloadDirectory();
      let subDir = null;
      for await (const entry of downloadLocation.values()) {
        subDir = entry;
        break;
      }

      if (subDir == null || subDir.kind !== 'directory') {
        return;
      }

      const chartData = await getChartInfo(subDir);
      const name = chartData.chart.name;
      console.log('loaded', name);

      if (!name) {
        return;
      }

      setAlreadyInstalled({
        songName: name,
        handle: subDir,
      });
      // console.log('data', chartData);
      // const result = scanCharts(subDir);
      // const song = chartData.metadata.Name;
    }
    run();
  }, []);

  const playDirectory = useCallback(
    async (directory: FileSystemDirectoryHandle) => {
      const chartData = await getChartData(directory);
      console.log(chartData);
      const songFiles = await getSongFiles(directory);

      setChart(chartData);
      setAudioFiles(songFiles);
    },
    [],
  );

  const handler = useCallback(
    async (chart: ChartResponseEncore) => {
      const downloadLocation = await getPreviewDownloadDirectory();
      // We should have a better way to manage this directory
      await emptyDirectory(downloadLocation);
      const downloadedSong = await downloadSong(
        'Artist',
        'Song',
        'charter',
        chart.file, // SWAP THIS OUT WITH midFileFetch TO TEST MIDI
        {
          folder: downloadLocation,
        },
      );

      if (downloadedSong == null) {
        return;
      }

      const songDir =
        await downloadedSong.newParentDirectoryHandle.getDirectoryHandle(
          downloadedSong.fileName,
        );

      await playDirectory(songDir);
    },
    [playDirectory],
  );

  return (
    <div className="flex flex-col w-full flex-1">
      {/* <Button onClick={() => handler(null)}>Play</Button> */}
      <div className="flex flex-row gap-10">
        <EncoreAutocomplete onChartSelected={handler} />
        {alreadyInstalled != null && (
          <Button onClick={() => playDirectory(alreadyInstalled?.handle)}>
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

async function getChartData(
  directoryHandle: FileSystemDirectoryHandle,
): Promise<ChartParser | MidiParser> {
  for await (const entry of directoryHandle.values()) {
    const name = entry.name.toLowerCase();
    if (entry.kind !== 'file') {
      continue;
    }

    let result: ChartParser | MidiParser | null = null;
    if (name == 'notes.chart') {
      const file = await entry.getFile();
      result = scanParseChart(await file.arrayBuffer());
      console.log(result);

      return result;
    } else if (name == 'notes.mid') {
      const file = await entry.getFile();
      result = parseMidi(await file.arrayBuffer());
      return result;
    }
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

// This should be reused from scan-chart
async function getSongFiles(folder: FileSystemDirectoryHandle) {
  const songFiles = [];
  for await (const entry of folder.values()) {
    if (entry.kind !== 'file') {
      continue;
    }
    const hasExtension = ['.ogg', '.mp3', '.wav', '.opus'].some(ext =>
      entry.name.endsWith(ext),
    );

    if (
      hasExtension &&
      !['preview', 'crowd'].some(base => entry.name.startsWith(base))
    ) {
      const file = await entry.getFile();
      songFiles.push(file);
    }
  }
  return songFiles;
}
