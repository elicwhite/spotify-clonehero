'use client';

import {useCallback, useEffect, useRef, useState} from 'react';
import {Chart, ScannedChart, scanCharts} from 'scan-chart-web';
import {getChartIssues, getIssuesXLSX} from './ExcelBuilder';

const NOT_SUPPORTED = typeof window.showDirectoryPicker !== 'function';

function formatTimeRemaining(timeInMillis: number) {
  const seconds = Math.ceil(timeInMillis / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  let formattedTime;

  if (hours > 0) {
    // Use hours if the time is more than 1 hour
    formattedTime = `${hours} ${hours === 1 ? 'hour' : 'hours'} remaining`;
  } else if (minutes > 0) {
    // Use minutes if the time is less than 1 hour but more than 1 minute
    formattedTime = `${minutes} ${
      minutes === 1 ? 'minute' : 'minutes'
    } remaining`;
  } else {
    // Use seconds if the time is less than 1 minute
    formattedTime = `${seconds} ${
      seconds === 1 ? 'second' : 'seconds'
    } remaining`;
  }

  return formattedTime;
}

export default function CheckerPage() {
  const [keyId, setKeyId] = useState<number>(0);
  const [directoryHandle, setDirectoryHandle] =
    useState<FileSystemDirectoryHandle | null>(null);

  const handler = useCallback(async () => {
    let handle;

    try {
      handle = await window.showDirectoryPicker({
        id: 'charts-to-scan',
      });
    } catch {
      console.log('User canceled picker');
      return;
    }

    setDirectoryHandle(handle);
    setKeyId(key => key + 1);
  }, []);

  return (
    <>
      <p className="mb-4 text-center">
        This tool will scan charts in a folder on your computer,
        <br /> providing an Excel file with all the issues found.
        <br />
      </p>
      {NOT_SUPPORTED && (
        <p className="mb-4 text-center text-red-700">
          This tool does not work in your browser.
          <br />
          Try again using Chrome / Edge.
        </p>
      )}
      <button
        disabled={NOT_SUPPORTED}
        className="bg-blue-500 text-white px-4 py-2 rounded-md transition-all ease-in-out duration-300 hover:bg-blue-600 dark:bg-blue-400 dark:hover:bg-blue-500"
        onClick={handler}>
        Choose Folder
      </button>

      {directoryHandle == null ? null : (
        <Scanner key={keyId} directoryHandle={directoryHandle} />
      )}
    </>
  );
}

function Scanner({
  directoryHandle,
}: {
  directoryHandle: FileSystemDirectoryHandle;
}) {
  const [numFolders, setNumFolders] = useState<number | null>(null);
  const [startTime, setStartTime] = useState<Date | null>(null);
  const [counter, setCounter] = useState<number>(0);
  const [latestChart, setLatestChart] = useState<string | null>(null);
  const [xlsx, setXlsx] = useState<ArrayBuffer | null>(null);
  const [issuesFound, setIssuesFound] = useState<number | null>(null);

  useEffect(() => {
    async function run() {
      const charts: ScannedChart[] = [];
      const emitter = scanCharts(directoryHandle);

      emitter.on('folder', () => {
        setNumFolders(n => (n || 0) + 1);
      });

      emitter.on('chart', chart => {
        // Only set this if it isn't already set
        setStartTime(d => (d == null ? new Date() : d));

        charts.push(chart);
        setCounter(c => (c == null ? 0 : c + 1));
        const name =
          chart.chartPath +
          (chart.chartFileName != null ? '/' + chart.chartFileName : '');

        setLatestChart(name);
      });

      emitter.on('end', async () => {
        const issues = await getChartIssues(charts);
        const xlsx = await getIssuesXLSX(issues);
        setIssuesFound(issues.length);
        setXlsx(xlsx);
      });
    }
    run();
  }, [directoryHandle]);

  const downloadXlsx = useCallback(async () => {
    if (xlsx == null) {
      throw new Error(
        'Cannot download the excel file. It has not been created yet',
      );
    }

    const fileHandle = await window.showSaveFilePicker({
      id: 'download-excel',
      startIn: 'downloads',
      suggestedName: `Chart-Errors-${new Date().toISOString()}.xlsx`,
      types: [
        {
          accept: {
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
              ['.xlsx'],
          },
        },
      ],
    });

    const writableStream = await fileHandle.createWritable();
    await writableStream.write(xlsx);
    await writableStream.close();
  }, [xlsx]);

  let timeRemaining;
  // Calculate time remaining
  if (startTime && numFolders) {
    const defaultEstimate = 500;
    const now = new Date();

    const totalCharts = numFolders;
    const chartsSoFar = counter;

    const elapsedTime = now.getTime() - startTime.getTime();
    const timePerChartSoFar =
      chartsSoFar > 0 ? elapsedTime / chartsSoFar : defaultEstimate;
    const chartsRemaining = totalCharts - chartsSoFar;
    timeRemaining = chartsRemaining * timePerChartSoFar;
  }

  return (
    <>
      {numFolders == null ? null : (
        <>
          <h1>
            Scanned {counter} out of {numFolders} charts
          </h1>
        </>
      )}
      {latestChart != null && xlsx == null ? (
        <>
          <h1>Currently Scanning {latestChart}</h1>
          {timeRemaining != null && (
            <h1>{formatTimeRemaining(timeRemaining)}</h1>
          )}
        </>
      ) : null}
      {issuesFound == null ? null : <h1>{issuesFound} issues Found</h1>}
      {xlsx == null ? null : (
        <button
          className="bg-blue-500 text-white px-4 py-2 rounded-md transition-all ease-in-out duration-300 hover:bg-blue-600 dark:bg-blue-400 dark:hover:bg-blue-500"
          onClick={downloadXlsx}>
          Download Excel File of Issues
        </button>
      )}
    </>
  );
}
