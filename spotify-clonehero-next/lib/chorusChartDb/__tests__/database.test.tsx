/**
 * @jest-environment jsdom
 */

import {act, renderHook, waitFor} from '@testing-library/react';
import {ChorusUnavailableError} from '../../chorus-errors';

const mockGetServerChartsDataVersion = jest.fn(async () => 1);
const mockGetChartsDataVersion = jest.fn(async () => 1);
const mockFetchNewCharts = jest.fn();
const mockGetLastScanSession = jest.fn(async () => null);
const mockLoadChartDbDump = jest.fn();
let mockTransactionCommitted = false;

jest.mock('../serverVersions', () => ({
  getServerChartsDataVersion: () => mockGetServerChartsDataVersion(),
}));

jest.mock('../fetchNewCharts', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockFetchNewCharts(...args),
}));

jest.mock('../chartDbAssets', () => ({
  loadChartDbDump: (...args: unknown[]) => mockLoadChartDbDump(...args),
}));

jest.mock('../../local-db/chorus', () => ({
  upsertCharts: jest.fn(async () => {}),
  getChartsDataVersion: () => mockGetChartsDataVersion(),
  replaceChorusCatalog: jest.fn(async () => {}),
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
      execute: async (callback: (trx: unknown) => Promise<unknown>) => {
        try {
          const result = await callback({});
          mockTransactionCommitted = true;
          return result;
        } catch (error) {
          mockTransactionCommitted = false;
          throw error;
        }
      },
    }),
  }),
}));

import {useChorusChartDb} from '../database';

beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: {
      request: async (
        _name: string,
        _options: unknown,
        work: () => Promise<unknown>,
      ) => work(),
    },
  });
  mockGetServerChartsDataVersion.mockResolvedValue(1);
  mockGetChartsDataVersion.mockResolvedValue(1);
  mockGetLastScanSession.mockResolvedValue(null);
  mockLoadChartDbDump.mockReset();
  mockTransactionCommitted = false;
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
      await expect(
        result.current[1](new AbortController()),
      ).resolves.toBeUndefined();
    });

    await waitFor(() => expect(result.current[0].status).toBe('complete'));
  });

  it('does not commit a catalog replacement when the dump fetch fails', async () => {
    const error = new Error('dump unavailable');
    mockGetChartsDataVersion.mockResolvedValue(1);
    mockGetServerChartsDataVersion.mockResolvedValue(2);
    mockLoadChartDbDump.mockRejectedValue(error);

    const {result} = renderHook(() => useChorusChartDb());

    await act(async () => {
      await expect(result.current[1](new AbortController())).rejects.toBe(
        error,
      );
    });

    expect(mockLoadChartDbDump).toHaveBeenCalled();
    expect(mockTransactionCommitted).toBe(false);
    expect(result.current[0].status).toBe('error');
  });
});
