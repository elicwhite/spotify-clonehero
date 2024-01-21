'use client';

import {useCallback, useEffect, useState} from 'react';
import {calculateTimes, ChartFile, parseChart} from '@/lib/preview/chart';
import styles from './Home.module.css';
import {Highway} from './Highway';
import {
  downloadSong,
  getPreviewDownloadDirectory,
} from '@/lib/local-songs-folder';
import {Button} from '@/components/ui/button';
import {readTextFile} from '@/lib/fileSystemHelpers';

// https://files.enchor.us/ad8aab427e01dbf8650687886d5d05ea.sng
export default function Preview() {
  const [chart, setChart] = useState<ChartFile | undefined>();
  const [audioFile, setAudioFile] = useState<string | undefined>();
  // const song = '/assets/preview/song.ogg';

  const handler = useCallback(async () => {
    const downloadLocation = await getPreviewDownloadDirectory();
    const downloadedSong = await downloadSong(
      'Polyphia',
      'Sweet Tea (feat. Aaron Marshall)',
      'tommyf1001',
      'https://files.enchor.us/56d31d7c085f5e504b91e272e65d1cd3.sng',
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
    const chartFile = await songDir.getFileHandle('notes.chart');
    const chart = await readTextFile(chartFile);

    window.song = downloadedSong;

    const parsedChart = parseChart(chart);
    calculateTimes(parsedChart);

    const audioFileHandle = await songDir.getFileHandle('song.opus');
    const audioFile = await audioFileHandle.getFile();
    const audioUrl = URL.createObjectURL(audioFile);

    setChart(parsedChart);
    setAudioFile(audioUrl);
  }, []);

  return (
    <div className={styles.main}>
      <Button onClick={handler}>Start</Button>
      {chart && audioFile && <Highway chart={chart} song={audioFile}></Highway>}
    </div>
  );
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
