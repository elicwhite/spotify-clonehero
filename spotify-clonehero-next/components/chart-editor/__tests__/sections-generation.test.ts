/**
 * Sections decoupled from the tempo map (plan 0076 item 23).
 *
 * The guarantee is behavioural and two-sided:
 *  - generating a tempo map leaves the chart's section titles exactly as the
 *    charter left them;
 *  - generating sections replaces section markers and nothing else;
 * plus the staleness signal that ties the two together — sections placed on
 * bar lines of one grid are flagged (amber, dismissable) once the grid moves.
 */

import {
  addDrumNote,
  addSection,
  createEmptyChart,
  makeChartTiming,
  setAudioAnchor,
} from '@/lib/chart-edit';
import type {ChartDocument} from '@/lib/chart-edit';
import {emptyTrackData} from '@/lib/chart-edit/__tests__/test-utils';
import {noteTypes} from '@eliwhite/scan-chart';
import type {Synctrack} from '@/lib/tempo-map/types';
import {
  chartEditorReducer,
  computeTempoStamp,
  getAssistProvenance,
  initialState,
  selectTempoDerivedStale,
  withAssistProvenance,
  type ChartEditorState,
} from '@/lib/chart-editor-core';

import {ReplaceSectionsCommand, ReplaceTempoMapCommand} from '../commands';

const RES = 480;

/** A chart with hand-written section titles and two drum notes — the notes
 *  are there so "touches nothing but sections" has something to check. */
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
  addDrumNote(track, {tick: 620, type: noteTypes.redDrum}, timing);
  addSection(doc, 0, 'My Intro');
  addSection(doc, RES * 8, 'The Big Chorus');
  return doc;
}

/** A different grid than the doc's 120 BPM, in the ms domain the tempo
 *  pipeline produces. */
const NEW_SYNC: Synctrack = {
  origin_ms: 0,
  tempos: [
    {ms: 0, bpm: 140},
    {ms: 20000, bpm: 145},
  ],
  timeSignatures: [{ms: 0, numerator: 4, denominator: 4}],
};

function sectionsOf(doc: ChartDocument): Array<{tick: number; name: string}> {
  return doc.parsedChart.sections.map(s => ({tick: s.tick, name: s.name}));
}

function stateFor(doc: ChartDocument): ChartEditorState {
  return chartEditorReducer(initialState, {
    type: 'SET_CHART_DOC',
    chartDoc: doc,
  });
}

describe('generating a tempo map leaves sections alone', () => {
  it('keeps every section title', () => {
    const doc = makeDoc();
    const before = sectionsOf(doc).map(s => s.name);

    const after = new ReplaceTempoMapCommand(NEW_SYNC).execute(doc);

    expect(sectionsOf(after).map(s => s.name)).toEqual(before);
  });

  it('keeps the same number of sections (none added, none dropped)', () => {
    const doc = makeDoc();
    const after = new ReplaceTempoMapCommand(NEW_SYNC).execute(doc);
    expect(after.parsedChart.sections).toHaveLength(2);
  });

  it('writes no sections provenance, so an ungenerated chart never goes stale', () => {
    const doc = makeDoc();
    const after = new ReplaceTempoMapCommand(NEW_SYNC).execute(doc);
    expect(getAssistProvenance(after)?.tempoDerived?.sections).toBeUndefined();
    expect(selectTempoDerivedStale(stateFor(after), 'sections')).toBe(false);
  });
});

describe('ReplaceSectionsCommand', () => {
  const LABELS = {
    // 120 BPM, 4/4: a bar is 2000 ms. These land on bars 0, 4, and 8.
    times: [0, 8, 16, 24],
    labels: ['Intro', 'Verse', 'Chorus'],
  };

  it('replaces the section markers with the generated labels', () => {
    const after = new ReplaceSectionsCommand(LABELS).execute(makeDoc());
    expect(sectionsOf(after)).toEqual([
      {tick: 0, name: 'Intro'},
      {tick: RES * 16, name: 'Verse'},
      {tick: RES * 32, name: 'Chorus'},
    ]);
  });

  it('numbers repeated labels', () => {
    const after = new ReplaceSectionsCommand({
      times: [0, 8, 16, 24],
      labels: ['Verse', 'Chorus', 'Verse'],
    }).execute(makeDoc());
    expect(sectionsOf(after).map(s => s.name)).toEqual([
      'Verse 1',
      'Chorus',
      'Verse 2',
    ]);
  });

  it('touches nothing but sections', () => {
    const doc = makeDoc();
    const after = new ReplaceSectionsCommand(LABELS).execute(doc);

    expect(after.parsedChart.trackData).toBe(doc.parsedChart.trackData);
    expect(after.parsedChart.tempos).toBe(doc.parsedChart.tempos);
    expect(after.parsedChart.timeSignatures).toBe(
      doc.parsedChart.timeSignatures,
    );
    expect(after.parsedChart.resolution).toBe(doc.parsedChart.resolution);
    // The input doc is not mutated either: the old titles survive on it.
    expect(sectionsOf(doc).map(s => s.name)).toEqual([
      'My Intro',
      'The Big Chorus',
    ]);
  });

  it('places markers against the padded timeline when the chart has leading silence', () => {
    // The task analyzes the ORIGINAL audio, so its seconds are relative to
    // that; a chart with 4000 ms of leading silence has its grid 2 bars (at
    // 120 BPM 4/4) later than the audio it was generated from. Every marker
    // must move with it, or sections land 2 bars early.
    const anchored = setAudioAnchor(makeDoc(), {ms: 4000, tick: RES * 8});
    const after = new ReplaceSectionsCommand(LABELS).execute(anchored);
    expect(sectionsOf(after)).toEqual([
      {tick: RES * 8, name: 'Intro'},
      {tick: RES * 24, name: 'Verse'},
      {tick: RES * 40, name: 'Chorus'},
    ]);
  });

  it('is unchanged at a zero anchor', () => {
    const unanchored = new ReplaceSectionsCommand(LABELS).execute(makeDoc());
    const zeroAnchored = new ReplaceSectionsCommand(LABELS).execute(
      setAudioAnchor(makeDoc(), {ms: 0, tick: 0}),
    );
    expect(sectionsOf(zeroAnchored)).toEqual(sectionsOf(unanchored));
  });

  it('records the grid it generated against, so fresh sections are not stale', () => {
    const after = new ReplaceSectionsCommand(LABELS).execute(makeDoc());
    expect(getAssistProvenance(after)?.tempoDerived?.sections?.tempoStamp).toBe(
      computeTempoStamp(after),
    );
    expect(selectTempoDerivedStale(stateFor(after), 'sections')).toBe(false);
  });
});

describe('sections staleness', () => {
  it('fires once the tempo map changes under generated sections', () => {
    const generated = new ReplaceSectionsCommand({
      times: [0, 8, 16],
      labels: ['Intro', 'Chorus'],
    }).execute(makeDoc());
    expect(selectTempoDerivedStale(stateFor(generated), 'sections')).toBe(
      false,
    );

    const regridded = new ReplaceTempoMapCommand(NEW_SYNC).execute(generated);
    expect(selectTempoDerivedStale(stateFor(regridded), 'sections')).toBe(true);
    // The titles themselves survived the regrid; only the recommendation fired.
    expect(sectionsOf(regridded).map(s => s.name)).toEqual(['Intro', 'Chorus']);
  });

  it('clears once the user keeps the sections as-is for that grid', () => {
    const generated = new ReplaceSectionsCommand({
      times: [0, 8],
      labels: ['Intro'],
    }).execute(makeDoc());
    const regridded = new ReplaceTempoMapCommand(NEW_SYNC).execute(generated);

    const acked = withAssistProvenance(regridded, {
      ...getAssistProvenance(regridded),
      acks: {sections: {ackStamp: computeTempoStamp(regridded)}},
    });
    expect(selectTempoDerivedStale(stateFor(acked), 'sections')).toBe(false);
  });

  it('stays quiet for a chart whose sections were written by hand', () => {
    const doc = makeDoc();
    const regridded = new ReplaceTempoMapCommand(NEW_SYNC).execute(doc);
    expect(selectTempoDerivedStale(stateFor(regridded), 'sections')).toBe(
      false,
    );
  });
});
