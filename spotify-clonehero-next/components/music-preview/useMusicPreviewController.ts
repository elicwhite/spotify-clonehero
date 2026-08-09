'use client';

import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {AudioContext} from '@/app/AudioProvider';
import type {AppleMusicLibraryClient} from '@/lib/apple-music';
import {resolveSpotifyTrackUrls} from '@/lib/spotify-sdk/SpotifyFetching';

import {
  createMusicPreviewPolicy,
  type AppleMusicPreviewAction,
  type MusicPreviewCandidate,
  type MusicPreviewProvider,
  type SpotifyPreviewAction,
} from './policy';

export type MusicPreviewPhase =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'unavailable'
  | 'no-match'
  | 'error';

export type ResolvedMusicPreview = {
  provider: MusicPreviewProvider;
  previewUrl: string | null;
  url: string | null;
};

export type MusicPreviewControllerOptions = {
  artist: string;
  song: string;
  trackKey?: string;
  preferredProvider: MusicPreviewProvider;
  spotifyEnabled: boolean;
  spotifyActions: readonly SpotifyPreviewAction[];
  appleMusicClient: AppleMusicLibraryClient | null;
  appleMusicActions: readonly AppleMusicPreviewAction[];
};

const spotifyLookupCache = new Map<
  string,
  Promise<ResolvedMusicPreview | null>
>();

function resolveSpotifyCached(
  artist: string,
  song: string,
  action: SpotifyPreviewAction | null,
) {
  const actionArtist = action?.artist ?? artist;
  const actionSong = action?.song ?? song;
  const key = [
    action?.trackId ?? '',
    actionArtist.toLocaleLowerCase(),
    actionSong.toLocaleLowerCase(),
  ].join('\u001f');
  const cached = spotifyLookupCache.get(key);
  if (cached) return cached;

  const pending = resolveSpotifyTrackUrls({
    trackId: action?.trackId,
    artist: actionArtist,
    song: actionSong,
  })
    .then(result => {
      if (!result) {
        spotifyLookupCache.delete(key);
        return null;
      }
      return {
        provider: 'spotify' as const,
        previewUrl: result.previewUrl,
        url: result.spotifyUrl || action?.url || null,
      };
    })
    .catch(error => {
      spotifyLookupCache.delete(key);
      throw error;
    });
  spotifyLookupCache.set(key, pending);
  return pending;
}

// Spotify lookups cannot currently accept an AbortSignal, so the shared audio
// request generation rejects stale results. Apple lookups can also be aborted.
let activeAppleResolution: AbortController | null = null;
let nextAppleClientId = 1;
const appleClientIds = new WeakMap<AppleMusicLibraryClient, number>();

function appleClientId(client: AppleMusicLibraryClient | null | undefined) {
  if (!client) return 'none';
  const existing = appleClientIds.get(client);
  if (existing) return String(existing);
  const id = nextAppleClientId++;
  appleClientIds.set(client, id);
  return String(id);
}

export function musicPreviewControllerIdentity({
  artist,
  song,
  trackKey,
  preferredProvider = 'spotify',
  spotifyEnabled = false,
  spotifyActions = [],
  appleMusicClient = null,
  appleMusicActions = [],
}: {
  artist: string;
  song: string;
  trackKey?: string | undefined;
  preferredProvider?: MusicPreviewProvider | undefined;
  spotifyEnabled?: boolean | undefined;
  spotifyActions?: readonly SpotifyPreviewAction[] | undefined;
  appleMusicClient?: AppleMusicLibraryClient | null | undefined;
  appleMusicActions?: readonly AppleMusicPreviewAction[] | undefined;
}) {
  return [
    trackKey ?? '',
    artist,
    song,
    preferredProvider,
    spotifyEnabled ? 'spotify-on' : 'spotify-off',
    appleClientId(appleMusicClient),
    ...spotifyActions.flatMap(action => [
      action.trackId ?? '',
      action.url ?? '',
      action.artist,
      action.song,
    ]),
    ...appleMusicActions.flatMap(action => [
      action.catalogId ?? '',
      action.artist,
      action.song,
    ]),
  ].join('\u0000');
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError';
}

export function useMusicPreviewController({
  artist,
  song,
  trackKey,
  preferredProvider,
  spotifyEnabled,
  spotifyActions,
  appleMusicClient,
  appleMusicActions,
}: MusicPreviewControllerOptions) {
  const policy = useMemo(
    () =>
      createMusicPreviewPolicy({
        preferredProvider,
        spotifyEnabled,
        appleMusicEnabled: appleMusicClient !== null,
        spotifyActions,
        appleMusicActions,
      }),
    [
      appleMusicActions,
      appleMusicClient,
      preferredProvider,
      spotifyActions,
      spotifyEnabled,
    ],
  );
  const [phase, setPhase] = useState<MusicPreviewPhase>('idle');
  const [result, setResult] = useState<ResolvedMusicPreview | null>(null);
  const [displayProvider, setDisplayProvider] = useState<MusicPreviewProvider>(
    policy.initialProvider,
  );
  const mountedRef = useRef(true);
  const localRequestRef = useRef(0);
  const appleAbortRef = useRef<AbortController | null>(null);
  const {
    isPlaying,
    isLoading,
    currentTrack,
    beginTrackRequest,
    isTrackRequestCurrent,
    playTrack,
    pause,
  } = useContext(AudioContext);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      localRequestRef.current += 1;
      appleAbortRef.current?.abort();
      if (activeAppleResolution === appleAbortRef.current) {
        activeAppleResolution = null;
      }
    };
  }, []);

  const thisTrack = currentTrack
    ? currentTrack.key && trackKey
      ? currentTrack.key === trackKey
      : currentTrack.artist === artist && currentTrack.song === song
    : false;
  const thisTrackPlaying = thisTrack && isPlaying;
  const thisTrackLoading = thisTrack && isLoading;

  const resolveCandidate = useCallback(
    async (
      candidate: MusicPreviewCandidate,
    ): Promise<ResolvedMusicPreview | null> => {
      if (candidate.provider === 'spotify') {
        return resolveSpotifyCached(
          artist,
          song,
          candidate.kind === 'exact' ? candidate.action : null,
        );
      }
      if (!appleMusicClient) return null;

      activeAppleResolution?.abort();
      appleAbortRef.current?.abort();
      const controller = new AbortController();
      appleAbortRef.current = controller;
      activeAppleResolution = controller;
      try {
        const catalogSong =
          candidate.kind === 'exact'
            ? await appleMusicClient.resolveCatalogSong(
                candidate.action.catalogId,
                {signal: controller.signal},
              )
            : await appleMusicClient.searchCatalogSong(
                {artistName: artist, title: song},
                {signal: controller.signal},
              );
        return catalogSong
          ? {
              provider: 'appleMusic',
              previewUrl: catalogSong.previewUrl,
              url: catalogSong.url,
            }
          : null;
      } finally {
        if (appleAbortRef.current === controller) appleAbortRef.current = null;
        if (activeAppleResolution === controller) {
          activeAppleResolution = null;
        }
      }
    },
    [appleMusicClient, artist, song],
  );

  const start = useCallback(async () => {
    if (thisTrack && (isPlaying || isLoading)) {
      localRequestRef.current += 1;
      appleAbortRef.current?.abort();
      pause();
      return;
    }

    const localRequest = ++localRequestRef.current;
    const playbackRequest = beginTrackRequest();
    activeAppleResolution?.abort();
    setPhase('loading');
    let firstResolved: ResolvedMusicPreview | null = null;
    let sawError = false;

    for (const candidate of policy.candidates) {
      try {
        const resolved = await resolveCandidate(candidate);
        if (
          !mountedRef.current ||
          localRequest !== localRequestRef.current ||
          !isTrackRequestCurrent(playbackRequest)
        ) {
          if (mountedRef.current && localRequest === localRequestRef.current) {
            setPhase('idle');
          }
          return;
        }
        if (!resolved) continue;
        firstResolved ??= resolved;
        if (!resolved.previewUrl) continue;

        setDisplayProvider(candidate.provider);
        setResult(resolved);
        await playTrack(
          artist,
          song,
          resolved.previewUrl,
          trackKey,
          playbackRequest,
          {loop: candidate.provider === 'spotify'},
        );
        if (
          mountedRef.current &&
          localRequest === localRequestRef.current &&
          isTrackRequestCurrent(playbackRequest)
        ) {
          setPhase('ready');
        } else if (
          mountedRef.current &&
          localRequest === localRequestRef.current
        ) {
          setPhase('idle');
        }
        return;
      } catch (error) {
        if (isAbortError(error)) {
          if (mountedRef.current && localRequest === localRequestRef.current) {
            setPhase('idle');
          }
          return;
        }
        sawError = true;
      }
    }

    if (
      !mountedRef.current ||
      localRequest !== localRequestRef.current ||
      !isTrackRequestCurrent(playbackRequest)
    ) {
      return;
    }
    setResult(firstResolved);
    if (firstResolved) setDisplayProvider(firstResolved.provider);
    setPhase(sawError ? 'error' : firstResolved ? 'unavailable' : 'no-match');
  }, [
    artist,
    beginTrackRequest,
    isLoading,
    isPlaying,
    isTrackRequestCurrent,
    pause,
    playTrack,
    policy.candidates,
    resolveCandidate,
    song,
    thisTrack,
    trackKey,
  ]);

  return {
    phase,
    displayProvider,
    destinationUrl: result?.url ?? policy.initialUrl,
    destinationProvider: result?.provider ?? policy.initialProvider,
    providerCount: policy.providers.length,
    thisTrackPlaying,
    thisTrackLoading,
    start,
  };
}
