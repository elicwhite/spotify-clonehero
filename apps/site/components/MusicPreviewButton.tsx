'use client';

import {ExternalLink, LoaderCircle} from 'lucide-react';

import AppleMusicIcon from '@/components/AppleMusicIcon';
import SpotifyIcon from '@/components/SpotifyIcon';
import {Button} from '@/components/ui/button';
import type {AppleMusicLibraryClient} from '@/lib/apple-music';
import {cn} from '@/lib/utils';

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
              : 'Preview';
  const providerName =
    controller.destinationProvider === 'spotify' ? 'Spotify' : 'Apple Music';

  return (
    <div className={cn('flex items-center gap-2', compact && 'justify-center')}>
      <Button
        type="button"
        size={compact ? 'sm' : 'default'}
        // Outline, matching the open-in-provider button beside it: Install is
        // the primary action in a row, not Preview. The label and
        // `aria-pressed` carry the playing state.
        variant="outline"
        // The brand icons hold their minimum size, so the compact button keeps
        // the `sm` icon scale and only loses height and width. The `xs` size
        // scales icons down to 12px, which is below the Spotify minimum.
        className={cn(compact && 'h-8 w-[120px] px-2.5 text-[11.5px]')}
        onClick={() => void controller.start()}
        disabled={lookingUp || unavailable || controller.providerCount === 0}
        aria-pressed={
          controller.thisTrackPlaying || controller.thisTrackLoading
        }
        aria-label={
          label === 'Preview'
            ? `Preview ${song} by ${artist}`
            : `${label} preview of ${song} by ${artist}`
        }>
        {lookingUp || controller.thisTrackLoading ? (
          <LoaderCircle className="h-[21px] w-[21px] animate-spin" />
        ) : controller.displayProvider === 'spotify' ? (
          // The green icon is allowed here: the outline fill is the page
          // background, white in light and near-black in dark. 21px is
          // Spotify's floor.
          <SpotifyIcon className="h-[21px] w-[21px]" />
        ) : (
          <AppleMusicIcon className="h-[21px] w-[21px]" />
        )}
        {label}
      </Button>
      {controller.destinationUrl ? (
        <Button
          size="icon"
          // Same height and same fill as the preview button beside it.
          variant="outline"
          className={cn(compact && 'h-8 w-8 shrink-0')}
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
