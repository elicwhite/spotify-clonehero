'use client';

import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {toast} from 'sonner';

import type {AppleMusicLibraryClient} from '@/lib/apple-music';
import {useAppleMusicLibraryUpdate} from '@/lib/apple-music/AppleMusicFetching';
import {navigateToAppleMusicPath} from '@/lib/apple-music/navigation';

import {findMusicPathForView} from './routes';
import type {FindMusicStats, FindMusicView, SourceStatus} from './types';

export type AppleMusicSourceViewModel = {
  canDisconnect: boolean;
  client: AppleMusicLibraryClient | null;
  connected: boolean;
  preferredPreviewProvider: 'spotify' | 'appleMusic';
  previewAvailable: boolean;
  refreshing: boolean;
  status: SourceStatus;
};

export type AppleMusicSourceActions = {
  connect: () => void;
  disconnect: () => Promise<void>;
  refresh: () => Promise<void>;
};

export function useAppleMusicSource({
  view,
  enabled,
  initializing,
  stats,
  spotifyPreviewAvailable,
  stageSnapshot,
  replaceSnapshot,
  onActivate,
  onActivateForNavigation,
}: {
  view: FindMusicView;
  enabled: boolean;
  initializing: boolean;
  stats: FindMusicStats;
  spotifyPreviewAvailable: boolean;
  stageSnapshot: () => Promise<void>;
  replaceSnapshot: () => Promise<void>;
  onActivate: () => void;
  onActivateForNavigation: () => void;
}): {viewModel: AppleMusicSourceViewModel; actions: AppleMusicSourceActions} {
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const refreshInFlightRef = useRef<Promise<void> | null>(null);
  const {setupState, progress, client, setup, refresh, disconnect} =
    useAppleMusicLibraryUpdate();

  useEffect(() => {
    if (!enabled) return;
    void setup();
  }, [enabled, setup]);

  useEffect(
    () => () => {
      controllerRef.current?.abort();
    },
    [],
  );

  const connect = useCallback(() => {
    onActivateForNavigation();
    const returnTo = findMusicPathForView(view);
    navigateToAppleMusicPath(
      `/apple-music-connect?returnTo=${encodeURIComponent(returnTo)}`,
    );
  }, [onActivateForNavigation, view]);

  const runRefresh = useCallback(async () => {
    onActivate();
    if (refreshInFlightRef.current) return refreshInFlightRef.current;
    const controller = new AbortController();
    controllerRef.current = controller;
    const run = (async () => {
      setRefreshError(null);
      setRefreshing(true);
      const result = await refresh(controller);
      if (result.status === 'success') {
        await stageSnapshot();
      } else if (result.status === 'unauthorized') {
        setRefreshError('Authorization is required to refresh');
        toast.info('Connect Apple Music to refresh your library');
      } else if (result.status === 'error') {
        setRefreshError(result.message);
        toast.error(result.message);
      }
    })().catch(error => {
      const message =
        error instanceof Error
          ? error.message
          : 'Apple Music library refresh failed';
      setRefreshError(message);
      toast.error(message);
    });
    refreshInFlightRef.current = run;
    try {
      await run;
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
      if (refreshInFlightRef.current === run) refreshInFlightRef.current = null;
      setRefreshing(false);
    }
  }, [onActivate, refresh, stageSnapshot]);

  const runDisconnect = useCallback(async () => {
    if (
      !window.confirm(
        'Disconnect Apple Music and remove its saved library index from this browser?',
      )
    ) {
      return;
    }
    setRefreshError(null);
    try {
      controllerRef.current?.abort();
      await refreshInFlightRef.current?.catch(() => undefined);
      await disconnect();
      await replaceSnapshot();
      toast.success('Apple Music disconnected and local library data cleared');
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Could not clear Apple Music data',
      );
    }
  }, [disconnect, replaceSnapshot]);

  const connected = enabled && setupState === 'authorized';
  const previewAvailable = connected && client !== null;
  const savedCount = stats.appleMusicLibraryTracks;
  const status = useMemo<SourceStatus>(() => {
    if (!enabled) {
      return {phase: 'idle', summary: 'Not connected'};
    }
    if (refreshing) {
      const total = progress.total;
      return {
        phase: 'loading',
        summary:
          total == null
            ? `Reading Apple Music… ${progress.fetchedCount.toLocaleString()} songs`
            : `Reading Apple Music… ${progress.fetchedCount.toLocaleString()} / ${total.toLocaleString()} songs`,
        progress:
          total != null && total > 0
            ? Math.min(100, (progress.fetchedCount / total) * 100)
            : 0,
        detail: 'The previous saved scan remains active until this finishes',
      };
    }
    if (refreshError) {
      return {
        phase: 'error',
        summary: refreshError,
        ...(savedCount > 0
          ? {
              detail: `${savedCount.toLocaleString()} previously saved songs remain available`,
            }
          : {}),
      };
    }
    if (initializing || setupState === 'preparing') {
      return {phase: 'loading', summary: 'Checking Apple Music…'};
    }
    if (setupState === 'error') {
      return {
        phase: 'error',
        summary: 'Apple Music could not be prepared',
        ...(savedCount > 0
          ? {
              detail: `${savedCount.toLocaleString()} saved songs remain available locally`,
            }
          : {}),
      };
    }
    if (savedCount > 0 || stats.appleMusicLibraryUpdatedAt != null) {
      const details = [
        stats.appleMusicStorefront
          ? `${stats.appleMusicStorefront.toUpperCase()} storefront`
          : null,
        connected
          ? formatFreshness(stats.appleMusicLibraryUpdatedAt)
          : 'Stored locally · reconnect to refresh',
      ]
        .filter(Boolean)
        .join(' · ');
      return readySource(`${savedCount.toLocaleString()} saved songs`, details);
    }
    return {
      phase: 'idle',
      summary: connected ? 'Ready to scan' : 'Not connected',
    };
  }, [
    connected,
    enabled,
    initializing,
    progress.fetchedCount,
    progress.total,
    refreshError,
    refreshing,
    savedCount,
    setupState,
    stats.appleMusicLibraryUpdatedAt,
    stats.appleMusicStorefront,
  ]);

  const preferredPreviewProvider: 'spotify' | 'appleMusic' =
    previewAvailable &&
    (!spotifyPreviewAvailable || savedCount > stats.spotifyLibraryTracks)
      ? 'appleMusic'
      : 'spotify';

  return {
    viewModel: {
      connected,
      canDisconnect: connected || stats.appleMusicLibraryUpdatedAt != null,
      client: connected ? client : null,
      previewAvailable,
      preferredPreviewProvider,
      refreshing,
      status,
    },
    actions: {connect, refresh: runRefresh, disconnect: runDisconnect},
  };
}

function formatFreshness(value: string | null) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return `Updated ${date.toLocaleString()}`;
}

function readySource(
  summary: string,
  detail: string | undefined,
): SourceStatus {
  return detail == null
    ? {phase: 'ready', summary}
    : {phase: 'ready', summary, detail};
}
