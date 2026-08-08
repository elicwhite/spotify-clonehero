/**
 * @jest-environment jsdom
 */

import '@testing-library/jest-dom';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import FindMusicTable from '../FindMusicTable';
import {AudioContext} from '../../AudioProvider';
import type {FindMusicChart, FindMusicFilters, FindMusicSong} from '../types';

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
  default: ({artist, song}: {artist: string; song: string}) => (
    <button aria-label={`Play preview of ${song} by ${artist}`}>Play</button>
  ),
}));

import {downloadSong} from '../../../lib/local-songs-folder';

const mockDownloadSong = downloadSong as jest.MockedFunction<
  typeof downloadSong
>;

const filters: FindMusicFilters = {
  install: 'all',
  instruments: new Set(),
  minPlays: 0,
  evidence: new Set(),
};

function chart(md5: string, name: string, installed = false): FindMusicChart {
  return {
    md5,
    artist: 'Artist',
    name,
    charter: `Charter ${name}`,
    modifiedTime: '2026-01-01T00:00:00.000Z',
    songLength: 185_000,
    albumArtMd5: null,
    groupId: 1,
    hasVideoBackground: false,
    isInstalled: installed,
    instruments: {
      drums: 3,
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

  const relevance = screen.getByRole('button', {
    name: 'Relevance 68 of 100. View why Beta is relevant',
  });
  fireEvent.click(relevance);
  const ledger = await screen.findByRole('dialog');
  expect(ledger).toHaveTextContent('Why this song is relevant');
  expect(ledger).toHaveTextContent('50 plays in Spotify history');
  expect(ledger).toHaveTextContent('Favorites');
  expect(ledger).toHaveTextContent(
    'Installed locally, but the local charter is not among these Chorus versions',
  );
  expect(sharedScroller).not.toContainElement(ledger);
  expect(screen.queryByText('Charter Beta')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', {name: 'Close'}));

  fireEvent.click(
    screen.getByRole('button', {name: 'Show chart versions for Artist — Beta'}),
  );
  expect(await screen.findByText('Charter Beta')).toBeInTheDocument();
  expect(screen.queryByTitle('Bass: not charted')).not.toBeInTheDocument();
  expect(
    screen.getByTitle('Drums: difficulty 3').querySelector('img'),
  ).toHaveAttribute('src', expect.stringContaining('drums.png'));

  fireEvent.click(screen.getByRole('button', {name: 'Install'}));
  await waitFor(() => expect(mockDownloadSong).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.getAllByText('Installed')).toHaveLength(2));
});

it('keeps Radar in a distinct explanatory state while affinity is loading', () => {
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
    screen.getByText('Radar is building artist affinity'),
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
