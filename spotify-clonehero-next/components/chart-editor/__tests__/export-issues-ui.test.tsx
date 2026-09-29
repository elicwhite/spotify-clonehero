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
import {act, render, screen, fireEvent} from '@testing-library/react';
import {noteTypes} from '@eliwhite/scan-chart';

import type {ChartDocument} from '@/lib/chart-edit';
import {addDrumNote, addSection, addTempo} from '@/lib/chart-edit';
import ExportDialog from '../ExportDialog';
import {makeEmptyDrumDoc, makeFixtureDoc} from './fixtures';

async function openDialog() {
  fireEvent.click(screen.getByRole('button', {name: /export/i}));
}

test('shows the bulleted issue list for a chart package missing audio', async () => {
  const chartDoc = makeFixtureDoc();
  render(
    <ExportDialog
      origin="chart-editor"
      toolsApplied={[]}
      songName="Song"
      chartDoc={chartDoc}
    />,
  );
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

/**
 * A drum chart scan-chart has nothing to say about: its first note is 2000ms
 * in (no `smallLeadingSilence`), it has sections and a tempo change (no
 * `noSections`, no `isDefaultBPM`), and it has no vocals, so the ini needs no
 * `diff_vocals`.
 */
function makeCleanDrumDoc(): ChartDocument {
  const doc = makeEmptyDrumDoc();
  const drums = doc.parsedChart.trackData[0];
  // 120 BPM at resolution 480: tick 1920 is exactly 2000ms.
  addDrumNote(drums, {tick: 1920, type: noteTypes.kick});
  addDrumNote(drums, {tick: 2400, type: noteTypes.redDrum});
  addDrumNote(drums, {tick: 2880, type: noteTypes.blueDrum});
  addSection(doc, 0, 'Intro');
  addSection(doc, 1920, 'Verse');
  addTempo(doc, 1920, 140);
  return doc;
}

/** The PNG signature and IHDR chunk of a 512x512 image — all scan-chart
 * reads to accept album art. */
function albumArtPng(): Uint8Array {
  const png = new Uint8Array(33);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // signature
  const view = new DataView(png.buffer);
  view.setUint32(8, 13); // IHDR data length
  png.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  view.setUint32(16, 512); // width
  view.setUint32(20, 512); // height
  png[24] = 8; // bit depth
  png[25] = 2; // colour type: RGB
  // Bytes 29-32 are the chunk CRC, left zero: the image parser does not
  // check it.
  return png;
}

test('reports a clean chart when the assembled package has no chart-checker issues', async () => {
  render(
    <ExportDialog
      origin="chart-editor"
      toolsApplied={[]}
      songName="Song"
      artistName="Artist"
      charterName="Charter"
      chartDoc={makeCleanDrumDoc()}
      getAudioSources={async () => [
        {fileName: 'song.opus', data: new Uint8Array([0, 1, 2, 3]).buffer},
      ]}
      getExtraAssets={async () => [
        {fileName: 'album.png', data: albumArtPng()},
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

  // Wait for the check's final state, not for the absence of an issue list:
  // while the scan runs the box reads "Checking for errors…", which has no
  // issue list either, so asserting absence could pass before the scan
  // finishes. "No errors found" only renders from a completed scan.
  expect(
    await screen.findByText(/no errors found in this chart/i),
  ).toBeInTheDocument();
  expect(
    screen.queryByText(/issue(s)? found in this chart/i),
  ).not.toBeInTheDocument();
});
