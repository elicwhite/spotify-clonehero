/**
 * @jest-environment jsdom
 */

import '@testing-library/jest-dom';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import FindMusicTable from '../FindMusicTable';
import {dismissRadarSong} from '../queries';
import {AudioContext} from '../../AudioProvider';
import type {
  FindMusicChart,
  FindMusicFilters,
  FindMusicSong,
  RadarSong,
} from '../types';

jest.mock('react-virtual', () => ({
  useVirtual: ({size}: {size: number}) => ({
    totalSize: size * 50,
    virtualItems: Array.from({length: size}, (_, index) => ({
      index,
      size: 50,
      start: index * 50,
      end: (index + 1) * 50,
    })),
  }),
}));

jest.mock('../queries', () => ({
  dismissRadarSong: jest.fn(async () => undefined),
}));

jest.mock('../../../lib/local-songs-folder', () => ({
  downloadSong: jest.fn(async () => ({
    status: 'downloaded',
    newParentDirectoryHandle: {},
    fileName: 'chart.sng',
  })),
}));

jest.mock('../../../components/MusicPreviewButton', () => ({
  __esModule: true,
  default: ({
    artist,
    song,
    spotifyActions,
    appleMusicActions,
    preferredProvider,
  }: {
    artist: string;
    song: string;
    spotifyActions?: Array<{url?: string | null; trackId?: string | null}>;
    appleMusicActions?: Array<{catalogId?: string | null}>;
    preferredProvider?: string;
  }) => (
    <>
      <button
        aria-label={`Play preview of ${song} by ${artist}`}
        data-spotify-track-id={spotifyActions?.[0]?.trackId}
        data-apple-catalog-ids={appleMusicActions
          ?.map(action => action.catalogId)
          .join(',')}
        data-preferred-provider={preferredProvider}>
        Play
      </button>
      {spotifyActions?.[0]?.url ? (
        <a
          href={spotifyActions[0].url ?? undefined}
          aria-label={`Open ${song} by ${artist} in Spotify`}>
          Spotify
        </a>
      ) : null}
    </>
  ),
}));

import {downloadSong} from '../../../lib/local-songs-folder';

const mockDismissRadarSong = dismissRadarSong as jest.MockedFunction<
  typeof dismissRadarSong
>;
const mockDownloadSong = downloadSong as jest.MockedFunction<
  typeof downloadSong
>;

const filters: FindMusicFilters = {
  install: 'all',
  instruments: new Set(),
  query: '',
  exclusions: [],
  exclusionDraft: '',
};

function chart(md5: string, name: string, installed = false): FindMusicChart {
  return {
    md5,
    artist: 'Artist',
    name,
    charter: `Charter ${name}`,
    modifiedTime: '2026-01-01T00:00:00.000Z',
    albumArtMd5: null,
    groupId: 1,
    hasVideoBackground: false,
    isInstalled: installed,
    instrumentPresence: {
      guitar: true,
      bass: false,
      keys: false,
      proDrums: true,
    },
    instruments: {
      guitar: 4,
      bass: -1,
      keys: null,
      proDrums: 3,
    },
  };
}

function song(
  key: string,
  name: string,
  playCount: number,
  installed = false,
): FindMusicSong {
  return {
    key,
    artist: 'Artist',
    song: name,
    playCount,
    playlists: playCount > 20 ? ['Favorites'] : [],
    albums: [],
    spotifyUrl: `https://open.spotify.com/track/${key}`,
    providerActions: [],
    inAppleMusicLibrary: false,
    hasInstalledChart: installed,
    charts: [chart(`${key}-chart`, name, installed)],
  };
}

function recommendation(key: string, artist: string, name: string): RadarSong {
  return {
    key,
    artist,
    song: name,
    artistPlayCount: 10,
    savedLibrarySongCount: 0,
    chartCount: 1,
    availableInstrumentCount: 2,
    spotifyUrl: null,
    hasInstalledChart: false,
    charts: [chart(`${key}-chart`, name)],
  };
}

const defaultPreviewProps = {
  appleMusicClient: null,
  preferredPreviewProvider: undefined,
} as const;

beforeEach(() => {
  mockDownloadSong.mockClear();
  mockDismissRadarSong.mockClear();
});

it('renders relevance order, expands chart variants, and installs a chart', async () => {
  const beta = song('beta', 'Beta', 50);
  beta.hasInstalledChart = true;
  render(
    <FindMusicTable
      view="music"
      music={[song('alpha', 'Alpha', 2), beta]}
      radar={[]}
      filters={filters}
      radarLoading={false}
      {...defaultPreviewProps}
      spotifyPreviewEnabled={false}
      onClearFilters={jest.fn()}
    />,
  );

  const songRows = screen.getAllByTestId('song-row');
  expect(songRows).toHaveLength(2);
  expect(songRows[0]).toHaveTextContent('Beta');
  expect(songRows[1]).toHaveTextContent('Alpha');
  expect(songRows[0]).not.toHaveTextContent('50 plays');
  expect(songRows[0]).not.toHaveTextContent('Playlist:');
  const sharedScroller = screen.getByTestId('results-scroll');
  expect(sharedScroller).toHaveClass('overflow-x-auto');
  expect(sharedScroller).toHaveClass(
    'flex',
    'min-h-0',
    'flex-1',
    'overflow-y-hidden',
  );
  expect(sharedScroller).toContainElement(songRows[0]);
  expect(sharedScroller).toHaveTextContent('Relevance');
  expect(screen.getByTestId('results-rows')).toHaveClass(
    'min-h-0',
    'flex-1',
    'overflow-y-auto',
  );
  expect(songRows[0]).toHaveTextContent('other version');

  const relevance = screen.getByLabelText(
    'Relevance 67 of 100. Why Beta is relevant',
  );
  fireEvent.focus(relevance);
  const ledger = await screen.findByRole('tooltip');
  expect(ledger).toHaveTextContent('Evidence ledger');
  const paintedTooltip = screen
    .getAllByText('Evidence ledger')
    .map(element => element.closest('[data-side]'))
    .find(Boolean);
  expect(paintedTooltip).toHaveClass('bg-popover', 'text-popover-foreground');
  expect(ledger).toHaveTextContent('50 plays in Spotify history');
  expect(ledger).toHaveTextContent('Favorites');
  expect(sharedScroller).not.toContainElement(ledger);
  expect(screen.queryByText('Charter Beta')).not.toBeInTheDocument();

  fireEvent.click(songRows[0]);
  expect(await screen.findByText('Charter Beta')).toBeInTheDocument();
  expect(screen.queryByText('beta-chart')).not.toBeInTheDocument();
  expect(
    screen.getByRole('link', {name: 'Open chart by Charter Beta on Enchor'}),
  ).toHaveAttribute('href', 'https://www.enchor.us/chart/beta-chart');
  expect(
    screen.getByRole('link', {name: 'Open chart by Charter Beta on Enchor'}),
  ).toHaveAttribute('target', '_blank');
  expect(screen.getAllByText(/2025|2026/).length).toBeGreaterThan(0);
  expect(screen.queryByText('3:05')).not.toBeInTheDocument();
  expect(screen.queryByTitle('Bass: not charted')).not.toBeInTheDocument();
  const proDrumsBadge = screen.getByTitle('Pro drums: intensity 3');
  expect(proDrumsBadge.querySelector('img')).toHaveAttribute(
    'src',
    expect.stringContaining('drums.png'),
  );
  expect(proDrumsBadge.querySelector('small')).toHaveClass('text-xs');
  expect(screen.queryByTitle('Drums: intensity 3')).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', {name: 'Install'}));
  await waitFor(() => expect(mockDownloadSong).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.getAllByText('Installed')).toHaveLength(2));
});

it('returns an install action to idle when directory selection is canceled', async () => {
  mockDownloadSong.mockResolvedValueOnce({status: 'canceled'});
  render(
    <FindMusicTable
      view="music"
      music={[song('alpha', 'Alpha', 2)]}
      radar={[]}
      filters={filters}
      radarLoading={false}
      {...defaultPreviewProps}
      spotifyPreviewEnabled={false}
      onClearFilters={jest.fn()}
    />,
  );

  fireEvent.click(screen.getByTestId('song-row'));
  fireEvent.click(await screen.findByRole('button', {name: 'Install'}));

  await waitFor(() =>
    expect(screen.getByRole('button', {name: 'Install'})).toBeEnabled(),
  );
  expect(screen.queryByRole('button', {name: 'Retry'})).not.toBeInTheDocument();
});

it('renders track-backed instruments with unavailable intensity beneath the song column', () => {
  const violetHill = song('violet-hill', 'Violet Hill', 10);
  violetHill.charts = [
    {
      ...chart('b26561a9d61bd5f4d2454a9169a42654', 'Violet Hill'),
      charter: 'Vicarious Visions',
      instruments: {guitar: -1, bass: -1, keys: -1, proDrums: -1},
      instrumentPresence: {
        guitar: true,
        bass: true,
        keys: false,
        proDrums: false,
      },
    },
  ];

  render(
    <FindMusicTable
      view="music"
      music={[violetHill]}
      radar={[]}
      filters={filters}
      radarLoading={false}
      {...defaultPreviewProps}
      spotifyPreviewEnabled={false}
      onClearFilters={jest.fn()}
    />,
  );
  fireEvent.click(screen.getByTestId('song-row'));

  expect(screen.getByTitle('Guitar: intensity unavailable')).toHaveTextContent(
    '?',
  );
  expect(screen.getByTitle('Bass: intensity unavailable')).toHaveTextContent(
    '?',
  );
  expect(screen.getByTestId('chart-row')).toHaveClass(
    'grid-cols-[34px_minmax(150px,1fr)_minmax(220px,1.5fr)_80px_150px_120px_100px]',
  );
  expect(
    screen.getByTitle('Guitar: intensity unavailable').parentElement
      ?.parentElement,
  ).toHaveClass('pl-2');
});

it('shows only chart versions that satisfy the active instrument filter', () => {
  const filteredSong = song('filtered', 'Filtered Song', 10);
  filteredSong.charts = [
    {
      ...chart('guitar-chart', 'Guitar Version'),
      instruments: {
        guitar: 3,
        bass: 0,
        keys: -1,
        proDrums: 4,
      },
      instrumentPresence: {
        guitar: true,
        bass: true,
        keys: false,
        proDrums: true,
      },
    },
    {
      ...chart('drums-chart', 'Pro Drums Version'),
      instruments: {
        guitar: null,
        bass: null,
        keys: null,
        proDrums: 4,
      },
      instrumentPresence: {
        guitar: false,
        bass: false,
        keys: false,
        proDrums: true,
      },
    },
  ];

  render(
    <FindMusicTable
      view="music"
      music={[filteredSong]}
      radar={[]}
      filters={{...filters, instruments: new Set(['guitar'])}}
      radarLoading={false}
      {...defaultPreviewProps}
      spotifyPreviewEnabled={false}
      onClearFilters={jest.fn()}
    />,
  );

  fireEvent.click(screen.getByTestId('song-row'));

  expect(
    screen.getByRole('link', {
      name: 'Open chart by Charter Guitar Version on Enchor',
    }),
  ).toHaveAttribute('href', 'https://www.enchor.us/chart/guitar-chart');
  expect(screen.getByTitle('Bass: intensity 0')).toBeInTheDocument();
  expect(screen.queryByTitle('Keys: intensity -1')).not.toBeInTheDocument();
  expect(
    screen.queryByRole('link', {
      name: 'Open chart by Charter Pro Drums Version on Enchor',
    }),
  ).not.toBeInTheDocument();
});

it('keeps Recommendations in a distinct explanatory state while affinity is loading', () => {
  render(
    <FindMusicTable
      view="radar"
      music={[]}
      radar={[]}
      filters={filters}
      radarLoading={true}
      {...defaultPreviewProps}
      spotifyPreviewEnabled={false}
      onClearFilters={jest.fn()}
    />,
  );

  expect(
    screen.getByText('Recommendations are building artist affinity'),
  ).toBeInTheDocument();
  expect(
    screen.getByText(
      'Your music remains usable while the matching pass finishes.',
    ),
  ).toBeInTheDocument();
});

it('adds the Listen column only for a connected listening provider', () => {
  const music = [song('preview', 'Preview Song', 4)];
  const {rerender} = render(
    <FindMusicTable
      view="music"
      music={music}
      radar={[]}
      filters={filters}
      radarLoading={false}
      {...defaultPreviewProps}
      spotifyPreviewEnabled={false}
      onClearFilters={jest.fn()}
    />,
  );
  expect(screen.queryByText('Listen')).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', {
      name: 'Play preview of Preview Song by Artist',
    }),
  ).not.toBeInTheDocument();

  rerender(
    <FindMusicTable
      view="music"
      music={music}
      radar={[]}
      filters={filters}
      radarLoading={false}
      {...defaultPreviewProps}
      spotifyPreviewEnabled
      onClearFilters={jest.fn()}
    />,
  );
  expect(screen.getByText('Listen')).toBeInTheDocument();
  expect(
    screen.getByRole('button', {
      name: 'Play preview of Preview Song by Artist',
    }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole('link', {
      name: 'Open Preview Song by Artist in Spotify',
    }),
  ).toHaveAttribute('href', 'https://open.spotify.com/track/preview');

  fireEvent.click(
    screen.getByRole('button', {
      name: 'Play preview of Preview Song by Artist',
    }),
  );
  expect(screen.queryByText('Charter Preview Song')).not.toBeInTheDocument();
});

it('renders one preview control while retaining direct provider IDs internally', () => {
  const direct = song('dual-provider', 'Dual Provider', 4);
  direct.providerActions = [
    {
      provider: 'appleMusic',
      catalogId: 'apple-one',
      artist: 'Artist',
      song: 'Dual Provider',
    },
    {
      provider: 'appleMusic',
      catalogId: 'apple-two',
      artist: 'Guest Artist',
      song: 'Dual Provider (Live)',
    },
  ];

  render(
    <FindMusicTable
      view="music"
      music={[direct]}
      radar={[]}
      filters={filters}
      radarLoading={false}
      {...defaultPreviewProps}
      spotifyPreviewEnabled
      appleMusicClient={{} as never}
      onClearFilters={jest.fn()}
    />,
  );

  expect(screen.getByText('Listen')).toBeInTheDocument();
  const providerActions = screen.getByRole('group', {
    name: 'Listening actions for Dual Provider by Artist',
  });
  expect(providerActions).toHaveClass(
    'flex-nowrap',
    'overflow-x-auto',
    'overflow-y-hidden',
    'whitespace-nowrap',
    '[&>*]:shrink-0',
  );
  expect(within(providerActions).getAllByRole('button')).toHaveLength(1);
  const preview = within(providerActions).getByRole('button', {
    name: 'Play preview of Dual Provider by Artist',
  });
  expect(preview).toHaveAttribute(
    'data-apple-catalog-ids',
    'apple-one,apple-two',
  );
});

it('uses conservative Apple Music text search for rows without a catalog action', () => {
  const catalogLess = song('catalog-less', 'Catalog Less', 0);
  catalogLess.inAppleMusicLibrary = true;
  const spotifyOnly = song('spotify-only', 'Spotify Only', 4);
  const recommendation: RadarSong = {
    key: 'radar-apple-search',
    artist: 'Artist',
    song: 'Radar Search',
    artistPlayCount: 0,
    savedLibrarySongCount: 0,
    chartCount: 1,
    availableInstrumentCount: 2,
    spotifyUrl: null,
    hasInstalledChart: false,
    charts: [chart('radar-apple-search-chart', 'Radar Search')],
  };
  const {rerender} = render(
    <FindMusicTable
      view="music"
      music={[catalogLess, spotifyOnly]}
      radar={[]}
      filters={filters}
      radarLoading={false}
      {...defaultPreviewProps}
      spotifyPreviewEnabled={false}
      appleMusicClient={{} as never}
      onClearFilters={jest.fn()}
    />,
  );

  expect(
    screen.getByRole('button', {
      name: 'Play preview of Catalog Less by Artist',
    }),
  ).not.toHaveAttribute('data-apple-catalog-id');
  expect(
    screen.getByRole('button', {
      name: 'Play preview of Spotify Only by Artist',
    }),
  ).not.toHaveAttribute('data-apple-catalog-id');

  rerender(
    <FindMusicTable
      view="radar"
      music={[]}
      radar={[recommendation]}
      filters={filters}
      radarLoading={false}
      {...defaultPreviewProps}
      spotifyPreviewEnabled={false}
      appleMusicClient={{} as never}
      onClearFilters={jest.fn()}
    />,
  );
  expect(
    screen.getByRole('button', {
      name: 'Play preview of Radar Search by Artist',
    }),
  ).toBeInTheDocument();
});

it('preserves independent scroll positions for each view', () => {
  const recommendation: RadarSong = {
    key: 'recommendation',
    artist: 'Artist',
    song: 'Recommendation',
    artistPlayCount: 20,
    savedLibrarySongCount: 0,
    chartCount: 1,
    availableInstrumentCount: 2,
    spotifyUrl: null,
    hasInstalledChart: false,
    charts: [chart('recommendation-chart', 'Recommendation')],
  };
  const {rerender} = render(
    <FindMusicTable
      view="music"
      music={[song('music', 'Music', 10)]}
      radar={[recommendation]}
      filters={filters}
      radarLoading={false}
      {...defaultPreviewProps}
      spotifyPreviewEnabled={false}
      onClearFilters={jest.fn()}
    />,
  );

  const scroller = screen.getByTestId('results-rows');
  scroller.scrollTop = 320;
  fireEvent.scroll(scroller);

  rerender(
    <FindMusicTable
      view="radar"
      music={[song('music', 'Music', 10)]}
      radar={[recommendation]}
      filters={filters}
      radarLoading={false}
      {...defaultPreviewProps}
      spotifyPreviewEnabled={false}
      onClearFilters={jest.fn()}
    />,
  );
  expect(scroller.scrollTop).toBe(0);
  scroller.scrollTop = 140;
  fireEvent.scroll(scroller);

  rerender(
    <FindMusicTable
      view="music"
      music={[song('music', 'Music', 10)]}
      radar={[recommendation]}
      filters={filters}
      radarLoading={false}
      {...defaultPreviewProps}
      spotifyPreviewEnabled={false}
      onClearFilters={jest.fn()}
    />,
  );
  expect(scroller.scrollTop).toBe(320);

  rerender(
    <FindMusicTable
      view="radar"
      music={[song('music', 'Music', 10)]}
      radar={[recommendation]}
      filters={filters}
      radarLoading={false}
      {...defaultPreviewProps}
      spotifyPreviewEnabled={false}
      onClearFilters={jest.fn()}
    />,
  );
  expect(scroller.scrollTop).toBe(140);
});

it('stops a preview when filters remove its song from the result set', async () => {
  const pause = jest.fn();
  render(
    <AudioContext.Provider
      value={{
        isPlaying: true,
        isLoading: false,
        currentTrack: {key: 'filtered', artist: 'Artist', song: 'Filtered'},
        beginTrackRequest: () => 1,
        isTrackRequestCurrent: () => true,
        playTrack: async () => {},
        pause,
      }}>
      <FindMusicTable
        view="music"
        music={[song('visible', 'Visible', 4)]}
        radar={[]}
        filters={filters}
        radarLoading={false}
        {...defaultPreviewProps}
        spotifyPreviewEnabled
        onClearFilters={jest.fn()}
      />
    </AudioContext.Provider>,
  );

  await waitFor(() => expect(pause).toHaveBeenCalledTimes(1));
});

it('opens on plays descending once a history import is loaded', () => {
  render(
    <FindMusicTable
      view="music"
      music={[song('quiet', 'Quiet', 3), song('loud', 'Loud', 900)]}
      radar={[]}
      filters={filters}
      radarLoading={false}
      {...defaultPreviewProps}
      spotifyPreviewEnabled={false}
      onClearFilters={jest.fn()}
    />,
  );

  expect(screen.getByRole('button', {name: /^Plays/})).toHaveTextContent('▼');
  const rows = screen.getAllByTestId('song-row');
  expect(rows[0]).toHaveTextContent('Loud');
  expect(rows[0]).toHaveTextContent('900');
  expect(rows[1]).toHaveTextContent('Quiet');
});

it('falls back to relevance when no history has been imported', () => {
  render(
    <FindMusicTable
      view="music"
      music={[song('a', 'A', 0), song('b', 'B', 0)]}
      radar={[]}
      filters={filters}
      radarLoading={false}
      {...defaultPreviewProps}
      spotifyPreviewEnabled={false}
      onClearFilters={jest.fn()}
    />,
  );

  expect(screen.getByRole('button', {name: /^Relevance/})).toHaveTextContent(
    '▼',
  );
  expect(screen.getByRole('button', {name: /^Plays/})).not.toHaveTextContent(
    '▼',
  );
});

it('removes a dismissed recommendation and everything by a dismissed artist', () => {
  render(
    <FindMusicTable
      view="radar"
      music={[]}
      radar={[
        recommendation('one', 'Keeper', 'Keep Me'),
        recommendation('two', 'Dropper', 'Drop Me'),
        recommendation('three', 'Dropper', 'Also Dropped'),
      ]}
      filters={filters}
      radarLoading={false}
      {...defaultPreviewProps}
      spotifyPreviewEnabled={false}
      onClearFilters={jest.fn()}
    />,
  );
  expect(screen.getAllByTestId('song-row')).toHaveLength(3);

  fireEvent.click(
    screen.getByRole('button', {
      name: 'Not interested in Drop Me by Dropper',
    }),
  );
  expect(screen.getAllByTestId('song-row')).toHaveLength(2);
  expect(mockDismissRadarSong).toHaveBeenCalledWith('two', 'song');

  fireEvent.click(screen.getByRole('button', {name: 'Show less from Dropper'}));
  const remaining = screen.getAllByTestId('song-row');
  expect(remaining).toHaveLength(1);
  expect(remaining[0]).toHaveTextContent('Keep Me');
  expect(mockDismissRadarSong).toHaveBeenCalledWith('three', 'artist');
});
