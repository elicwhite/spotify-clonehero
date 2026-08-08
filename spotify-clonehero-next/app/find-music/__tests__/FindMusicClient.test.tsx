/**
 * @jest-environment jsdom
 */

import '@testing-library/jest-dom';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import type {FindMusicFilters, FindMusicSong, FindMusicStats} from '../types';
import {FIND_MUSIC_FILTERS_STORAGE_KEY} from '../filterPersistence';

jest.mock('../../SupportedBrowserWarning', () => ({
  __esModule: true,
  default: ({children}: {children: React.ReactNode}) => <>{children}</>,
}));

const mockGetUser = jest.fn(async () => ({data: {user: null}}));
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

jest.mock('../../../lib/spotify-sdk/SpotifyFetching', () => ({
  useSpotifyLibraryUpdate: () => [
    {playlists: {}, albums: {}, updateStatus: 'idle'},
    jest.fn(),
  ],
  onPlaylistCacheUpdated: jest.fn(() => jest.fn()),
}));

jest.mock('../../../lib/spotify-sdk/HistoryDumpParsing', () => ({
  processSpotifyDump: jest.fn(),
}));

jest.mock('../../../lib/local-songs-folder', () => ({
  scanForInstalledCharts: jest.fn(),
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
    filters,
    onFiltersChange,
  }: {
    musicCount: number;
    filters: FindMusicFilters;
    onFiltersChange: (filters: FindMusicFilters) => void;
  }) => (
    <aside data-testid="sidebar" data-filter-query={filters.query}>
      {musicCount} matches available
      <button
        type="button"
        onClick={() => onFiltersChange({...filters, query: 'next query'})}>
        Change filter
      </button>
    </aside>
  ),
}));

jest.mock('../FindMusicTable', () => ({
  __esModule: true,
  default: ({music}: {music: FindMusicSong[]}) => (
    <div data-testid="music-table">
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
  chorusCharts: 2,
  localCharts: 0,
  historyUpdatedAt: null,
  libraryUpdatedAt: null,
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
    hasInstalledChart: false,
    charts: [
      {
        md5: `${key}-chart`,
        artist: 'Artist',
        name,
        charter: 'Charter',
        modifiedTime: '2026-01-01T00:00:00.000Z',
        songLength: 180000,
        albumArtMd5: null,
        groupId: 1,
        hasVideoBackground: false,
        isInstalled: false,
        instruments: {
          drums: 2,
          guitar: 3,
          bass: null,
          keys: null,
          proDrums: 2,
        },
      },
    ],
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  mockGetFindMusicStats.mockResolvedValue(stats);
  mockGetRadarSongs.mockResolvedValue([]);
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
    }),
  );
});

it('uses the full setup guide when no taste source has been loaded', async () => {
  mockGetFindMusicSongs.mockResolvedValue([]);
  mockGetFindMusicStats.mockResolvedValue({...stats, historySongs: 0});

  render(<FindMusicClient />);

  expect(await screen.findByTestId('find-music-welcome')).toBeInTheDocument();
  expect(
    screen.getByRole('heading', {
      name: 'Bring in the music you already care about',
    }),
  ).toBeInTheDocument();
  expect(screen.queryByTestId('music-table')).not.toBeInTheDocument();
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
