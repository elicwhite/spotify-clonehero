/**
 * @jest-environment jsdom
 */
/**
 * What an export reports (plan 0105 Stage 5).
 *
 * This is the funnel's terminal event and the only member of
 * `AnalyticsEvent` carrying anything derived from the user's chart, so the
 * assertions here are as much about what is NOT sent as about what is: the
 * charter credit and an opaque song key go out, the song's title and artist
 * never do.
 */

import '@testing-library/jest-dom';
import {
  act,
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
} from '@testing-library/react';

import ExportDialog from '../ExportDialog';
import {songKey} from '@/lib/analytics/song-key';
import {MAX_GA_PARAM_LENGTH} from '@/lib/analytics/limits';

jest.mock('../../../lib/chart-export', () => ({
  assembleChartFiles: () => [{fileName: 'notes.chart', data: new Uint8Array()}],
  chartPackageFileName: (
    metadata: {name: string; artist: string; charter: string},
    ext: string,
  ) => `${metadata.artist} - ${metadata.name} (${metadata.charter}).${ext}`,
  packageChartFiles: (_files: unknown, format: string) => ({
    blob: new Blob(['x']),
    extension: format,
  }),
  transcodeAudioFilesToOpus: async (files: unknown[]) => ({
    files,
    durationMs: undefined,
  }),
}));

jest.mock('../../../lib/download', () => ({downloadBlob: jest.fn()}));

const trackMock = jest.fn();
// Only `track` is replaced. The module's constants are real: stubbing them
// away made `UNSET_ORIGIN` undefined and the dialog reported no origin at
// all, which the assertion below would otherwise have hidden.
jest.mock('../../../lib/analytics/track', () => ({
  ...jest.requireActual('../../../lib/analytics/track'),
  track: (payload: unknown) => trackMock(payload),
}));

beforeEach(() => {
  jest.clearAllMocks();
});

async function exportChart(props: Record<string, unknown> = {}) {
  // A test that exports twice renders two dialogs; without this both are in
  // the document and every query is ambiguous.
  cleanup();
  render(
    <ExportDialog
      origin="chart-editor"
      toolsApplied={[]}
      songName="Tom Sawyer"
      artistName="Rush"
      charterName="TheCharterName"
      getChartText={async () => '.chart text'}
      {...props}
    />,
  );
  await act(async () => {
    fireEvent.click(screen.getByRole('button', {name: /export/i}));
  });
  await act(async () => {
    fireEvent.click(
      screen.getByRole('button', {name: /download \.sng package/i}),
    );
  });
  await waitFor(() => expect(trackMock).toHaveBeenCalled());
  return trackMock.mock.calls.map(([payload]) => payload)[0];
}

test('reports the charter, the format, and the song as a key', async () => {
  const event = await exportChart({origin: 'tempo', toolsApplied: []});

  expect(event).toEqual({
    event: 'chart_exported',
    origin: 'tempo',
    format: 'sng',
    charter: 'TheCharterName',
    songKey: songKey('Rush', 'Tom Sawyer'),
    tools: '',
  });
});

test('a chart crediting nobody says so, rather than sending a blank', async () => {
  // Pinned here as well as in `charter-param.test.ts`: the unit test proves
  // the function, this proves the export actually calls it.
  const event = await exportChart({charterName: ''});
  expect(event.charter).toBe('uncredited');
});

test('an over-long credit is shortened rather than dropped by GA4', async () => {
  const event = await exportChart({charterName: 'x'.repeat(150)});
  expect(event.charter).toHaveLength(MAX_GA_PARAM_LENGTH);
});

test('never reports the song title or the artist', async () => {
  const event = await exportChart();
  const serialized = JSON.stringify(event);

  expect(serialized).not.toContain('Tom Sawyer');
  expect(serialized).not.toContain('Rush');
});

test('the key is the same for a re-export, and different for another song', async () => {
  const first = await exportChart();
  trackMock.mockClear();
  const second = await exportChart();
  expect(second.songKey).toBe(first.songKey);

  trackMock.mockClear();
  const other = await exportChart({songName: 'Limelight'});
  expect(other.songKey).not.toBe(first.songKey);
});

test('reports the applied tools, sorted so one combination is one row', async () => {
  const event = await exportChart({
    toolsApplied: ['generate-tempo-map', 'add-lyrics'],
  });
  expect(event.tools).toBe('lyrics,tempo');
});

test('every tool at once still fits inside a GA4 parameter', async () => {
  // The chart that used everything is the single most interesting row, and
  // with the raw task keys it was the one row GA4 would have dropped.
  const event = await exportChart({
    toolsApplied: [
      'add-leading-silence',
      'add-lyrics',
      'generate-difficulties',
      'generate-sections',
      'generate-tempo-map',
      'transcribe-drums',
    ],
  });
  expect(event.tools.length).toBeLessThanOrEqual(MAX_GA_PARAM_LENGTH);
  expect(event.tools.split(',')).toHaveLength(6);
});

test('a chart with no tools and an unknown origin reports both as such', async () => {
  // `unset` is deliberately not `chart-editor`: a host that cannot say where
  // the chart came from has to be visible in the data, not folded into the
  // editor's own traffic. Both props are required, so this is a value a host
  // chose rather than a default nobody saw.
  const event = await exportChart({origin: 'unset', toolsApplied: []});
  expect(event).toMatchObject({origin: 'unset', tools: ''});
});
