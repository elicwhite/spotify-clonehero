import {
  localNoteIdForTrack,
  localNoteIdsForTrack,
  parseTrackQualifiedNoteId,
  trackKeyId,
  trackQualifiedNoteId,
} from '../scope';

const drumsExpert = {instrument: 'drums', difficulty: 'expert'} as const;
const drumsHard = {instrument: 'drums', difficulty: 'hard'} as const;

describe('track-qualified note ids', () => {
  it('round-trips the owning track and local note id', () => {
    const id = trackQualifiedNoteId(drumsExpert, '480:redDrum');

    expect(id).toBe('drums:expert|480:redDrum');
    expect(parseTrackQualifiedNoteId(id)).toEqual({
      track: drumsExpert,
      localId: '480:redDrum',
    });
    expect(trackKeyId(drumsExpert)).toBe('drums:expert');
  });

  it('rejects a qualified id from another row at the command boundary', () => {
    const expertId = trackQualifiedNoteId(drumsExpert, '480:redDrum');
    const hardId = trackQualifiedNoteId(drumsHard, '480:redDrum');

    expect(localNoteIdForTrack(expertId, drumsExpert)).toBe('480:redDrum');
    expect(localNoteIdForTrack(hardId, drumsExpert)).toBeNull();
    expect(localNoteIdsForTrack([expertId, hardId], drumsExpert)).toEqual([
      '480:redDrum',
    ]);
  });

  it('keeps legacy local ids compatible during migration', () => {
    expect(localNoteIdForTrack('480:redDrum', drumsExpert)).toBe('480:redDrum');
  });
});
