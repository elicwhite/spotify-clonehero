/**
 * @jest-environment jsdom
 */
/**
 * The funnel's first step reached Google Analytics for nobody, and every
 * test in the suite passed while it did.
 *
 * A landing page reports its view from a mount effect. Under hydration that
 * effect runs a whole commit before `RegionAwareAnalytics` resolves the
 * region cookie and mounts <GoogleAnalytics>, so `gtag` did not exist yet
 * and the event was discarded with a console warning. Nothing caught it
 * because the other tests replace `sendGAEvent` and <GoogleAnalytics> with
 * mocks, and because `render()` mounts in one commit and so cannot show the
 * ordering that production has.
 *
 * This test therefore uses the real @next/third-parties and the real
 * next/script, hydrates rather than renders, and asserts on what actually
 * lands in `window.dataLayer` — including that it lands after `config`, an
 * event ahead of which is not attributed to the property.
 */

// Hydration here is driven directly rather than through @testing-library,
// which sets this up itself.
(
  globalThis as unknown as {IS_REACT_ACT_ENVIRONMENT: boolean}
).IS_REACT_ACT_ENVIRONMENT = true;
// <GoogleAnalytics> marks a feature-use signal on mount and jsdom has no
// mark(), so without this the component throws before it can render.
performance.mark ??= (() => undefined) as unknown as typeof performance.mark;

import {act} from 'react';
import {hydrateRoot} from 'react-dom/client';

import RegionAwareAnalytics from '../RegionAwareAnalytics';
import {flushPendingEvents} from '@/lib/analytics/track';
import {useToolLandingView} from '@/components/analytics/useToolLandingView';

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
 * The server's markup for <App />, written out rather than produced with
 * react-dom/server: on the server `RegionAwareAnalytics` renders null, so
 * the page's own markup is all of it. It has to match `Landing` exactly —
 * a mismatch makes React discard the server tree and mount everything in
 * one client commit, which is the very ordering this test exists to check.
 */
const SERVER_HTML = '<main>tempo</main>';

function hydrate(): void {
  const container = document.createElement('div');
  container.innerHTML = SERVER_HTML;
  document.body.appendChild(container);
  act(() => {
    hydrateRoot(container, <App />);
  });
}

afterEach(() => {
  document.cookie = 'gaRegion=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  // Assigned, not deleted: the init script declares `gtag` as a global
  // function, which jsdom makes non-configurable.
  (window as unknown as {dataLayer?: unknown}).dataLayer = undefined;
  (window as unknown as {gtag?: unknown}).gtag = undefined;
});

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

test('an EEA visitor sends nothing at all', () => {
  document.cookie = 'gaRegion=eea';

  hydrate();

  expect(commands()).toEqual([]);
});

test('an EEA visitor is not held in memory either', () => {
  document.cookie = 'gaRegion=eea';

  hydrate();

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
