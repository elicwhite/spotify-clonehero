/** @jest-environment jsdom */

import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';

const mockUpdateSpotifyLibrary = jest.fn();
const mockFetchChorusCharts = jest.fn(async () => []);
const mockScanForInstalledCharts = jest.fn();
const mockGetSongsDirectoryHandle = jest.fn();
const mockToastError = jest.fn();
const mockToastInfo = jest.fn();
const mockToastWarning = jest.fn();
const mockCaptureException = jest.fn();

jest.mock('@sentry/nextjs', () => ({
  captureException: (...args: unknown[]) => mockCaptureException(...args),
}));

jest.mock('../../../../lib/spotify-sdk/SpotifyFetching', () => ({
  useSpotifyLibraryUpdate: () => [
    {playlists: {}, albums: {}, updateStatus: 'idle'},
    mockUpdateSpotifyLibrary,
  ],
}));

jest.mock('../../../../lib/chorusChartDb', () => ({
  useChorusChartDb: () => [
    {status: 'idle', numFetched: 0, numTotal: 0},
    mockFetchChorusCharts,
  ],
}));

jest.mock('../../../../lib/local-songs-folder', () => ({
  getLocalScanWarning: (count: number) => `${count} locations skipped`,
  scanInstalledCharts: (...args: unknown[]) =>
    mockScanForInstalledCharts(...args),
  tryGetSongsDirectoryHandle: () => mockGetSongsDirectoryHandle(),
}));
jest.mock('../../../../lib/local-db/client', () => ({getLocalDb: jest.fn()}));
jest.mock('../../../../lib/suspense-data', () => ({
  useData: jest.fn(() => ({data: []})),
}));
jest.mock('../../../../lib/supabase/client', () => ({createClient: jest.fn()}));

jest.mock('sonner', () => ({
  toast: {
    error: (...args: unknown[]) => mockToastError(...args),
    info: (...args: unknown[]) => mockToastInfo(...args),
    warning: (...args: unknown[]) => mockToastWarning(...args),
  },
}));

jest.mock('next/dynamic', () => () => () => null);
jest.mock('../../../SpotifyTableDownloader', () => () => null);
jest.mock('../../../SupportedBrowserWarning', () => ({
  __esModule: true,
  default: ({children}: {children: React.ReactNode}) => <>{children}</>,
}));
jest.mock(
  '../SpotifyLoaderCard',
  () =>
    function MockSpotifyLoaderCard() {
      return <div>Spotify loading</div>;
    },
);
jest.mock(
  '../LocalScanLoaderCard',
  () =>
    function MockLocalScanLoaderCard() {
      return <div>Local loading</div>;
    },
);
jest.mock(
  '../UpdateChorusLoaderCard',
  () =>
    function MockUpdateChorusLoaderCard() {
      return <div>Chorus loading</div>;
    },
);
jest.mock('../SignInWithSpotifyCard', () => ({
  SignInWithSpotifyCard: () => null,
}));

import {LoggedIn} from '../Spotify';

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

describe('Spotify refresh errors', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSongsDirectoryHandle.mockResolvedValue({
      kind: 'directory',
      name: 'Songs',
    });
  });

  it('returns to the start action when Spotify refresh rejects', async () => {
    const refresh = deferred<never>();
    mockUpdateSpotifyLibrary.mockReturnValue(refresh.promise);
    mockScanForInstalledCharts.mockResolvedValue({
      lastScanned: new Date(),
      installedCharts: [],
    });

    render(<LoggedIn />);
    fireEvent.click(screen.getByRole('button', {name: 'Select Songs Folder'}));

    await waitFor(() => expect(mockScanForInstalledCharts).toHaveBeenCalled());
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 20));
      refresh.reject(new Error('Spotify metadata failed'));
      await expect(refresh.promise).rejects.toThrow('Spotify metadata failed');
    });

    expect(
      await screen.findByRole('button', {name: 'Select Songs Folder'}),
    ).toBeInTheDocument();
    expect(mockToastError).toHaveBeenCalledWith('Spotify metadata failed');
  });

  it('shows one aggregate warning for a partial local scan', async () => {
    mockUpdateSpotifyLibrary.mockResolvedValue({status: 'unauthenticated'});
    mockScanForInstalledCharts.mockResolvedValue({
      status: 'partial',
      lastScanned: new Date(),
      installedCharts: [],
      issues: [{path: 'Songs/Inaccessible'}, {path: 'Songs/Offline'}],
    });

    render(<LoggedIn />);
    fireEvent.click(screen.getByRole('button', {name: 'Select Songs Folder'}));

    await waitFor(() =>
      expect(mockToastWarning).toHaveBeenCalledWith('2 locations skipped'),
    );
    expect(mockToastWarning).toHaveBeenCalledTimes(1);
  });

  it('does not start background work when folder selection is canceled', async () => {
    mockGetSongsDirectoryHandle.mockResolvedValue(null);

    render(<LoggedIn />);
    fireEvent.click(screen.getByRole('button', {name: 'Select Songs Folder'}));

    await waitFor(() =>
      expect(mockToastInfo).toHaveBeenCalledWith('Directory picker canceled'),
    );
    expect(mockUpdateSpotifyLibrary).not.toHaveBeenCalled();
    expect(mockFetchChorusCharts).not.toHaveBeenCalled();
    expect(mockScanForInstalledCharts).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', {name: 'Select Songs Folder'}),
    ).toBeInTheDocument();
  });

  it('reports a folder acquisition failure without starting background work', async () => {
    const error = new Error('Songs folder failed');
    mockGetSongsDirectoryHandle.mockRejectedValue(error);

    render(<LoggedIn />);
    fireEvent.click(screen.getByRole('button', {name: 'Select Songs Folder'}));

    expect(
      await screen.findByRole('button', {name: 'Select Songs Folder'}),
    ).toBeInTheDocument();
    expect(mockToastError).toHaveBeenCalledWith('Songs folder failed');
    expect(mockCaptureException).toHaveBeenCalledWith(error);
    expect(mockUpdateSpotifyLibrary).not.toHaveBeenCalled();
    expect(mockFetchChorusCharts).not.toHaveBeenCalled();
    expect(mockScanForInstalledCharts).not.toHaveBeenCalled();
  });

  it('keeps the retry action visible when a scan completes after another task fails', async () => {
    const refresh = deferred<never>();
    const scan = deferred<{
      status: 'complete';
      lastScanned: Date;
      installedCharts: never[];
      issues: never[];
    }>();
    const error = new Error('Spotify metadata failed');
    mockUpdateSpotifyLibrary.mockReturnValue(refresh.promise);
    mockScanForInstalledCharts.mockReturnValue(scan.promise);

    render(<LoggedIn />);
    fireEvent.click(screen.getByRole('button', {name: 'Select Songs Folder'}));

    await waitFor(() => expect(mockScanForInstalledCharts).toHaveBeenCalled());
    await act(async () => {
      refresh.reject(error);
      await Promise.resolve();
    });

    expect(
      await screen.findByRole('button', {name: 'Select Songs Folder'}),
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
      screen.getByRole('button', {name: 'Select Songs Folder'}),
    ).toBeInTheDocument();
    expect(screen.queryByText('Local loading')).not.toBeInTheDocument();
  });

  it('ignores a second click while folder selection is pending', async () => {
    const songsDirectory = deferred<FileSystemDirectoryHandle>();
    mockGetSongsDirectoryHandle.mockReturnValue(songsDirectory.promise);
    mockUpdateSpotifyLibrary.mockResolvedValue({status: 'unauthenticated'});
    mockScanForInstalledCharts.mockResolvedValue({
      status: 'complete',
      lastScanned: new Date(),
      installedCharts: [],
      issues: [],
    });

    render(<LoggedIn />);
    const button = screen.getByRole('button', {name: 'Select Songs Folder'});
    fireEvent.click(button);
    fireEvent.click(button);

    expect(mockGetSongsDirectoryHandle).toHaveBeenCalledTimes(1);

    await act(async () => {
      songsDirectory.resolve({
        kind: 'directory',
        name: 'Songs',
      } as FileSystemDirectoryHandle);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mockUpdateSpotifyLibrary).toHaveBeenCalledTimes(1);
      expect(mockFetchChorusCharts).toHaveBeenCalledTimes(1);
      expect(mockScanForInstalledCharts).toHaveBeenCalledTimes(1);
    });
  });
});
