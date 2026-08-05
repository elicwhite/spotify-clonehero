/**
 * @jest-environment jsdom
 */
/**
 * The export dialog: a package-format choice and nothing else.
 *
 * Song details belong to the song-details dialog, so this one collects no
 * metadata; it packages what the caller already has and downloads one of two
 * formats. These tests cover: no metadata inputs and no format dropdown; each
 * large button packages and downloads the format it names, reading
 * name/artist/charter straight from props; the chart source precedence
 * (`getChartFile` over `chartDoc` over `getChartText`); the secondary
 * chart-file-format and stem controls rendering only when the caller opts in;
 * and the busy state disabling both buttons mid-export.
 */

import '@testing-library/jest-dom';
import {act, render, screen, fireEvent, waitFor} from '@testing-library/react';

import ExportDialog from '../ExportDialog';

const packageChartFiles = jest.fn((_files: unknown, format: string) => ({
  blob: new Blob(['x']),
  extension: format,
}));
const assembleChartFiles = jest.fn((_options: unknown) => [
  {fileName: 'notes.chart', data: new Uint8Array()},
]);
const chartPackageFileName = jest.fn(
  (metadata: {name: string; artist: string; charter: string}, ext: string) =>
    `${metadata.artist} - ${metadata.name} (${metadata.charter}).${ext}`,
);
const transcodeAudioFilesToOpus = jest.fn(async (files: unknown[]) => ({
  files: files as any,
  durationMs: undefined,
}));

jest.mock('../../../lib/chart-export', () => ({
  assembleChartFiles: (options: unknown) => assembleChartFiles(options),
  chartPackageFileName: (
    metadata: {name: string; artist: string; charter: string},
    ext: string,
  ) => chartPackageFileName(metadata, ext),
  packageChartFiles: (files: unknown, format: string) =>
    packageChartFiles(files, format),
  transcodeAudioFilesToOpus: (files: unknown[]) =>
    transcodeAudioFilesToOpus(files),
}));

const downloadBlob = jest.fn();
jest.mock('../../../lib/download', () => ({
  downloadBlob: (blob: Blob, fileName: string) => downloadBlob(blob, fileName),
}));

beforeEach(() => {
  jest.clearAllMocks();
});

async function openDialog() {
  fireEvent.click(screen.getByRole('button', {name: /export/i}));
}

test('drops the metadata inputs and the format dropdown', async () => {
  render(
    <ExportDialog
      songName="Song"
      artistName="Artist"
      charterName="Charter"
      getChartText={async () => '.chart text'}
    />,
  );
  await openDialog();

  expect(screen.queryByLabelText(/song name/i)).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/^artist$/i)).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/charter/i)).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/^package$/i)).not.toBeInTheDocument();
});

test('renders two equal-weight package buttons', async () => {
  render(
    <ExportDialog songName="Song" getChartText={async () => '.chart text'} />,
  );
  await openDialog();

  expect(
    screen.getByRole('button', {name: /download \.zip package/i}),
  ).toBeInTheDocument();
  expect(
    screen.getByRole('button', {name: /download \.sng package/i}),
  ).toBeInTheDocument();
});

test('clicking the zip button packages as zip and downloads using prop metadata', async () => {
  render(
    <ExportDialog
      songName="Song"
      artistName="Artist"
      charterName="Charter"
      getChartText={async () => '.chart text'}
    />,
  );
  await openDialog();

  await act(async () => {
    fireEvent.click(
      screen.getByRole('button', {name: /download \.zip package/i}),
    );
  });

  await waitFor(() => expect(packageChartFiles).toHaveBeenCalled());
  expect(packageChartFiles.mock.calls[0][1]).toBe('zip');
  expect(assembleChartFiles.mock.calls[0][0]).toMatchObject({
    metadata: {name: 'Song', artist: 'Artist', charter: 'Charter'},
  });
  expect(downloadBlob).toHaveBeenCalledWith(
    expect.any(Blob),
    'Artist - Song (Charter).zip',
  );
});

test('clicking the sng button packages as sng', async () => {
  render(
    <ExportDialog songName="Song" getChartText={async () => '.chart text'} />,
  );
  await openDialog();

  await act(async () => {
    fireEvent.click(
      screen.getByRole('button', {name: /download \.sng package/i}),
    );
  });

  await waitFor(() => expect(packageChartFiles).toHaveBeenCalled());
  expect(packageChartFiles.mock.calls[0][1]).toBe('sng');
});

test('assembles from the live document rather than its .chart text', async () => {
  const chartDoc = {parsedChart: {metadata: {icon: 'harmonix'}}, assets: []};
  const getChartText = jest.fn(async () => '.chart text');
  render(
    <ExportDialog
      songName="Song"
      getChartText={getChartText}
      chartDoc={chartDoc as never}
    />,
  );
  await openDialog();

  await act(async () => {
    fireEvent.click(
      screen.getByRole('button', {name: /download \.zip package/i}),
    );
  });

  await waitFor(() => expect(assembleChartFiles).toHaveBeenCalled());
  // The document wins, so ini-only fields (`icon` here) reach the package;
  // parsing the `.chart` text alone would drop them.
  expect(assembleChartFiles.mock.calls[0][0]).toMatchObject({chartDoc});
  expect(assembleChartFiles.mock.calls[0][0]).not.toHaveProperty('chartText');
  expect(getChartText).not.toHaveBeenCalled();
});

test('prefers getChartFile over the live document', async () => {
  const chartFile = {fileName: 'notes.mid', data: new Uint8Array([1])};
  render(
    <ExportDialog
      songName="Song"
      getChartFile={async () => chartFile}
      chartDoc={{parsedChart: {metadata: {}}, assets: []} as never}
    />,
  );
  await openDialog();

  await act(async () => {
    fireEvent.click(
      screen.getByRole('button', {name: /download \.zip package/i}),
    );
  });

  await waitFor(() => expect(assembleChartFiles).toHaveBeenCalled());
  expect(assembleChartFiles.mock.calls[0][0]).toMatchObject({chartFile});
  expect(assembleChartFiles.mock.calls[0][0]).not.toHaveProperty('chartDoc');
});

test('hides the chart-file-format control unless the caller opts in', async () => {
  const {rerender} = render(
    <ExportDialog songName="Song" getChartText={async () => '.chart text'} />,
  );
  await openDialog();
  expect(screen.queryByLabelText(/chart file/i)).not.toBeInTheDocument();

  rerender(
    <ExportDialog
      songName="Song"
      getChartText={async () => '.chart text'}
      chartFormatSelectable
    />,
  );
  expect(screen.getByLabelText(/chart file/i)).toBeInTheDocument();
});

test('shows the stem toggle only when the caller offers a stem choice', async () => {
  render(
    <ExportDialog
      songName="Song"
      getChartText={async () => '.chart text'}
      getAudioSources={async () => []}
      showStemChoice
    />,
  );
  await openDialog();
  expect(screen.getByLabelText(/include stems/i)).toBeInTheDocument();
});

test('badges the button matching defaultFormat as recommended', async () => {
  render(
    <ExportDialog
      songName="Song"
      getChartText={async () => '.chart text'}
      defaultFormat="sng"
    />,
  );
  await openDialog();

  const sngButton = screen.getByRole('button', {
    name: /download \.sng package/i,
  });
  const zipButton = screen.getByRole('button', {
    name: /download \.zip package/i,
  });
  expect(sngButton).toHaveTextContent(/recommended/i);
  expect(zipButton).not.toHaveTextContent(/recommended/i);
});

test('disables both buttons while an export is in flight', async () => {
  let resolveChartText: (value: string) => void = () => {};
  render(
    <ExportDialog
      songName="Song"
      getChartText={() =>
        new Promise<string>(resolve => (resolveChartText = resolve))
      }
    />,
  );
  await openDialog();

  fireEvent.click(
    screen.getByRole('button', {name: /download \.zip package/i}),
  );

  await waitFor(() =>
    expect(
      screen.getByRole('button', {name: /download \.sng package/i}),
    ).toBeDisabled(),
  );
  expect(
    screen.getByRole('button', {name: /download \.zip package/i}),
  ).toBeDisabled();

  await act(async () => {
    resolveChartText('.chart text');
  });

  // The export completes and closes the dialog, rather than leaving both
  // buttons stuck disabled.
  await waitFor(() =>
    expect(
      screen.queryByRole('button', {name: /download \.sng package/i}),
    ).not.toBeInTheDocument(),
  );
});
