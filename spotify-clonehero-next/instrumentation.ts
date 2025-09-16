import * as Sentry from '@sentry/nextjs';

export function register() {
  // The config you add here will be used whenever the server handles a request.
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/
  Sentry.init({
    dsn: 'https://ef4de5241935af48ae2c81fbc23c6a46@o4506522084048896.ingest.sentry.io/4506522086080512',

    // Adjust this value in production, or use tracesSampler for greater control
    tracesSampleRate: 1,

    // Setting this option to true will print useful information to the console while you're setting up Sentry.
    debug: true,
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
