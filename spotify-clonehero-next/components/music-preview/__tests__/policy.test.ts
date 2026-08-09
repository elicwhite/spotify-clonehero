import {
  createMusicPreviewPolicy,
  type AppleMusicPreviewAction,
  type SpotifyPreviewAction,
} from '../policy';

const spotifyActions: SpotifyPreviewAction[] = [
  {
    trackId: 'spotify-exact',
    url: 'https://open.spotify.com/track/spotify-exact',
    artist: 'Exact Artist',
    song: 'Exact Song',
  },
  {
    url: 'https://open.spotify.com/track/link-only',
    artist: 'Link Artist',
    song: 'Link Song',
  },
];

const appleMusicActions: AppleMusicPreviewAction[] = [
  {catalogId: 'apple-one', artist: 'Apple Artist', song: 'Apple Song'},
  {catalogId: 'apple-two', artist: 'Apple Artist', song: 'Apple Song'},
  {artist: 'Search Artist', song: 'Search Song'},
];

it('orders all exact candidates before search and then falls back to the other provider', () => {
  const policy = createMusicPreviewPolicy({
    preferredProvider: 'appleMusic',
    spotifyEnabled: true,
    appleMusicEnabled: true,
    spotifyActions,
    appleMusicActions,
  });

  expect(policy.providers).toEqual(['appleMusic', 'spotify']);
  expect(policy.candidates).toEqual([
    {
      provider: 'appleMusic',
      kind: 'exact',
      action: appleMusicActions[0],
    },
    {
      provider: 'appleMusic',
      kind: 'exact',
      action: appleMusicActions[1],
    },
    {provider: 'appleMusic', kind: 'search'},
    {provider: 'spotify', kind: 'exact', action: spotifyActions[0]},
    {provider: 'spotify', kind: 'search'},
  ]);
});

it('uses the available provider when the preference is unavailable', () => {
  const policy = createMusicPreviewPolicy({
    preferredProvider: 'appleMusic',
    spotifyEnabled: true,
    appleMusicEnabled: false,
    spotifyActions,
    appleMusicActions,
  });

  expect(policy.providers).toEqual(['spotify']);
  expect(policy.initialProvider).toBe('spotify');
  expect(policy.initialUrl).toBe(
    'https://open.spotify.com/track/spotify-exact',
  );
});

it('keeps a Spotify link-only action for initial link-out but not exact lookup', () => {
  const policy = createMusicPreviewPolicy({
    preferredProvider: 'spotify',
    spotifyEnabled: true,
    appleMusicEnabled: false,
    spotifyActions: [spotifyActions[1]!],
    appleMusicActions: [],
  });

  expect(policy.initialUrl).toBe('https://open.spotify.com/track/link-only');
  expect(policy.candidates).toEqual([{provider: 'spotify', kind: 'search'}]);
});

it('retains the preference only as the display default when no provider is enabled', () => {
  const policy = createMusicPreviewPolicy({
    preferredProvider: 'appleMusic',
    spotifyEnabled: false,
    appleMusicEnabled: false,
    spotifyActions,
    appleMusicActions,
  });

  expect(policy).toMatchObject({
    providers: [],
    candidates: [],
    initialProvider: 'appleMusic',
    initialUrl: null,
  });
});
