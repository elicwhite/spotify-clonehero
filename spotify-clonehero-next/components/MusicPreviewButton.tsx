'use client';

import {ExternalLink, LoaderCircle} from 'lucide-react';

import AppleMusicIcon from '@/components/AppleMusicIcon';
import {Button} from '@/components/ui/button';
import type {AppleMusicLibraryClient} from '@/lib/apple-music';
import {cn} from '@/lib/utils';

import {Icons} from './icons';
import {
  musicPreviewControllerIdentity,
  useMusicPreviewController,
} from './music-preview/useMusicPreviewController';

export type {
  AppleMusicPreviewAction,
  MusicPreviewProvider,
  SpotifyPreviewAction,
} from './music-preview/policy';
import type {
  AppleMusicPreviewAction,
  MusicPreviewProvider,
  SpotifyPreviewAction,
} from './music-preview/policy';

export type MusicPreviewButtonProps = {
  artist: string;
  song: string;
  trackKey?: string;
  preferredProvider?: MusicPreviewProvider | undefined;
  spotifyEnabled?: boolean;
  spotifyActions?: readonly SpotifyPreviewAction[];
  appleMusicClient?: AppleMusicLibraryClient | null;
  appleMusicActions?: readonly AppleMusicPreviewAction[];
  compact?: boolean;
};

export default function MusicPreviewButton(props: MusicPreviewButtonProps) {
  return (
    <MusicPreviewButtonForTrack
      key={musicPreviewControllerIdentity(props)}
      {...props}
    />
  );
}

function MusicPreviewButtonForTrack({
  artist,
  song,
  trackKey,
  preferredProvider = 'spotify',
  spotifyEnabled = false,
  spotifyActions = [],
  appleMusicClient = null,
  appleMusicActions = [],
  compact = false,
}: MusicPreviewButtonProps) {
  const controller = useMusicPreviewController({
    artist,
    song,
    ...(trackKey === undefined ? {} : {trackKey}),
    preferredProvider,
    spotifyEnabled,
    spotifyActions,
    appleMusicClient,
    appleMusicActions,
  });
  const lookingUp =
    controller.phase === 'loading' && !controller.thisTrackLoading;
  const unavailable =
    controller.phase === 'unavailable' || controller.phase === 'no-match';
  const label = controller.thisTrackPlaying
    ? 'Stop'
    : controller.thisTrackLoading
      ? 'Stop'
      : lookingUp
        ? 'Loading'
        : controller.phase === 'error'
          ? 'Retry'
          : controller.phase === 'no-match'
            ? 'No match'
            : controller.phase === 'unavailable'
              ? 'No preview'
              : 'Play';
  const providerName =
    controller.destinationProvider === 'spotify' ? 'Spotify' : 'Apple Music';

  return (
    <div className={cn('flex items-center gap-2', compact && 'justify-center')}>
      <Button
        type="button"
        size={compact ? 'xs' : 'default'}
        variant={controller.thisTrackPlaying ? 'secondary' : 'default'}
        className={cn(compact && 'w-[96px] px-2')}
        onClick={() => void controller.start()}
        disabled={lookingUp || unavailable || controller.providerCount === 0}
        aria-pressed={
          controller.thisTrackPlaying || controller.thisTrackLoading
        }
        aria-label={`${label} preview of ${song} by ${artist}`}>
        {lookingUp || controller.thisTrackLoading ? (
          <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
        ) : controller.displayProvider === 'spotify' ? (
          <Icons.spotify className="h-3.5 w-3.5" />
        ) : (
          <AppleMusicIcon className="h-3.5 w-3.5" />
        )}
        {label}
      </Button>
      {controller.destinationUrl ? (
        <Button
          size="icon"
          variant="outline"
          className={cn(compact && 'h-7 w-7 shrink-0')}
          asChild>
          <a
            href={controller.destinationUrl}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open ${song} by ${artist} in ${providerName}`}>
            <ExternalLink className={cn('h-4 w-4', compact && 'h-3.5 w-3.5')} />
          </a>
        </Button>
      ) : null}
    </div>
  );
}
