'use client';

import {useCallback, useEffect, useRef, useState} from 'react';

import {Button} from '@/components/ui/button';
import {
  getPersistencePermission,
  getStoragePressure,
  isStoragePersisted,
  requestPersistentStorage,
  type StoragePressure,
} from '@/lib/browser-storage';
import {
  listStemCacheEntries,
  pruneStemCache,
} from '@/lib/audio-pipeline/stem-cache';
import {getCachedModelBytes} from '@/lib/lyrics-align/model-cache';
import {attachStorageContext} from '@/lib/sentry/storage-context';
import {formatBytes} from '@/lib/sng/file-utils';

interface StorageReading {
  pressure: StoragePressure | null;
  persisted: boolean;
  /**
   * The permission state, not a pair of booleans derived from it. A four-value
   * answer flattened into two flags is how the "granted but not yet taken"
   * case ends up with no branch at all.
   */
  permission: PermissionState | 'unknown';
  cachedSongs: number;
  cachedBytes: number;
  modelBytes: number;
}

/**
 * Takes every reading, and never rejects.
 *
 * `listStemCacheEntries` walks OPFS, which can fail outright — Firefox private
 * browsing has no OPFS at all. This is the page a user opens because their
 * storage misbehaved, so one failed reading must not be what leaves it saying
 * "Reading storage…" for good.
 */
async function readStorage(): Promise<StorageReading> {
  const [pressure, persisted, permission, entries, modelBytes] =
    await Promise.all([
      getStoragePressure(),
      isStoragePersisted(),
      getPersistencePermission(),
      listStemCacheEntries().catch(() => []),
      getCachedModelBytes(),
    ]);
  return {
    pressure,
    persisted,
    permission,
    // By fingerprint: the walk returns an entry per root, and a song cached
    // before the cache bucket existed and re-separated since is in both.
    cachedSongs: new Set(entries.map(entry => entry.fingerprint)).size,
    cachedBytes: entries.reduce((sum, entry) => sum + entry.sizeBytes, 0),
    modelBytes,
  };
}

/** One labelled figure. */
function Row({label, value}: {label: string; value: string}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-border py-3 first:border-t-0 first:pt-0">
      <dt className="text-sm text-foreground/70">{label}</dt>
      <dd className="font-mono text-sm text-foreground">{value}</dd>
    </div>
  );
}

function usageValue(pressure: StoragePressure | null): string {
  if (pressure == null) return 'This browser does not say';
  if (pressure.quotaBytes <= 0) return formatBytes(pressure.usageBytes);
  return `${formatBytes(pressure.usageBytes)} of ${formatBytes(
    pressure.quotaBytes,
  )} (${Math.round(pressure.ratio * 100)}%)`;
}

/**
 * What this browser is holding, and whether it has promised to keep it.
 *
 * The readings come from the browser at mount rather than from any stored
 * state: the numbers a user needs are the ones true right now, and there is no
 * server that could know them.
 */
export function StoragePanel() {
  const [reading, setReading] = useState<StorageReading | null>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  /** Rising count, so a slow reading cannot overwrite a newer one. */
  const latestRead = useRef(0);

  const refresh = useCallback(async () => {
    const attempt = ++latestRead.current;
    const next = await readStorage();
    if (attempt === latestRead.current) setReading(next);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const emptyCache = async () => {
    setBusy(true);
    setStatus('');
    try {
      // Target 0, and no floor: this is the one caller that means "delete all
      // of it" rather than "prune to a budget".
      const result = await pruneStemCache({targetBytes: 0});
      await refresh();
      // Null means another tab holds the prune lock — a separation running
      // somewhere else. Saying nothing would look like a button that does
      // nothing.
      setStatus(
        result == null
          ? 'Another tab is working on a song right now. Try again when it has finished.'
          : `Freed ${formatBytes(result.freedBytes)}.`,
      );
    } catch {
      setStatus('This browser would not let the stems be deleted.');
    } finally {
      setBusy(false);
    }
  };

  const askForPersistence = async () => {
    setBusy(true);
    setStatus('');
    try {
      const granted = await requestPersistentStorage();
      // The tag written at load says this session is unprotected. Left alone
      // it would say that for the rest of the session's life. Not awaited: it
      // re-reads the quota, which is the slowest call there is on a large
      // origin, and the user is waiting on the numbers below.
      if (granted) void attachStorageContext();
      await refresh();
      setStatus(
        granted
          ? 'This browser will keep your data.'
          : 'This browser did not agree to keep your data.',
      );
    } catch {
      setStatus('This browser could not answer.');
    } finally {
      setBusy(false);
    }
  };

  if (reading == null) {
    return (
      <p aria-busy="true" className="text-sm text-foreground/70">
        Reading storage…
      </p>
    );
  }

  // Asking helps whenever the browser has not already been told no and the
  // data is not already kept — including a permission that is granted but not
  // yet taken, which one call settles silently.
  const canAsk = !reading.persisted && reading.permission !== 'denied';

  return (
    <div className="space-y-6">
      <dl>
        <Row label="Used by this site" value={usageValue(reading.pressure)} />
        <Row
          label="Separated stems"
          value={
            reading.cachedSongs === 0
              ? 'None'
              : `${reading.cachedSongs} ${
                  reading.cachedSongs === 1 ? 'song' : 'songs'
                }, ${formatBytes(reading.cachedBytes)}`
          }
        />
        <Row
          label="Downloaded models"
          value={
            reading.modelBytes === 0 ? 'None' : formatBytes(reading.modelBytes)
          }
        />
        <Row
          label="Kept when space runs short"
          value={reading.persisted ? 'Yes' : 'Not promised'}
        />
      </dl>

      <div className="flex flex-wrap gap-3">
        {reading.cachedSongs > 0 ? (
          <Button variant="outline" onClick={emptyCache} disabled={busy}>
            Free {formatBytes(reading.cachedBytes)}
          </Button>
        ) : null}
        {canAsk ? (
          <Button onClick={askForPersistence} disabled={busy}>
            Ask this browser to keep your data
          </Button>
        ) : null}
      </div>

      <p
        role="status"
        aria-live="polite"
        className="text-sm text-foreground/70">
        {status}
        {!reading.persisted && reading.permission === 'denied'
          ? 'This browser has been told not to store data permanently for this site. You can change that in its site settings.'
          : null}
      </p>
    </div>
  );
}
