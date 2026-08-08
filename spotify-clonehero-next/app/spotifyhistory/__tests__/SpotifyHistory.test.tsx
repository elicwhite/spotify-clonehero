/** @jest-environment jsdom */

import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';

const mockFetchChorusCharts = jest.fn();
const mockGetSongsDirectoryHandle = jest.fn();
const mockScanInstalledCharts = jest.fn();
const mockGetCachedSpotifyHistory = jest.fn();
const mockProcessSpotifyDump = jest.fn();
const mockToastError = jest.fn();
const mockToastInfo = jest.fn();
const mockCaptureException = jest.fn();

jest.mock('@sentry/nextjs', () => ({
  captureException: (...args: unknown[]) => mockCaptureException(...args),
}));

jest.mock('../../../lib/chorusChartDb', () => ({
  useChorusChartDb: () => [
    {status: 'idle', numFetched: 0, numTotal: 0},
    mockFetchChorusCharts,
  ],
}));
jest.mock('../../../lib/local-songs-folder', () => ({
  getLocalScanWarning: jest.fn(),
  scanInstalledCharts: (...args: unknown[]) => mockScanInstalledCharts(...args),
  tryGetSongsDirectoryHandle: () => mockGetSongsDirectoryHandle(),
}));
jest.mock('../../../lib/spotify-sdk/HistoryDumpParsing', () => ({
  getSpotifyDumpArtistTrackPlays: () => mockGetCachedSpotifyHistory(),
  tryProcessSpotifyDump: (...args: unknown[]) =>
    mockProcessSpotifyDump(...args),
}));
jest.mock('../../../lib/local-db/client', () => ({getLocalDb: jest.fn()}));
jest.mock('../../SpotifyTableDownloader', () => () => null);
jest.mock('../../spotify/app/LocalScanLoaderCard', () => () => null);
jest.mock('../../spotify/app/UpdateChorusLoaderCard', () => () => null);
jest.mock('sonner', () => ({
  toast: {
    error: (...args: unknown[]) => mockToastError(...args),
    info: (...args: unknown[]) => mockToastInfo(...args),
    warning: jest.fn(),
  },
}));

import {SpotifyHistory} from '../SpotifyHistory';

type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return {promise, resolve, reject};
}

describe('Spotify history picker orchestration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCachedSpotifyHistory.mockResolvedValue(new Map());
    jest.spyOn(window, 'alert').mockImplementation(() => {});
  });

  it('does not start background work when Songs selection is canceled', async () => {
    mockGetSongsDirectoryHandle.mockResolvedValue(null);

    render(<SpotifyHistory authenticated={true} />);
    fireEvent.click(screen.getByRole('button', {name: 'Scan Spotify Dump'}));

    await waitFor(() =>
      expect(mockToastInfo).toHaveBeenCalledWith('Directory picker canceled'),
    );
    expect(mockFetchChorusCharts).not.toHaveBeenCalled();
    expect(mockScanInstalledCharts).not.toHaveBeenCalled();
    expect(mockProcessSpotifyDump).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', {name: 'Scan Spotify Dump'}),
    ).toBeInTheDocument();
  });

  it('does not start background work when Spotify history selection is canceled', async () => {
    mockGetCachedSpotifyHistory.mockResolvedValue(null);
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: jest.fn(async () => {
        throw new DOMException('The user aborted a request.', 'AbortError');
      }),
    });

    render(<SpotifyHistory authenticated={true} />);
    fireEvent.click(screen.getByRole('button', {name: 'Scan Spotify Dump'}));

    await waitFor(() =>
      expect(mockToastInfo).toHaveBeenCalledWith('Directory picker canceled'),
    );
    expect(mockGetSongsDirectoryHandle).not.toHaveBeenCalled();
    expect(mockFetchChorusCharts).not.toHaveBeenCalled();
    expect(mockScanInstalledCharts).not.toHaveBeenCalled();
    expect(mockProcessSpotifyDump).not.toHaveBeenCalled();
  });

  it('reports a cached-history read failure and restores the start action', async () => {
    const error = new Error('History cache failed');
    mockGetCachedSpotifyHistory.mockRejectedValue(error);

    render(<SpotifyHistory authenticated={true} />);
    fireEvent.click(screen.getByRole('button', {name: 'Scan Spotify Dump'}));

    expect(
      await screen.findByRole('button', {name: 'Scan Spotify Dump'}),
    ).toBeInTheDocument();
    expect(mockToastError).toHaveBeenCalledWith('History cache failed', {
      duration: 8000,
    });
    expect(mockCaptureException).toHaveBeenCalledWith(error);
    expect(mockGetSongsDirectoryHandle).not.toHaveBeenCalled();
    expect(mockFetchChorusCharts).not.toHaveBeenCalled();
  });

  it('reports a non-cancellation history-picker failure', async () => {
    const error = new Error('History picker failed');
    mockGetCachedSpotifyHistory.mockResolvedValue(null);
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: jest.fn(async () => {
        throw error;
      }),
    });

    render(<SpotifyHistory authenticated={true} />);
    fireEvent.click(screen.getByRole('button', {name: 'Scan Spotify Dump'}));

    expect(
      await screen.findByRole('button', {name: 'Scan Spotify Dump'}),
    ).toBeInTheDocument();
    expect(mockToastError).toHaveBeenCalledWith('History picker failed', {
      duration: 8000,
    });
    expect(mockCaptureException).toHaveBeenCalledWith(error);
    expect(mockGetSongsDirectoryHandle).not.toHaveBeenCalled();
    expect(mockFetchChorusCharts).not.toHaveBeenCalled();
  });

  it('reports a Songs-folder acquisition failure', async () => {
    const error = new Error('Songs folder failed');
    mockGetSongsDirectoryHandle.mockRejectedValue(error);

    render(<SpotifyHistory authenticated={true} />);
    fireEvent.click(screen.getByRole('button', {name: 'Scan Spotify Dump'}));

    expect(
      await screen.findByRole('button', {name: 'Scan Spotify Dump'}),
    ).toBeInTheDocument();
    expect(mockToastError).toHaveBeenCalledWith('Songs folder failed', {
      duration: 8000,
    });
    expect(mockCaptureException).toHaveBeenCalledWith(error);
    expect(mockFetchChorusCharts).not.toHaveBeenCalled();
    expect(mockScanInstalledCharts).not.toHaveBeenCalled();
  });

  it('keeps the retry action visible when scanning finishes after another task fails', async () => {
    const scan = deferred<{
      status: 'complete';
      lastScanned: Date;
      installedCharts: never[];
      issues: never[];
    }>();
    const error = new Error('Chorus failed');
    mockGetSongsDirectoryHandle.mockResolvedValue({
      kind: 'directory',
      name: 'Songs',
    });
    mockScanInstalledCharts.mockReturnValue(scan.promise);
    mockFetchChorusCharts.mockRejectedValue(error);

    render(<SpotifyHistory authenticated={true} />);
    fireEvent.click(screen.getByRole('button', {name: 'Scan Spotify Dump'}));

    await waitFor(() => expect(mockScanInstalledCharts).toHaveBeenCalled());
    expect(
      await screen.findByRole('button', {name: 'Scan Spotify Dump'}),
    ).toBeInTheDocument();
    expect(mockCaptureException).toHaveBeenCalledWith(error);

    await act(async () => {
      scan.resolve({
        status: 'complete',
        lastScanned: new Date(),
        installedCharts: [],
        issues: [],
      });
      await Promise.resolve();
    });

    expect(
      screen.getByRole('button', {name: 'Scan Spotify Dump'}),
    ).toBeInTheDocument();
  });

  it('ignores a second click while picker preflight is pending', async () => {
    const cachedHistory = deferred<Map<string, Map<string, number>>>();
    mockGetCachedSpotifyHistory.mockReturnValue(cachedHistory.promise);
    mockGetSongsDirectoryHandle.mockResolvedValue(null);

    render(<SpotifyHistory authenticated={true} />);
    const button = screen.getByRole('button', {name: 'Scan Spotify Dump'});
    fireEvent.click(button);
    fireEvent.click(button);

    expect(mockGetCachedSpotifyHistory).toHaveBeenCalledTimes(1);

    await act(async () => {
      cachedHistory.resolve(new Map<string, Map<string, number>>());
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(mockGetSongsDirectoryHandle).toHaveBeenCalledTimes(1),
    );
    expect(mockFetchChorusCharts).not.toHaveBeenCalled();
    expect(mockScanInstalledCharts).not.toHaveBeenCalled();
  });
});
