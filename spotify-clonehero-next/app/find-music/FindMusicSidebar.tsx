'use client';

import {useState} from 'react';
import Link from 'next/link';
import {
  FolderOpen,
  ExternalLink,
  LoaderCircle,
  MoreHorizontal,
  Music2,
  Plus,
  Radio,
  RotateCw,
  Search,
  X,
} from 'lucide-react';

import {Icons} from '@/components/icons';
import AppleMusicIcon from '@/components/AppleMusicIcon';
import {Button} from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {Progress} from '@/components/ui/progress';
import {cn} from '@/lib/utils';

import FindMusicInstrumentIcon from './FindMusicInstrumentIcon';
import {
  INSTRUMENTS,
  type FindMusicFilters,
  type FindMusicView,
  type SourceStatus,
} from './types';
import {FIND_MUSIC_PATH, FIND_MUSIC_RECOMMENDATIONS_PATH} from './routes';

export interface FindMusicSidebarProps {
  variant?: 'responsive' | 'drawer';
  view: FindMusicView;
  onViewChange: (view: FindMusicView) => void;
  filters: FindMusicFilters;
  onFiltersChange: (filters: FindMusicFilters) => void;
  onClearFilters: () => void;
  historyStatus: SourceStatus;
  spotifyLibraryStatus: SourceStatus;
  appleMusicStatus: SourceStatus;
  localStatus: SourceStatus;
  chorusStatus: SourceStatus;
  onRefreshHistory: () => void;
  onRefreshSpotifyLibrary: () => void;
  onRefreshAppleMusic: () => void;
  onScanLocal: () => void;
  onRefreshChorus: () => void;
  onConnectSpotify: () => void;
  onConnectAppleMusic: () => void;
  onDisconnectAppleMusic: () => void;
  authenticated: boolean;
  hasSpotify: boolean;
  appleMusicConnected: boolean;
  canDisconnectAppleMusic: boolean;
  musicCount: number;
  radarCount: number;
}

type SourceCardProps = {
  id: string;
  name: string;
  icon: React.ReactNode;
  description?: React.ReactNode;
  status: SourceStatus;
  actionLabel: string;
  onAction: () => void;
  primaryAction?: boolean;
  actionDisabled?: boolean;
  overflowActionLabel?: string | undefined;
  onOverflowAction?: (() => void) | undefined;
  helpLink?:
    | {
        href: string;
        label: string;
      }
    | undefined;
};

const sectionHeadingClass =
  'mb-2 px-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground';

function formatCount(count: number) {
  return new Intl.NumberFormat().format(count);
}

function activeFilterCount(filters: FindMusicFilters) {
  return (
    (filters.install === 'all' ? 0 : 1) +
    filters.instruments.size +
    (filters.query.trim() ? 1 : 0) +
    filters.exclusions.length +
    (filters.exclusionDraft.trim() ? 1 : 0)
  );
}

function SourceGlyph({children}: {children: React.ReactNode}) {
  return (
    <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground [&_svg]:h-3 [&_svg]:w-3">
      {children}
    </span>
  );
}

function SourceCard({
  id,
  name,
  icon,
  description,
  status,
  actionLabel,
  onAction,
  primaryAction = false,
  actionDisabled = false,
  overflowActionLabel,
  onOverflowAction,
  helpLink,
}: SourceCardProps) {
  const loading = status.phase === 'loading';
  const error = status.phase === 'error';
  const ready = status.phase === 'ready';

  return (
    <article
      className={cn(
        'rounded-lg border bg-card px-3 py-2.5 text-card-foreground',
        error && 'border-destructive/50',
      )}
      data-testid={`source-${id}`}>
      <div className="flex items-center gap-2">
        {icon}
        <h3 className="min-w-0 flex-1 text-xs font-semibold">{name}</h3>
        <span
          className={cn(
            'h-2 w-2 shrink-0 rounded-full bg-border',
            ready && 'bg-green-600 dark:bg-green-500',
            loading && 'animate-pulse bg-amber-500',
            error && 'bg-destructive',
          )}
          aria-hidden="true"
        />
        <span className="sr-only">
          {loading
            ? 'Loading'
            : error
              ? 'Error'
              : ready
                ? 'Ready'
                : 'Not connected'}
        </span>
      </div>

      <div className="ml-7 mt-1">
        {description ? (
          <p className="mb-1.5 text-[11px] leading-4 text-muted-foreground">
            {description}
          </p>
        ) : null}
        <p
          className={cn(
            'text-[11.5px] leading-4 text-muted-foreground',
            error && 'text-red-700 dark:text-red-400',
          )}
          role={error ? 'alert' : loading ? 'status' : undefined}>
          {status.summary}
        </p>
        {status.detail ? (
          <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
            {status.detail}
          </p>
        ) : null}

        {helpLink ? (
          <a
            href={helpLink.href}
            target="_blank"
            rel="noreferrer"
            className="mt-1.5 inline-flex items-center gap-1 text-[11.5px] font-medium text-primary underline-offset-4 hover:underline">
            {helpLink.label}
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </a>
        ) : null}

        {loading && status.progress !== undefined ? (
          <Progress
            value={status.progress}
            className="mt-2 h-1"
            aria-label={`${name} progress`}
          />
        ) : null}

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Button
            type="button"
            size="xs"
            variant={primaryAction ? 'default' : 'secondary'}
            onClick={onAction}
            disabled={loading || actionDisabled}
            aria-label={loading ? `${name} is loading` : actionLabel}>
            {loading ? (
              <LoaderCircle className="animate-spin" aria-hidden="true" />
            ) : error ? (
              <RotateCw aria-hidden="true" />
            ) : null}
            {loading ? 'Working…' : actionLabel}
          </Button>
          {overflowActionLabel && onOverflowAction ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  className="w-7 px-0"
                  aria-label={`${name} actions`}>
                  <MoreHorizontal aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem destructive onSelect={onOverflowAction}>
                  {overflowActionLabel}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </div>
    </article>
  );
}

export default function FindMusicSidebar({
  variant = 'responsive',
  view,
  onViewChange,
  filters,
  onFiltersChange,
  onClearFilters,
  historyStatus,
  spotifyLibraryStatus,
  appleMusicStatus,
  localStatus,
  chorusStatus,
  onRefreshHistory,
  onRefreshSpotifyLibrary,
  onRefreshAppleMusic,
  onScanLocal,
  onRefreshChorus,
  onConnectSpotify,
  onConnectAppleMusic,
  onDisconnectAppleMusic,
  authenticated,
  hasSpotify,
  appleMusicConnected,
  canDisconnectAppleMusic,
  musicCount,
  radarCount,
}: FindMusicSidebarProps) {
  const [addingExclusion, setAddingExclusion] = useState(
    filters.exclusionDraft.trim().length > 0,
  );
  const showExclusionInput =
    addingExclusion || filters.exclusionDraft.trim().length > 0;
  const activeFilters = activeFilterCount(filters);
  const spotifyConnected = authenticated && hasSpotify;
  const tasteSourceConnected =
    spotifyLibraryStatus.phase === 'ready' ||
    appleMusicStatus.phase === 'ready' ||
    historyStatus.phase === 'ready';
  const spotifyActionLabel = !authenticated
    ? 'Sign in with Spotify'
    : !hasSpotify
      ? 'Connect Spotify'
      : spotifyLibraryStatus.phase === 'idle'
        ? 'Load library'
        : spotifyLibraryStatus.phase === 'error'
          ? 'Try again'
          : 'Refresh';
  const appleMusicActionLabel = !appleMusicConnected
    ? 'Connect Apple Music'
    : appleMusicStatus.phase === 'error'
      ? 'Try again'
      : 'Refresh';

  function toggleInstrument(instrument: (typeof INSTRUMENTS)[number][0]) {
    const instruments = new Set(filters.instruments);
    if (instruments.has(instrument)) instruments.delete(instrument);
    else instruments.add(instrument);
    onFiltersChange({...filters, instruments});
  }

  function commitExclusion() {
    const term = filters.exclusionDraft.trim();
    if (!term) return;
    const duplicate = filters.exclusions.some(
      existing => existing.toLocaleLowerCase() === term.toLocaleLowerCase(),
    );
    onFiltersChange({
      ...filters,
      exclusions: duplicate
        ? filters.exclusions
        : [...filters.exclusions, term],
      exclusionDraft: '',
    });
    setAddingExclusion(false);
  }

  function removeExclusion(index: number) {
    onFiltersChange({
      ...filters,
      exclusions: filters.exclusions.filter(
        (_, itemIndex) => itemIndex !== index,
      ),
    });
  }

  return (
    <aside
      className={cn(
        'min-h-0 shrink-0 overflow-y-auto bg-muted/30 px-3.5 py-4 text-foreground [contain:paint]',
        variant === 'drawer'
          ? 'h-full max-h-full w-full border-0'
          : 'max-h-[40vh] w-full border-b border-border sm:max-h-[44vh] lg:h-full lg:max-h-full lg:w-[292px] lg:border-b-0 lg:border-r',
      )}
      aria-label="Navigation, filters and sources">
      <section className="mb-5">
        <h2 className={sectionHeadingClass}>Browse</h2>
        <nav aria-label="Browse">
          <div className="space-y-1">
            <Link
              href={FIND_MUSIC_PATH}
              className={cn(
                'flex w-full items-center gap-2 rounded-md border border-transparent px-2.5 py-2 text-left text-xs font-semibold hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                view === 'music' &&
                  'border-border bg-card text-foreground shadow-[inset_2px_0_0_hsl(var(--primary))]',
              )}
              aria-current={view === 'music' ? 'page' : undefined}
              onClick={() => onViewChange('music')}>
              <Music2 className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                Your music
                <span className="mt-0.5 block font-normal text-muted-foreground">
                  songs with direct evidence
                </span>
              </span>
              <span className="text-[11.5px] font-normal tabular-nums text-muted-foreground">
                {formatCount(musicCount)}
              </span>
            </Link>
            <Link
              href={FIND_MUSIC_RECOMMENDATIONS_PATH}
              className={cn(
                'flex w-full items-center gap-2 rounded-md border border-transparent px-2.5 py-2 text-left text-xs font-semibold hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                view === 'radar' &&
                  'border-border bg-card text-foreground shadow-[inset_2px_0_0_hsl(var(--primary))]',
              )}
              aria-current={view === 'radar' ? 'page' : undefined}
              onClick={() => onViewChange('radar')}>
              <Radio className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                Recommendations
                <span className="mt-0.5 block font-normal text-muted-foreground">
                  more from artists you play
                </span>
              </span>
              <span className="text-[11.5px] font-normal tabular-nums text-muted-foreground">
                {formatCount(radarCount)}
              </span>
            </Link>
          </div>
        </nav>
      </section>

      <section className="mb-5">
        <h2 className={sectionHeadingClass}>Filters</h2>
        <div className="rounded-lg border bg-card px-3 py-2.5 text-card-foreground">
          <div className="mb-3 flex items-baseline gap-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Filters
            </h3>
            {activeFilters > 0 ? (
              <span className="text-[11px] font-semibold text-fuchsia-700 dark:text-fuchsia-300">
                {activeFilters} active
              </span>
            ) : null}
            <button
              type="button"
              className="ml-auto text-[11.5px] text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              onClick={onClearFilters}
              disabled={activeFilters === 0}>
              Clear all
            </button>
          </div>

          <label className="mb-3 block">
            <span className="mb-1.5 block text-[11px] font-semibold text-muted-foreground">
              Artist or song
            </span>
            <span className="relative block">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <input
                type="search"
                value={filters.query}
                onChange={event =>
                  onFiltersChange({
                    ...filters,
                    query: event.currentTarget.value,
                  })
                }
                placeholder="Search artist or song"
                className="h-8 w-full rounded-md border bg-background pl-8 pr-2 text-xs text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
              />
            </span>
          </label>

          <fieldset className="mb-3">
            <legend className="mb-1.5 text-[11px] font-semibold text-muted-foreground">
              Install state
            </legend>
            <label className="flex cursor-pointer items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                checked={filters.install === 'hide-installed'}
                onChange={event =>
                  onFiltersChange({
                    ...filters,
                    install: event.currentTarget.checked
                      ? 'hide-installed'
                      : 'all',
                  })
                }
                className="accent-primary"
              />
              Hide songs with installed charts
            </label>
          </fieldset>

          <fieldset className="mb-3">
            <legend className="mb-1.5 text-[11px] font-semibold text-muted-foreground">
              Instruments — require
            </legend>
            <div className="flex flex-wrap gap-1">
              {INSTRUMENTS.map(([id, , label]) => {
                const selected = filters.instruments.has(id);
                return (
                  <button
                    key={id}
                    type="button"
                    className={cn(
                      'inline-flex h-8 min-w-9 items-center justify-center gap-1 rounded-md border bg-secondary px-2 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                      selected &&
                        'border-primary bg-primary text-primary-foreground hover:text-primary-foreground',
                    )}
                    aria-label={`Require ${label}`}
                    aria-pressed={selected}
                    onClick={() => toggleInstrument(id)}>
                    <FindMusicInstrumentIcon instrument={id} size={18} />
                  </button>
                );
              })}
            </div>
          </fieldset>

          <div>
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-[11px] font-semibold text-muted-foreground">
                Exclude
              </h4>
              {!showExclusionInput ? (
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  className="h-7 px-2"
                  onClick={() => setAddingExclusion(true)}>
                  <Plus className="h-3.5 w-3.5" />
                  Add exclusion
                </Button>
              ) : null}
            </div>

            {filters.exclusions.length > 0 ? (
              <div
                className="mt-1.5 flex flex-wrap gap-1.5"
                aria-label="Excluded terms">
                {filters.exclusions.map((term, index) => (
                  <span
                    key={`${term}-${index}`}
                    className="inline-flex min-w-0 items-center gap-1 rounded-full border bg-secondary py-1 pl-2.5 pr-1 text-xs text-secondary-foreground">
                    <span className="max-w-36 truncate">{term}</span>
                    <button
                      type="button"
                      className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label={`Remove exclusion ${term}`}
                      onClick={() => removeExclusion(index)}>
                      <X className="h-3 w-3" aria-hidden="true" />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}

            {showExclusionInput ? (
              <input
                type="search"
                autoFocus
                value={filters.exclusionDraft}
                onChange={event =>
                  onFiltersChange({
                    ...filters,
                    exclusionDraft: event.currentTarget.value,
                  })
                }
                onKeyDown={event => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    commitExclusion();
                  }
                  if (event.key === 'Escape') {
                    onFiltersChange({...filters, exclusionDraft: ''});
                    setAddingExclusion(false);
                  }
                }}
                aria-label="Exclusion term"
                placeholder="blink"
                className="mt-2 h-8 w-full rounded-md border bg-background px-2.5 text-xs text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
              />
            ) : null}
          </div>
        </div>
      </section>

      <section className="mb-5 space-y-2">
        <h2 className={sectionHeadingClass}>Taste sources</h2>
        <SourceCard
          id="spotify-library"
          name="Spotify Library"
          icon={
            <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md bg-[#1ed760] text-[#08210f]">
              <Icons.spotify className="h-3 w-3" />
            </span>
          }
          status={spotifyLibraryStatus}
          actionLabel={spotifyActionLabel}
          onAction={
            spotifyConnected ? onRefreshSpotifyLibrary : onConnectSpotify
          }
          primaryAction={
            !spotifyConnected || spotifyLibraryStatus.phase === 'idle'
          }
        />
        <SourceCard
          id="apple-music"
          name="Apple Music"
          icon={
            <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md bg-gradient-to-br from-[#fa3159] to-[#d7003a] text-white">
              <AppleMusicIcon variant="white" className="h-3 w-3" />
            </span>
          }
          status={appleMusicStatus}
          actionLabel={appleMusicActionLabel}
          onAction={
            appleMusicConnected ? onRefreshAppleMusic : onConnectAppleMusic
          }
          primaryAction={!appleMusicConnected}
          overflowActionLabel={
            canDisconnectAppleMusic ? 'Disconnect and clear' : undefined
          }
          onOverflowAction={
            canDisconnectAppleMusic ? onDisconnectAppleMusic : undefined
          }
        />
        <SourceCard
          id="history"
          name="Spotify History"
          icon={
            <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md bg-[#1ed760] text-[#08210f]">
              <Icons.spotify className="h-3 w-3" />
            </span>
          }
          status={historyStatus}
          actionLabel={
            historyStatus.phase === 'idle'
              ? 'Pick history folder…'
              : historyStatus.phase === 'error'
                ? 'Try again'
                : 'Refresh'
          }
          onAction={onRefreshHistory}
          primaryAction={historyStatus.phase === 'idle'}
          helpLink={
            historyStatus.phase === 'idle'
              ? {
                  href: 'https://www.spotify.com/us/account/privacy/',
                  label: 'Request Extended Streaming History',
                }
              : undefined
          }
        />
      </section>

      <section className="mb-3 space-y-2">
        <h2 className={sectionHeadingClass}>System sources</h2>
        <SourceCard
          id="local"
          name="Local Songs Folder"
          icon={
            <SourceGlyph>
              <FolderOpen />
            </SourceGlyph>
          }
          status={localStatus}
          actionLabel={
            localStatus.phase === 'idle'
              ? 'Pick Songs folder…'
              : localStatus.phase === 'error'
                ? 'Try again'
                : 'Rescan'
          }
          onAction={onScanLocal}
          primaryAction={localStatus.phase === 'idle'}
        />
        <SourceCard
          id="chorus"
          name="Chorus Chart Index"
          icon={
            <SourceGlyph>
              <span className="text-[11px] font-bold">C</span>
            </SourceGlyph>
          }
          status={chorusStatus}
          actionLabel={
            !tasteSourceConnected
              ? 'Connect taste sources first'
              : chorusStatus.phase === 'error'
                ? 'Try again'
                : 'Refresh index'
          }
          onAction={onRefreshChorus}
          actionDisabled={!tasteSourceConnected}
        />
      </section>
    </aside>
  );
}
