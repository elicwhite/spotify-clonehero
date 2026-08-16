import {filterTasteBreadcrumb, filterTasteTransaction} from '../taste-filters';

/**
 * These call the same functions `Sentry.init` is given in
 * `instrumentation-client.ts`. An earlier version of this file re-declared the
 * predicates locally, so deleting both filters from `Sentry.init` left every
 * assertion passing.
 */
describe('filterTasteTransaction', () => {
  // tracesSampleRate is 1 and @sentry/nextjs adds browserTracing
  // unconditionally, so an ungated transaction carries `http.client` spans for
  // api.spotify.com playlist and track URLs.
  it('drops a transaction recorded on a taste-data route', () => {
    const event = {request: {url: 'https://musiccharts.tools/find-music'}};
    expect(filterTasteTransaction(event, '/find-music')).toBeNull();
  });

  it('keeps a transaction recorded on an ordinary route', () => {
    const event = {request: {url: 'https://musiccharts.tools/chart-editor'}};
    expect(filterTasteTransaction(event, '/chart-editor')).toBe(event);
  });

  // A transaction is sent after its root span ends, by which time the user may
  // have navigated. The event's own URL is the one that describes it.
  it('drops on the event URL even after navigating away', () => {
    const event = {request: {url: 'https://musiccharts.tools/find-music'}};
    expect(filterTasteTransaction(event, '/chart-editor')).toBeNull();
  });

  it('falls back to the current pathname when the event has no URL', () => {
    expect(filterTasteTransaction({}, '/find-music')).toBeNull();
    expect(filterTasteTransaction({}, '/chart-editor')).not.toBeNull();
  });
});

describe('filterTasteBreadcrumb', () => {
  it.each(['console', 'fetch', 'xhr'])(
    'drops %s breadcrumbs on a taste-data route',
    category => {
      expect(filterTasteBreadcrumb({category}, '/find-music')).toBeNull();
    },
  );

  it.each(['console', 'fetch', 'xhr'])(
    'keeps %s breadcrumbs on an ordinary route',
    category => {
      const breadcrumb = {category};
      expect(filterTasteBreadcrumb(breadcrumb, '/chart-editor')).toBe(
        breadcrumb,
      );
    },
  );

  // The regression this file exists for. Sentry copies aria-label, title, alt
  // and name into a ui.* breadcrumb message, and on Find Music those attributes
  // name the song and the artist.
  it('strips serialized DOM attributes from a click on a taste-data route', () => {
    const result = filterTasteBreadcrumb(
      {
        category: 'ui.click',
        message:
          'button.h-7[aria-label="Not interested in Bohemian Rhapsody by Queen"][title="Less from Queen"]',
      },
      '/find-music',
    );

    expect(result?.message).toBe('button.h-7');
    expect(result?.message).not.toMatch(/Bohemian Rhapsody|Queen/);
  });

  it('keeps the element itself, so which button was pressed survives', () => {
    const result = filterTasteBreadcrumb(
      {category: 'ui.click', message: 'button#install[aria-label="Install X"]'},
      '/find-music',
    );

    expect(result?.message).toBe('button#install');
  });

  it('leaves click breadcrumbs alone on an ordinary route', () => {
    const breadcrumb = {
      category: 'ui.click',
      message: 'button[aria-label="Export chart"]',
    };
    expect(filterTasteBreadcrumb(breadcrumb, '/chart-editor')).toBe(breadcrumb);
  });

  it('keeps navigation breadcrumbs on a taste-data route', () => {
    const breadcrumb = {category: 'navigation'};
    expect(filterTasteBreadcrumb(breadcrumb, '/find-music')).toBe(breadcrumb);
  });
});
