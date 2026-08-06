/**
 * @jest-environment jsdom
 */
/**
 * ExportDialog's chart-checker issues panel, rendered end-to-end (real
 * `assembleChartFiles`/`scanChart`, no mocking) against a `chartDoc` prop —
 * confirms the effect that runs on dialog open actually wires
 * `summarizeScanIssues`'s output into the UI, not just that the pure mapping
 * is correct in isolation (see `export-issues.test.ts`).
 */

import '@testing-library/jest-dom';
import {act, render, screen, fireEvent, waitFor} from '@testing-library/react';

import ExportDialog from '../ExportDialog';
import {makeFixtureDoc} from './fixtures';

async function openDialog() {
  fireEvent.click(screen.getByRole('button', {name: /export/i}));
}

test('shows the bulleted issue list for a chart package missing audio', async () => {
  const chartDoc = makeFixtureDoc();
  render(<ExportDialog songName="Song" chartDoc={chartDoc} />);
  await openDialog();

  expect(
    await screen.findByText(/issue(s)? found in this chart/i),
  ).toBeInTheDocument();
  expect(screen.getByText(/doesn't have an audio file/i)).toBeInTheDocument();

  // Let the issue-check effect's chain fully settle before the test (and
  // RTL's automatic unmount) ends, so no state update lands unwrapped.
  await act(async () => {});

  // Informational only — both export buttons stay enabled.
  expect(
    screen.getByRole('button', {name: /download \.zip package/i}),
  ).not.toBeDisabled();
  expect(
    screen.getByRole('button', {name: /download \.sng package/i}),
  ).not.toBeDisabled();
});

test('shows nothing when the assembled package has no chart-checker issues', async () => {
  const chartDoc = makeFixtureDoc();
  render(
    <ExportDialog
      songName="Song"
      artistName="Artist"
      charterName="Charter"
      chartDoc={chartDoc}
      getAudioSources={async () => [
        {fileName: 'song.opus', data: new Uint8Array([0, 1, 2, 3]).buffer},
      ]}
      iniMetadata={{
        name: 'Song',
        artist: 'Artist',
        charter: 'Charter',
        album: 'Album',
        genre: 'Rock',
        year: '2024',
        difficulties: {diff_drums: 3},
      }}
    />,
  );
  await openDialog();

  // Give the issue-check effect a tick to run and settle.
  await waitFor(() =>
    expect(
      screen.getByRole('button', {name: /download \.zip package/i}),
    ).toBeInTheDocument(),
  );
  await waitFor(() =>
    expect(
      screen.queryByText(/issue(s)? found in this chart/i),
    ).not.toBeInTheDocument(),
  );
});
