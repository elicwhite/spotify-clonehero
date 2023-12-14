import {SongAccumulator} from '@/lib/scanLocalCharts';
import {ChartInfo, ChartResponse, selectChart} from './chartSelection';

export function compareToCurrentChart(
  currentChart: SongAccumulator,
  newChart: ChartResponse,
) {
  const currentChartInfo: ChartInfo = {
    ...currentChart.data,
    uploadedAt: new Date(currentChart.lastModified).toISOString(),
  };

  const result = selectChart([currentChartInfo, newChart]);

  if (result == currentChartInfo) {
    return 'current';
  } else {
    return 'new';
  }
}
