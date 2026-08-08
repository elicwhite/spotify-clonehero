/**
 * @jest-environment jsdom
 */

import '@testing-library/jest-dom';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import FindMusicTable from '../FindMusicTable';
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

jest.mock('../../../lib/local-songs-folder', () => ({
  downloadSong: jest.fn(async () => ({
    newParentDirectoryHandle: {},
    fileName: 'chart.sng',
  })),
}));

jest.mock('../../../components/SpotifyPreviewButton', () => ({
  __esModule: true,
  default: ({
    artist,
    song,
    spotifyUrl,
  }: {
    artist: string;
    song: string;
    spotifyUrl?: string | null;
  }) => (
    <>
      <button aria-label={`Play preview of ${song} by ${artist}`}>Play</button>
      {spotifyUrl ? (
        <a
          href={spotifyUrl}
          aria-label={`Open ${song} by ${artist} in Spotify`}>
          Spotify
        </a>
      ) : null}
    </>
  ),
}));

import {downloadSong} from '../../../lib/local-songs-folder';

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
    hasInstalledChart: installed,
    charts: [chart(`${key}-chart`, name, installed)],
  };
}

beforeEach(() => {
  mockDownloadSong.mockClear();
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
      previewEnabled={false}
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
    'Relevance 68 of 100. Why Beta is relevant',
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
  expect(ledger).toHaveTextContent(
    'Installed locally, but the local charter is not among these Chorus versions',
  );
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
  const proDrumsBadge = screen.getByTitle('Pro drums: difficulty 3');
  expect(proDrumsBadge.querySelector('img')).toHaveAttribute(
    'src',
    expect.stringContaining('drums.png'),
  );
  expect(proDrumsBadge.querySelector('small')).toHaveClass('text-xs');
  expect(screen.queryByTitle('Drums: difficulty 3')).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', {name: 'Install'}));
  await waitFor(() => expect(mockDownloadSong).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.getAllByText('Installed')).toHaveLength(2));
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
    },
    {
      ...chart('drums-chart', 'Pro Drums Version'),
      instruments: {
        guitar: null,
        bass: null,
        keys: null,
        proDrums: 4,
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
      previewEnabled={false}
      onClearFilters={jest.fn()}
    />,
  );

  fireEvent.click(screen.getByTestId('song-row'));

  expect(
    screen.getByRole('link', {
      name: 'Open chart by Charter Guitar Version on Enchor',
    }),
  ).toHaveAttribute('href', 'https://www.enchor.us/chart/guitar-chart');
  expect(screen.getByTitle('Bass: difficulty 0')).toBeInTheDocument();
  expect(screen.queryByTitle('Keys: difficulty -1')).not.toBeInTheDocument();
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
      previewEnabled={false}
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

it('adds the compact preview column only for a linked Spotify account', () => {
  const music = [song('preview', 'Preview Song', 4)];
  const {rerender} = render(
    <FindMusicTable
      view="music"
      music={music}
      radar={[]}
      filters={filters}
      radarLoading={false}
      previewEnabled={false}
      onClearFilters={jest.fn()}
    />,
  );
  expect(screen.queryByText('Preview')).not.toBeInTheDocument();
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
      previewEnabled
      onClearFilters={jest.fn()}
    />,
  );
  expect(screen.getByText('Preview')).toBeInTheDocument();
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

it('preserves independent scroll positions for each view', () => {
  const recommendation: RadarSong = {
    key: 'recommendation',
    artist: 'Artist',
    song: 'Recommendation',
    artistPlayCount: 20,
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
      previewEnabled={false}
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
      previewEnabled={false}
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
      previewEnabled={false}
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
      previewEnabled={false}
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
        previewEnabled
        onClearFilters={jest.fn()}
      />
    </AudioContext.Provider>,
  );

  await waitFor(() => expect(pause).toHaveBeenCalledTimes(1));
});
