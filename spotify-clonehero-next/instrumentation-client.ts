// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from '@sentry/nextjs';
import {getSentryEnvironment, isSentryEnabled} from '@/lib/sentry/environment';
import {rendersPersonalTasteData} from '@/lib/apple-music/private-route';
import {markReplayRegistered} from '@/lib/sentry/replay';
import {attachStorageContext} from '@/lib/sentry/storage-context';
import {
  filterTasteBreadcrumb,
  filterTasteTransaction,
} from '@/lib/sentry/taste-filters';

const sentryEnvironment = getSentryEnvironment(
  process.env['NEXT_PUBLIC_VERCEL_ENV'],
);
const isInitialTasteDataPrivate = rendersPersonalTasteData(
  typeof window === 'undefined' ? undefined : window.location.pathname,
);
const currentPathname = () =>
  typeof window === 'undefined' ? undefined : window.location.pathname;

// `replayIntegration()` throws if it is ever called twice, so the one place that
// decides to call it also records that it did.
function initialIntegrations() {
  if (isInitialTasteDataPrivate) return [];
  markReplayRegistered();
  return [Sentry.replayIntegration()];
}

// Sentry initializes on every route. Skipping it when the first load was a
// taste-data route meant a user landing directly on /find-music had no SDK at
// all, so that whole feature reported nothing — a broken Chorus refresh took a
// Discord thread and a screenshot of the user's console to diagnose.
//
// Errors from those routes are reported. Session Replay is what must not run
// there: it records the DOM, which on /find-music is the user's songs, artists,
// and playlists. It is therefore registered only when the first load was not a
// taste-data route, and added later by TasteDataPrivacyBoundary on the first
// navigation to one that is not. `stop()` alone is not enough — a buffer that
// was never created cannot be flushed by an integration that loads too early.
Sentry.init({
  dsn: 'https://ef4de5241935af48ae2c81fbc23c6a46@o4506522084048896.ingest.us.sentry.io/4506522086080512',

  environment: sentryEnvironment,

  integrations: initialIntegrations(),

  // Define how likely traces are sampled. Adjust this value in production, or use tracesSampler for greater control.
  tracesSampleRate: 1,

  // Define how likely Replay events are sampled.
  // This sets the sample rate to be 10%. You may want this to be 100% while
  // in development and sample at a lower rate in production
  replaysSessionSampleRate: 0.0,

  // Define how likely Replay events are sampled when an error occurs.
  replaysOnErrorSampleRate: 0.2,

  // Setting this option to true will print useful information to the console while you're setting up Sentry.
  debug: false,

  enabled: isSentryEnabled(sentryEnvironment),

  // Errors from taste-data routes are wanted. What those errors carry with
  // them — the console, the network, and the DOM attributes Sentry copies into
  // click breadcrumbs — is where the user's library would otherwise ride along.
  // `lib/sentry/taste-filters` holds the rules so they can be tested directly.
  beforeSendTransaction: event =>
    filterTasteTransaction(event, currentPathname()),
  beforeBreadcrumb: breadcrumb =>
    filterTasteBreadcrumb(breadcrumb, currentPathname()),
});

// A Chrome eviction destroys the user's chart projects and is reported as
// "my songs are gone", never as a quota figure. Reading the quota here puts
// that figure on the events this session sends once the read resolves, so the
// next such report can be told apart from a bug that only looks like one.
void attachStorageContext();

export const onRouterTransitionStart = (
  ...args: Parameters<typeof Sentry.captureRouterTransitionStart>
) => {
  const [href] = args;
  const targetPath =
    typeof window === 'undefined'
      ? href
      : new URL(href, window.location.origin).pathname;
  if (rendersPersonalTasteData(targetPath)) {
    void Sentry.getReplay()?.stop();
    return;
  }
  if (rendersPersonalTasteData(currentPathname())) return;
  return Sentry.captureRouterTransitionStart(...args);
};
