export type MusicPreviewProvider = 'spotify' | 'appleMusic';

export type SpotifyPreviewAction = {
  trackId?: string | null;
  url?: string | null;
  artist: string;
  song: string;
};

export type AppleMusicPreviewAction = {
  catalogId?: string | null;
  artist: string;
  song: string;
};

type ExactSpotifyPreviewAction = SpotifyPreviewAction & {trackId: string};
type ExactAppleMusicPreviewAction = AppleMusicPreviewAction & {
  catalogId: string;
};

export type MusicPreviewCandidate =
  | {
      provider: 'spotify';
      kind: 'exact';
      action: ExactSpotifyPreviewAction;
    }
  | {provider: 'spotify'; kind: 'search'}
  | {
      provider: 'appleMusic';
      kind: 'exact';
      action: ExactAppleMusicPreviewAction;
    }
  | {provider: 'appleMusic'; kind: 'search'};

export type MusicPreviewPolicy = {
  providers: readonly MusicPreviewProvider[];
  candidates: readonly MusicPreviewCandidate[];
  initialProvider: MusicPreviewProvider;
  initialUrl: string | null;
};

function hasSpotifyTrackId(
  action: SpotifyPreviewAction,
): action is ExactSpotifyPreviewAction {
  return Boolean(action.trackId?.trim());
}

function hasAppleMusicCatalogId(
  action: AppleMusicPreviewAction,
): action is ExactAppleMusicPreviewAction {
  return Boolean(action.catalogId?.trim());
}

export function createMusicPreviewPolicy({
  preferredProvider,
  spotifyEnabled,
  appleMusicEnabled,
  spotifyActions,
  appleMusicActions,
}: {
  preferredProvider: MusicPreviewProvider;
  spotifyEnabled: boolean;
  appleMusicEnabled: boolean;
  spotifyActions: readonly SpotifyPreviewAction[];
  appleMusicActions: readonly AppleMusicPreviewAction[];
}): MusicPreviewPolicy {
  const providers: MusicPreviewProvider[] = [];
  if (spotifyEnabled) providers.push('spotify');
  if (appleMusicEnabled) providers.push('appleMusic');
  providers.sort(provider => (provider === preferredProvider ? -1 : 1));

  const candidates = providers.flatMap<MusicPreviewCandidate>(provider => {
    if (provider === 'spotify') {
      return [
        ...spotifyActions
          .filter(hasSpotifyTrackId)
          .map(action => ({provider, kind: 'exact', action}) as const),
        {provider, kind: 'search'} as const,
      ];
    }

    return [
      ...appleMusicActions
        .filter(hasAppleMusicCatalogId)
        .map(action => ({provider, kind: 'exact', action}) as const),
      {provider, kind: 'search'} as const,
    ];
  });
  const initialProvider = providers[0] ?? preferredProvider;

  return {
    providers,
    candidates,
    initialProvider,
    initialUrl:
      initialProvider === 'spotify' ? (spotifyActions[0]?.url ?? null) : null,
  };
}
