'use client';

import {useChorusChartDb as useChorusChartDbDatabase} from './database';

export type ChorusChartProgress = {
  status:
    | 'idle'
    | 'fetching'
    | 'fetching-dump'
    | 'updating-db'
    | 'complete'
    | 'error';
  numFetched: number;
  numTotal: number;
};
/** The SQLite catalog is the sole catalog implementation. */
export function useChorusChartDb() {
  return useChorusChartDbDatabase();
}
