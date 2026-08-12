/**
 * Running work too big for one frame without freezing the page.
 *
 * The editor holds whole decoded songs in memory, and several passes over
 * them — interleaving a decode, scanning for waveform peaks — are a second or
 * more of straight-line arithmetic on a quarter of a billion samples. They run
 * while a project's audio arrives, which is while the editor is open and
 * possibly playing, so running them in one go shows up as a frozen highway and
 * a stalled playhead.
 */

/**
 * Hand control back to the event loop.
 *
 * A `MessageChannel` round trip rather than a timer: timers are clamped to a
 * second in a background tab, which would leave half-finished work sitting
 * there for minutes.
 */
export function yieldToEventLoop(): Promise<void> {
  return new Promise(resolve => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}

/** How long a slice may run before yielding. Comfortably inside a frame. */
export const SLICE_MS = 6;

/**
 * Run `step` over `total` items in slices, yielding between them, and adapt
 * the slice size to whatever this machine manages in {@link SLICE_MS}.
 *
 * `step` is called with a half-open range and must be resumable — the whole
 * point is that it stops and continues. `isCancelled` is polled between
 * slices; when it goes true the run stops where it is and resolves `false`,
 * so a caller whose inputs changed mid-run can drop the result.
 */
export async function runSliced(
  total: number,
  step: (from: number, to: number) => void,
  isCancelled: () => boolean = () => false,
): Promise<boolean> {
  let cursor = 0;
  // Start small: guessing high on a slow machine is a dropped frame, and the
  // measurement below corrects upward within one slice anyway.
  let budget = 200_000;
  while (cursor < total) {
    if (isCancelled()) return false;
    const end = Math.min(total, cursor + budget);
    const started = performance.now();
    step(cursor, end);
    const elapsed = performance.now() - started;
    cursor = end;
    budget = Math.max(
      50_000,
      Math.round(budget * (elapsed > 0 ? SLICE_MS / elapsed : 2)),
    );
    if (cursor < total) await yieldToEventLoop();
  }
  return !isCancelled();
}
