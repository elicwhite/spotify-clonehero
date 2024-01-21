'use client';

import {useCallback, useEffect, useState} from 'react';
import {calculateTimes, parseChart} from '@/lib/preview/chart';
import {Highway} from './Highway';
import {
  downloadSong,
  emptyDirectory,
  getPreviewDownloadDirectory,
} from '@/lib/local-songs-folder';
import {Button} from '@/components/ui/button';
import {readTextFile} from '@/lib/fileSystemHelpers';
import {ChartFile} from '@/lib/preview/interfaces';
import {parseMidi} from '@/lib/preview/midi';
import {parseChart as scanParseChart} from '@/lib/preview/chart-parser';
import EncoreAutocomplete from '@/components/EncoreAutocomplete';
import chorusChartDb from '@/lib/chorusChartDb';
import {Searcher} from 'fast-fuzzy';
import {ChartResponseEncore} from '@/lib/chartSelection';

export default function Preview() {
  const [chart, setChart] = useState<ChartFile | undefined>();
  const [audioFile, setAudioFile] = useState<string | undefined>();

  // const midFileFetch =
  //   'https://files.enchor.us/56d31d7c085f5e504b91e272e65d1cd3.sng';
  // const chartFileFetch =
  //   'https://files.enchor.us/c395e1d650182ccae787f37758f20223.sng';

  const handler = useCallback(async (chart: ChartResponseEncore) => {
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

    const chartData = await getChartData(songDir);
    calculateTimes(chartData);

    const audioFileHandle = await songDir.getFileHandle('song.opus');
    const audioFile = await audioFileHandle.getFile();
    const audioUrl = URL.createObjectURL(audioFile);

    setChart(chartData);
    setAudioFile(audioUrl);
  }, []);

  return (
    <div className="flex flex-col w-full flex-1">
      <TypeAhead onChartSelected={handler} />
      {chart && audioFile && <Highway chart={chart} song={audioFile}></Highway>}
    </div>
  );
}

async function getChartData(
  directoryHandle: FileSystemDirectoryHandle,
): Promise<ChartFile> {
  for await (const entry of directoryHandle.values()) {
    const name = entry.name.toLowerCase();
    if (entry.kind !== 'file') {
      continue;
    }

    if (name == 'notes.chart') {
      const chart = await readTextFile(entry);

      const parsedChart = parseChart(chart);

      const file = await entry.getFile();
      const result = scanParseChart(await file.arrayBuffer());
      console.log(parsedChart, result);

      return parsedChart;
    } else if (name == 'notes.mid') {
      const file = await entry.getFile();
      parseMidi(await file.arrayBuffer());
      throw new Error('notes.mid files are not supported yet');
    }
  }

  throw new Error('No .chart or .mid file found');
}

function TypeAhead({
  onChartSelected,
}: {
  onChartSelected: (chart: ChartResponseEncore) => void;
}) {
  const [searcher, setSearcher] = useState<Searcher<
    ChartResponseEncore,
    any
  > | null>(null);

  useEffect(() => {
    async function run() {
      const fetchChorusDb = await chorusChartDb();

      const artistSearcher = new Searcher(fetchChorusDb, {
        keySelector: chart => [chart.artist, chart.name],
        threshold: 1,
        useDamerau: false,
        useSellers: false,
      });

      setSearcher(artistSearcher);
    }
    run();
  }, []);

  return (
    <EncoreAutocomplete onChartSelected={onChartSelected} searcher={searcher} />
  );
}
