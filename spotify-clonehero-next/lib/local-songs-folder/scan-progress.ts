/**
 * Coalesces high-frequency scan progress ticks into at most one callback per
 * animation frame, so a per-chart callback driving React state doesn't fire
 * thousands of re-renders during a large library scan.
 *
 * This lives outside `scanLocalCharts` on purpose: the scanner only uses
 * worker-portable File System Access APIs, whereas `requestAnimationFrame` is
 * window-only. Keeping the rAF coupling here lets the scanner still run in a
 * worker, while main-thread UI callers opt into coalescing. Falls back to
 * `setTimeout` where rAF is unavailable (workers, SSR, tests).
 */

const scheduleFlush: (cb: () => void) => void =
  typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame
    : cb => setTimeout(cb, 0);

export interface CoalescedProgress {
  /** Pass as `scanLocalCharts`' per-song callback; records one processed item. */
  bump: () => void;
  /**
   * Emit the latest count immediately. Call once after the scan resolves so the
   * UI shows the final total without waiting on a trailing animation frame.
   */
  flush: () => void;
}

export function coalesceProgress(
  onProgress: (count: number) => void,
): CoalescedProgress {
  let count = 0;
  let scheduled = false;
  let lastEmitted = 0;

  const flush = () => {
    scheduled = false;
    if (count !== lastEmitted) {
      lastEmitted = count;
      onProgress(count);
    }
  };

  return {
    bump() {
      count++;
      if (!scheduled) {
        scheduled = true;
        scheduleFlush(flush);
      }
    },
    flush,
  };
}
