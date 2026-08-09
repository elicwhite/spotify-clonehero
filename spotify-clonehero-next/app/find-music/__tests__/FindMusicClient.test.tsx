/**
 * @jest-environment jsdom
 */

import '@testing-library/jest-dom';
import {StrictMode} from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import type {
  FindMusicFilters,
  FindMusicSong,
  FindMusicStats,
  SourceStatus,
} from '../types';
import type {AppleMusicRefreshResult} from '../../../lib/apple-music/AppleMusicFetching';
import {FIND_MUSIC_FILTERS_STORAGE_KEY} from '../filterPersistence';
import {FIND_MUSIC_ACTIVATION_KEY} from '../activation';

let mockPathname = '/find-music';
jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}));

jest.mock('../../SupportedBrowserWarning', () => ({
  __esModule: true,
  default: ({children}: {children: React.ReactNode}) => <>{children}</>,
}));

type MockAuthUser = {identities?: Array<{provider: string}>} | null;
const mockGetUser = jest.fn(
  async (): Promise<{data: {user: MockAuthUser}}> => ({data: {user: null}}),
);
jest.mock('../../../lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getUser: mockGetUser,
      signInWithOAuth: jest.fn(),
      linkIdentity: jest.fn(),
    },
  }),
}));

const mockRefreshChorus = jest.fn(async () => []);
jest.mock('../../../lib/chorusChartDb', () => ({
  useChorusChartDb: () => [
    {status: 'idle', numFetched: 0, numTotal: 0},
    mockRefreshChorus,
  ],
}));

const mockLocalDbExists = jest.fn(async () => true);
jest.mock('../../../lib/local-db/client', () => ({
  localDbExists: () => mockLocalDbExists(),
}));

jest.mock('../../../lib/spotify-sdk/SpotifyFetching', () => ({
  useSpotifyLibraryUpdate: () => [
    {playlists: {}, albums: {}, updateStatus: 'idle'},
    jest.fn(),
  ],
  onPlaylistCacheUpdated: jest.fn(() => jest.fn()),
}));

const mockAppleClient = {isAuthorized: () => true};
const mockSetupAppleMusic = jest.fn(async () => mockAppleClient);
const mockRefreshAppleMusic = jest.fn(
  async (): Promise<AppleMusicRefreshResult> => ({status: 'success'}),
);
const mockDisconnectAppleMusic = jest.fn(async () => undefined);
let mockAppleSetupState = 'unauthorized';
jest.mock('../../../lib/apple-music/AppleMusicFetching', () => ({
  useAppleMusicLibraryUpdate: () => ({
    setupState: mockAppleSetupState,
    progress: {
      total: null,
      fetchedCount: 0,
      usableCount: 0,
      catalogAssociatedCount: 0,
      pagesFetched: 0,
    },
    client: mockAppleSetupState === 'authorized' ? mockAppleClient : null,
    setup: mockSetupAppleMusic,
    refresh: mockRefreshAppleMusic,
    disconnect: mockDisconnectAppleMusic,
  }),
}));

const mockNavigateToAppleMusicPath = jest.fn();
jest.mock('../../../lib/apple-music/navigation', () => ({
  navigateToAppleMusicPath: (path: string) =>
    mockNavigateToAppleMusicPath(path),
}));

jest.mock('../../../lib/spotify-sdk/HistoryDumpParsing', () => ({
  tryProcessSpotifyDump: jest.fn(),
}));

jest.mock('../../../lib/local-songs-folder', () => ({
  tryScanForInstalledCharts: jest.fn(),
}));

const mockGetFindMusicSongs = jest.fn();
const mockGetRadarSongs = jest.fn(async () => []);
const mockGetFindMusicStats = jest.fn();
jest.mock('../queries', () => ({
  getFindMusicSongs: () => mockGetFindMusicSongs(),
  getRadarSongs: () => mockGetRadarSongs(),
  getFindMusicStats: () => mockGetFindMusicStats(),
}));

jest.mock('../FindMusicSidebar', () => ({
  __esModule: true,
  default: ({
    musicCount,
    view,
    filters,
    onFiltersChange,
    onViewChange,
    historyStatus,
    spotifyLibraryStatus,
    appleMusicStatus,
    localStatus,
    chorusStatus,
    onRefreshAppleMusic,
  }: {
    musicCount: number;
    view: 'music' | 'radar';
    filters: FindMusicFilters;
    onFiltersChange: (filters: FindMusicFilters) => void;
    onViewChange: (view: 'music' | 'radar') => void;
    historyStatus: SourceStatus;
    spotifyLibraryStatus: SourceStatus;
    appleMusicStatus: SourceStatus;
    localStatus: SourceStatus;
    chorusStatus: SourceStatus;
    onRefreshAppleMusic: () => void;
  }) => (
    <aside
      data-testid="sidebar"
      data-view={view}
      data-filter-query={filters.query}
      data-history-phase={historyStatus.phase}
      data-library-phase={spotifyLibraryStatus.phase}
      data-apple-music-phase={appleMusicStatus.phase}
      data-local-phase={localStatus.phase}
      data-chorus-phase={chorusStatus.phase}>
      {musicCount} matches available
      <span>{appleMusicStatus.summary}</span>
      <button
        type="button"
        onClick={() => onFiltersChange({...filters, query: 'next query'})}>
        Change filter
      </button>
      <button type="button" onClick={() => onViewChange('radar')}>
        Choose recommendations
      </button>
      <button type="button" onClick={() => onViewChange('music')}>
        Choose your music
      </button>
      <button type="button" onClick={onRefreshAppleMusic}>
        Refresh Apple Music test
      </button>
    </aside>
  ),
}));

jest.mock('../FindMusicTable', () => ({
  __esModule: true,
  default: ({
    music,
    spotifyPreviewEnabled,
    appleMusicClient,
    preferredPreviewProvider,
  }: {
    music: FindMusicSong[];
    spotifyPreviewEnabled: boolean;
    appleMusicClient: unknown;
    preferredPreviewProvider: string;
  }) => (
    <div
      data-testid="music-table"
      data-spotify-preview={spotifyPreviewEnabled}
      data-apple-preview={Boolean(appleMusicClient)}
      data-preferred-preview={preferredPreviewProvider}>
      {music.map(song => song.song).join(',')}
    </div>
  ),
}));

import FindMusicClient from '../FindMusicClient';

const stats: FindMusicStats = {
  historySongs: 2,
  playlists: 0,
  albums: 0,
  libraryTracks: 0,
  spotifyLibraryTracks: 0,
  appleMusicLibraryTracks: 0,
  chorusCharts: 2,
  localCharts: 0,
  historyUpdatedAt: null,
  libraryUpdatedAt: null,
  spotifyLibraryUpdatedAt: null,
  appleMusicLibraryUpdatedAt: null,
  appleMusicStorefront: null,
  localUpdatedAt: null,
};

function song(key: string, name: string): FindMusicSong {
  return {
    key,
    artist: 'Artist',
    song: name,
    playCount: 10,
    playlists: [],
    albums: [],
    spotifyUrl: null,
    providerActions: [],
    inAppleMusicLibrary: false,
    hasInstalledChart: false,
    charts: [
      {
        md5: `${key}-chart`,
        artist: 'Artist',
        name,
        charter: 'Charter',
        modifiedTime: '2026-01-01T00:00:00.000Z',
        albumArtMd5: null,
        groupId: 1,
        hasVideoBackground: false,
        isInstalled: false,
        instruments: {
          guitar: 3,
          bass: null,
          keys: null,
          proDrums: 2,
        },
        instrumentPresence: {
          guitar: true,
          bass: false,
          keys: false,
          proDrums: true,
        },
      },
    ],
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetUser.mockResolvedValue({data: {user: null}});
  mockPathname = '/find-music';
  mockAppleSetupState = 'unauthorized';
  mockRefreshAppleMusic.mockResolvedValue({status: 'success'});
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.sessionStorage.setItem(FIND_MUSIC_ACTIVATION_KEY, 'true');
  mockLocalDbExists.mockResolvedValue(true);
  mockGetFindMusicStats.mockResolvedValue(stats);
  mockGetRadarSongs.mockResolvedValue([]);
});

it('does not create the local index or prepare sources before first interaction', async () => {
  window.sessionStorage.clear();
  mockLocalDbExists.mockResolvedValue(false);
  mockGetUser.mockResolvedValue({
    data: {user: {identities: [{provider: 'spotify'}]}},
  });
  mockGetFindMusicSongs.mockResolvedValue([]);
  mockGetFindMusicStats.mockResolvedValue({...stats, historySongs: 0});

  render(<FindMusicClient />);

  expect(await screen.findByTestId('find-music-welcome')).toBeInTheDocument();
  expect(mockLocalDbExists).toHaveBeenCalledTimes(1);
  expect(mockGetFindMusicSongs).not.toHaveBeenCalled();
  expect(mockGetRadarSongs).not.toHaveBeenCalled();
  expect(mockGetFindMusicStats).not.toHaveBeenCalled();
  expect(mockSetupAppleMusic).not.toHaveBeenCalled();
  expect(mockRefreshChorus).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', {name: 'Connect Apple Music'}));

  expect(mockNavigateToAppleMusicPath).toHaveBeenCalled();
  expect(window.sessionStorage.getItem(FIND_MUSIC_ACTIVATION_KEY)).toBe('true');
  await waitFor(() => expect(mockGetFindMusicStats).toHaveBeenCalled());
  await waitFor(() => expect(mockSetupAppleMusic).toHaveBeenCalled());
});

it('preserves provider-return activation through React Strict Mode effect replay', async () => {
  mockLocalDbExists.mockResolvedValue(false);
  mockGetFindMusicSongs.mockResolvedValue([]);
  mockGetFindMusicStats.mockResolvedValue({...stats, historySongs: 0});

  render(
    <StrictMode>
      <FindMusicClient />
    </StrictMode>,
  );

  await waitFor(() => expect(mockGetFindMusicStats).toHaveBeenCalled());
  expect(window.sessionStorage.getItem(FIND_MUSIC_ACTIVATION_KEY)).toBeNull();
});

it('loads an existing local index without automatically refreshing Chorus', async () => {
  window.sessionStorage.clear();
  mockLocalDbExists.mockResolvedValue(true);
  mockGetFindMusicSongs.mockResolvedValue([song('saved', 'Saved')]);
  mockGetFindMusicStats.mockResolvedValue(stats);

  render(<FindMusicClient />);

  expect(await screen.findByTestId('music-table')).toHaveTextContent('Saved');
  expect(mockGetFindMusicStats).toHaveBeenCalled();
  expect(mockRefreshChorus).not.toHaveBeenCalled();
});

it('keeps the loaded snapshot warm while the route changes', async () => {
  mockGetFindMusicSongs.mockResolvedValue([song('alpha', 'Alpha')]);

  const rendered = render(<FindMusicClient />);

  expect(await screen.findByTestId('music-table')).toBeInTheDocument();
  expect(screen.getByTestId('sidebar')).toHaveAttribute('data-view', 'music');
  await waitFor(() => expect(mockGetFindMusicSongs).toHaveBeenCalledTimes(2));

  const queryCounts = {
    songs: mockGetFindMusicSongs.mock.calls.length,
    radar: mockGetRadarSongs.mock.calls.length,
    stats: mockGetFindMusicStats.mock.calls.length,
    chorusRefreshes: mockRefreshChorus.mock.calls.length,
  };

  mockPathname = '/find-music/recommendations';
  rendered.rerender(<FindMusicClient />);
  expect(screen.getByTestId('sidebar')).toHaveAttribute('data-view', 'radar');
  expect(screen.getByTestId('music-table')).toHaveTextContent('Alpha');

  expect(mockGetFindMusicSongs).toHaveBeenCalledTimes(queryCounts.songs);
  expect(mockGetRadarSongs).toHaveBeenCalledTimes(queryCounts.radar);
  expect(mockGetFindMusicStats).toHaveBeenCalledTimes(queryCounts.stats);
  expect(mockRefreshChorus).toHaveBeenCalledTimes(queryCounts.chorusRefreshes);
});

it('restores filters from local storage and persists subsequent changes', async () => {
  window.localStorage.setItem(
    FIND_MUSIC_FILTERS_STORAGE_KEY,
    JSON.stringify({
      install: 'hide-installed',
      instruments: ['guitar'],
      query: 'saved query',
    }),
  );
  mockGetFindMusicSongs.mockResolvedValue([]);

  render(<FindMusicClient />);

  await waitFor(() =>
    expect(screen.getByTestId('sidebar')).toHaveAttribute(
      'data-filter-query',
      'saved query',
    ),
  );

  fireEvent.click(screen.getByRole('button', {name: 'Change filter'}));
  await waitFor(() =>
    expect(
      JSON.parse(
        window.localStorage.getItem(FIND_MUSIC_FILTERS_STORAGE_KEY) ?? '{}',
      ),
    ).toEqual({
      install: 'hide-installed',
      instruments: ['guitar'],
      query: 'next query',
      exclusions: [],
      exclusionDraft: '',
    }),
  );
});

it('shows loading source states while the OPFS database snapshot is unresolved', async () => {
  mockGetFindMusicSongs.mockReturnValue(new Promise(() => {}));

  render(<FindMusicClient />);
  await act(async () => {
    await Promise.resolve();
  });

  const sidebar = screen.getByTestId('sidebar');
  expect(sidebar).toHaveAttribute('data-history-phase', 'loading');
  expect(sidebar).toHaveAttribute('data-library-phase', 'loading');
  expect(sidebar).toHaveAttribute('data-local-phase', 'loading');
  expect(sidebar).toHaveAttribute('data-chorus-phase', 'loading');
  expect(
    screen.getByText('Opening your local music index'),
  ).toBeInTheDocument();
});

it('uses the full setup guide when no taste source has been loaded', async () => {
  mockGetFindMusicSongs.mockResolvedValue([]);
  mockGetFindMusicStats.mockResolvedValue({
    ...stats,
    historySongs: 0,
    libraryTracks: 0,
    chorusCharts: 0,
  });

  render(<FindMusicClient />);

  expect(await screen.findByTestId('find-music-welcome')).toBeInTheDocument();
  expect(
    screen.getByRole('heading', {
      name: 'Bring in the music you already care about',
    }),
  ).toBeInTheDocument();
  expect(screen.queryByTestId('music-table')).not.toBeInTheDocument();
  expect(mockRefreshChorus).not.toHaveBeenCalled();
  expect(
    screen.getAllByText(
      'Connect Spotify, Apple Music, or History to download the index',
    ).length,
  ).toBeGreaterThan(0);
});

it('connects Apple Music without requiring a site account', async () => {
  mockGetFindMusicSongs.mockResolvedValue([]);
  mockGetFindMusicStats.mockResolvedValue({
    ...stats,
    historySongs: 0,
    libraryTracks: 0,
    chorusCharts: 0,
  });

  render(<FindMusicClient />);

  fireEvent.click(
    await screen.findByRole('button', {name: 'Connect Apple Music'}),
  );
  expect(mockNavigateToAppleMusicPath).toHaveBeenCalledWith(
    '/apple-music-connect?returnTo=%2Ffind-music',
  );
});

it('uses an authorized Apple-only library as a taste and preview source', async () => {
  mockAppleSetupState = 'authorized';
  mockGetFindMusicSongs.mockResolvedValue([song('apple', 'Apple Song')]);
  mockGetFindMusicStats.mockResolvedValue({
    ...stats,
    historySongs: 0,
    libraryTracks: 1,
    appleMusicLibraryTracks: 1,
    appleMusicLibraryUpdatedAt: '2026-08-08T20:00:00.000Z',
    appleMusicStorefront: 'us',
  });

  render(<FindMusicClient />);

  const table = await screen.findByTestId('music-table');
  expect(table).toHaveAttribute('data-spotify-preview', 'false');
  expect(table).toHaveAttribute('data-apple-preview', 'true');
  expect(table).toHaveAttribute('data-preferred-preview', 'appleMusic');
  expect(screen.getByTestId('sidebar')).toHaveAttribute(
    'data-apple-music-phase',
    'ready',
  );
  await waitFor(() => expect(mockRefreshChorus).toHaveBeenCalled());
});

it('shows the safe Apple Music refresh diagnostic returned by the hook', async () => {
  mockAppleSetupState = 'authorized';
  mockGetFindMusicSongs.mockResolvedValue([song('apple-error', 'Apple Song')]);
  mockGetFindMusicStats.mockResolvedValue({
    ...stats,
    appleMusicLibraryTracks: 1,
  });
  mockRefreshAppleMusic.mockResolvedValue({
    status: 'error',
    errorCode: 'local_database:unknown',
    message:
      'Apple Music could not update its local library index. Reload this page and try again. (local_database:unknown)',
  });

  render(<FindMusicClient />);
  fireEvent.click(
    await screen.findByRole('button', {name: 'Refresh Apple Music test'}),
  );

  expect(
    await screen.findByText(
      'Apple Music could not update its local library index. Reload this page and try again. (local_database:unknown)',
    ),
  ).toBeInTheDocument();
});

it('prefers Apple Music when both providers are connected and its saved library is larger', async () => {
  mockAppleSetupState = 'authorized';
  mockGetUser.mockResolvedValue({
    data: {
      user: {
        identities: [{provider: 'spotify'}],
      },
    },
  });
  mockGetFindMusicSongs.mockResolvedValue([song('both-apple', 'Both Apple')]);
  mockGetFindMusicStats.mockResolvedValue({
    ...stats,
    libraryTracks: 30,
    spotifyLibraryTracks: 10,
    appleMusicLibraryTracks: 20,
  });

  render(<FindMusicClient />);

  const table = await screen.findByTestId('music-table');
  await waitFor(() =>
    expect(table).toHaveAttribute('data-spotify-preview', 'true'),
  );
  expect(table).toHaveAttribute('data-apple-preview', 'true');
  expect(table).toHaveAttribute('data-preferred-preview', 'appleMusic');
});

it.each([
  ['larger', 12],
  ['tied', 8],
] as const)(
  'prefers Spotify when both providers are connected and its saved library is %s',
  async (_case, spotifyLibraryTracks) => {
    mockAppleSetupState = 'authorized';
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          identities: [{provider: 'spotify'}],
        },
      },
    });
    mockGetFindMusicSongs.mockResolvedValue([
      song(`both-spotify-${_case}`, `Both Spotify ${_case}`),
    ]);
    mockGetFindMusicStats.mockResolvedValue({
      ...stats,
      libraryTracks: spotifyLibraryTracks + 8,
      spotifyLibraryTracks,
      appleMusicLibraryTracks: 8,
    });

    render(<FindMusicClient />);

    const table = await screen.findByTestId('music-table');
    await waitFor(() =>
      expect(table).toHaveAttribute('data-spotify-preview', 'true'),
    );
    expect(table).toHaveAttribute('data-apple-preview', 'true');
    expect(table).toHaveAttribute('data-preferred-preview', 'spotify');
  },
);

it('uses Spotify when it is the only connected preview provider', async () => {
  mockGetUser.mockResolvedValue({
    data: {
      user: {
        identities: [{provider: 'spotify'}],
      },
    },
  });
  mockGetFindMusicSongs.mockResolvedValue([
    song('spotify-provider', 'Spotify Provider'),
  ]);
  mockGetFindMusicStats.mockResolvedValue({
    ...stats,
    libraryTracks: 20,
    spotifyLibraryTracks: 20,
    appleMusicLibraryTracks: 100,
  });

  render(<FindMusicClient />);

  const table = await screen.findByTestId('music-table');
  await waitFor(() =>
    expect(table).toHaveAttribute('data-spotify-preview', 'true'),
  );
  expect(table).toHaveAttribute('data-apple-preview', 'false');
  expect(table).toHaveAttribute('data-preferred-preview', 'spotify');
});

it('moves the sidebar into a dismissible hamburger drawer on small screens', async () => {
  mockGetFindMusicSongs.mockResolvedValue([song('alpha', 'Alpha')]);

  render(<FindMusicClient />);

  expect(await screen.findByTestId('music-table')).toBeInTheDocument();
  expect(screen.getByTestId('find-music-layout')).toHaveClass(
    'grid-rows-[minmax(0,1fr)]',
  );
  expect(screen.getByTestId('find-music-desktop-sidebar')).toHaveClass(
    'hidden',
    'lg:block',
  );

  fireEvent.click(
    screen.getByRole('button', {name: 'Open filters and sources'}),
  );

  const drawer = screen.getByRole('dialog', {name: 'Find music controls'});
  expect(drawer).toBeInTheDocument();
  expect(screen.getAllByTestId('sidebar')).toHaveLength(2);

  fireEvent.click(
    within(drawer).getByRole('button', {name: 'Choose recommendations'}),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole('dialog', {name: 'Find music controls'}),
    ).not.toBeInTheDocument(),
  );
});

it('holds source-driven matches until the user explicitly re-ranks', async () => {
  mockGetFindMusicSongs
    .mockResolvedValueOnce([song('alpha', 'Alpha')])
    .mockResolvedValue([song('alpha', 'Alpha'), song('beta', 'Beta')]);

  render(<FindMusicClient />);

  expect(screen.getByTestId('find-music-page')).toHaveClass(
    'w-[calc(100%+2rem)]',
  );
  expect(screen.getByTestId('find-music-results')).toHaveClass(
    'flex',
    'min-h-0',
    'overflow-hidden',
  );

  expect(await screen.findByTestId('music-table')).toHaveTextContent('Alpha');

  const hold = await screen.findByTestId('held-matches');
  expect(mockRefreshChorus).toHaveBeenCalledTimes(1);
  expect(hold).toHaveTextContent('1 new match held');
  expect(screen.getByTestId('sidebar')).toHaveTextContent(
    '2 matches available',
  );
  expect(screen.getByTestId('music-table')).not.toHaveTextContent('Beta');

  fireEvent.click(screen.getByRole('button', {name: 'Re-rank now'}));
  await waitFor(() =>
    expect(screen.getByTestId('music-table')).toHaveTextContent('Alpha,Beta'),
  );
  expect(screen.queryByTestId('held-matches')).not.toBeInTheDocument();
});
