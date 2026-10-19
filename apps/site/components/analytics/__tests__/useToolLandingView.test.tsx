/**
 * @jest-environment jsdom
 */
/**
 * The funnel's first step (plan 0105).
 *
 * Two things can go wrong quietly. A landing page can report twice, which
 * inflates the widest step in the funnel and so deflates every conversion
 * rate measured against it. And a new landing route can simply forget to
 * report, which makes that page unmeasurable past its pageview — the exact
 * failure the plan says this step exists to prevent.
 */

import {readFileSync} from 'fs';
import {join} from 'path';
import {StrictMode} from 'react';
import {renderHook} from '@testing-library/react';

const trackMock = jest.fn();
jest.mock('../../../lib/analytics/track', () => ({
  ...jest.requireActual('../../../lib/analytics/track'),
  track: (payload: unknown) => trackMock(payload),
}));

import {useToolLandingView} from '../useToolLandingView';

const ROOT = join(__dirname, '..', '..', '..');

/** Which tool each landing client is required to report itself as. */
const LANDING_CLIENTS: Record<string, string> = {
  'app/add-lyrics/AddLyricsClient.tsx': 'add-lyrics',
  'app/tempo/TempoClient.tsx': 'tempo',
  'app/drum-transcription/DrumTranscriptionClient.tsx': 'drum-transcription',
  'app/drum-difficulties/DrumDifficultiesClient.tsx': 'drum-difficulties',
  'app/guitar-difficulties/GuitarDifficultiesClient.tsx': 'guitar-difficulties',
};

beforeEach(() => {
  trackMock.mockClear();
});

test('a mounted landing page reports itself once', () => {
  // Under Strict Mode React mounts every component twice in development.
  // Without the guard that is two views for one visit, which inflates the
  // funnel's widest step and so deflates every rate measured against it.
  renderHook(() => useToolLandingView('tempo'), {wrapper: StrictMode});

  expect(trackMock).toHaveBeenCalledTimes(1);
  expect(trackMock).toHaveBeenCalledWith({
    event: 'tool_landing_viewed',
    tool: 'tempo',
  });
});

test('a re-render does not report a second view', () => {
  const {rerender} = renderHook(() => useToolLandingView('tempo'));
  rerender();
  rerender();

  expect(trackMock).toHaveBeenCalledTimes(1);
});

test('every landing client reports, and reports its own tool', () => {
  // A file walk rather than five assertions: the failure to guard against is
  // a NEW landing route that forgets the hook, or one that copies another
  // page's tool. Both are invisible in the data.
  for (const [file, tool] of Object.entries(LANDING_CLIENTS)) {
    const source = readFileSync(join(ROOT, file), 'utf8');
    expect({
      file,
      call: source.match(/useToolLandingView\('[a-z-]+'\)/)?.[0],
    }).toEqual({file, call: `useToolLandingView('${tool}')`});
  }
});
