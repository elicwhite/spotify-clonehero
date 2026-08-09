/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';

import {AudioContext} from '@/app/AudioProvider';
import MusicPreviewButton from '@/components/MusicPreviewButton';
import type {AppleMusicLibraryClient} from '@/lib/apple-music';
import {resolveSpotifyTrackUrls} from '../../lib/spotify-sdk/SpotifyFetching';

jest.mock('../../lib/spotify-sdk/SpotifyFetching', () => ({
  resolveSpotifyTrackUrls: jest.fn(),
}));

const mockResolveSpotify = resolveSpotifyTrackUrls as jest.MockedFunction<
  typeof resolveSpotifyTrackUrls
>;

function appleResult(
  previewUrl: string | null = 'https://preview.test/apple.m4a',
) {
  return {
    catalogId: 'apple-id',
    artistName: 'Artist',
    title: 'Song',
    url: 'https://music.apple.com/us/song/song/apple-id',
    previewUrl,
  };
}

function appleClient(overrides: Partial<AppleMusicLibraryClient> = {}) {
  return {
    isAuthorized: () => true,
    authorize: async () => {},
    unauthorize: async () => {},
    fetchLibrarySongs: jest.fn(),
    resolveCatalogSong: jest.fn(async () => appleResult()),
    searchCatalogSong: jest.fn(async () => appleResult()),
    ...overrides,
  } as AppleMusicLibraryClient;
}

function renderPreview(
  props: Partial<React.ComponentProps<typeof MusicPreviewButton>> = {},
  playTrack = jest.fn(async (..._args: unknown[]) => {}),
) {
  let request = 0;
  render(
    <AudioContext.Provider
      value={{
        isPlaying: false,
        isLoading: false,
        currentTrack: null,
        beginTrackRequest: () => ++request,
        isTrackRequestCurrent: id => id === request,
        playTrack,
        pause: jest.fn(),
      }}>
      <MusicPreviewButton artist="Artist" song="Song" {...props} />
    </AudioContext.Provider>,
  );
  return {playTrack};
}

beforeEach(() => {
  mockResolveSpotify.mockReset();
});

it('uses an exact Spotify action without consulting the Apple backup', async () => {
  mockResolveSpotify.mockResolvedValue({
    previewUrl: 'https://preview.test/spotify.mp3',
    spotifyUrl: 'https://open.spotify.com/track/spotify-id',
  });
  const musicClient = appleClient();
  const {playTrack} = renderPreview({
    spotifyEnabled: true,
    spotifyActions: [
      {
        trackId: 'spotify-id',
        url: 'https://open.spotify.com/track/spotify-id',
        artist: 'Exact Artist',
        song: 'Exact Song',
      },
    ],
    appleMusicClient: musicClient,
    appleMusicActions: [
      {
        catalogId: 'apple-id',
        artist: 'Exact Artist',
        song: 'Exact Song',
      },
    ],
    preferredProvider: 'spotify',
    trackKey: 'row-preview',
  });

  fireEvent.click(
    screen.getByRole('button', {name: 'Play preview of Song by Artist'}),
  );

  await waitFor(() => expect(playTrack).toHaveBeenCalledTimes(1));
  expect(mockResolveSpotify).toHaveBeenCalledWith({
    trackId: 'spotify-id',
    artist: 'Exact Artist',
    song: 'Exact Song',
  });
  expect(musicClient.resolveCatalogSong).not.toHaveBeenCalled();
  expect(playTrack).toHaveBeenCalledWith(
    'Artist',
    'Song',
    'https://preview.test/spotify.mp3',
    'row-preview',
    1,
    {loop: true},
  );
  expect(
    screen.getByRole('link', {name: 'Open Song by Artist in Spotify'}),
  ).toHaveAttribute('href', 'https://open.spotify.com/track/spotify-id');
  const previewButton = screen.getByRole('button', {
    name: 'Play preview of Song by Artist',
  });
  expect(previewButton.querySelector('img')).not.toBeInTheDocument();
  expect(screen.getAllByRole('button')).toHaveLength(1);
});

it('falls back from an Apple catalog item with no preview to Spotify', async () => {
  mockResolveSpotify.mockResolvedValue({
    previewUrl: 'https://preview.test/spotify-backup.mp3',
    spotifyUrl: 'https://open.spotify.com/track/spotify-backup',
  });
  const musicClient = appleClient({
    resolveCatalogSong: jest.fn(async () => appleResult(null)),
    searchCatalogSong: jest.fn(async () => null),
  });
  const {playTrack} = renderPreview({
    artist: 'Apple First Artist',
    song: 'Apple First Song',
    spotifyEnabled: true,
    spotifyActions: [
      {
        trackId: 'spotify-backup',
        url: 'https://open.spotify.com/track/spotify-backup',
        artist: 'Artist',
        song: 'Song',
      },
    ],
    appleMusicClient: musicClient,
    appleMusicActions: [
      {
        catalogId: 'apple-exact',
        artist: 'Artist',
        song: 'Song',
      },
    ],
    preferredProvider: 'appleMusic',
  });

  fireEvent.click(
    screen.getByRole('button', {
      name: 'Play preview of Apple First Song by Apple First Artist',
    }),
  );

  await waitFor(() => expect(playTrack).toHaveBeenCalledTimes(1));
  expect(musicClient.resolveCatalogSong).toHaveBeenCalledWith(
    'apple-exact',
    expect.objectContaining({signal: expect.any(AbortSignal)}),
  );
  expect(musicClient.searchCatalogSong).toHaveBeenCalledTimes(1);
  expect(mockResolveSpotify).toHaveBeenCalledTimes(1);
  expect(playTrack.mock.calls[0]?.[2]).toBe(
    'https://preview.test/spotify-backup.mp3',
  );
  expect(playTrack.mock.calls[0]?.[5]).toEqual({loop: true});
  expect(
    screen.getByRole('link', {
      name: 'Open Apple First Song by Apple First Artist in Spotify',
    }),
  ).toHaveAttribute('href', 'https://open.spotify.com/track/spotify-backup');
});

it('falls back from an unavailable Spotify result to Apple and links to the successful provider', async () => {
  mockResolveSpotify.mockResolvedValue({
    previewUrl: null,
    spotifyUrl: 'https://open.spotify.com/track/no-preview',
  });
  const musicClient = appleClient();
  const {playTrack} = renderPreview({
    artist: 'Spotify First Artist',
    song: 'Spotify First Song',
    spotifyEnabled: true,
    appleMusicClient: musicClient,
    preferredProvider: 'spotify',
  });

  fireEvent.click(
    screen.getByRole('button', {
      name: 'Play preview of Spotify First Song by Spotify First Artist',
    }),
  );

  await waitFor(() => expect(playTrack).toHaveBeenCalledTimes(1));
  expect(mockResolveSpotify).toHaveBeenCalledWith({
    trackId: undefined,
    artist: 'Spotify First Artist',
    song: 'Spotify First Song',
  });
  expect(musicClient.searchCatalogSong).toHaveBeenCalledWith(
    {artistName: 'Spotify First Artist', title: 'Spotify First Song'},
    expect.objectContaining({signal: expect.any(AbortSignal)}),
  );
  expect(playTrack.mock.calls[0]?.[2]).toBe('https://preview.test/apple.m4a');
  expect(playTrack.mock.calls[0]?.[5]).toEqual({loop: false});
  expect(
    screen.getByRole('link', {
      name: 'Open Spotify First Song by Spotify First Artist in Apple Music',
    }),
  ).toHaveAttribute('href', 'https://music.apple.com/us/song/song/apple-id');
  expect(
    screen
      .getByRole('button', {
        name: 'Play preview of Spotify First Song by Spotify First Artist',
      })
      .querySelector('img'),
  ).toHaveAttribute('src', '/assets/apple-music/apple-music-icon-color.svg');
});

it('tries the backup when playback of the preferred preview rejects', async () => {
  mockResolveSpotify.mockResolvedValue({
    previewUrl: 'https://preview.test/broken.mp3',
    spotifyUrl: 'https://open.spotify.com/track/broken',
  });
  const playTrack = jest
    .fn()
    .mockRejectedValueOnce(new Error('media failed'))
    .mockResolvedValueOnce(undefined);
  const {playTrack: playback} = renderPreview(
    {
      artist: 'Playback Failover Artist',
      song: 'Playback Failover Song',
      spotifyEnabled: true,
      appleMusicClient: appleClient(),
      preferredProvider: 'spotify',
    },
    playTrack,
  );

  fireEvent.click(
    screen.getByRole('button', {
      name: 'Play preview of Playback Failover Song by Playback Failover Artist',
    }),
  );

  await waitFor(() => expect(playback).toHaveBeenCalledTimes(2));
  expect(playback.mock.calls[1]?.[2]).toBe('https://preview.test/apple.m4a');
  expect(playback.mock.calls[1]?.[5]).toEqual({loop: false});
});

it('reports no match only after both conservative searches return nothing', async () => {
  mockResolveSpotify.mockResolvedValue(null);
  const musicClient = appleClient({
    searchCatalogSong: jest.fn(async () => null),
  });
  const {playTrack} = renderPreview({
    artist: 'No Match Artist',
    song: 'No Match Song',
    spotifyEnabled: true,
    appleMusicClient: musicClient,
    preferredProvider: 'appleMusic',
  });

  fireEvent.click(
    screen.getByRole('button', {
      name: 'Play preview of No Match Song by No Match Artist',
    }),
  );

  expect(
    await screen.findByRole('button', {
      name: 'No match preview of No Match Song by No Match Artist',
    }),
  ).toBeDisabled();
  expect(musicClient.searchCatalogSong).toHaveBeenCalledTimes(1);
  expect(mockResolveSpotify).toHaveBeenCalledTimes(1);
  expect(playTrack).not.toHaveBeenCalled();
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
});
