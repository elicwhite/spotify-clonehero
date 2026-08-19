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

it('returns a canceled row to idle when another row takes over its Apple request', async () => {
  let slowSignal: AbortSignal | undefined;
  const slowClient = appleClient({
    searchCatalogSong: jest.fn(
      async (
        _query: {artistName: string; title: string},
        options: {signal?: AbortSignal} = {},
      ) => {
        slowSignal = options.signal;
        return new Promise((_resolve, reject) => {
          options.signal?.addEventListener('abort', () => {
            reject(new DOMException('Canceled', 'AbortError'));
          });
        });
      },
    ),
  });
  mockResolveSpotify.mockResolvedValue({
    previewUrl: 'https://preview.test/fast.mp3',
    spotifyUrl: 'https://open.spotify.com/track/fast',
  });
  let request = 0;
  const playTrack = jest.fn(async () => {});
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
      <MusicPreviewButton
        artist="Slow Artist"
        song="Slow Song"
        appleMusicClient={slowClient}
        preferredProvider="appleMusic"
      />
      <MusicPreviewButton
        artist="Fast Artist"
        song="Fast Song"
        spotifyEnabled
        preferredProvider="spotify"
      />
    </AudioContext.Provider>,
  );

  fireEvent.click(
    screen.getByRole('button', {
      name: 'Preview Slow Song by Slow Artist',
    }),
  );
  expect(
    await screen.findByRole('button', {
      name: 'Loading preview of Slow Song by Slow Artist',
    }),
  ).toBeDisabled();
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Preview Fast Song by Fast Artist',
    }),
  );

  await waitFor(() => expect(slowSignal?.aborted).toBe(true));
  expect(
    await screen.findByRole('button', {
      name: 'Preview Slow Song by Slow Artist',
    }),
  ).toBeEnabled();
  await waitFor(() => expect(playTrack).toHaveBeenCalledTimes(1));
});

it('keeps a no-preview preference retryable when the backup fails transiently', async () => {
  const musicClient = appleClient({
    resolveCatalogSong: jest.fn(async () => appleResult(null)),
    searchCatalogSong: jest.fn(async () => null),
  });
  mockResolveSpotify
    .mockRejectedValueOnce(new Error('temporary Spotify error'))
    .mockResolvedValueOnce({
      previewUrl: 'https://preview.test/recovered.mp3',
      spotifyUrl: 'https://open.spotify.com/track/recovered',
    });
  const {playTrack} = renderPreview({
    artist: 'Transient Artist',
    song: 'Transient Song',
    preferredProvider: 'appleMusic',
    appleMusicClient: musicClient,
    appleMusicActions: [
      {
        catalogId: 'no-preview',
        artist: 'Transient Artist',
        song: 'Transient Song',
      },
    ],
    spotifyEnabled: true,
  });

  fireEvent.click(
    screen.getByRole('button', {
      name: 'Preview Transient Song by Transient Artist',
    }),
  );
  const retry = await screen.findByRole('button', {
    name: 'Retry preview of Transient Song by Transient Artist',
  });
  expect(retry).toBeEnabled();

  fireEvent.click(retry);
  await waitFor(() => expect(playTrack).toHaveBeenCalledTimes(1));
  expect(mockResolveSpotify).toHaveBeenCalledTimes(2);
  expect(
    screen.getByRole('link', {
      name: 'Open Transient Song by Transient Artist in Spotify',
    }),
  ).toHaveAttribute('href', 'https://open.spotify.com/track/recovered');
});

it('cancels an in-flight Apple fallback when the client disconnects', async () => {
  let pendingSignal: AbortSignal | undefined;
  const musicClient = appleClient({
    searchCatalogSong: jest.fn(
      async (
        _query: {artistName: string; title: string},
        options: {signal?: AbortSignal} = {},
      ) => {
        pendingSignal = options.signal;
        return new Promise((_resolve, reject) => {
          options.signal?.addEventListener('abort', () =>
            reject(new DOMException('Disconnected', 'AbortError')),
          );
        });
      },
    ),
  });
  mockResolveSpotify.mockResolvedValue(null);
  let request = 0;
  const audioValue = {
    isPlaying: false,
    isLoading: false,
    currentTrack: null,
    beginTrackRequest: () => ++request,
    isTrackRequestCurrent: (id: number) => id === request,
    playTrack: jest.fn(async () => {}),
    pause: jest.fn(),
  };
  const {rerender} = render(
    <AudioContext.Provider value={audioValue}>
      <MusicPreviewButton
        artist="Disconnect Artist"
        song="Disconnect Song"
        spotifyEnabled
        appleMusicClient={musicClient}
        preferredProvider="spotify"
      />
    </AudioContext.Provider>,
  );

  fireEvent.click(
    screen.getByRole('button', {
      name: 'Preview Disconnect Song by Disconnect Artist',
    }),
  );
  await waitFor(() => expect(pendingSignal).toBeDefined());

  rerender(
    <AudioContext.Provider value={audioValue}>
      <MusicPreviewButton
        artist="Disconnect Artist"
        song="Disconnect Song"
        spotifyEnabled
        appleMusicClient={null}
        preferredProvider="spotify"
      />
    </AudioContext.Provider>,
  );

  expect(pendingSignal?.aborted).toBe(true);
  expect(
    screen.getByRole('button', {
      name: 'Preview Disconnect Song by Disconnect Artist',
    }),
  ).toBeEnabled();
});

it('tries every exact Apple catalog action before text search or another provider', async () => {
  const resolveCatalogSong = jest
    .fn()
    .mockResolvedValueOnce(appleResult(null))
    .mockResolvedValueOnce({
      ...appleResult('https://preview.test/second-apple.m4a'),
      catalogId: 'apple-two',
      url: 'https://music.apple.com/us/song/song/apple-two',
    });
  const musicClient = appleClient({resolveCatalogSong});
  mockResolveSpotify.mockResolvedValue({
    previewUrl: 'https://preview.test/spotify-unused.mp3',
    spotifyUrl: 'https://open.spotify.com/track/unused',
  });
  const {playTrack} = renderPreview({
    artist: 'Multi Apple Artist',
    song: 'Multi Apple Song',
    appleMusicClient: musicClient,
    appleMusicActions: [
      {
        catalogId: 'apple-one',
        artist: 'Multi Apple Artist',
        song: 'Multi Apple Song',
      },
      {
        catalogId: 'apple-two',
        artist: 'Multi Apple Artist',
        song: 'Multi Apple Song',
      },
    ],
    spotifyEnabled: true,
    preferredProvider: 'appleMusic',
  });

  fireEvent.click(
    screen.getByRole('button', {
      name: 'Preview Multi Apple Song by Multi Apple Artist',
    }),
  );

  await waitFor(() => expect(playTrack).toHaveBeenCalledTimes(1));
  expect(resolveCatalogSong.mock.calls.map(call => call[0])).toEqual([
    'apple-one',
    'apple-two',
  ]);
  expect(musicClient.searchCatalogSong).not.toHaveBeenCalled();
  expect(mockResolveSpotify).not.toHaveBeenCalled();
  expect(playTrack.mock.calls[0]?.[2]).toBe(
    'https://preview.test/second-apple.m4a',
  );
  expect(
    screen.getByRole('link', {
      name: 'Open Multi Apple Song by Multi Apple Artist in Apple Music',
    }),
  ).toHaveAttribute('href', 'https://music.apple.com/us/song/song/apple-two');
});
