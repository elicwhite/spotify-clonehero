'use client';

import * as Sentry from '@sentry/nextjs';
import {useCallback, useRef, useState} from 'react';
import {
  AppleMusicError,
  classifyAppleMusicError,
  configureAppleMusicClient,
  loadMusicKitScript,
  prepareAppleMusicClient,
  type AppleMusicLibraryClient,
  type AppleMusicLibraryProgress,
} from '.';
import {
  activateAppleMusicScan,
  beginAppleMusicScan,
  clearAppleMusicLibrary,
  discardAppleMusicScan,
  stageAppleMusicTracks,
} from '@/lib/local-db/apple-music';
import {getLocalDb} from '@/lib/local-db/client';

export type AppleMusicSetupState =
  | 'preparing'
  | 'authorized'
  | 'unauthorized'
  | 'error';

export type AppleMusicRefreshResult =
  | {status: 'success' | 'unauthorized' | 'aborted'}
  | {status: 'error'; errorCode: string; message: string};

const DEVELOPER_TOKEN_RENEWAL_SKEW_MS = 5 * 60 * 1000;

export type AppleMusicFetchingDependencies = {
  activateAppleMusicScan: typeof activateAppleMusicScan;
  beginAppleMusicScan: typeof beginAppleMusicScan;
  clearAppleMusicLibrary: typeof clearAppleMusicLibrary;
  configureAppleMusicClient: typeof configureAppleMusicClient;
  discardAppleMusicScan: typeof discardAppleMusicScan;
  getLocalDb: typeof getLocalDb;
  loadMusicKitScript: typeof loadMusicKitScript;
  stageAppleMusicTracks: typeof stageAppleMusicTracks;
};

const defaultDependencies: AppleMusicFetchingDependencies = {
  activateAppleMusicScan,
  beginAppleMusicScan,
  clearAppleMusicLibrary,
  configureAppleMusicClient,
  discardAppleMusicScan,
  getLocalDb,
  loadMusicKitScript,
  stageAppleMusicTracks,
};

function emptyProgress(): AppleMusicLibraryProgress {
  return {
    total: null,
    fetchedCount: 0,
    usableCount: 0,
    catalogAssociatedCount: 0,
    pagesFetched: 0,
  };
}

function scanId() {
  return typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function useAppleMusicLibraryUpdate(
  dependencies: AppleMusicFetchingDependencies = defaultDependencies,
) {
  const [setupState, setSetupState] =
    useState<AppleMusicSetupState>('preparing');
  const [progress, setProgress] =
    useState<AppleMusicLibraryProgress>(emptyProgress);
  const [client, setClient] = useState<AppleMusicLibraryClient | null>(null);
  const clientRef = useRef<AppleMusicLibraryClient | null>(null);
  const tokenExpiresAtRef = useRef(0);
  const lifecycleRef = useRef(0);
  const setupErrorRef = useRef<AppleMusicError | null>(null);

  const safeFailure = useCallback(
    (stage: 'setup' | 'library' | 'local_database', error: unknown) => {
      const classified = classifyAppleMusicError(error);
      const errorCode = `${stage}:${classified.code}`;
      const message =
        stage === 'local_database'
          ? `Apple Music could not update its local library index. Reload this page and try again. (${errorCode})`
          : classified.code === 'rate_limited'
            ? `Apple Music is rate limiting library requests. Try again in a few minutes. (${errorCode})`
            : classified.code === 'transient'
              ? `Apple Music is temporarily unavailable. Try again shortly. (${errorCode})`
              : classified.code === 'malformed_response'
                ? `Apple Music returned an incomplete library response. Try refreshing again. (${errorCode})`
                : stage === 'setup'
                  ? `MusicKit could not start. Reload this page and try again. (${errorCode})`
                  : `Apple Music could not read the library. Try refreshing again. (${errorCode})`;
      return {status: 'error' as const, errorCode, message};
    },
    [],
  );

  const setup = useCallback(
    async (force = false): Promise<AppleMusicLibraryClient | null> => {
      const lifecycle = lifecycleRef.current;
      try {
        if (
          !force &&
          clientRef.current &&
          tokenExpiresAtRef.current >
            Date.now() + DEVELOPER_TOKEN_RENEWAL_SKEW_MS
        ) {
          return clientRef.current;
        }
        setSetupState('preparing');
        const prepared = await prepareAppleMusicClient(dependencies);
        const configured = prepared.client;
        if (lifecycle !== lifecycleRef.current) {
          if (configured.isAuthorized()) {
            await configured.unauthorize().catch(() => undefined);
          }
          return null;
        }
        clientRef.current = configured;
        setupErrorRef.current = null;
        tokenExpiresAtRef.current = prepared.developerTokenExpiresAt;
        setClient(configured);
        setSetupState(
          configured.isAuthorized() ? 'authorized' : 'unauthorized',
        );
        return configured;
      } catch (error) {
        if (lifecycle !== lifecycleRef.current) return null;
        const classified = classifyAppleMusicError(error);
        setupErrorRef.current = classified;
        setSetupState(
          classified.code === 'unauthorized' ? 'unauthorized' : 'error',
        );
        // `setup` resolves to null rather than rejecting, so a caller's
        // `.catch` never runs. Reporting has to happen here or not at all.
        // An expired or declined authorization is the user's own doing.
        if (classified.code !== 'unauthorized') {
          Sentry.captureException(error);
        }
        return null;
      }
    },
    [dependencies],
  );

  const refresh = useCallback(
    async (controller: AbortController): Promise<AppleMusicRefreshResult> => {
      let configured =
        clientRef.current &&
        tokenExpiresAtRef.current > Date.now() + DEVELOPER_TOKEN_RENEWAL_SKEW_MS
          ? clientRef.current
          : await setup();
      if (!configured || !configured.isAuthorized()) {
        if (
          setupErrorRef.current &&
          setupErrorRef.current.code !== 'unauthorized'
        ) {
          return safeFailure('setup', setupErrorRef.current);
        }
        setSetupState('unauthorized');
        return {status: 'unauthorized'};
      }

      let db: Awaited<ReturnType<typeof getLocalDb>>;
      try {
        db = await dependencies.getLocalDb();
      } catch (error) {
        return safeFailure('local_database', error);
      }
      const lifecycle = lifecycleRef.current;
      for (let attempt = 0; attempt < 2; attempt++) {
        const id = scanId();
        let stage: 'library' | 'local_database' = 'local_database';
        try {
          setProgress(emptyProgress());
          const scanToken = await dependencies.beginAppleMusicScan(db, id);
          stage = 'library';
          const scan = await configured.fetchLibrarySongs({
            signal: controller.signal,
            onProgress: setProgress,
          });
          if (controller.signal.aborted || lifecycle !== lifecycleRef.current) {
            throw new AppleMusicError('aborted');
          }
          stage = 'local_database';
          await dependencies.stageAppleMusicTracks(
            db,
            id,
            scan.songs.map(song => ({
              artist: song.artistName,
              name: song.title,
              catalogId: song.catalogId,
            })),
          );
          await dependencies.activateAppleMusicScan(db, id, {
            storefront: scan.storefront,
            reportedTotal: scan.total ?? scan.fetchedCount,
            fetchedCount: scan.fetchedCount,
            usableCount: scan.usableCount,
            catalogAssociatedCount: scan.catalogAssociatedCount,
            scanToken,
          });
          setSetupState('authorized');
          return {status: 'success'};
        } catch (error) {
          await Promise.resolve(
            dependencies.discardAppleMusicScan(db, id),
          ).catch(() => undefined);
          const classified = classifyAppleMusicError(error);
          if (classified.code === 'aborted') return {status: 'aborted'};
          if (classified.code === 'unauthorized' && attempt === 0) {
            configured = await setup(true);
            if (configured?.isAuthorized()) continue;
          }
          if (classified.code === 'unauthorized') setSetupState('unauthorized');
          return classified.code === 'unauthorized'
            ? {status: 'unauthorized'}
            : safeFailure(stage, error);
        }
      }
      setSetupState('unauthorized');
      return {status: 'unauthorized'};
    },
    [dependencies, safeFailure, setup],
  );

  const disconnect = useCallback(async () => {
    lifecycleRef.current += 1;
    const configured = clientRef.current;
    try {
      if (configured?.isAuthorized()) await configured.unauthorize();
    } finally {
      await dependencies.clearAppleMusicLibrary(
        await dependencies.getLocalDb(),
      );
      setClient(null);
      clientRef.current = null;
      tokenExpiresAtRef.current = 0;
      setProgress(emptyProgress());
      setSetupState('unauthorized');
    }
  }, [dependencies]);

  return {setupState, progress, client, setup, refresh, disconnect};
}
