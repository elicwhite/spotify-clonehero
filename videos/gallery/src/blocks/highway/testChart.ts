/**
 * The kit's invented test chart, parsed the way the chart editor opens it,
 * and its probe note for the smoke check. No song material.
 */
import {useMemo} from 'react';
import type {ChartDocument} from '@eliwhite/scan-chart';
import {readChartForEditing} from '@product/lib/chart-edit';
import {
  EXPERT_DRUMS,
  laneOfNoteType,
  noteIdOf,
  TEST_PROBE_NOTE,
  testChartFiles,
  trackNotes,
  type SmokeProbe,
} from '@musiccharts/video-kit/highway';

/** The test chart (16 bars at 120 BPM: a bar is 2 s), parsed once per component the way the editor opens a chart. */
export const useTestChart = (): ChartDocument =>
  useMemo(() => readChartForEditing(testChartFiles()), []);

/** The test chart's lone snare, as the smoke check's probe. */
export const testProbe = (doc: ChartDocument): SmokeProbe => {
  const note = trackNotes(doc, EXPERT_DRUMS).find(
    n =>
      n.tick === TEST_PROBE_NOTE.tick &&
      laneOfNoteType('drums', n.type) === TEST_PROBE_NOTE.lane,
  );
  if (!note) throw new Error('[gallery] the test chart has no probe note');
  return {
    track: EXPERT_DRUMS,
    noteId: noteIdOf(note),
    lane: TEST_PROBE_NOTE.lane,
    atSec: note.msTime / 1000,
  };
};

/** One timeline segment: film second 0 plays song second `songStart`. */
export const editFrom = (songStart: number, lengthSec = 60) => [
  {
    videoStart: 0,
    videoEnd: lengthSec,
    songStart,
    songEnd: songStart + lengthSec,
  },
];
