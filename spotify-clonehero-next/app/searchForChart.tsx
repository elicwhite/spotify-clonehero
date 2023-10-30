import {searchForChart} from './serverActions';
import {ChartResponse, selectChart} from './chartSelection';
import {useState, useTransition} from 'react';

export default async function search(
  artist: string,
  song: string,
): Promise<ChartResponse> {
  // TODO this needs a useTransition
  const result = await searchForChart(artist, song);
  const charts: ChartResponse[] = JSON.parse(result);

  const selectedChart = selectChart(charts);
  return selectedChart;
}
