/**
 * @jest-environment jsdom
 */

import {act, renderHook, waitFor} from '@testing-library/react';
import {ChorusUnavailableError} from '../../chorus-errors';

const mockGetServerChartsDataVersion = jest.fn(async () => 1);
const mockGetChartsDataVersion = jest.fn(async () => 1);
const mockFetchNewCharts = jest.fn();
const mockGetLastScanSession = jest.fn(async () => null);

jest.mock('../serverVersions', () => ({
  getServerChartsDataVersion: () => mockGetServerChartsDataVersion(),
}));

jest.mock('../fetchNewCharts', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockFetchNewCharts(...args),
}));

jest.mock('../../local-db/chorus', () => ({
  upsertCharts: jest.fn(async () => {}),
  clearAllCharts: jest.fn(async () => {}),
  getChartsDataVersion: () => mockGetChartsDataVersion(),
  setChartsDataVersion: jest.fn(async () => {}),
  createScanSession: jest.fn(async () => 7),
  updateScanProgress: jest.fn(async () => {}),
  completeScanSession: jest.fn(async () => {}),
}));

jest.mock('../../local-db/chorus/scanning', () => ({
  getLastScanSession: () => mockGetLastScanSession(),
}));

jest.mock('../../local-db/client', () => ({
  getLocalDb: async () => ({
    transaction: () => ({
      execute: async (callback: (trx: unknown) => Promise<unknown>) =>
        callback({}),
    }),
  }),
}));

import {useChorusChartDb} from '../database';

beforeEach(() => {
  jest.clearAllMocks();
  mockGetServerChartsDataVersion.mockResolvedValue(1);
  mockGetChartsDataVersion.mockResolvedValue(1);
  mockGetLastScanSession.mockResolvedValue(null);
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('useChorusChartDb', () => {
  it('rejects with the underlying error when Chorus is unavailable', async () => {
    const error = new ChorusUnavailableError(500);
    mockFetchNewCharts.mockRejectedValue(error);

    const {result} = renderHook(() => useChorusChartDb());

    await act(async () => {
      await expect(result.current[1](new AbortController())).rejects.toBe(
        error,
      );
    });

    await waitFor(() => expect(result.current[0].status).toBe('error'));
  });

  it('completes when the fetch succeeds', async () => {
    mockFetchNewCharts.mockResolvedValue({charts: [], metadata: {}});

    const {result} = renderHook(() => useChorusChartDb());

    await act(async () => {
      await expect(result.current[1](new AbortController())).resolves.toEqual(
        [],
      );
    });

    await waitFor(() => expect(result.current[0].status).toBe('complete'));
  });
});
