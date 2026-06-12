'use client';

import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {set as idbSet} from 'idb-keyval';
import {toast} from 'sonner';
import {Button} from '@/components/ui/button';
import {Progress} from '@/components/ui/progress';
import {queryFills, type FillWithSrs} from '@/lib/local-db/drum-fills';
import {
  startLibraryScan,
  NEEDS_PICKER,
  type ScanHandle,
} from '@/lib/drum-fills/scan/scanController';
import type {ScanProgress} from '@/lib/drum-fills/scan/types';
import {
  DEFAULT_LIBRARY_FILTERS,
  filterFills,
  hasActiveFilters,
  availableVoicingTags,
  type LibraryFilters,
} from '@/lib/drum-fills/library/filterFills';
import MidiStatus from './MidiStatus';
import FilterPanel from './FilterPanel';
import FillCard from './FillCard';

type LoadState = 'loading' | 'ready';

export default function LibraryView({
  onPracticeFill,
}: {
  onPracticeFill: (fillId: string) => void;
}) {
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [fills, setFills] = useState<FillWithSrs[]>([]);
  const [filters, setFilters] = useState<LibraryFilters>(
    DEFAULT_LIBRARY_FILTERS,
  );

  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const scanHandleRef = useRef<ScanHandle | null>(null);

  const loadFills = useCallback(() => {
    return queryFills({})
      .then(rows => {
        setFills(rows);
      })
      .catch(err => {
        console.error('Failed to load fills', err);
        toast.error('Could not load saved fills.');
      })
      .finally(() => {
        setLoadState('ready');
      });
  }, []);

  useEffect(() => {
    void loadFills();
  }, [loadFills]);

  const runScan = useCallback(
    async (initialHandle?: FileSystemDirectoryHandle) => {
      const doScan = async (
        directoryHandle?: FileSystemDirectoryHandle,
      ): Promise<void> => {
        setScanning(true);
        setProgress(null);
        try {
          const handle = await startLibraryScan({
            directoryHandle,
            onProgress: p => setProgress(p),
          });
          scanHandleRef.current = handle;
          const result = await handle.done;
          if (result.cancelled) {
            toast.info('Scan cancelled.');
          } else {
            toast.success(
              `Scanned ${result.songsScanned} songs — found ${result.fillsFound} fills.`,
            );
          }
          await loadFills();
        } catch (err) {
          if (err instanceof Error && err.message === NEEDS_PICKER) {
            // No cached handle: prompt for the Songs folder, cache it, retry.
            try {
              const picked = await window.showDirectoryPicker({
                id: 'clone-hero-songs',
                mode: 'readwrite',
              });
              await idbSet('songsDirectoryHandle', picked);
              setScanning(false);
              await doScan(picked);
              return;
            } catch (pickErr) {
              // User cancelled the picker.
              console.warn('Directory pick cancelled', pickErr);
            }
          } else {
            console.error('Scan failed', err);
            toast.error('Library scan failed. See console for details.');
          }
        } finally {
          scanHandleRef.current = null;
          setScanning(false);
          setProgress(null);
        }
      };
      await doScan(initialHandle);
    },
    [loadFills],
  );

  const cancelScan = useCallback(() => {
    scanHandleRef.current?.cancel();
  }, []);

  const voicingTags = useMemo(() => availableVoicingTags(fills), [fills]);
  const visibleFills = useMemo(
    () => filterFills(fills, filters),
    [fills, filters],
  );
  const active = hasActiveFilters(filters);

  return (
    <div className="flex flex-1 flex-col gap-4">
      <MidiStatus />

      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3">
        <Button onClick={() => void runScan()} disabled={scanning}>
          {scanning
            ? 'Scanning…'
            : fills.length > 0
              ? 'Rescan Library'
              : 'Scan Library'}
        </Button>
        {scanning && (
          <Button variant="outline" onClick={cancelScan}>
            Cancel
          </Button>
        )}
        {scanning && progress && (
          <div className="flex flex-1 flex-col gap-1">
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>
                {progress.songsScanned}
                {progress.totalEstimate > 0
                  ? ` / ${progress.totalEstimate}`
                  : ''}{' '}
                songs · {progress.fillsFound} fills
              </span>
              <span className="truncate max-w-[40%]">
                {progress.currentSong ?? ''}
              </span>
            </div>
            <Progress
              value={
                progress.totalEstimate > 0
                  ? (progress.songsScanned / progress.totalEstimate) * 100
                  : undefined
              }
            />
          </div>
        )}
      </div>

      {loadState === 'ready' && fills.length === 0 && !scanning ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <h2 className="text-xl font-semibold">No fills yet</h2>
          <p className="max-w-md text-muted-foreground">
            Scan your Clone Hero Songs folder to detect drum fills across your
            library. Everything runs in your browser.
          </p>
        </div>
      ) : (
        <>
          {fills.length > 0 && (
            <FilterPanel
              filters={filters}
              onChange={setFilters}
              voicingTags={voicingTags}
              onReset={() => setFilters(DEFAULT_LIBRARY_FILTERS)}
              hasActive={active}
              resultCount={visibleFills.length}
            />
          )}

          {fills.length > 0 && visibleFills.length === 0 ? (
            <p className="py-10 text-center text-muted-foreground">
              No fills match the current filters.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {visibleFills.map(fill => (
                <FillCard
                  key={fill.id}
                  fill={fill}
                  onPractice={onPracticeFill}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
