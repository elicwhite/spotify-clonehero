/**
 * Tests for buildProjectionFor -- parity with chartToElements/trackToElements
 * for the note-element and marker slices, plus lane/timing derivation.
 */

import {noteTypes} from '@eliwhite/scan-chart';
import {buildProjectionFor} from '../projection';
import {chartToElements} from '../chartToElements';
import {trackToElements} from '../trackToElements';
import type {Track} from '../types';
import {drums4LaneSchema} from '@/lib/chart-edit';
import type {ChartDocument} from '@/lib/chart-edit';
import type {EditorScope} from '@/components/chart-editor/scope';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function note(
  type: number,
  tick: number,
  msTime: number,
  flags = 0,
  msLength = 0,
): Track['noteEventGroups'][0][0] {
  return {type, tick, msTime, flags, msLength} as Track['noteEventGroups'][0][0];
}

function makeTrack(
  noteEventGroups: Track['noteEventGroups'],
  opts?: {instrument?: Track['instrument']; difficulty?: Track['difficulty']},
): Track {
  return {
    instrument: opts?.instrument ?? 'drums',
    difficulty: opts?.difficulty ?? 'expert',
    noteEventGroups,
    starPowerSections: [],
    rejectedStarPowerSections: [],
    soloSections: [],
    flexLanes: [],
    flexLaneSections: [],
    drumFreestyleSections: [],
  } as unknown as Track;
}

function makeDoc(track: Track): ChartDocument {
  const parsedChart = {
    trackData: [track],
    sections: [{tick: 0, msTime: 0, name: 'Intro'}],
    tempos: [{tick: 0, msTime: 0, beatsPerMinute: 120}],
    timeSignatures: [{tick: 0, msTime: 0, numerator: 4, denominator: 4}],
    vocalTracks: null,
  };
  return {parsedChart} as unknown as ChartDocument;
}

const DRUMS_SCOPE: EditorScope = {
  kind: 'track',
  track: {instrument: 'drums', difficulty: 'expert'},
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildProjectionFor', () => {
  it('returns the empty projection when doc is null', () => {
    const projection = buildProjectionFor(DRUMS_SCOPE, null, drums4LaneSchema);
    expect(projection).toEqual({
      lanes: [],
      elements: [],
      markers: [],
      overlays: [],
      timing: {tempos: [], timeSignatures: []},
    });
  });

  it('elements match trackToElements for the scoped track', () => {
    const track = makeTrack([[note(noteTypes.redDrum, 480, 250)]]);
    const doc = makeDoc(track);

    const projection = buildProjectionFor(DRUMS_SCOPE, doc, drums4LaneSchema);

    expect(projection.elements).toEqual(trackToElements(track));
    expect(projection.elements).toHaveLength(1);
  });

  it('markers match the marker slice of chartToElements', () => {
    const track = makeTrack([[note(noteTypes.redDrum, 480, 250)]]);
    const doc = makeDoc(track);

    const projection = buildProjectionFor(DRUMS_SCOPE, doc, drums4LaneSchema);
    const combined = chartToElements(doc.parsedChart, track);
    const expectedMarkers = combined.filter(e => e.kind !== 'note');

    expect(projection.markers).toEqual(expectedMarkers);
    expect(projection.markers.some(m => m.kind === 'section')).toBe(true);
    expect(projection.markers.some(m => m.kind === 'bpm')).toBe(true);
    expect(projection.markers.some(m => m.kind === 'ts')).toBe(true);
  });

  it('returns no note elements for a vocals scope', () => {
    const track = makeTrack([[note(noteTypes.redDrum, 480, 250)]]);
    const doc = makeDoc(track);

    const projection = buildProjectionFor(
      {kind: 'vocals', part: 'vocals'},
      doc,
      null,
    );

    expect(projection.elements).toHaveLength(0);
    expect(projection.lanes).toHaveLength(0);
  });

  it('returns lanes from the passed-in schema', () => {
    const track = makeTrack([]);
    const doc = makeDoc(track);

    const projection = buildProjectionFor(DRUMS_SCOPE, doc, drums4LaneSchema);

    expect(projection.lanes).toEqual(drums4LaneSchema.lanes);
  });

  it('flattens tempos and time signatures into timing', () => {
    const track = makeTrack([]);
    const doc = makeDoc(track);

    const projection = buildProjectionFor(DRUMS_SCOPE, doc, drums4LaneSchema);

    expect(projection.timing).toEqual({
      tempos: [{tick: 0, msTime: 0, beatsPerMinute: 120}],
      timeSignatures: [{tick: 0, msTime: 0, numerator: 4, denominator: 4}],
    });
  });

  it('always returns an empty overlays array', () => {
    const track = makeTrack([]);
    const doc = makeDoc(track);

    const projection = buildProjectionFor(DRUMS_SCOPE, doc, drums4LaneSchema);

    expect(projection.overlays).toEqual([]);
  });
});
