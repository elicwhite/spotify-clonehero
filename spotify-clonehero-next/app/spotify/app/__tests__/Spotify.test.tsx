/** @jest-environment jsdom */

import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';

const mockUpdateSpotifyLibrary = jest.fn();
const mockFetchChorusCharts = jest.fn(async () => []);
const mockScanForInstalledCharts = jest.fn();
const mockToastError = jest.fn();

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
  tryScanForInstalledCharts: (...args: unknown[]) =>
    mockScanForInstalledCharts(...args),
}));
jest.mock('../../../../lib/local-db/client', () => ({getLocalDb: jest.fn()}));
jest.mock('../../../../lib/suspense-data', () => ({useData: jest.fn()}));
jest.mock('../../../../lib/supabase/client', () => ({createClient: jest.fn()}));

jest.mock('sonner', () => ({
  toast: {
    error: (...args: unknown[]) => mockToastError(...args),
    info: jest.fn(),
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
});
