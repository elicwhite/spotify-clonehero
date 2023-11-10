'use client';

import {useCallback} from 'react';
import {scanCharts} from 'scan-chart';

export default function Scanner() {
  const handler = useCallback(async () => {
    let directoryHandle;

    try {
      directoryHandle = await window.showDirectoryPicker();
    } catch {
      console.log('User canceled picker');
      return;
    }

    const emitter = scanCharts(directoryHandle);

    emitter.on('chart', chart => {
      console.log(
        chart.chartPath,
        chart.chart.folderIssues.map(issue => issue.description).join('\n'),
      );
    });
  }, []);

  return <button onClick={handler}>Check Charts</button>;
}
