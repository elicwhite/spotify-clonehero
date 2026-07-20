/**
 * RepredictTempoCommand tests (plan 0061 §3 class (b) / §7).
 *
 * The command wraps `repredictTempo`: it commits a RE-PREDICT candidate when
 * decoded onsets are available and a RESNAP fallback (with the disclosure
 * flag) when they are not. Undo is snapshot replay (`undoDocStack`), not
 * command inversion — `execute()` must leave its input doc untouched so that
 * doc remains a valid snapshot to restore to.
 */

import {
  createEmptyChart,
  addDrumNote,
  getDrumNotes,
  makeChartTiming,
  findTrackInParsedChart,
} from '@/lib/chart-edit';
import type {ChartDocument} from '@/lib/chart-edit';
import {emptyTrackData} from '@/lib/chart-edit/__tests__/test-utils';
import type {Synctrack} from '@/lib/tempo-map/types';
import type {DecodedOnsetsFile} from '@/lib/drum-transcription/ml/types';
import {RepredictTempoCommand} from '../commands';
import {noteTypes} from '@eliwhite/scan-chart';

const RES = 480;

const SYNC_120: Synctrack = {
  origin_ms: 0,
  tempos: [{ms: 0, bpm: 120}],
  timeSignatures: [{ms: 0, numerator: 4, denominator: 4}],
};

function makeDoc(): ChartDocument {
  const parsedChart = createEmptyChart({
    format: 'chart',
    bpm: 120,
    resolution: RES,
  });
  const track = emptyTrackData('drums', 'expert');
  parsedChart.trackData.push(track);
  const doc: ChartDocument = {parsedChart, assets: []};
  const timing = makeChartTiming(parsedChart);
  addDrumNote(track, {tick: 100, type: noteTypes.kick}, timing);
  addDrumNote(track, {tick: 620, type: noteTypes.kick}, timing);
  return doc;
}

const ONSETS: DecodedOnsetsFile = {
  version: 1,
  flow: 'audio',
  onsets: [0.5, 1.0, 1.5].map(t => ({
    timeSeconds: t,
    drumClass: 'BD' as const,
    midiPitch: 36,
    confidence: 0.9,
  })),
};

function kickTicks(doc: ChartDocument): number[] {
  const track = findTrackInParsedChart(doc.parsedChart, {
    instrument: 'drums',
    difficulty: 'expert',
  });
  return getDrumNotes(track!.track)
    .filter(n => n.type === noteTypes.kick)
    .map(n => n.tick)
    .sort((a, b) => a - b);
}

describe('RepredictTempoCommand', () => {
  test('with decoded onsets: re-predicts, no disclosure flag', () => {
    const doc = makeDoc();
    const cmd = new RepredictTempoCommand(SYNC_120, ONSETS);
    const out = cmd.execute(doc);
    expect(cmd.usedResnapFallback).toBe(false);
    expect(kickTicks(out)).toEqual([480, 960, 1440]);
  });

  test('without decoded onsets: RESNAP fallback sets disclosure flag', () => {
    const doc = makeDoc();
    const cmd = new RepredictTempoCommand(SYNC_120, null);
    const out = cmd.execute(doc);
    expect(cmd.usedResnapFallback).toBe(true);
    // Kept the existing two-note set, not re-derived to three.
    expect(kickTicks(out)).toHaveLength(2);
  });

  test('execute leaves the input doc untouched (valid undo snapshot)', () => {
    const doc = makeDoc();
    const cmd = new RepredictTempoCommand(SYNC_120, ONSETS);
    const out = cmd.execute(doc);
    expect(out).not.toBe(doc);
    expect(kickTicks(doc)).toEqual([100, 620]);
  });
});
