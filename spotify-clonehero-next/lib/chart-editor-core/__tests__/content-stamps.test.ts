/**
 * Content-stamp unit tests (plan 0074 Design C).
 */

import {noteTypes} from '@eliwhite/scan-chart';
import {addDrumNote, addTempo} from '@/lib/chart-edit';
import {makeFixtureDoc} from '@/components/chart-editor/__tests__/fixtures';
import {
  carryAssistProvenance,
  computeAllTrackStamps,
  computeTempoStamp,
  computeTrackStamp,
  EMPTY_STAMP,
  getAssistProvenance,
  isStampStale,
  recomputeTrackStamps,
  restampDrumTranscription,
  setDrumTranscriptionStamp,
  withAssistProvenance,
} from '../content-stamps';
import {trackKeyId} from '../trackInventory';

const DRUMS_KEY = {instrument: 'drums' as const, difficulty: 'expert' as const};

describe('computeTrackStamp', () => {
  it('is deterministic for identical content', () => {
    const doc = makeFixtureDoc();
    const track = doc.parsedChart.trackData[0];
    expect(computeTrackStamp(track)).toBe(computeTrackStamp(track));
  });

  it('changes when a note is added', () => {
    const doc = makeFixtureDoc();
    const before = computeTrackStamp(doc.parsedChart.trackData[0]);
    addDrumNote(doc.parsedChart.trackData[0], {
      tick: 2400,
      type: noteTypes.kick,
    });
    const after = computeTrackStamp(doc.parsedChart.trackData[0]);
    expect(after).not.toBe(before);
  });

  it('does NOT change when only the tempo map changes', () => {
    const doc = makeFixtureDoc();
    const before = computeTrackStamp(doc.parsedChart.trackData[0]);
    addTempo(doc, 3840, 180);
    const after = computeTrackStamp(doc.parsedChart.trackData[0]);
    expect(after).toBe(before);
  });
});

describe('computeTempoStamp', () => {
  it('is EMPTY_STAMP for a null doc', () => {
    expect(computeTempoStamp(null)).toBe(EMPTY_STAMP);
  });

  it('changes when a tempo marker is added', () => {
    const doc = makeFixtureDoc();
    const before = computeTempoStamp(doc);
    addTempo(doc, 3840, 180);
    const after = computeTempoStamp(doc);
    expect(after).not.toBe(before);
  });

  it('is unaffected by note edits', () => {
    const doc = makeFixtureDoc();
    const before = computeTempoStamp(doc);
    addDrumNote(doc.parsedChart.trackData[0], {
      tick: 2400,
      type: noteTypes.kick,
    });
    const after = computeTempoStamp(doc);
    expect(after).toBe(before);
  });

  it('changes when the resolution changes under an identical marker list', () => {
    // A synctrack swap can hand over the same (tick, bpm) pairs at a
    // different resolution, which moves where every tick lands in time. If
    // the stamp missed that, a transcription authored against the old grid
    // would silently stay "fresh".
    const doc = makeFixtureDoc();
    const before = computeTempoStamp(doc);
    doc.parsedChart.resolution = doc.parsedChart.resolution * 2;
    expect(computeTempoStamp(doc)).not.toBe(before);
  });

  it('changes when a downbeat edit inserts a time-signature marker', () => {
    const doc = makeFixtureDoc();
    const before = computeTempoStamp(doc);
    doc.parsedChart.timeSignatures = [
      ...doc.parsedChart.timeSignatures,
      {
        tick: 1920,
        numerator: 3,
        denominator: 4,
        msTime: 0,
        msLength: 0,
      },
    ];
    expect(computeTempoStamp(doc)).not.toBe(before);
  });
});

describe('computeAllTrackStamps / recomputeTrackStamps', () => {
  it('computes a stamp per track keyed by trackKeyId', () => {
    const doc = makeFixtureDoc();
    const stamps = computeAllTrackStamps(doc);
    expect(stamps[trackKeyId(DRUMS_KEY)]).toBe(
      computeTrackStamp(doc.parsedChart.trackData[0]),
    );
  });

  it('is empty for a null doc', () => {
    expect(computeAllTrackStamps(null)).toEqual({});
  });

  it('recomputes only the affected track, carrying the rest over', () => {
    const doc = makeFixtureDoc();
    const prev = computeAllTrackStamps(doc);
    addDrumNote(doc.parsedChart.trackData[0], {
      tick: 2400,
      type: noteTypes.kick,
    });

    const next = recomputeTrackStamps(
      doc,
      prev,
      new Set([trackKeyId(DRUMS_KEY)]),
    );

    expect(next[trackKeyId(DRUMS_KEY)]).not.toBe(prev[trackKeyId(DRUMS_KEY)]);
  });

  it('leaves stamps untouched when affectedTracks is undefined', () => {
    const doc = makeFixtureDoc();
    const prev = computeAllTrackStamps(doc);
    const next = recomputeTrackStamps(doc, prev, undefined);
    expect(next).toBe(prev);
  });

  it('drops the stamp for a track no longer present in the doc', () => {
    const doc = makeFixtureDoc();
    const prev = computeAllTrackStamps(doc);
    doc.parsedChart.trackData = [];
    const next = recomputeTrackStamps(
      doc,
      prev,
      new Set([trackKeyId(DRUMS_KEY)]),
    );
    expect(trackKeyId(DRUMS_KEY) in next).toBe(false);
  });
});

describe('assist provenance helpers', () => {
  it('getAssistProvenance is undefined for a doc with none written', () => {
    const doc = makeFixtureDoc();
    expect(getAssistProvenance(doc)).toBeUndefined();
  });

  it('getAssistProvenance is undefined for a null doc', () => {
    expect(getAssistProvenance(null)).toBeUndefined();
  });

  it('withAssistProvenance attaches provenance readable via getAssistProvenance', () => {
    const doc = makeFixtureDoc();
    const withProvenance = withAssistProvenance(doc, {
      drumTranscription: {tempoStamp: 'abc'},
    });
    expect(getAssistProvenance(withProvenance)).toEqual({
      drumTranscription: {tempoStamp: 'abc'},
    });
    // The original doc is untouched.
    expect(getAssistProvenance(doc)).toBeUndefined();
  });
});

describe('drum-transcription provenance writers', () => {
  it('setDrumTranscriptionStamp records the doc own tempo stamp', () => {
    const doc = makeFixtureDoc();
    const stamped = setDrumTranscriptionStamp(doc);
    expect(getAssistProvenance(stamped)!.drumTranscription).toEqual({
      tempoStamp: computeTempoStamp(doc),
    });
  });

  it('setDrumTranscriptionStamp keeps the rest of the bag', () => {
    const doc = withAssistProvenance(makeFixtureDoc(), {
      acks: {'drum-transcription': {ackStamp: 'ack-1'}},
    });
    expect(getAssistProvenance(setDrumTranscriptionStamp(doc))!.acks).toEqual({
      'drum-transcription': {ackStamp: 'ack-1'},
    });
  });

  it('setDrumTranscriptionStamp writes a record even when there was none', () => {
    const doc = makeFixtureDoc();
    expect(
      getAssistProvenance(setDrumTranscriptionStamp(doc))!.drumTranscription,
    ).toBeDefined();
  });

  it('restampDrumTranscription leaves a doc with no record untouched', () => {
    const doc = makeFixtureDoc();
    const restamped = restampDrumTranscription(doc);
    expect(restamped).toBe(doc);
    expect(getAssistProvenance(restamped)).toBeUndefined();
  });

  it('restampDrumTranscription re-points an existing record at the current map', () => {
    const doc = withAssistProvenance(makeFixtureDoc(), {
      drumTranscription: {tempoStamp: 'stale-stamp'},
    });
    expect(
      getAssistProvenance(restampDrumTranscription(doc))!.drumTranscription,
    ).toEqual({tempoStamp: computeTempoStamp(doc)});
  });
});

describe('carryAssistProvenance', () => {
  it('returns the target untouched when the source carries no bag', () => {
    const from = makeFixtureDoc();
    const to = withAssistProvenance(makeFixtureDoc(), {
      drumTranscription: {tempoStamp: 'candidate'},
    });
    expect(carryAssistProvenance(from, to)).toBe(to);
  });

  it('returns the target untouched when both sides share a bag', () => {
    const provenance = {drumTranscription: {tempoStamp: 'shared'}};
    const from = withAssistProvenance(makeFixtureDoc(), provenance);
    const to = withAssistProvenance(makeFixtureDoc(), provenance);
    expect(carryAssistProvenance(from, to)).toBe(to);
  });

  it('copies the source bag onto the target when they differ', () => {
    const from = withAssistProvenance(makeFixtureDoc(), {
      acks: {'drum-transcription': {ackStamp: 'acked-after-preview'}},
    });
    const to = withAssistProvenance(makeFixtureDoc(), {
      drumTranscription: {tempoStamp: 'candidate'},
    });
    const carried = carryAssistProvenance(from, to);
    expect(getAssistProvenance(carried)).toEqual(getAssistProvenance(from));
    // The target doc itself is untouched.
    expect(getAssistProvenance(to)!.drumTranscription).toEqual({
      tempoStamp: 'candidate',
    });
  });
});

describe('isStampStale', () => {
  it('is false when nothing was ever generated (recorded undefined)', () => {
    expect(isStampStale(undefined, 'current', undefined)).toBe(false);
  });

  it('is false when the recorded stamp matches the current one', () => {
    expect(isStampStale('same', 'same', undefined)).toBe(false);
  });

  it('is true when the stamps differ and there is no ack', () => {
    expect(isStampStale('old', 'new', undefined)).toBe(true);
  });

  it('is false when the ack matches the current stamp', () => {
    expect(isStampStale('old', 'new', 'new')).toBe(false);
  });

  it('is true again once the current stamp moves past the ack', () => {
    expect(isStampStale('old', 'newer', 'new')).toBe(true);
  });
});
