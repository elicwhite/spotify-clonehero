'use client';

import {useCallback, useEffect, useRef, useState} from 'react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {Button} from '@/components/ui/button';
import {
  getPersistencePermission,
  getStoragePressure,
  isStoragePersisted,
  requestPersistentStorage,
  type StoragePressure,
} from '@/lib/browser-storage';
import {
  deleteStemEntry,
  listStemCacheEntries,
  pruneStemCache,
  type StemCacheEntry,
} from '@/lib/audio-pipeline/stem-cache';
import {
  deleteCachedModels,
  getCachedModelBytes,
} from '@/lib/lyrics-align/model-cache';
import {
  deleteStoredProject,
  measureProjectStorage,
  type ProjectStorage,
  type StoredProject,
} from '@/lib/project-storage/storedProjects';
import {attachStorageContext} from '@/lib/sentry/storage-context';
import {formatBytes} from '@/lib/sng/file-utils';

import {ChartExportDialog} from './ChartExportDialog';
import {StorageGroup, StorageRow} from './StorageRow';
import {UsageBar, type UsageSegment} from './UsageBar';

interface StorageReading {
  pressure: StoragePressure | null;
  persisted: boolean;
  /**
   * The permission state, not a pair of booleans derived from it. A four-value
   * answer flattened into flags is how the "granted but not yet taken" case
   * ends up with no branch at all.
   */
  permission: PermissionState | 'unknown';
  stems: StemCacheEntry[];
  modelBytes: number;
  work: ProjectStorage;
}

/**
 * Takes every reading, and never rejects.
 *
 * The cache walk can fail outright — Firefox private browsing has no OPFS at
 * all. This is the page a user opens because their storage misbehaved, so one
 * failed reading must not be what leaves it saying "Reading storage…" for good.
 */
async function readStorage(): Promise<StorageReading> {
  const [pressure, persisted, permission, stems, modelBytes, work] =
    await Promise.all([
      getStoragePressure(),
      isStoragePersisted(),
      getPersistencePermission(),
      listStemCacheEntries().catch(() => []),
      getCachedModelBytes(),
      measureProjectStorage(),
    ]);
  return {pressure, persisted, permission, stems, modelBytes, work};
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/** A readable date, or nothing at all rather than a guess. */
function formatDate(iso: string | null): string | null {
  if (iso == null) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? null
    : date.toLocaleDateString(undefined, {dateStyle: 'medium'});
}

/**
 * What this browser is holding, and what can be done about each part of it.
 *
 * The readings come from the browser at mount rather than from any stored
 * state: the numbers a user needs are the ones true right now, and there is no
 * server that could know them.
 */
export function StoragePanel() {
  const [reading, setReading] = useState<StorageReading | null>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  /** The chart whose export dialog is open, if any. */
  const [exporting, setExporting] = useState<StoredProject | null>(null);
  /** True until that dialog has loaded — seconds, on a cold click. */
  const [opening, setOpening] = useState(false);
  /** The chart the delete confirmation is asking about, if any. */
  const [confirming, setConfirming] = useState<StoredProject | null>(null);
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

  // Stable, because the export dialog lists them in an effect's dependencies.
  // New identities on every render made it re-read the chart, and a second
  // read that failed would have closed the dialog while the user was in it.
  const closeExport = useCallback(() => setExporting(null), []);
  const exportReady = useCallback(() => setOpening(false), []);
  const exportFailed = useCallback((reason: string) => {
    setExporting(null);
    setOpening(false);
    setStatus(reason);
  }, []);

  /**
   * Runs one action, reports what happened, and never leaves the page busy.
   *
   * The action says what to report, including for its own failures — several
   * of these answer false rather than throwing, and a caller that only handled
   * the throw would print a saving the next redraw contradicts.
   */
  const run = async (work: () => Promise<string>): Promise<void> => {
    setBusy(true);
    setStatus('');
    try {
      const said = await work();
      await refresh();
      setStatus(said);
    } catch (error) {
      await refresh();
      setStatus(
        error instanceof Error
          ? `That did not work: ${error.message}`
          : 'That did not work.',
      );
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

  const stemBytes = sum(reading.stems.map(entry => entry.sizeBytes));
  const named = reading.work.bytes + stemBytes + reading.modelBytes;
  // What the origin holds that no group names: site code the browser has
  // cached, and anything this page has not learned to measure. Stating it is
  // what stops the parts from looking like they disagree with the whole.
  const otherBytes = Math.max(
    0,
    (reading.pressure?.usageBytes ?? named) - named,
  );

  const segments: UsageSegment[] = [
    {
      key: 'work',
      label: 'Your charts and audio',
      bytes: reading.work.bytes,
      swatch: 'bg-foreground',
    },
    {
      key: 'stems',
      label: 'Separated stems',
      bytes: stemBytes,
      swatch: 'bg-foreground/70',
    },
    {
      key: 'models',
      label: 'Downloaded models',
      bytes: reading.modelBytes,
      swatch: 'bg-foreground/45',
    },
    {
      key: 'other',
      label: 'Everything else',
      bytes: otherBytes,
      swatch: 'bg-foreground/20',
    },
  ];

  // Asking helps whenever the browser has not already been told no and the
  // data is not already kept — including a permission that is granted but not
  // yet taken, which one call settles silently.
  const canAsk = !reading.persisted && reading.permission !== 'denied';

  /** The chart a cached stem belongs to, where one claims it. */
  const chartFor = (fingerprint: string): StoredProject | undefined =>
    reading.work.projects.find(
      project => project.stemFingerprint === fingerprint,
    );

  return (
    <div className="space-y-10">
      {exporting ? (
        <ChartExportDialog
          // Keyed, so choosing another chart builds a fresh dialog rather
          // than reusing one still holding the last chart's format choice.
          key={`${exporting.namespace}/${exporting.id}`}
          project={exporting}
          onClose={closeExport}
          onReady={exportReady}
          onFailed={exportFailed}
        />
      ) : null}

      <UsageBar
        segments={segments}
        quotaBytes={reading.pressure?.quotaBytes ?? 0}
      />

      <StorageGroup
        title="Your charts — kept"
        totalBytes={reading.work.bytes}
        note={
          reading.persisted
            ? 'This browser has promised to keep these. Nothing here is deleted to make room.'
            : 'This browser has not promised to keep these. It may delete them if it runs short of room.'
        }>
        {reading.work.projects.length === 0 ? (
          <StorageRow title="No charts stored yet" />
        ) : (
          reading.work.projects.map(project => (
            <StorageRow
              key={`${project.namespace}/${project.id}`}
              title={project.name}
              detail={
                [
                  project.artist,
                  project.isProject
                    ? formatDate(project.updatedAt)
                    : 'Unfinished — never opened as a chart',
                ]
                  .filter(Boolean)
                  .join(' · ') || undefined
              }
              sizeBytes={project.sizeBytes}
              actions={
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy || opening || !project.isProject}
                    onClick={() => {
                      setStatus('');
                      setOpening(true);
                      setExporting(project);
                    }}>
                    {opening && exporting?.id === project.id
                      ? 'Opening…'
                      : 'Download'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy || opening}
                    onClick={() => setConfirming(project)}>
                    Delete
                  </Button>
                </>
              }
            />
          ))
        )}
        {reading.work.databaseBytes > 0 ? (
          <StorageRow
            title="Song library and matching Chorus charts"
            detail="Kept with your charts, and not removable from here"
            sizeBytes={reading.work.databaseBytes}
          />
        ) : null}
      </StorageGroup>

      <StorageGroup
        title="Rebuildable — safe to free"
        totalBytes={stemBytes + reading.modelBytes}
        note="Nothing here is your work. Freeing it costs time the next time you use one of these songs, and nothing else.">
        {reading.stems.map(entry => {
          const chart = chartFor(entry.fingerprint);
          return (
            <StorageRow
              key={entry.fingerprint}
              title={chart?.name ?? 'Separated stems'}
              detail={
                chart
                  ? 'Separated drums and vocals'
                  : 'Not linked to a chart you still have'
              }
              sizeBytes={entry.sizeBytes}
              actions={
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    run(async () =>
                      (await deleteStemEntry(entry.fingerprint))
                        ? `Freed ${formatBytes(entry.sizeBytes)}.`
                        : 'Those stems are in use somewhere else right now.',
                    )
                  }>
                  Free
                </Button>
              }
            />
          );
        })}
        {reading.modelBytes > 0 ? (
          <StorageRow
            title="Separation models"
            detail="Downloaded again the next time you separate a song"
            sizeBytes={reading.modelBytes}
            actions={
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    // What went, not what was expected to go.
                    const freed = await deleteCachedModels();
                    return freed > 0
                      ? `Freed ${formatBytes(freed)}.`
                      : 'The models could not be freed right now.';
                  })
                }>
                Free
              </Button>
            }
          />
        ) : null}
        {reading.stems.length === 0 && reading.modelBytes === 0 ? (
          <StorageRow title="Nothing cached" />
        ) : null}
      </StorageGroup>

      <div className="flex flex-wrap gap-3">
        {stemBytes > 0 ? (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const result = await pruneStemCache({targetBytes: 0});
                return result == null
                  ? 'Another tab is working on a song right now. Try again when it has finished.'
                  : `Freed ${formatBytes(result.freedBytes)}.`;
              })
            }>
            Free all stems ({formatBytes(stemBytes)})
          </Button>
        ) : null}
        {canAsk ? (
          <Button
            disabled={busy}
            onClick={() =>
              run(async () => {
                const granted = await requestPersistentStorage();
                // The tag written at load says this session is unprotected.
                // Left alone it would say that for the session's whole life.
                if (granted) void attachStorageContext();
                return granted
                  ? 'This browser will keep your charts.'
                  : 'This browser did not agree to keep your charts.';
              })
            }>
            Ask this browser to keep my charts
          </Button>
        ) : null}
      </div>

      <AlertDialog
        open={confirming != null}
        onOpenChange={next => {
          if (!next) setConfirming(null);
        }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete &ldquo;{confirming?.name}&rdquo;?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This removes the chart and its audio from this browser. Nothing is
              stored anywhere else, so this cannot be undone. Download it first
              if you want a copy. Any separated stems for it stay, and can be
              freed below.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const project = confirming;
                setConfirming(null);
                if (project == null) return;
                void run(async () =>
                  (await deleteStoredProject(project.namespace, project.id))
                    ? `Deleted ${project.name}.`
                    : `Could not delete ${project.name}.`,
                );
              }}>
              Delete it
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
