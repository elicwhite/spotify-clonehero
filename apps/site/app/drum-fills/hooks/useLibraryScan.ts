'use client';

import {useCallback, useRef, useState} from 'react';
import {toast} from 'sonner';
import {
  getCachedSongsDirectoryHandle,
  pickSongsDirectory,
} from '@/lib/local-songs-folder';
import {
  startLibraryScan,
  type ScanHandle,
} from '@/lib/drum-fills/scan/scanController';
import type {ScanProgress} from '@/lib/drum-fills/scan/types';

/**
 * Library-scan orchestration shared by the Library and Grooves views: drives the
 * scan worker, resolves the Songs directory through `lib/local-songs-folder`
 * (stored folder first, picker only when there is none), and exposes progress
 * and cancel. On completion it invokes `onComplete` so the caller can reload
 * from the DB.
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

  const runScan = useCallback(async () => {
    // The folder is resolved before the worker starts, so the scan itself has
    // one outcome to report instead of a retry loop around a missing folder.
    const directoryHandle =
      (await getCachedSongsDirectoryHandle()) ?? (await pickSongsDirectory());
    if (directoryHandle == null) {
      return;
    }

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
      console.error('Scan failed', err);
      toast.error('Library scan failed. See console for details.');
    } finally {
      scanHandleRef.current = null;
      setScanning(false);
      setProgress(null);
    }
  }, [onComplete]);

  const cancelScan = useCallback(() => {
    scanHandleRef.current?.cancel();
  }, []);

  return {scanning, progress, runScan, cancelScan};
}
