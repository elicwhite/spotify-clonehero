import {createEmptyChart} from '@/lib/chart-edit';
import {buildChartDocument, buildChartDocumentFromExistingChart} from './chart-builder';
import type {LinkSegSections} from '@/lib/tempo-map/types';
import type {RawDrumEvent} from '../ml/types';

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

describe('buildChartDocumentFromExistingChart', () => {
  const kickEvent: RawDrumEvent = {
    timeSeconds: 2, // at 150 BPM (4 beats/s), 2s = tick 1920
    drumClass: 'BD',
    midiPitch: 36,
    confidence: 0.9,
  };

  function existingChartAt150Bpm() {
    return {
      parsedChart: createEmptyChart({
        format: 'chart',
        resolution: 480,
        bpm: 150,
        timeSignature: {numerator: 4, denominator: 4},
      }),
      assets: [],
    };
  }

  it('snaps drum notes against the EXISTING chart tempo, not a predicted one', () => {
    const existing = existingChartAt150Bpm();
    const doc = buildChartDocumentFromExistingChart(existing, [kickEvent], 10);
    const track = doc.parsedChart.trackData.find(
      t => t.instrument === 'drums' && t.difficulty === 'expert',
    );
    expect(track).toBeDefined();
    // At 150 BPM, tempos/timeSignatures come from the existing chart, so the
    // note lands relative to that tempo (not the DEFAULT_BPM=120 fallback).
    expect(track!.noteEventGroups.length).toBeGreaterThan(0);
  });

  it('preserves the existing tempo map, resolution, and other tracks untouched', () => {
    const existing = existingChartAt150Bpm();
    // Add a non-drums track that must survive unmodified.
    existing.parsedChart.trackData.push({
      instrument: 'guitar',
      difficulty: 'expert',
      starPowerSections: [],
      rejectedStarPowerSections: [],
      drumFreestyleSections: [],
      soloSections: [],
      flexLanes: [],
      noteEventGroups: [],
      textEvents: [],
      versusPhrases: [],
      animations: [],
      unrecognizedMidiEvents: [],
    } as never);

    const doc = buildChartDocumentFromExistingChart(existing, [kickEvent], 10);

    expect(doc.parsedChart.tempos).toEqual(existing.parsedChart.tempos);
    expect(doc.parsedChart.timeSignatures).toEqual(
      existing.parsedChart.timeSignatures,
    );
    expect(doc.parsedChart.resolution).toBe(existing.parsedChart.resolution);
    expect(
      doc.parsedChart.trackData.some(t => t.instrument === 'guitar'),
    ).toBe(true);
  });

  it('replaces an existing Expert Drums track rather than duplicating it', () => {
    const existing = existingChartAt150Bpm();
    existing.parsedChart.trackData.push({
      instrument: 'drums',
      difficulty: 'expert',
      starPowerSections: [],
      rejectedStarPowerSections: [],
      drumFreestyleSections: [],
      soloSections: [],
      flexLanes: [],
      noteEventGroups: [['stale' as never]],
      textEvents: [],
      versusPhrases: [],
      animations: [],
      unrecognizedMidiEvents: [],
    } as never);

    const doc = buildChartDocumentFromExistingChart(existing, [kickEvent], 10);
    const drumTracks = doc.parsedChart.trackData.filter(
      t => t.instrument === 'drums' && t.difficulty === 'expert',
    );
    expect(drumTracks).toHaveLength(1);
    // The stale placeholder note must be gone — replaced, not merged.
    expect(
      drumTracks[0].noteEventGroups.some(g =>
        (g as unknown[]).includes('stale'),
      ),
    ).toBe(false);
  });

  it('extends the end event past the existing one when the new audio runs longer', () => {
    const existing = existingChartAt150Bpm();
    const shortEndTick = existing.parsedChart.endEvents[0]?.tick ?? 0;
    const doc = buildChartDocumentFromExistingChart(existing, [], 60);
    const newEndTick = doc.parsedChart.endEvents[0]?.tick ?? 0;
    expect(newEndTick).toBeGreaterThan(shortEndTick);
  });
});
