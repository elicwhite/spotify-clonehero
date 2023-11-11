'use client';

import {useCallback, useEffect, useRef, useState} from 'react';
import {Chart, ScannedChart, scanCharts} from 'scan-chart-web';
import {getChartIssues, getIssuesXLSX} from './ExcelBuilder';
import {write} from 'fs';

export default function Scanner() {
  const [counter, setCounter] = useState<number | null>(null);
  const [latestChart, setLatestChart] = useState<string | null>(null);
  const [xlsx, setXlsx] = useState<ArrayBuffer | null>(null);
  const [issuesFound, setIssuesFound] = useState<number | null>(null);

  const handler = useCallback(async () => {
    let directoryHandle;

    try {
      directoryHandle = await window.showDirectoryPicker({
        id: 'charts-to-scan',
      });
    } catch {
      console.log('User canceled picker');
      return;
    }

    const charts: ScannedChart[] = [];
    const emitter = scanCharts(directoryHandle);

    // const issues: [string, Chart['folderIssues']][] = [];
    emitter.on('chart', chart => {
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
  }, []);

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

  return (
    <>
      <button onClick={handler}>Check Charts</button>
      {counter == null ? null : <h1>Processed {counter} charts</h1>}
      {latestChart != null && xlsx == null ? (
        <h1>Scanning {latestChart}</h1>
      ) : null}
      {issuesFound == null ? null : <h1>{issuesFound} issues Found</h1>}
      {xlsx == null ? null : (
        <button onClick={downloadXlsx}>Download Excel File of Issues</button>
      )}
    </>
  );
}
