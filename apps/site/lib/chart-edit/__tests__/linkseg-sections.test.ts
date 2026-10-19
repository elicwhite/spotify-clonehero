/**
 * LinkSeg labels → section markers, the conversion shared by the
 * drum-transcription chart builder and the editor's Sections assist card.
 */

import {buildTimedTempos} from '@/lib/drum-transcription/timing';
import {
  buildBarTicks,
  linkSegSectionsToMarkers,
  snapTickToBar,
} from '../helpers/linkseg-sections';

const RES = 480;
// 120 BPM 4/4: a beat is 480 ticks / 500 ms, a bar is 1920 ticks / 2000 ms.
const TEMPOS = buildTimedTempos([{tick: 0, beatsPerMinute: 120}], RES);
const TIME_SIGS = [{tick: 0, numerator: 4, denominator: 4}];
const BARS = buildBarTicks(RES, TIME_SIGS, RES * 40);

function convert(sections: {times: number[]; labels: string[]}) {
  return linkSegSectionsToMarkers(sections, {
    timedTempos: TEMPOS,
    resolution: RES,
    barTicks: BARS,
  });
}

describe('buildBarTicks', () => {
  it('walks whole bars up to the end tick', () => {
    expect(buildBarTicks(RES, TIME_SIGS, RES * 8)).toEqual([0, RES * 4]);
  });

  it('follows a mid-song time-signature change', () => {
    const ticks = buildBarTicks(
      RES,
      [
        {tick: 0, numerator: 4, denominator: 4},
        {tick: RES * 8, numerator: 3, denominator: 4},
      ],
      RES * 17,
    );
    // Two 4/4 bars, then 3/4 bars of 1440 ticks.
    expect(ticks).toEqual([0, RES * 4, RES * 8, RES * 11, RES * 14]);
  });
});

describe('snapTickToBar', () => {
  it('picks the nearest bar line, forwards or backwards', () => {
    expect(snapTickToBar(100, BARS)).toBe(0);
    expect(snapTickToBar(RES * 4 - 100, BARS)).toBe(RES * 4);
  });
});

describe('linkSegSectionsToMarkers', () => {
  it('places one marker per segment start, on a bar line', () => {
    expect(
      convert({times: [0, 4, 12, 20], labels: ['Intro', 'Verse', 'Solo']}),
    ).toEqual([
      {tick: 0, name: 'Intro'},
      {tick: RES * 8, name: 'Verse'},
      {tick: RES * 24, name: 'Solo'},
    ]);
  });

  it('leaves a label that occurs once unnumbered', () => {
    expect(convert({times: [0, 4], labels: ['Intro']})).toEqual([
      {tick: 0, name: 'Intro'},
    ]);
  });

  it('numbers repeated labels in order', () => {
    expect(
      convert({
        times: [0, 4, 8, 12],
        labels: ['Verse', 'Chorus', 'Verse'],
      }).map(m => m.name),
    ).toEqual(['Verse 1', 'Chorus', 'Verse 2']);
  });

  it('collapses two boundaries that snap to the same bar without skipping a number', () => {
    // The 4.0 s and 4.1 s boundaries both snap to the same bar line, so the
    // second is dropped. It must not consume "Verse 2", or the last verse
    // would render as "Verse 3" with no "Verse 2" anywhere in the chart.
    const names = convert({
      times: [0, 4, 4.1, 12, 20],
      labels: ['Chorus', 'Verse', 'Verse', 'Verse'],
    }).map(m => m.name);
    expect(names).toEqual(['Chorus', 'Verse 1', 'Verse 2']);
  });

  it('returns nothing for an empty label set', () => {
    expect(convert({times: [0], labels: []})).toEqual([]);
  });
});
