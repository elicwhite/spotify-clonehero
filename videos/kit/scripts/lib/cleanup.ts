/**
 * Cleanup that must also happen when a tool is interrupted (Ctrl-C, a kill):
 * scratch folders, half-written outputs, Remotion bundles. Node runs no
 * `finally` block when a signal ends it, so each of those registers here for
 * as long as it exists, and the first SIGINT or SIGTERM runs them all before
 * exiting.
 */
const pending = new Set<() => void>();
let installed = false;

function install(): void {
  if (installed) return;
  installed = true;
  for (const [signal, code] of [
    ['SIGINT', 130],
    ['SIGTERM', 143],
  ] as const) {
    process.once(signal, () => {
      for (const fn of pending) {
        try {
          fn();
        } catch {
          // Keep going: the rest still need cleaning.
        }
      }
      process.exit(code);
    });
  }
}

/** Runs `fn` if the process is interrupted before the returned release is called. */
export function onInterrupt(fn: () => void): () => void {
  install();
  pending.add(fn);
  return () => {
    pending.delete(fn);
  };
}
