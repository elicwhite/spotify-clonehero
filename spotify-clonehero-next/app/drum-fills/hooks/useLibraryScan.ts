'use client';

import {useCallback, useRef, useState} from 'react';
import {set as idbSet} from 'idb-keyval';
import {toast} from 'sonner';
import {
  startLibraryScan,
  NEEDS_PICKER,
  type ScanHandle,
} from '@/lib/drum-fills/scan/scanController';
import type {ScanProgress} from '@/lib/drum-fills/scan/types';

/**
 * Library-scan orchestration shared by the Library and Grooves views: drives the
 * scan worker, caches the picked Songs directory handle in IndexedDB (so the
 * picker doesn't reappear every reload), and exposes progress + cancel. On
 * completion it invokes `onComplete` so the caller can reload from the DB.
 *
 * `onComplete` may return the number of fills actually persisted (distinct rows
 * in the DB). The worker's `fillsFound` counter double-counts duplicate song
 * folders (same chart_hash), so the success toast reports the persisted count
 * when available to match what the grid shows.
 */
export function useLibraryScan(
  onComplete?: () => number | void | Promise<number | void>,
) {
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const scanHandleRef = useRef<ScanHandle | null>(null);

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
          const persisted = await onComplete?.();
          if (result.cancelled) {
            toast.info('Scan cancelled.');
          } else {
            const fillCount =
              typeof persisted === 'number' ? persisted : result.fillsFound;
            toast.success(
              `Scanned ${result.songsScanned} songs — found ${fillCount} fills.`,
            );
          }
        } catch (err) {
          if (err instanceof Error && err.message === NEEDS_PICKER) {
            try {
              const picked = await window['showDirectoryPicker']({
                id: 'clone-hero-songs',
                mode: 'readwrite',
              });
              await idbSet('songsDirectoryHandle', picked);
              setScanning(false);
              await doScan(picked);
              return;
            } catch (pickErr) {
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
    [onComplete],
  );

  const cancelScan = useCallback(() => {
    scanHandleRef.current?.cancel();
  }, []);

  return {scanning, progress, runScan, cancelScan};
}
