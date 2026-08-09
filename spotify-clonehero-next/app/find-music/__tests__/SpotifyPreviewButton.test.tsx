/**
 * @jest-environment jsdom
 */

import '@testing-library/jest-dom';
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {useContext} from 'react';

import {AudioContext, AudioProvider} from '../../AudioProvider';
import SpotifyPreviewButton from '../../../components/SpotifyPreviewButton';
import {useTrackUrls} from '../../../lib/spotify-sdk/SpotifyFetching';

let mockPathname = '/find-music';

jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}));

jest.mock('../../../lib/spotify-sdk/SpotifyFetching', () => ({
  useTrackUrls: jest.fn(),
}));

jest.mock('sonner', () => ({
  toast: {error: jest.fn()},
}));

type Deferred = {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
};

function deferred(): Deferred {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return {promise, resolve, reject};
}

class FakeAudio {
  static instances: FakeAudio[] = [];
  static playQueue: Array<() => Promise<void>> = [];

  src = '';
  crossOrigin: string | null = null;
  loop = false;
  pause = jest.fn(() => this.emit('pause'));
  load = jest.fn();
  play = jest.fn(async () => {
    const next = FakeAudio.playQueue.shift();
    if (next) await next();
    this.emit('playing');
  });
  private listeners = new Map<string, Set<() => void>>();

  constructor() {
    FakeAudio.instances.push(this);
  }

  addEventListener(name: string, listener: () => void) {
    const listeners = this.listeners.get(name) ?? new Set();
    listeners.add(listener);
    this.listeners.set(name, listeners);
  }

  removeEventListener(name: string, listener: () => void) {
    this.listeners.get(name)?.delete(listener);
  }

  removeAttribute(name: string) {
    if (name === 'src') this.src = '';
  }

  emit(name: string) {
    this.listeners.get(name)?.forEach(listener => listener());
  }
}

const mockUseTrackUrls = useTrackUrls as jest.MockedFunction<
  typeof useTrackUrls
>;

beforeAll(() => {
  Object.defineProperty(global, 'Audio', {
    configurable: true,
    writable: true,
    value: FakeAudio,
  });
});

beforeEach(() => {
  mockPathname = '/find-music';
  FakeAudio.instances = [];
  FakeAudio.playQueue = [];
  mockUseTrackUrls.mockImplementation(() => async () => null);
});

it('keeps one preview active, stops it on a second click, and releases it on navigation', async () => {
  const view = render(
    <AudioProvider>
      <SpotifyPreviewButton
        artist="Artist A"
        song="Song A"
        previewUrl="https://preview.test/a.mp3"
        spotifyUrl="https://open.spotify.com/track/a"
        compact
      />
      <SpotifyPreviewButton
        artist="Artist B"
        song="Song B"
        previewUrl="https://preview.test/b.mp3"
        spotifyUrl="https://open.spotify.com/track/b"
        compact
      />
    </AudioProvider>,
  );

  expect(
    screen.getByRole('link', {name: 'Open Song A by Artist A in Spotify'}),
  ).toHaveAttribute('href', 'https://open.spotify.com/track/a');
  expect(
    screen.getByRole('link', {name: 'Open Song B by Artist B in Spotify'}),
  ).toHaveAttribute('href', 'https://open.spotify.com/track/b');

  fireEvent.click(
    screen.getByRole('button', {name: 'Play preview of Song A by Artist A'}),
  );
  expect(
    await screen.findByRole('button', {
      name: 'Stop preview of Song A by Artist A',
    }),
  ).toBeInTheDocument();

  fireEvent.click(
    screen.getByRole('button', {name: 'Play preview of Song B by Artist B'}),
  );
  expect(
    await screen.findByRole('button', {
      name: 'Stop preview of Song B by Artist B',
    }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole('button', {name: 'Play preview of Song A by Artist A'}),
  ).toBeInTheDocument();

  const previousAudio = FakeAudio.instances[0];
  const audio = FakeAudio.instances.at(-1)!;
  expect(audio.src).toBe('https://preview.test/b.mp3');
  expect(audio.crossOrigin).toBe('anonymous');
  expect(audio.loop).toBe(true);
  expect(previousAudio.pause).toHaveBeenCalled();

  previousAudio.emit('abort');
  expect(
    screen.getByRole('button', {
      name: 'Stop preview of Song B by Artist B',
    }),
  ).toBeInTheDocument();

  mockPathname = '/spotify';
  view.rerender(
    <AudioProvider>
      <SpotifyPreviewButton
        artist="Artist B"
        song="Song B"
        previewUrl="https://preview.test/b.mp3"
        spotifyUrl="https://open.spotify.com/track/b"
        compact
      />
    </AudioProvider>,
  );

  await waitFor(() =>
    expect(
      screen.getByRole('button', {
        name: 'Play preview of Song B by Artist B',
      }),
    ).toBeInTheDocument(),
  );
  expect(audio.src).toBe('');
  expect(audio.load).toHaveBeenCalled();
});

it('does not let an older play promise replace newer playback', async () => {
  const first = deferred();
  const second = deferred();
  FakeAudio.playQueue = [() => first.promise, () => second.promise];

  function Harness() {
    const audio = useContext(AudioContext);
    return (
      <>
        <button
          onClick={() =>
            void audio.playTrack('Artist A', 'Song A', 'preview-a', 'a')
          }>
          A
        </button>
        <button
          onClick={() =>
            void audio.playTrack('Artist B', 'Song B', 'preview-b', 'b')
          }>
          B
        </button>
        <output>{audio.currentTrack?.song ?? 'none'}</output>
      </>
    );
  }

  render(
    <AudioProvider>
      <Harness />
    </AudioProvider>,
  );
  fireEvent.click(screen.getByRole('button', {name: 'A'}));
  fireEvent.click(screen.getByRole('button', {name: 'B'}));
  expect(screen.getByText('Song B')).toBeInTheDocument();

  await act(async () => second.resolve());
  await act(async () => first.resolve());
  expect(screen.getByText('Song B')).toBeInTheDocument();
  expect(FakeAudio.instances.at(-1)?.src).toBe('preview-b');
});

it('keeps Spotify looping by default while allowing finite provider previews', async () => {
  function Harness() {
    const audio = useContext(AudioContext);
    return (
      <>
        <button
          onClick={() => void audio.playTrack('Spotify', 'Song', 'spotify')}>
          Spotify
        </button>
        <button
          onClick={() =>
            void audio.playTrack(
              'Apple',
              'Song',
              'apple',
              undefined,
              undefined,
              {
                loop: false,
              },
            )
          }>
          Apple
        </button>
      </>
    );
  }
  render(
    <AudioProvider>
      <Harness />
    </AudioProvider>,
  );

  await act(async () => {
    fireEvent.click(screen.getByRole('button', {name: 'Spotify'}));
  });
  expect(FakeAudio.instances[0].loop).toBe(true);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', {name: 'Apple'}));
  });
  expect(FakeAudio.instances.at(-1)?.loop).toBe(false);
});

it('ignores a lookup that resolves after another song starts', async () => {
  let resolveLookup!: (value: {
    previewUrl: string | null;
    spotifyUrl: string;
  }) => void;
  const slowLookup = new Promise<{
    previewUrl: string | null;
    spotifyUrl: string;
  }>(resolve => {
    resolveLookup = resolve;
  });
  mockUseTrackUrls.mockImplementation(
    artist => async () => (artist === 'Slow Artist' ? slowLookup : null),
  );

  render(
    <AudioProvider>
      <SpotifyPreviewButton artist="Slow Artist" song="Slow Song" compact />
      <SpotifyPreviewButton
        artist="Fast Artist"
        song="Fast Song"
        previewUrl="https://preview.test/fast.mp3"
        spotifyUrl="https://open.spotify.com/track/fast"
        compact
      />
    </AudioProvider>,
  );
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Play preview of Slow Song by Slow Artist',
    }),
  );
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Play preview of Fast Song by Fast Artist',
    }),
  );
  expect(
    await screen.findByRole('button', {
      name: 'Stop preview of Fast Song by Fast Artist',
    }),
  ).toBeInTheDocument();

  await act(async () =>
    resolveLookup({
      previewUrl: 'https://preview.test/slow.mp3',
      spotifyUrl: 'https://open.spotify.com/track/slow',
    }),
  );

  expect(FakeAudio.instances.at(-1)?.src).toBe('https://preview.test/fast.mp3');
  expect(
    screen.getByRole('button', {
      name: 'Stop preview of Fast Song by Fast Artist',
    }),
  ).toBeInTheDocument();
});

it('offers a real retry after a Spotify lookup failure', async () => {
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  const lookup = jest
    .fn()
    .mockRejectedValueOnce(new Error('temporary failure'))
    .mockResolvedValueOnce({
      previewUrl: 'https://preview.test/retry.mp3',
      spotifyUrl: 'https://open.spotify.com/track/retry',
    });
  mockUseTrackUrls.mockImplementation(() => lookup);

  render(
    <AudioProvider>
      <SpotifyPreviewButton artist="Retry Artist" song="Retry Song" compact />
    </AudioProvider>,
  );
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Play preview of Retry Song by Retry Artist',
    }),
  );
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Retry preview of Retry Song by Retry Artist',
    }),
  );

  expect(
    await screen.findByRole('button', {
      name: 'Stop preview of Retry Song by Retry Artist',
    }),
  ).toBeInTheDocument();
  expect(lookup).toHaveBeenCalledTimes(2);
  errorSpy.mockRestore();
});

it('replays with one click after a native pause and clears a finished track', async () => {
  render(
    <AudioProvider>
      <SpotifyPreviewButton
        artist="Paused Artist"
        song="Paused Song"
        previewUrl="https://preview.test/paused.mp3"
        spotifyUrl="https://open.spotify.com/track/paused"
        compact
      />
    </AudioProvider>,
  );
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Play preview of Paused Song by Paused Artist',
    }),
  );
  const firstAudio = FakeAudio.instances[0];
  await screen.findByRole('button', {
    name: 'Stop preview of Paused Song by Paused Artist',
  });

  act(() => firstAudio.emit('pause'));
  const playAgain = screen.getByRole('button', {
    name: 'Play preview of Paused Song by Paused Artist',
  });
  fireEvent.click(playAgain);

  expect(
    await screen.findByRole('button', {
      name: 'Stop preview of Paused Song by Paused Artist',
    }),
  ).toBeInTheDocument();
  expect(FakeAudio.instances).toHaveLength(2);

  act(() => FakeAudio.instances[1].emit('ended'));
  expect(
    screen.getByRole('button', {
      name: 'Play preview of Paused Song by Paused Artist',
    }),
  ).toBeInTheDocument();
});

it('resets a reused legacy table cell when its song props change', async () => {
  const view = render(
    <AudioProvider>
      <SpotifyPreviewButton
        artist="Old Artist"
        song="Old Song"
        previewUrl="https://preview.test/old.mp3"
        spotifyUrl="https://open.spotify.com/track/old"
        compact
      />
    </AudioProvider>,
  );

  view.rerender(
    <AudioProvider>
      <SpotifyPreviewButton
        artist="New Artist"
        song="New Song"
        previewUrl="https://preview.test/new.mp3"
        spotifyUrl="https://open.spotify.com/track/new"
        compact
      />
    </AudioProvider>,
  );
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Play preview of New Song by New Artist',
    }),
  );

  await screen.findByRole('button', {
    name: 'Stop preview of New Song by New Artist',
  });
  expect(FakeAudio.instances.at(-1)?.src).toBe('https://preview.test/new.mp3');
});

it('recovers when the browser rejects playback', async () => {
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  FakeAudio.playQueue = [
    () => Promise.reject(new Error('autoplay denied')),
    () => Promise.resolve(),
  ];
  render(
    <AudioProvider>
      <SpotifyPreviewButton
        artist="Blocked Artist"
        song="Blocked Song"
        previewUrl="https://preview.test/blocked.mp3"
        spotifyUrl="https://open.spotify.com/track/blocked"
        compact
      />
    </AudioProvider>,
  );

  fireEvent.click(
    screen.getByRole('button', {
      name: 'Play preview of Blocked Song by Blocked Artist',
    }),
  );
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Retry preview of Blocked Song by Blocked Artist',
    }),
  );
  expect(
    await screen.findByRole('button', {
      name: 'Stop preview of Blocked Song by Blocked Artist',
    }),
  ).toBeInTheDocument();
  errorSpy.mockRestore();
});

it('cannot start playback after a pending lookup unmounts', async () => {
  let resolveLookup!: (value: {
    previewUrl: string | null;
    spotifyUrl: string;
  }) => void;
  mockUseTrackUrls.mockImplementation(
    () => () =>
      new Promise(resolve => {
        resolveLookup = resolve;
      }),
  );
  const view = render(
    <AudioProvider>
      <SpotifyPreviewButton artist="Gone Artist" song="Gone Song" compact />
    </AudioProvider>,
  );
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Play preview of Gone Song by Gone Artist',
    }),
  );
  view.unmount();
  await act(async () =>
    resolveLookup({
      previewUrl: 'https://preview.test/gone.mp3',
      spotifyUrl: 'https://open.spotify.com/track/gone',
    }),
  );
  expect(FakeAudio.instances).toHaveLength(0);
});

it('shows a known compact Spotify destination while still looking up its preview', async () => {
  const lookup = jest.fn(async () => ({
    previewUrl: 'https://preview.test/known.mp3',
    spotifyUrl: 'https://open.spotify.com/track/known',
  }));
  mockUseTrackUrls.mockImplementation(() => lookup);
  render(
    <AudioProvider>
      <SpotifyPreviewButton
        artist="Known Artist"
        song="Known Song"
        spotifyUrl="https://open.spotify.com/track/known"
        compact
      />
    </AudioProvider>,
  );

  expect(
    screen.getByRole('link', {
      name: 'Open Known Song by Known Artist in Spotify',
    }),
  ).toHaveAttribute('href', 'https://open.spotify.com/track/known');
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Play preview of Known Song by Known Artist',
    }),
  );
  expect(
    await screen.findByRole('button', {
      name: 'Stop preview of Known Song by Known Artist',
    }),
  ).toBeInTheDocument();
  expect(lookup).toHaveBeenCalledTimes(1);
});

it('shows the compact Spotify destination when a track has no preview clip', async () => {
  mockUseTrackUrls.mockImplementation(() => async () => ({
    previewUrl: null,
    spotifyUrl: 'https://open.spotify.com/track/no-preview',
  }));
  render(
    <AudioProvider>
      <SpotifyPreviewButton artist="Quiet Artist" song="Quiet Song" compact />
    </AudioProvider>,
  );
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Play preview of Quiet Song by Quiet Artist',
    }),
  );

  expect(
    await screen.findByRole('button', {
      name: 'No preview preview of Quiet Song by Quiet Artist',
    }),
  ).toBeDisabled();
  expect(
    screen.getByRole('link', {
      name: 'Open Quiet Song by Quiet Artist in Spotify',
    }),
  ).toHaveAttribute('href', 'https://open.spotify.com/track/no-preview');
});
