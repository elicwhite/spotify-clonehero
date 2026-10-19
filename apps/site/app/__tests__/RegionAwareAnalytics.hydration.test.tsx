/**
 * @jest-environment jsdom
 */
/**
 * The funnel's first step reached Google Analytics for nobody, and every
 * test in the suite passed while it did.
 *
 * A landing page reports its view from a mount effect, which runs before
 * `RegionAwareAnalytics` has resolved the region cookie and mounted
 * <GoogleAnalytics>. Nothing caught that, because the tests around it mock
 * <GoogleAnalytics> away and mock the transport out — so no assertion ever
 * reached the code that decides whether an event is sent.
 *
 * This test therefore mocks nothing: the real @next/third-parties, the real
 * next/script, and assertions on what lands in `window.dataLayer`, including
 * that it lands after `config` — an event ahead of which is not attributed
 * to the property. It hydrates rather than renders because that is the shape
 * production has: the page's effects run one commit before the analytics
 * loader's.
 */

import {act} from 'react';
import {hydrateRoot, type Root} from 'react-dom/client';

import RegionAwareAnalytics from '../RegionAwareAnalytics';
import {flushPendingEvents} from '@/lib/analytics/track';
import {useToolLandingView} from '@/components/analytics/useToolLandingView';

// Hydration here is driven directly rather than through @testing-library,
// which sets this up itself.
(
  globalThis as unknown as {IS_REACT_ACT_ENVIRONMENT: boolean}
).IS_REACT_ACT_ENVIRONMENT = true;
// <GoogleAnalytics> marks a feature-use signal on mount and jsdom has no
// mark(), so without this the component throws before it can render.
performance.mark ??= (() => undefined) as unknown as typeof performance.mark;

const GA_ID = 'G-TEST';

function Landing() {
  useToolLandingView('tempo');
  return <main>tempo</main>;
}

/** The shape of `app/layout.tsx`: the page, then the analytics loader. */
function App() {
  return (
    <>
      <Landing />
      <RegionAwareAnalytics gaId={GA_ID} />
    </>
  );
}

/** Every gtag command pushed onto the dataLayer, oldest first. */
function commands(): unknown[][] {
  const layer = (window as unknown as {dataLayer?: IArguments[]}).dataLayer;
  return (layer ?? []).map(entry => Array.from(entry));
}

/**
 * What the server sends for <App />: `RegionAwareAnalytics` renders null
 * there, so `Landing`'s markup is all of it. It must match `Landing`
 * exactly. A mismatch makes React discard the server tree and mount
 * everything in one commit, which is the ordering this test exists to rule
 * out — and React only warns about it, so `hydrate` fails on a console
 * complaint rather than trusting this string to stay right.
 */
const SERVER_HTML = '<main>tempo</main>';

let root: Root | undefined;

function hydrate(): void {
  const container = document.createElement('div');
  container.innerHTML = SERVER_HTML;
  document.body.appendChild(container);

  const complaints: unknown[][] = [];
  const error = jest
    .spyOn(console, 'error')
    .mockImplementation((...args: unknown[]) => complaints.push(args));
  try {
    act(() => {
      root = hydrateRoot(container, <App />);
    });
  } finally {
    error.mockRestore();
  }
  expect(complaints).toEqual([]);
}

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.cookie = 'gaRegion=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  // Assigned, not deleted: the init script declares `gtag` as a global
  // function, which jsdom makes non-configurable.
  (window as unknown as {dataLayer?: unknown}).dataLayer = undefined;
  (window as unknown as {gtag?: unknown}).gtag = undefined;
});

// One case in this file may render <GoogleAnalytics>. `next/script` keeps a
// module-level LoadCache, so a second one gets no init script, no `gtag` and
// no `dataLayer` — and an assertion that nothing was sent would pass for the
// wrong reason. A second GA-rendering case belongs in its own file.
test('a landing view reported during hydration reaches gtag, after config', () => {
  document.cookie = 'gaRegion=other';

  hydrate();

  const sent = commands();
  const config = sent.findIndex(c => c[0] === 'config' && c[1] === GA_ID);
  const event = sent.findIndex(
    c => c[0] === 'event' && c[1] === 'tool_landing_viewed',
  );

  expect(config).toBeGreaterThanOrEqual(0);
  expect(event).toBeGreaterThan(config);
  expect(sent[event][2]).toEqual({tool: 'tempo'});
});

test('an EEA visitor is neither sent nor held in memory', () => {
  document.cookie = 'gaRegion=eea';

  hydrate();

  expect(commands()).toEqual([]);

  // Sending nothing is not the whole rule. A queue that is never flushed is
  // still a record of what this visitor did, and it is one future flush
  // trigger — a consent banner, a re-mount, a late-gtag retry — away from
  // being sent in one go. So gtag is put in place afterwards and the queue
  // is asked to drain: there must be nothing in it to drain.
  const layer: unknown[][] = [];
  (window as unknown as {dataLayer: unknown[]}).dataLayer = layer;
  (window as unknown as {gtag: (...args: unknown[]) => void}).gtag = (
    ...args
  ) => {
    layer.push(args);
  };
  flushPendingEvents();

  expect(layer).toEqual([]);
});
