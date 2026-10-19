/**
 * `readChartForEditing` — the parse the chart editor's hosts open a package
 * with.
 *
 * The rule under test is a round trip, not a flag: the editor offers a cymbal
 * toggle on every four-lane drum track, but the .chart writer only emits a
 * cymbal marker for a pro-drums chart. So a chart that arrives as basic
 * four-lane has to become pro-drums at parse time, or cymbal edits are shown,
 * saved, and lost on the next read. Five-lane charts must NOT be swept up in
 * that: `pro_drums` outranks five-lane detection in scan-chart.
 */

import {
  createEmptyChart,
  drumTypes,
  noteFlags,
  noteTypes,
  readChart,
  readChartForEditing,
  setDrumNoteFlags,
  writeChartFolder,
  addDrumNote,
  type ChartDocument,
  type File,
} from '..';
import {emptyTrackData} from './test-utils';

/** Serialize a doc the way the editor's autosave does. */
function chartFiles(doc: ChartDocument): File[] {
  doc.parsedChart.format = 'chart';
  return writeChartFolder(doc).filter(f => f.fileName === 'notes.chart');
}

/**
 * A drums chart with one kick and one yellow tom, written at `drumType`.
 * No song.ini, so nothing but the chart's own events tells a reader what
 * kind of drum chart this is — the case a plain community 4-lane chart hits.
 */
function drumsChartFiles(drumType: number): File[] {
  const parsed = createEmptyChart({bpm: 120, resolution: 192});
  parsed.drumType = drumType as typeof parsed.drumType;
  parsed.trackData.push(emptyTrackData('drums', 'expert'));
  const doc: ChartDocument = {parsedChart: parsed, assets: []};
  addDrumNote(doc.parsedChart.trackData[0], {tick: 0, type: noteTypes.kick});
  addDrumNote(doc.parsedChart.trackData[0], {
    tick: 192,
    type: noteTypes.yellowDrum,
  });
  if (drumType === drumTypes.fiveLane) {
    addDrumNote(doc.parsedChart.trackData[0], {
      tick: 384,
      type: noteTypes.greenDrum,
    });
  }
  return chartFiles(doc);
}

function expertDrums(doc: ChartDocument) {
  const track = doc.parsedChart.trackData.find(
    t => t.instrument === 'drums' && t.difficulty === 'expert',
  );
  if (!track) throw new Error('no expert drums track');
  return track;
}

describe('readChartForEditing', () => {
  it('opens a basic four-lane drum chart as pro-drums, so a cymbal edit survives the save it is written with', () => {
    const files = drumsChartFiles(drumTypes.fourLane);

    // Baseline: parsed as it is on disk, this chart is basic four-lane.
    expect(readChart(files).parsedChart.drumType).toBe(drumTypes.fourLane);

    const doc = readChartForEditing(files);
    expect(doc.parsedChart.drumType).toBe(drumTypes.fourLanePro);

    // The edit the editor's cymbal toggle makes.
    setDrumNoteFlags(
      expertDrums(doc),
      192,
      noteTypes.yellowDrum,
      noteFlags.cymbal,
    );

    const reloaded = readChartForEditing(chartFiles(doc));
    const reloadedYellow = expertDrums(reloaded)
      .noteEventGroups.flat()
      .find(n => n.type === noteTypes.yellowDrum)!;
    expect(reloadedYellow.flags & noteFlags.cymbal).toBeTruthy();
  });

  it('leaves a five-lane chart five-lane, rather than re-reading it as four-lane pro', () => {
    const files = drumsChartFiles(drumTypes.fiveLane);

    expect(readChartForEditing(files).parsedChart.drumType).toBe(
      drumTypes.fiveLane,
    );
  });

  it('leaves a chart that is already pro-drums alone', () => {
    const parsed = createEmptyChart({bpm: 120, resolution: 192});
    parsed.drumType = drumTypes.fourLanePro;
    parsed.trackData.push(emptyTrackData('drums', 'expert'));
    const doc: ChartDocument = {parsedChart: parsed, assets: []};
    addDrumNote(doc.parsedChart.trackData[0], {
      tick: 0,
      type: noteTypes.yellowDrum,
      flags: noteFlags.cymbal,
    });

    const reloaded = readChartForEditing(chartFiles(doc));
    expect(reloaded.parsedChart.drumType).toBe(drumTypes.fourLanePro);
    const note = expertDrums(reloaded).noteEventGroups.flat()[0];
    expect(note.flags & noteFlags.cymbal).toBeTruthy();
  });

  it('leaves a chart with no drums at all alone', () => {
    const parsed = createEmptyChart({bpm: 120, resolution: 192});
    parsed.trackData.push(emptyTrackData('guitar', 'expert'));
    const doc: ChartDocument = {parsedChart: parsed, assets: []};

    const reloaded = readChartForEditing(chartFiles(doc));
    expect(reloaded.parsedChart.drumType).toBeNull();
    expect(reloaded.parsedChart.trackData).toHaveLength(1);
  });
});
