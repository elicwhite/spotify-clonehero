'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type {ScanProgress} from '@/lib/drum-fills/scan/types';
import {getFillCount} from '@/lib/drum-fills/db';
import {useLibraryScan} from '../hooks/useLibraryScan';

/**
 * Shared chrome state for the drum-fills tool, owned by `layout.tsx` and read by
 * the single header `[H]`. Two responsibilities:
 *
 *  - **Context slot** — a thin route-supplied breadcrumb/metadata node rendered
 *    in the header. Pages publish into it through `useChromeSlot` (an effect, not
 *    a render-time write — same one-way push as MidiContext) and the slot clears
 *    on unmount. This is the single canonical home for groove identity, ladder
 *    "Rung n/N", and the today-queue counter.
 *  - **Scan version** — bumped by the layout's scan-completion callback so mounted
 *    data pages (Home, Grooves, Library) re-fetch; replaces the old `refreshKey`.
 */
interface DrumFillsChromeValue {
  /** The node currently published into the header context slot. */
  slot: ReactNode;
  /** Publish (or clear with `null`) the header context slot. */
  setSlot: (node: ReactNode) => void;
  /** Monotonic counter bumped on each completed scan; key data refetches off it. */
  scanVersion: number;
  /** Called by the layout's scan-completion handler to trigger refetches. */
  bumpScanVersion: () => void;
  /**
   * Library-scan state, owned here so any surface (the header Rescan, Home's
   * first-run CTA, Grooves' empty state) can read/trigger one shared scan.
   * Scan completion bumps {@link scanVersion} so mounted data routes re-fetch.
   */
  scanning: boolean;
  scanProgress: ScanProgress | null;
  runScan: () => void;
}

const DrumFillsChromeContext = createContext<DrumFillsChromeValue | null>(null);

export function useDrumFillsChrome(): DrumFillsChromeValue {
  const ctx = useContext(DrumFillsChromeContext);
  if (!ctx)
    throw new Error(
      'useDrumFillsChrome must be used within DrumFillsChromeProvider',
    );
  return ctx;
}

/**
 * Publish a node into the header context slot for the lifetime of the calling
 * component. One-way push via effect; clears on unmount. Pass `null` to render
 * nothing.
 */
export function useChromeSlot(node: ReactNode): void {
  const {setSlot} = useDrumFillsChrome();
  useEffect(() => {
    setSlot(node);
    return () => setSlot(null);
  }, [setSlot, node]);
}

export function DrumFillsChromeProvider({children}: {children: ReactNode}) {
  const [slot, setSlot] = useState<ReactNode>(null);
  const [scanVersion, setScanVersion] = useState(0);

  const bumpScanVersion = useCallback(() => setScanVersion(v => v + 1), []);

  // Re-read fill presence on completion (kept so future surfaces can gate
  // first-run) and bump scanVersion so mounted data routes re-fetch.
  const onScanComplete = useCallback(async () => {
    try {
      await getFillCount();
    } catch {
      // surfaces handle their own empty/error states
    }
    bumpScanVersion();
  }, [bumpScanVersion]);

  const scan = useLibraryScan(onScanComplete);
  const runScan = useCallback(() => void scan.runScan(), [scan]);

  const value = useMemo<DrumFillsChromeValue>(
    () => ({
      slot,
      setSlot,
      scanVersion,
      bumpScanVersion,
      scanning: scan.scanning,
      scanProgress: scan.progress,
      runScan,
    }),
    [slot, scanVersion, bumpScanVersion, scan.scanning, scan.progress, runScan],
  );

  return (
    <DrumFillsChromeContext.Provider value={value}>
      {children}
    </DrumFillsChromeContext.Provider>
  );
}
