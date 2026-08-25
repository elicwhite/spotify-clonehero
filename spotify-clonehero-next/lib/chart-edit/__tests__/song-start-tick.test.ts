/**
 * `songStartTick` — the one record this feature keeps (plan 0124 §3).
 *
 * Everything else is derived from it and the audio anchor: where the music
 * sits in the stored audio, how many bars of lead-in there are, and what the
 * song's opening tempo and meter is. Revision 9 stored all three separately
 * and each could go stale against the chart it described.
 */

import type {ChartDocument} from '../types';
import {
  addTempo,
  addTimeSignature,
  createEmptyChart,
  retimeChart,
} from '../index';
import {emptyTrackData} from './test-utils';
import {
  applyDocSidecars,
  carryDocSidecars,
  getAudioAnchor,
  getSongStartTick,
  leadInBars,
  readDocSidecars,
  resolveOpening,
  setAudioAnchor,
  setSongStartTick,
  songStartAudioMs,
} from '../leading-silence';

const RES = 192;
const BAR = RES * 4;

function makeDoc(bpm = 120): ChartDocument {
  const parsedChart = createEmptyChart({format: 'chart', bpm, resolution: RES});
  parsedChart.trackData.push(emptyTrackData('drums', 'expert'));
  const doc: ChartDocument = {parsedChart, assets: []};
  retimeChart(parsedChart);
  return doc;
}

describe('the record itself', () => {
  it('round-trips through a shallow doc clone, like every other sidecar', () => {
    const doc = setSongStartTick(makeDoc(), BAR * 2);
    expect(getSongStartTick({...doc})).toBe(BAR * 2);
  });

  it('is null until something says, and can be cleared', () => {
    expect(getSongStartTick(makeDoc())).toBeNull();
    expect(getSongStartTick(setSongStartTick(makeDoc(), null))).toBeNull();
  });

  it('travels with the doc through carryDocSidecars', () => {
    const from = setSongStartTick(makeDoc(), BAR);
    expect(getSongStartTick(carryDocSidecars(from, makeDoc()))).toBe(BAR);
    expect(readDocSidecars(from).songStartTick).toBe(BAR);
  });
});

describe('what is derived from it', () => {
  it('counts lead-in bars from tick 0, using the tick-0 meter', () => {
    expect(leadInBars(setSongStartTick(makeDoc(), BAR * 3))).toBeCloseTo(3, 9);
  });

  it('goes fractional when the opening meter changes underneath it', () => {
    // Two bars of 4/4 is 1536 ticks. Retyped as 3/4 a bar is 576 ticks, so
    // the same position is 2.667 bars. Nothing corrects that on its own.
    const doc = setSongStartTick(makeDoc(), BAR * 2);
    addTimeSignature(doc, 0, 3, 4);
    retimeChart(doc.parsedChart);
    expect(leadInBars(doc)).toBeCloseTo(8 / 3, 6);
  });

  it('reads the opening AT the song start, not at tick 0', () => {
    const doc = makeDoc(168.4);
    addTimeSignature(doc, 0, 3, 4);
    addTempo(doc, BAR, 150.5);
    addTimeSignature(doc, BAR, 4, 4);
    retimeChart(doc.parsedChart);
    expect(resolveOpening(setSongStartTick(doc, BAR))).toEqual({
      bpm: 150.5,
      meter: {numerator: 4, denominator: 4},
    });
  });

  it('puts the music in the stored audio, past whatever silence is in front', () => {
    // Two bars of 120 BPM 4/4 = 4000 ms of chart, less a 1000 ms pad.
    const doc = setAudioAnchor(setSongStartTick(makeDoc(), BAR * 2), {
      ms: 1000,
      tick: 0,
    });
    expect(songStartAudioMs(doc)).toBeCloseTo(3000, 6);
  });
});

describe('the read/write pair', () => {
  it('restores everything it writes — the two must not drift', () => {
    // A host that saves `readDocSidecars` and restores a SHORTER list by hand
    // writes a field on every autosave and drops it on every reload. That is
    // what happened to `songStartTick` on /drum-transcription: the anchor was
    // re-attached by hand and the song start was not, so a reloaded project
    // silently forgot where its music began.
    const doc = setAudioAnchor(setSongStartTick(makeDoc(), BAR * 2), {
      ms: 4000,
      tick: BAR * 2,
    });
    const restored = applyDocSidecars(makeDoc(), readDocSidecars(doc));
    expect(readDocSidecars(restored)).toEqual(readDocSidecars(doc));
  });
});

describe('migration from the three records older projects wrote', () => {
  it('converts a song start in audio ms to the tick it already sits on', () => {
    // The anchor is applied first, so the conversion happens under the pad
    // the project was saved with. Nothing about the chart moves.
    const doc = applyDocSidecars(makeDoc(), {
      audioAnchor: {ms: 4000, tick: BAR * 2},
      songStart: {audioMs: 0},
      leadIn: {bars: 2},
    });
    expect(getSongStartTick(doc)).toBe(BAR * 2);
    expect(leadInBars(doc)).toBeCloseTo(2, 9);
    expect(getAudioAnchor(doc)!.ms).toBe(4000);
  });

  it('prefers a tick that is already stored over the old records', () => {
    const doc = applyDocSidecars(makeDoc(), {
      songStartTick: BAR,
      songStart: {audioMs: 99999},
    });
    expect(getSongStartTick(doc)).toBe(BAR);
  });

  it('leaves a project that recorded neither with no song start', () => {
    expect(getSongStartTick(applyDocSidecars(makeDoc(), {}))).toBeNull();
  });
});
