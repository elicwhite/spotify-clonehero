'use client';

import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {ExternalLink, LoaderCircle} from 'lucide-react';
import {toast} from 'sonner';

import {AudioContext} from '@/app/AudioProvider';
import {Button} from '@/components/ui/button';
import {useTrackUrls} from '@/lib/spotify-sdk/SpotifyFetching';
import {cn} from '@/lib/utils';

import {Icons} from './icons';

type TrackUrls = {previewUrl: string | null; spotifyUrl: string};
type Phase = 'idle' | 'loading' | 'ready' | 'unavailable' | 'error';
type SpotifyPreviewButtonProps = {
  artist: string;
  song: string;
  trackKey?: string;
  previewUrl?: string | null;
  spotifyUrl?: string | null;
  compact?: boolean;
};

// Spotify preview URLs are stable enough to reuse for the page session. The
// promise cache also deduplicates double clicks and survives virtual-row
// unmount/remount. Failed requests are removed so Retry performs a real lookup.
const lookupCache = new Map<string, Promise<TrackUrls | null>>();

function cachedLookup(
  key: string,
  lookup: () => Promise<TrackUrls | null>,
): Promise<TrackUrls | null> {
  const existing = lookupCache.get(key);
  if (existing) return existing;
  const pending = lookup()
    .then(value => {
      if (!value) lookupCache.delete(key);
      return value;
    })
    .catch(error => {
      lookupCache.delete(key);
      throw error;
    });
  lookupCache.set(key, pending);
  return pending;
}

export default function SpotifyPreviewButton(props: SpotifyPreviewButtonProps) {
  const identity = [
    props.trackKey ?? '',
    props.artist.toLocaleLowerCase(),
    props.song.toLocaleLowerCase(),
    props.previewUrl ?? '',
    props.spotifyUrl ?? '',
  ].join('\u001f');
  return <SpotifyPreviewButtonForTrack key={identity} {...props} />;
}

function SpotifyPreviewButtonForTrack({
  artist,
  song,
  trackKey,
  previewUrl,
  spotifyUrl,
  compact = false,
}: SpotifyPreviewButtonProps) {
  const lookup = useTrackUrls(artist, song);
  const cacheKey = `${artist.toLocaleLowerCase()}\u001f${song.toLocaleLowerCase()}`;
  const initialResult = useMemo<TrackUrls | null>(
    () =>
      spotifyUrl && previewUrl !== undefined ? {previewUrl, spotifyUrl} : null,
    [previewUrl, spotifyUrl],
  );
  const [result, setResult] = useState<TrackUrls | null>(initialResult);
  const [phase, setPhase] = useState<Phase>(
    initialResult
      ? initialResult.previewUrl
        ? 'ready'
        : 'unavailable'
      : 'idle',
  );
  const mountedRef = useRef(true);
  const localRequestRef = useRef(0);
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
    };
  }, []);

  const thisTrack = currentTrack
    ? currentTrack.key && trackKey
      ? currentTrack.key === trackKey
      : currentTrack.artist === artist && currentTrack.song === song
    : false;
  const thisTrackPlaying = thisTrack && isPlaying;
  const thisTrackLoading = thisTrack && isLoading;

  const start = useCallback(async () => {
    if (thisTrack && (isPlaying || isLoading)) {
      localRequestRef.current += 1;
      pause();
      return;
    }

    const localRequest = ++localRequestRef.current;
    const playbackRequest = beginTrackRequest();
    setPhase('loading');

    try {
      const urls = result ?? (await cachedLookup(cacheKey, lookup));
      if (
        !mountedRef.current ||
        localRequest !== localRequestRef.current ||
        !isTrackRequestCurrent(playbackRequest)
      ) {
        return;
      }
      if (!urls) {
        setPhase('error');
        return;
      }

      setResult(urls);
      if (!urls.previewUrl) {
        setPhase('unavailable');
        return;
      }

      await playTrack(artist, song, urls.previewUrl, trackKey, playbackRequest);
      if (mountedRef.current && localRequest === localRequestRef.current) {
        setPhase('ready');
      }
    } catch (error) {
      if (
        mountedRef.current &&
        localRequest === localRequestRef.current &&
        isTrackRequestCurrent(playbackRequest)
      ) {
        setPhase('error');
        toast.error('Could not play this Spotify preview');
      }
      console.error('Spotify preview failed', error);
    }
  }, [
    artist,
    beginTrackRequest,
    cacheKey,
    isTrackRequestCurrent,
    isLoading,
    isPlaying,
    lookup,
    pause,
    playTrack,
    result,
    song,
    thisTrack,
    trackKey,
  ]);

  const lookingUp = phase === 'loading' && !thisTrack;
  const unavailable = phase === 'unavailable';
  const destinationUrl = result?.spotifyUrl ?? spotifyUrl;
  const label = thisTrackPlaying
    ? 'Stop'
    : thisTrackLoading
      ? 'Stop'
      : lookingUp
        ? 'Loading'
        : phase === 'error'
          ? 'Retry'
          : unavailable
            ? 'No preview'
            : 'Play';

  return (
    <div className={cn('flex items-center gap-2', compact && 'justify-center')}>
      <Button
        type="button"
        size={compact ? 'xs' : 'default'}
        variant={thisTrackPlaying ? 'secondary' : 'default'}
        className={cn(compact && 'w-[96px] px-2')}
        onClick={() => void start()}
        disabled={lookingUp || unavailable}
        aria-pressed={thisTrackPlaying || thisTrackLoading}
        aria-label={`${label} preview of ${song} by ${artist}`}>
        {lookingUp || thisTrackLoading ? (
          <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Icons.spotify className="h-3.5 w-3.5" />
        )}
        {label}
      </Button>
      {destinationUrl ? (
        <Button
          size="icon"
          variant="outline"
          className={cn(compact && 'h-7 w-7 shrink-0')}
          asChild>
          <a
            href={destinationUrl}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open ${song} by ${artist} in Spotify`}>
            <ExternalLink className={cn('h-4 w-4', compact && 'h-3.5 w-3.5')} />
          </a>
        </Button>
      ) : null}
    </div>
  );
}
