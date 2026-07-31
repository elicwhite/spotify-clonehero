/**
 * /add-lyrics export packaging.
 *
 * The regression these lock down: the Download button used to re-derive the
 * exported chart by re-applying the aligner's output to the chart as loaded,
 * so every manual timing fix the user made in the editor was dropped from the
 * downloaded file. Export must serialize the editor session's live document.
 */

import {unzipSync, strFromU8} from 'fflate';
import {EditorSession} from '@/lib/chart-editor-core';
import {ADD_LYRICS_CAPABILITIES} from '@/components/chart-editor/capabilities';
import {MoveEntitiesCommand} from '@/components/chart-editor/commands';
import {lyricId} from '@/lib/chart-edit/helpers/lyrics';
import type {ChartDocument} from '@/lib/chart-edit';
import {applyAlignedLyricsToDoc} from '@/lib/lyrics-align/apply-lyrics';
import type {AlignedSyllable} from '@/lib/lyrics-align/aligner';
import {makeFixtureDoc} from '@/components/chart-editor/__tests__/fixtures';
import {buildChartExport} from '../export-chart';

const SYLLABLES: AlignedSyllable[] = [
  {text: 'hel', startMs: 1000, endMs: 1250, joinNext: true, newLine: true},
  {text: 'lo', startMs: 1250, endMs: 1500, joinNext: false, newLine: false},
  {text: 'there', startMs: 2000, endMs: 2400, joinNext: false, newLine: true},
];

/** The doc the page hands the editor: chart as loaded + aligned lyrics. */
function makeAlignedDoc(): ChartDocument {
  return applyAlignedLyricsToDoc(makeFixtureDoc(), SYLLABLES);
}

function lyricTicks(doc: ChartDocument): number[] {
  return (
    doc.parsedChart.vocalTracks.parts['vocals']?.notePhrases.flatMap(p =>
      p.lyrics.map(l => l.tick),
    ) ?? []
  );
}

/** Read a file out of an exported .zip blob. */
async function readFromZip(blob: Blob, fileName: string): Promise<string> {
  const zip = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  const file = zip[fileName];
  if (!file) throw new Error(`${fileName} missing from export`);
  return strFromU8(file);
}

/**
 * Drive the same path the page does: seed the aligned doc, then move a lyric
 * the way a highway drag would. Returns the session's live document.
 */
function moveFirstLyric(tickDelta: number): {
  seeded: ChartDocument;
  edited: ChartDocument;
} {
  const seeded = makeAlignedDoc();
  const session = new EditorSession({}, ADD_LYRICS_CAPABILITIES);
  session.dispatch({type: 'SET_CHART_DOC', chartDoc: seeded});

  const firstTick = lyricTicks(seeded)[0];
  const command = new MoveEntitiesCommand(
    'lyric',
    [lyricId(firstTick)],
    tickDelta,
    0,
  );
  session.dispatch({
    type: 'EXECUTE_COMMAND',
    command,
    chartDoc: command.execute(seeded),
  });

  const edited = session.getState().chartDoc;
  if (!edited) throw new Error('session lost the chart doc');
  return {seeded, edited};
}

describe('buildChartExport', () => {
  it('serializes the editor doc, keeping edits made after alignment', async () => {
    const {seeded, edited} = moveFirstLyric(120);

    const seededTicks = lyricTicks(seeded);
    const editedTicks = lyricTicks(edited);
    expect(editedTicks).not.toEqual(seededTicks);
    expect(editedTicks).toContain(seededTicks[0] + 120);

    // Every lyric tick the editor holds shows up in the downloaded chart, and
    // the pre-edit tick is gone — i.e. the download reflects the drag.
    const {blob} = buildChartExport(edited, 'zip', 'Song');
    const text = await readFromZip(blob, 'notes.chart');
    for (const tick of editedTicks) {
      expect(text).toMatch(new RegExp(`^\\s*${tick} = E `, 'm'));
    }
    expect(text).not.toMatch(new RegExp(`^\\s*${seededTicks[0]} = E `, 'm'));
  });

  it('leaves the source chart identity alone', async () => {
    // This page round-trips somebody else's chart, so unlike the flows that
    // mint one (drum transcription, /difficulties) it must not stamp drum
    // ratings or rewrite the charter credit onto a chart that never had them.
    const doc = makeAlignedDoc();
    doc.parsedChart.metadata.charter = 'Original Charter';

    const {blob} = buildChartExport(doc, 'zip', 'Song');
    const ini = await readFromZip(blob, 'song.ini');

    expect(ini).toContain('charter = Original Charter');
    expect(ini).not.toMatch(/pro_drums/);
    expect(ini).not.toMatch(/diff_drums/);
  });

  it('packages a zip source as .zip under the original name', async () => {
    const {blob, fileName} = buildChartExport(
      makeAlignedDoc(),
      'zip',
      'My Song',
    );

    expect(fileName).toBe('My Song.zip');
    const zip = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    expect(Object.keys(zip)).toContain('notes.chart');
    expect(Object.keys(zip)).toContain('song.ini');
  });

  it('packages a folder source as .zip', () => {
    const {fileName} = buildChartExport(makeAlignedDoc(), 'folder', 'Song');
    expect(fileName).toBe('Song.zip');
  });

  it('packages an sng source as .sng', () => {
    const {blob, fileName} = buildChartExport(makeAlignedDoc(), 'sng', 'Song');
    expect(fileName).toBe('Song.sng');
    expect(blob.size).toBeGreaterThan(0);
  });
});
