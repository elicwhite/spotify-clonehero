/**
 * Leading-silence recommendation detector tests (plan 0074 Design C).
 */

import type {ChartDocument} from '../types';
import {
  createEmptyChart,
  retimeChart,
  addDrumNote,
  makeChartTiming,
} from '../index';
import {noteTypes} from '@eliwhite/scan-chart';
import {emptyTrackData} from './test-utils';
import {
  detectLeadingSilenceRecommendation,
  type DetectedAudioOnset,
} from '../leading-silence-detector';
import {COLLAPSE_BPM_MIN, LEAD_MIN_MS} from '../leading-silence';

/** `firstNoteTick` places a single kick so the chart has a first-note ms
 * position — the quantity trigger (b) checks alongside the audio onset.
 * Tick 0 (the default) is the "no lead-in at all" case. */
function makeDoc(
  resolution: number,
  bpm = 120,
  firstNoteTick = 0,
): ChartDocument {
  const parsedChart = createEmptyChart({format: 'chart', bpm, resolution});
  const track = emptyTrackData('drums', 'expert');
  parsedChart.trackData.push(track);
  const doc: ChartDocument = {parsedChart, assets: []};
  retimeChart(parsedChart);
  addDrumNote(
    track,
    {tick: firstNoteTick, type: noteTypes.kick},
    makeChartTiming(parsedChart),
  );
  return doc;
}

/** Installs a tick-0 opening marker at `firstBpm` followed by a real-tempo
 * second marker at tick `RES` — `synctrackFromChart` (which the detector
 * calls) reads `chart.tempos` directly by tick order, so this gives precise,
 * hand-controlled boundary values for the outlier check without going
 * through `buildSyncLayout`'s own tier selection. */
function makeTwoTempoDoc(firstBpm: number, secondBpm = 146.98): ChartDocument {
  const RES = 192;
  const doc = makeDoc(RES, 120);
  doc.parsedChart.tempos = [
    {tick: 0, beatsPerMinute: firstBpm, msTime: 0},
    {tick: RES, beatsPerMinute: secondBpm, msTime: 0},
  ];
  retimeChart(doc.parsedChart);
  return doc;
}

describe('detectLeadingSilenceRecommendation — first-bpm-outlier trigger', () => {
  test('fires when the opening marker is >= COLLAPSE_BPM_MIN vs. the second marker', () => {
    const doc = makeTwoTempoDoc(COLLAPSE_BPM_MIN + 1000);
    const result = detectLeadingSilenceRecommendation(doc, null);
    expect(result).not.toBeNull();
    expect(result!.reason).toBe('first-bpm-outlier');
    // The copy explains the situation in terms of the audio, not in terms of
    // the BPM threshold that detects it, so it must not quote a number.
    expect(result!.detail).toMatch(/no silence before the first beat/i);
    expect(result!.detail).not.toMatch(/\d/);
  });

  test('does not fire at exactly one BPM below the threshold', () => {
    const doc = makeTwoTempoDoc(COLLAPSE_BPM_MIN - 1);
    const result = detectLeadingSilenceRecommendation(doc, null);
    expect(result).toBeNull();
  });

  test('boundary: exactly COLLAPSE_BPM_MIN fires (>=, not >)', () => {
    const doc = makeTwoTempoDoc(COLLAPSE_BPM_MIN);
    const result = detectLeadingSilenceRecommendation(doc, null);
    expect(result).not.toBeNull();
    expect(result!.reason).toBe('first-bpm-outlier');
  });

  test('a single-tempo chart never fires this trigger regardless of BPM', () => {
    const doc = makeDoc(480, COLLAPSE_BPM_MIN + 5000);
    const result = detectLeadingSilenceRecommendation(doc, null);
    expect(result).toBeNull();
  });
});

describe('detectLeadingSilenceRecommendation — early-audio-onset trigger', () => {
  test('fires when the detected onset is earlier than LEAD_MIN_MS', () => {
    const doc = makeDoc(480, 120);
    const onset: DetectedAudioOnset = {onsetMs: LEAD_MIN_MS - 1};
    const result = detectLeadingSilenceRecommendation(doc, onset);
    expect(result).not.toBeNull();
    expect(result!.reason).toBe('early-audio-onset');
    expect(result!.detail).toMatch(/onset/i);
  });

  test('fires on a negative onset (audio content before tick 0)', () => {
    const doc = makeDoc(480, 120);
    const onset: DetectedAudioOnset = {onsetMs: -50};
    const result = detectLeadingSilenceRecommendation(doc, onset);
    expect(result).not.toBeNull();
    expect(result!.reason).toBe('early-audio-onset');
  });

  test('boundary: exactly LEAD_MIN_MS does not fire (strictly-less-than)', () => {
    const doc = makeDoc(480, 120);
    const onset: DetectedAudioOnset = {onsetMs: LEAD_MIN_MS};
    const result = detectLeadingSilenceRecommendation(doc, onset);
    expect(result).toBeNull();
  });

  test('does not fire when the onset is comfortably past the threshold', () => {
    const doc = makeDoc(480, 120);
    const onset: DetectedAudioOnset = {onsetMs: LEAD_MIN_MS + 500};
    const result = detectLeadingSilenceRecommendation(doc, onset);
    expect(result).toBeNull();
  });

  test('null onset never fires this trigger (caller has not run detection yet)', () => {
    const doc = makeDoc(480, 120);
    const result = detectLeadingSilenceRecommendation(doc, null);
    expect(result).toBeNull();
  });

  test('an early onset does NOT fire when the first note already sits past the threshold', () => {
    // 8 bars at 120 BPM 4/4 == 16000ms, well past LEAD_MIN_MS: the chart
    // already has its lead-in, so `planLeadingSilence` would decline to pad
    // and the card must not recommend it.
    const doc = makeDoc(480, 120, 480 * 4 * 8);
    const onset: DetectedAudioOnset = {onsetMs: 0};
    expect(detectLeadingSilenceRecommendation(doc, onset)).toBeNull();
  });

  test('a chart with no notes at all never fires this trigger', () => {
    const parsedChart = createEmptyChart({
      format: 'chart',
      bpm: 120,
      resolution: 480,
    });
    parsedChart.trackData.push(emptyTrackData('drums', 'expert'));
    const doc: ChartDocument = {parsedChart, assets: []};
    retimeChart(parsedChart);
    expect(detectLeadingSilenceRecommendation(doc, {onsetMs: 0})).toBeNull();
  });
});

describe('detectLeadingSilenceRecommendation — neither fires', () => {
  test('clean single-tempo chart with a comfortably-late onset', () => {
    const doc = makeDoc(480, 120);
    const onset: DetectedAudioOnset = {onsetMs: 3000};
    expect(detectLeadingSilenceRecommendation(doc, onset)).toBeNull();
  });
});

describe('detectLeadingSilenceRecommendation — both trigger, (a) wins', () => {
  test('collapse marker present AND an early onset: reason is first-bpm-outlier', () => {
    const doc = makeTwoTempoDoc(COLLAPSE_BPM_MIN + 1000);
    const onset: DetectedAudioOnset = {onsetMs: -10};
    const result = detectLeadingSilenceRecommendation(doc, onset);
    expect(result).not.toBeNull();
    expect(result!.reason).toBe('first-bpm-outlier');
  });
});
