/**
 * How a refused chart is classified for analytics (plan 0105 Stage 4).
 *
 * The gap between a landing view and `chart_opened` is the funnel's most
 * likely silent drop, and the most likely cause is a user arriving with a
 * chart the editor will not take. The reason has to say which refusal it
 * was — a single open string field is how
 * `add_lyrics_align_failed` came to report `"unknown"` for all 47 of its
 * failures.
 */

import {
  chartOpenFailureReason,
  NO_AUDIO_MESSAGE,
  NO_SUPPORTED_TRACK_MESSAGE,
} from '../chartOpenFailure';

test('a chart with nothing playable is reported as such', () => {
  expect(chartOpenFailureReason(new Error(NO_SUPPORTED_TRACK_MESSAGE))).toBe(
    'no-supported-track',
  );
});

test('a chart package with no audio is reported as such', () => {
  expect(chartOpenFailureReason(new Error(NO_AUDIO_MESSAGE))).toBe('no-audio');
});

test('anything thrown by parsing falls to parse-error', () => {
  expect(chartOpenFailureReason(new Error('Unexpected end of file'))).toBe(
    'parse-error',
  );
  // Including a throw that was never an Error at all.
  expect(chartOpenFailureReason('boom')).toBe('parse-error');
  expect(chartOpenFailureReason(undefined)).toBe('parse-error');
});

test('a failure after the chart was accepted is storage, not a bad chart', () => {
  // The same throw means different things either side of the point where the
  // chart itself was accepted. A full disk in the `parse-error` column would
  // overstate "users arriving with charts we refuse".
  expect(chartOpenFailureReason(new Error('quota exceeded'), true)).toBe(
    'storage-error',
  );
  expect(chartOpenFailureReason(new Error('quota exceeded'), false)).toBe(
    'parse-error',
  );
});

test('a chart the editor refuses stays refused whenever it is classified', () => {
  // These two are properties of the chart, so `chartAccepted` cannot change
  // them — it only ever separates parsing from storage.
  for (const accepted of [false, true]) {
    expect(
      chartOpenFailureReason(new Error(NO_SUPPORTED_TRACK_MESSAGE), accepted),
    ).toBe('no-supported-track');
    expect(chartOpenFailureReason(new Error(NO_AUDIO_MESSAGE), accepted)).toBe(
      'no-audio',
    );
  }
});

test('the reasons this classifier produces are distinguishable, not one bucket', () => {
  const reasons = new Set([
    chartOpenFailureReason(new Error(NO_SUPPORTED_TRACK_MESSAGE)),
    chartOpenFailureReason(new Error(NO_AUDIO_MESSAGE)),
    chartOpenFailureReason(new Error('anything else')),
    chartOpenFailureReason(new Error('anything else'), true),
  ]);
  expect(reasons.size).toBe(4);
  // The difficulty route names its reasons where it decides them, so it
  // reaches `storage-error` directly rather than through this classifier.
});
