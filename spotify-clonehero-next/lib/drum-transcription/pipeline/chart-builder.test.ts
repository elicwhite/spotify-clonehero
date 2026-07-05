import {buildChartDocument, RESOLUTION} from './chart-builder';
import type {LinkSegSections} from '@/lib/tempo-map/types';

// Flat 120 BPM 4/4 (synctrack=null): 1 beat = 0.5 s = 480 ticks; 1 bar = 2 s = 1920 ticks.
// Bar-lines fall at t = 0, 2, 4, ... s -> ticks 0, 1920, 3840, ...
const DURATION = 24;

function sectionsOf(doc: ReturnType<typeof buildChartDocument>) {
  return doc.parsedChart.sections.map(s => ({tick: s.tick, name: s.name}));
}

describe('buildChartDocument section markers', () => {
  it('places LinkSeg sections at bar-snapped ticks with numbered repeats', () => {
    const sections: LinkSegSections = {
      // segment starts at 0, 4.1, 8.0, 16.0 s (last time is the song end)
      times: [0, 4.1, 8.0, 16.0, DURATION],
      labels: ['Intro', 'Verse', 'Chorus', 'Verse'],
    };
    const doc = buildChartDocument([], 'test', DURATION, null, sections);
    const secs = sectionsOf(doc);

    // 4.1 s -> ~tick 3936 -> nearest bar-line 3840 (t=4 s); 8 s -> 7680; 16 s -> 15360.
    expect(secs).toEqual([
      {tick: 0, name: 'Intro'},
      {tick: 3840, name: 'Verse 1'},
      {tick: 7680, name: 'Chorus'},
      {tick: 15360, name: 'Verse 2'},
    ]);
  });

  it('merges are already applied upstream; unique labels are not numbered', () => {
    const sections: LinkSegSections = {
      times: [0, 6.0, DURATION],
      labels: ['Intro', 'Outro'],
    };
    const doc = buildChartDocument([], 'test', DURATION, null, sections);
    expect(sectionsOf(doc)).toEqual([
      {tick: 0, name: 'Intro'},
      {tick: 5760, name: 'Outro'}, // 6 s -> 5760 ticks (bar-line)
    ]);
  });

  it('skips a section that snaps onto the previous marker without advancing repeat #', () => {
    // Two 'Verse' boundaries both snap to bar-line tick 0 (0 s and 0.1 s); the second must be
    // skipped and must NOT consume a repeat index, so the third Verse stays "Verse 2" (not an
    // orphan "Verse 3" from addSection replacing the prior marker).
    const sections: LinkSegSections = {
      times: [0, 0.1, 10.0, DURATION],
      labels: ['Verse', 'Verse', 'Verse'],
    };
    const doc = buildChartDocument([], 'test', DURATION, null, sections);
    expect(sectionsOf(doc)).toEqual([
      {tick: 0, name: 'Verse 1'},
      {tick: 9600, name: 'Verse 2'}, // 10 s -> 9600 ticks (bar-line)
    ]);
  });

  it('falls back to every-4-bar Section N markers when no LinkSeg sections', () => {
    const doc = buildChartDocument([], 'test', DURATION, null, null);
    const secs = sectionsOf(doc);
    expect(secs[0]).toEqual({tick: 0, name: 'Intro'});
    // every 4 bars = 4*1920 = 7680 ticks
    expect(secs[1]).toEqual({tick: 7680, name: 'Section 2'});
  });
});
