'use client';

import {useCallback, useEffect, useRef, useState} from 'react';
import {Chart, scanCharts} from 'scan-chart-web';

export default function Scanner() {
  const [issues, setIssues] = useState<[string, Chart['folderIssues']][]>([]);
  const [counter, setCounter] = useState<number | null>(null);

  const handler = useCallback(async () => {
    let directoryHandle;

    try {
      directoryHandle = await window.showDirectoryPicker();
    } catch {
      console.log('User canceled picker');
      return;
    }

    const emitter = scanCharts(directoryHandle);

    const issues: [string, Chart['folderIssues']][] = [];
    emitter.on('chart', chart => {
      setCounter(c => (c == null ? 0 : c + 1));
      const name =
        chart.chartPath +
        (chart.chartFileName != null ? '/' + chart.chartFileName : '');

      if (chart.chart.folderIssues.length == 0) {
        return;
      }
      issues.push([name, chart.chart.folderIssues]);

      console.log(
        name,
        chart.chart.folderIssues.map(issue => issue.description).join('\n'),
      );
    });

    emitter.on('end', () => {
      setIssues(issues);
    });
  }, []);

  return (
    <>
      <button onClick={handler}>Check Charts</button>
      {counter == null ? null : <h1>Processed {counter} charts</h1>}
      <ul>
        {issues.map(([file, issues]) => {
          return (
            <li key={file}>
              {file}
              <ul>
                {issues.map(issue => {
                  return <li key={issue.description}>{issue.description}</li>;
                })}
              </ul>
            </li>
          );
        })}
      </ul>
    </>
  );
}
