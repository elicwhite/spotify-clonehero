/**
 * Which tool the open chart is reported as coming from (plan 0105).
 *
 * This selector holds the single decision the whole funnel rests on: a host
 * that never published an origin reports a HOLE, not the editor. The two are
 * indistinguishable in a report once sent, so a default of `chart-editor`
 * would quietly fold every such chart into the editor's own traffic — which
 * is exactly how the drum-transcription editor went unnoticed for a round of
 * review.
 */

import {initialState} from '../state';
import {selectReportedOrigin} from '../selectors';

test('a chart whose host published no origin reports a hole', () => {
  expect(selectReportedOrigin(initialState)).toBe('unset');
});

test('the hole is not the editor', () => {
  // The point of the whole dimension is telling the tools apart. A chart
  // genuinely started in the editor and one whose host forgot must not
  // arrive as the same value.
  expect(selectReportedOrigin(initialState)).not.toBe('chart-editor');
});

test('a published origin is reported as itself', () => {
  for (const origin of ['tempo', 'add-lyrics', 'chart-editor'] as const) {
    expect(selectReportedOrigin({...initialState, chartOrigin: origin})).toBe(
      origin,
    );
  }
});
