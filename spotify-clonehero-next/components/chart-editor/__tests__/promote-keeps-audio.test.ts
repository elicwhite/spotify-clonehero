/**
 * Promoting the opening tempo keeps the song on its audio (plan 0124 step 6).
 *
 * Reported 2026-08-23: a chart with 4/4 162.9 at bar 1 and 150.5 at bar 3,
 * where the music starts. "Use 150.5 from the start" made the whole song
 * slide against the recording — the lead-in got longer at the slower tempo
 * and nothing absorbed the difference, because the chart had bars of lead-in
 * but no lead-in RECORD.
 *
 * What the user wants, and what the model says: the same number of bars, at
 * the new tempo, with the leading silence resized so nothing else moves.
 */

import {PromoteOpeningTempoCommand} from '../commands';
import {
  addTempo,
  applyDocSidecars,
  createEmptyChart,
  getAudioAnchor,
  retimeChart,
  type ChartDocument,
} from '@/lib/chart-edit';
import {emptyTrackData} from '@/lib/chart-edit/__tests__/test-utils';

const RES = 192;
const BAR = RES * 4;

/** The reported chart: two bars of intro at 162.9, the song at 150.5. */
function reportedChart(): ChartDocument {
  const parsedChart = createEmptyChart({
    format: 'chart',
    bpm: 162.9,
    resolution: RES,
  });
  parsedChart.trackData.push(emptyTrackData('drums', 'expert'));
  const doc: ChartDocument = {parsedChart, assets: []};
  retimeChart(parsedChart);
  addTempo(doc, BAR * 2, 150.5);
  addTempo(doc, BAR * 6, 149.2);
  retimeChart(parsedChart);

  const songStartMs = parsedChart.tempos.find(t => t.tick === BAR * 2)!.msTime;
  return applyDocSidecars(doc, {songStart: {audioMs: songStartMs}});
}

/** Where a tick sits in the ORIGINAL audio: chart ms minus the pad. */
function audioMsOfTick(doc: ChartDocument, tick: number): number {
  const pad = getAudioAnchor(doc)?.ms ?? 0;
  const tempo = [...doc.parsedChart.tempos]
    .sort((a, b) => a.tick - b.tick)
    .filter(t => t.tick <= tick)
    .at(-1)!;
  const msPerTick = 60000 / tempo.beatsPerMinute / doc.parsedChart.resolution;
  return tempo.msTime + (tick - tempo.tick) * msPerTick - pad;
}

describe('PromoteOpeningTempoCommand with lead-in bars but no pad', () => {
  it('resizes the leading silence so the song stays on its audio', () => {
    const before = reportedChart();
    const beforeStart = audioMsOfTick(before, BAR * 2);
    const after = new PromoteOpeningTempoCommand().execute(before);

    // Two bars at 150.5 are longer than two at 162.9, so silence is added to
    // hold the song where it is in the recording.
    expect(getAudioAnchor(after)!.ms).toBeCloseTo(242.8, 0);
    expect(audioMsOfTick(after, BAR * 2)).toBeCloseTo(beforeStart, 1);
  });

  it('keeps the same number of bars before the song', () => {
    const after = new PromoteOpeningTempoCommand().execute(reportedChart());
    // The song still starts at bar 3: ticks do not move.
    expect(after.parsedChart.tempos[0].beatsPerMinute).toBeCloseTo(150.5, 1);
    expect(audioMsOfTick(after, 0)).toBeCloseTo(-242.8, 0);
  });

  it('leaves every later marker on its own audio position', () => {
    const before = reportedChart();
    const beforeLater = audioMsOfTick(before, BAR * 6);
    const after = new PromoteOpeningTempoCommand().execute(before);
    expect(audioMsOfTick(after, BAR * 6)).toBeCloseTo(beforeLater, 1);
  });
});
