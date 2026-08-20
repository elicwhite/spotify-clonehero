'use client';

import {
  AlertCircle,
  Check,
  ExternalLink,
  FolderOpen,
  History,
  LoaderCircle,
  MoreHorizontal,
  Music2,
  Radio,
  RefreshCw,
  Sparkles,
} from 'lucide-react';

import AppleMusicIcon from '@/components/AppleMusicIcon';
import SpotifyIcon from '@/components/SpotifyIcon';
import {Eyebrow} from '@/components/landing/Eyebrow';
import {TrustLine} from '@/components/landing/TrustLine';
import {Button} from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {Progress} from '@/components/ui/progress';
import {cn} from '@/lib/utils';

import type {CardOverflowAction, SourceStatus} from './types';

export interface FindMusicWelcomeProps {
  authenticated: boolean;
  hasSpotify: boolean;
  appleMusicConnected: boolean;
  canDisconnectAppleMusic: boolean;
  historyStatus: SourceStatus;
  spotifyLibraryStatus: SourceStatus;
  appleMusicStatus: SourceStatus;
  localStatus: SourceStatus;
  chorusStatus: SourceStatus;
  onConnectSpotify: () => void;
  onConnectAppleMusic: () => void;
  onDisconnectAppleMusic: () => void;
  onRefreshHistory: () => void;
  onRefreshSpotifyLibrary: () => void;
  onRefreshAppleMusic: () => void;
  onScanLocal: () => void;
  onPickLocalFolder: () => void;
  onRefreshChorus: () => void;
}

type SetupCardProps = {
  name: string;
  description: React.ReactNode;
  icon: React.ReactNode;
  status: SourceStatus;
  actionLabel: string;
  onAction: () => void;
  overflowAction?: CardOverflowAction | undefined;
  /** True when `icon` is Spotify or Apple Music artwork. */
  brandArtwork?: boolean;
  optional?: boolean;
};

function StatusDot({phase}: {phase: SourceStatus['phase']}) {
  return (
    <span
      className={cn(
        'mt-1.5 h-2 w-2 shrink-0 rounded-full bg-muted-foreground/40',
        phase === 'ready' && 'bg-emerald-600 dark:bg-emerald-400',
        phase === 'loading' && 'animate-pulse bg-amber-500',
        phase === 'error' && 'bg-destructive',
      )}
      aria-hidden="true"
    />
  );
}

function statusLabel(status: SourceStatus) {
  switch (status.phase) {
    case 'ready':
      return 'Ready';
    case 'loading':
      return 'Working';
    case 'error':
      return 'Needs attention';
    default:
      return 'Not connected';
  }
}

function SetupCard({
  name,
  description,
  icon,
  status,
  actionLabel,
  onAction,
  overflowAction,
  brandArtwork = false,
  optional = false,
}: SetupCardProps) {
  const loading = status.phase === 'loading';
  const error = status.phase === 'error';

  return (
    <article
      className={cn(
        'flex flex-col rounded-xl border bg-card p-5 text-card-foreground shadow-sm',
        optional && 'border-dashed shadow-none',
        error && 'border-destructive/50',
      )}
      data-testid={`welcome-${name.toLowerCase().replaceAll(' ', '-')}`}>
      <div className={cn('flex items-start gap-3', brandArtwork && 'gap-4')}>
        <span
          className={cn(
            'grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary [&_svg]:h-5 [&_svg]:w-5',
            // Service marks keep their own shape and colors, so they get no
            // tile behind them. 32px on `bg-card` with the card's own 20px
            // padding and the 16px gap below is the same treatment the home
            // page gives them.
            brandArtwork && 'h-8 w-8 bg-transparent [&_svg]:h-8 [&_svg]:w-8',
          )}>
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="font-semibold tracking-tight">{name}</h3>
            {optional ? (
              <span className="rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                Optional
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-sm leading-5 text-muted-foreground">
            {description}
          </p>
        </div>
      </div>

      <div className="mt-5">
        <div className="flex items-start gap-2 text-sm">
          <StatusDot phase={status.phase} />
          <div className="min-w-0">
            <p
              className={cn(
                'leading-5 text-muted-foreground',
                error && 'text-destructive',
              )}
              role={error ? 'alert' : loading ? 'status' : undefined}>
              {status.summary}
            </p>
            {status.detail ? (
              <p className="mt-0.5 text-xs leading-4 text-muted-foreground">
                {status.detail}
              </p>
            ) : null}
          </div>
        </div>

        {loading && status.progress !== undefined ? (
          <Progress
            value={status.progress}
            className="mt-3 h-1.5"
            aria-label={`${name} progress`}
          />
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant={error ? 'outline' : 'default'}
            onClick={onAction}
            disabled={loading}
            aria-label={loading ? `${name} is working` : actionLabel}>
            {loading ? <LoaderCircle className="animate-spin" /> : null}
            {error ? <RefreshCw className="h-3.5 w-3.5" /> : null}
            {loading ? 'Working…' : actionLabel}
          </Button>
          {overflowAction ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="w-9 px-0"
                  aria-label={`${name} actions`}>
                  <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  destructive={overflowAction.tone === 'destructive'}
                  onSelect={overflowAction.onSelect}>
                  {overflowAction.label}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function OutcomePanel({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <article className="rounded-xl border bg-card p-5 text-card-foreground">
      <span className="grid h-9 w-9 place-items-center rounded-lg bg-secondary text-secondary-foreground [&_svg]:h-[18px] [&_svg]:w-[18px]">
        {icon}
      </span>
      <h3 className="mt-4 font-semibold tracking-tight">{title}</h3>
      <p className="mt-1.5 text-sm leading-5 text-muted-foreground">
        {children}
      </p>
    </article>
  );
}

export default function FindMusicWelcome({
  authenticated,
  hasSpotify,
  appleMusicConnected,
  canDisconnectAppleMusic,
  historyStatus,
  spotifyLibraryStatus,
  appleMusicStatus,
  localStatus,
  chorusStatus,
  onConnectSpotify,
  onConnectAppleMusic,
  onDisconnectAppleMusic,
  onRefreshHistory,
  onRefreshSpotifyLibrary,
  onRefreshAppleMusic,
  onScanLocal,
  onPickLocalFolder,
  onRefreshChorus,
}: FindMusicWelcomeProps) {
  const spotifyConnected = authenticated && hasSpotify;
  const spotifyLibraryAction = spotifyConnected
    ? spotifyLibraryStatus.phase === 'idle'
      ? 'Load library'
      : spotifyLibraryStatus.phase === 'error'
        ? 'Try again'
        : 'Refresh library'
    : authenticated
      ? 'Connect Spotify'
      : 'Sign in with Spotify';
  const appleMusicAction = !appleMusicConnected
    ? 'Connect Apple Music'
    : appleMusicStatus.phase === 'error'
      ? 'Try again'
      : 'Refresh';

  const historyAction =
    historyStatus.phase === 'idle'
      ? 'Choose history folder'
      : historyStatus.phase === 'error'
        ? 'Try again'
        : 'Refresh history';
  const localAction =
    localStatus.phase === 'idle'
      ? 'Choose Songs folder'
      : localStatus.phase === 'error'
        ? 'Try again'
        : 'Rescan folder';

  return (
    <section
      className="min-h-0 flex-1 overflow-y-auto bg-background"
      aria-labelledby="find-music-welcome-title"
      data-testid="find-music-welcome">
      <div className="mx-auto w-full max-w-5xl px-4 py-7 sm:px-6 sm:py-10 lg:px-8">
        {/* Trust signals are stated, not decorated: no badge graphics, no
            shield icons (docs/landing-page-style-guide.md §7). The label uses
            the site's plain Eyebrow and the fact below sits in a TrustLine,
            the same treatment the tool landing pages give their own. */}
        <header className="max-w-2xl">
          <Eyebrow>Local and private</Eyebrow>
          <h2
            id="find-music-welcome-title"
            className="mt-4 text-2xl font-semibold tracking-tight sm:text-3xl">
            Bring in the music you already care about
          </h2>
          <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground sm:text-base">
            Add a little music you already know. We match it with Chorus right
            here in your browser. Imported history and the matching index stay
            in this browser; connected-service requests go directly to the music
            provider.
          </p>
          <TrustLine
            className="mt-4"
            items={[
              <>
                Your folders are read locally and saved in this browser&apos;s
                private music index.
              </>,
            ]}
          />
        </header>

        <section className="mt-8" aria-labelledby="start-with-music-heading">
          <div className="mb-4">
            <h3
              id="start-with-music-heading"
              className="text-sm font-semibold tracking-tight">
              Start with your music
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Connect either source, or both, for better matches.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <SetupCard
              name="Spotify Library"
              description="Match songs from your playlists, liked albums, and saved music."
              icon={<SpotifyIcon />}
              brandArtwork
              status={spotifyLibraryStatus}
              actionLabel={spotifyLibraryAction}
              onAction={
                spotifyConnected ? onRefreshSpotifyLibrary : onConnectSpotify
              }
            />
            <SetupCard
              name="Apple Music"
              description="Connect in this browser to match saved songs. It works without a site account, does not sign you in to this site, and keeps its library index browser-local."
              icon={<AppleMusicIcon className="h-8 w-8" />}
              brandArtwork
              status={appleMusicStatus}
              actionLabel={appleMusicAction}
              onAction={
                appleMusicConnected ? onRefreshAppleMusic : onConnectAppleMusic
              }
              overflowAction={
                canDisconnectAppleMusic
                  ? {
                      label: 'Disconnect and clear',
                      onSelect: onDisconnectAppleMusic,
                      tone: 'destructive',
                    }
                  : undefined
              }
            />
            <SetupCard
              name="Spotify History"
              description={
                <>
                  Import your{' '}
                  <a
                    href="https://www.spotify.com/us/account/privacy/"
                    target="_blank"
                    rel="noreferrer"
                    title="Request your Spotify Extended Streaming History"
                    aria-label="Request your Spotify Extended Streaming History"
                    className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline">
                    Spotify Extended Streaming History
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  </a>{' '}
                  to surface songs you listen to.
                </>
              }
              icon={<History />}
              status={historyStatus}
              actionLabel={historyAction}
              onAction={onRefreshHistory}
            />
          </div>
        </section>

        <section className="mt-5" aria-labelledby="local-songs-folder-heading">
          <div className="mb-3">
            <h3
              id="local-songs-folder-heading"
              className="text-sm font-semibold tracking-tight">
              Already have charts?
            </h3>
          </div>
          <SetupCard
            name="Local Songs Folder"
            description="Choose your Clone Hero or YARG Songs folder to install charts directly and filter out songs you already have."
            icon={<FolderOpen />}
            status={localStatus}
            actionLabel={localAction}
            onAction={onScanLocal}
            // The folder name is not shown: the File System Access API gives
            // no path, and a bare folder name does not say which folder it is.
            overflowAction={
              localStatus.phase === 'idle'
                ? undefined
                : {
                    label: 'Choose a different folder…',
                    onSelect: onPickLocalFolder,
                  }
            }
            optional
          />
        </section>

        <section className="mt-8" aria-labelledby="what-you-get-heading">
          <div className="mb-4">
            <h3
              id="what-you-get-heading"
              className="text-sm font-semibold tracking-tight">
              What you&apos;ll get
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Your sources become useful, practical ways to browse Chorus.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <OutcomePanel icon={<Music2 />} title="Your music">
              Charts matched directly to songs in your library or listening
              history, with the evidence that brought each one here.
            </OutcomePanel>
            <OutcomePanel icon={<Radio />} title="Recommendations">
              Chorus charts selected from the artists and songs you listen to,
              ready for when you want something adjacent and new.
            </OutcomePanel>
          </div>
        </section>

        <section
          className="mt-8 rounded-xl border bg-card p-4 text-card-foreground sm:flex sm:items-center sm:gap-4"
          aria-labelledby="chorus-index-heading">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
            {chorusStatus.phase === 'loading' ? (
              <LoaderCircle className="h-[18px] w-[18px] animate-spin" />
            ) : chorusStatus.phase === 'error' ? (
              <AlertCircle className="h-[18px] w-[18px] text-destructive" />
            ) : chorusStatus.phase === 'ready' ? (
              <Check className="h-[18px] w-[18px]" />
            ) : (
              <Sparkles className="h-[18px] w-[18px]" />
            )}
          </span>
          <div className="mt-3 min-w-0 flex-1 sm:mt-0">
            <div className="flex items-center gap-2">
              <h3 id="chorus-index-heading" className="text-sm font-semibold">
                Chorus Chart Index
              </h3>
              <span className="text-xs text-muted-foreground">
                {statusLabel(chorusStatus)}
              </span>
            </div>
            <p
              className={cn(
                'mt-0.5 text-sm text-muted-foreground',
                chorusStatus.phase === 'error' && 'text-destructive',
              )}
              role={chorusStatus.phase === 'error' ? 'alert' : undefined}>
              {chorusStatus.summary}
              {chorusStatus.detail ? ` · ${chorusStatus.detail}` : ''}
            </p>
            {chorusStatus.phase === 'loading' &&
            chorusStatus.progress !== undefined ? (
              <Progress
                value={chorusStatus.progress}
                className="mt-3 h-1.5 max-w-md"
                aria-label="Chorus index progress"
              />
            ) : null}
          </div>
          {chorusStatus.phase === 'error' ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-4 sm:mt-0"
              onClick={onRefreshChorus}>
              <RefreshCw className="h-3.5 w-3.5" />
              Retry index
            </Button>
          ) : null}
        </section>
      </div>
    </section>
  );
}
