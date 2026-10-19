import * as Sentry from '@sentry/nextjs';

/**
 * Whether the Session Replay integration has been registered on this client.
 *
 * `Sentry.getReplay()` cannot answer that question. It returns undefined
 * whenever the integration has not produced an instance — including when the
 * SDK is disabled, as it is in development — so treating a falsy result as
 * "not registered" registers a second one, and Sentry rejects that with
 * "Multiple Sentry Session Replay instances are not supported".
 *
 * Registration happens in exactly two places, and this module is what keeps them
 * from colliding: `instrumentation-client` at init when the first page load is
 * not a taste-data route, and `TasteDataPrivacyBoundary` on the first navigation
 * away from one when init skipped it.
 */
/**
 * The flag lives on `globalThis`, not in module scope. Replay's own
 * `_isInitialized` lives in `node_modules`, which Fast Refresh does not
 * re-evaluate; a module-scoped flag here would reset on the next edit while
 * Replay's stayed set, and the second `replayIntegration()` would throw again.
 * Sharing a lifetime with the page is the only way the two stay in step.
 */
const FLAG = '__musicChartsReplayRegistered';

type FlagHolder = {[FLAG]?: boolean};

function holder(): FlagHolder {
  return globalThis as unknown as FlagHolder;
}

/** Called by `instrumentation-client` when it passes Replay to `Sentry.init`. */
export function markReplayRegistered(): void {
  holder()[FLAG] = true;
}

export function ensureReplayRegistered(): void {
  if (holder()[FLAG]) return;
  holder()[FLAG] = true;
  try {
    Sentry.addIntegration(Sentry.replayIntegration());
  } catch (error) {
    // Registering twice is a privacy-neutral no-op, never a reason to break
    // the page. The crash this module exists for was exactly that.
    console.warn('Could not register Session Replay', error);
  }
}
