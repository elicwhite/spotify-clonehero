/**
 * The opening record and the rule that reads it (plan 0124 step 1b).
 *
 * The chart cannot answer "what is the real opening?" once the writer has
 * wrapped a lead-in construct around tick 0, so the values are recorded when
 * a synctrack becomes a chart. These tests pin what happens with the record
 * and, more importantly, what does NOT happen without one.
 */

import type {ChartDocument} from '../types';
import {
  createEmptyChart,
  retimeChart,
  addTimeSignature,
  addTempo,
} from '../index';
import {emptyTrackData} from './test-utils';
import {
  COLLAPSE_BPM_MIN,
  getOpening,
  resolveOpening,
  setLeadIn,
  setOpening,
} from '../leading-silence';

const RES = 192;

function makeDoc(bpm = 120, meter: [number, number] = [4, 4]): ChartDocument {
  const parsedChart = createEmptyChart({format: 'chart', bpm, resolution: RES});
  parsedChart.timeSignatures[0] = {
    ...parsedChart.timeSignatures[0],
    numerator: meter[0],
    denominator: meter[1],
  };
  parsedChart.trackData.push(emptyTrackData('drums', 'expert'));
  const doc: ChartDocument = {parsedChart, assets: []};
  retimeChart(parsedChart);
  return doc;
}

describe('the opening record', () => {
  it('round-trips through a shallow doc clone, like every other sidecar', () => {
    const doc = setOpening(makeDoc(), {
      bpm: 152.67,
      meter: {numerator: 3, denominator: 4},
    });
    expect(getOpening({...doc})).toEqual({
      bpm: 152.67,
      meter: {numerator: 3, denominator: 4},
    });
  });

  it('is cleared by null', () => {
    const doc = setOpening(makeDoc(), {
      bpm: 120,
      meter: {numerator: 4, denominator: 4},
    });
    expect(getOpening(setOpening(doc, null))).toBeNull();
  });
});

describe('resolveOpening — with a record', () => {
  it('takes the recorded tempo and forces 4/4, whatever tick 0 says', () => {
    // The okgo shape: the writer synthesized 147.87 and a 1/4 bar at tick 0,
    // and the real opening is 152.67 in 3/4.
    const doc = makeDoc(147.87, [1, 4]);
    const withRecord = setOpening(doc, {
      bpm: 152.67,
      meter: {numerator: 3, denominator: 4},
    });
    expect(resolveOpening(withRecord)).toEqual({
      bpm: 152.67,
      meter: {numerator: 4, denominator: 4},
    });
  });
});

describe('resolveOpening — without a record', () => {
  it('reads the chart and never overwrites its meter', () => {
    // A human chart in 7/8 throughout. It has exactly one signature event,
    // so an event-count test would call it ours and rewrite it to 4/4.
    const doc = makeDoc(132, [7, 8]);
    expect(resolveOpening(doc)).toEqual({
      bpm: 132,
      meter: {numerator: 7, denominator: 8},
    });
  });

  it('keeps the first tempo even when a later marker exists', () => {
    // Hand-authored: 120 at tick 0, 60 at bar 9. An earlier revision took
    // the later marker here and halved every tick in the first section.
    const doc = makeDoc(120);
    addTempo(doc, RES * 4 * 8, 60);
    retimeChart(doc.parsedChart);
    expect(resolveOpening(doc).bpm).toBe(120);
  });

  it('refuses a collapse marker and takes the next tempo instead', () => {
    const doc = makeDoc(COLLAPSE_BPM_MIN * 4);
    addTempo(doc, RES, 152.67);
    retimeChart(doc.parsedChart);
    expect(resolveOpening(doc).bpm).toBeCloseTo(152.67, 5);
  });

  it('keeps a collapse marker when there is nothing else to use', () => {
    const doc = makeDoc(COLLAPSE_BPM_MIN * 4);
    expect(resolveOpening(doc).bpm).toBe(COLLAPSE_BPM_MIN * 4);
  });

  it('reads the meter of a later signature only when it governs tick 0', () => {
    const doc = makeDoc(120, [3, 4]);
    addTimeSignature(doc, RES * 3 * 4, 5, 4);
    retimeChart(doc.parsedChart);
    expect(resolveOpening(doc).meter).toEqual({numerator: 3, denominator: 4});
  });
});

describe('resolveOpening — after the opening has been emitted', () => {
  it('reads the chart, so a later meter edit is not overruled by the record', () => {
    // The record says 4/4 (the default it was emitted with). The user has
    // since set 3/4 at tick 0. The bar length must follow the user.
    const doc = setLeadIn(
      setOpening(makeDoc(146.98, [3, 4]), {
        bpm: 146.98,
        meter: {numerator: 4, denominator: 4},
      }),
      {bars: 2},
    );
    expect(resolveOpening(doc)).toEqual({
      bpm: 146.98,
      meter: {numerator: 3, denominator: 4},
    });
  });
});
