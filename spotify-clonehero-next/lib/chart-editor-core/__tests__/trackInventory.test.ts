import {
  availableTrackKeys,
  highestDifficultyTrackKeys,
  parseTrackKeyId,
  preferredTrackKey,
  trackKeyId,
} from '../trackInventory';
import type {ParsedTrackData} from '@/lib/chart-edit';

function track(instrument: string, difficulty: string): ParsedTrackData {
  return {instrument, difficulty} as unknown as ParsedTrackData;
}

describe('availableTrackKeys', () => {
  it('returns guitar, bass, and drums in instrument and difficulty order', () => {
    const trackData = [
      track('drums', 'hard'),
      track('bass', 'expert'),
      track('guitar', 'medium'),
      track('guitar', 'expert'),
      track('vocals', 'expert'),
    ];

    expect(availableTrackKeys(trackData)).toEqual([
      {instrument: 'guitar', difficulty: 'expert'},
      {instrument: 'guitar', difficulty: 'medium'},
      {instrument: 'bass', difficulty: 'expert'},
      {instrument: 'drums', difficulty: 'hard'},
    ]);
  });

  it('ignores unsupported tracks', () => {
    expect(
      availableTrackKeys([track('vocals', 'expert'), track('keys', 'expert')]),
    ).toEqual([]);
  });
});

describe('preferredTrackKey', () => {
  it('prefers guitar Expert before drums Expert', () => {
    const trackData = [
      track('drums', 'expert'),
      track('guitar', 'hard'),
      track('bass', 'expert'),
      track('guitar', 'expert'),
    ];

    expect(preferredTrackKey(trackData)).toMatchObject({
      instrument: 'guitar',
      difficulty: 'expert',
    });
  });

  it('prefers drums Expert when guitar Expert is absent', () => {
    const trackData = [
      track('bass', 'expert'),
      track('drums', 'expert'),
      track('guitar', 'hard'),
    ];

    expect(preferredTrackKey(trackData)).toMatchObject({
      instrument: 'drums',
      difficulty: 'expert',
    });
  });

  it('falls back to any Expert track, then the first track', () => {
    expect(preferredTrackKey([track('bass', 'expert')])).toMatchObject({
      instrument: 'bass',
      difficulty: 'expert',
    });
    expect(preferredTrackKey([track('guitar', 'hard')])).toMatchObject({
      instrument: 'guitar',
      difficulty: 'hard',
    });
  });

  it('returns undefined for no supported tracks', () => {
    expect(preferredTrackKey([track('vocals', 'expert')])).toBeUndefined();
  });
});

describe('highestDifficultyTrackKeys', () => {
  it('picks Expert for every instrument when all are charted at Expert', () => {
    const trackData = [
      track('guitar', 'expert'),
      track('bass', 'expert'),
      track('drums', 'expert'),
    ];

    expect(highestDifficultyTrackKeys(trackData)).toEqual([
      {instrument: 'guitar', difficulty: 'expert'},
      {instrument: 'bass', difficulty: 'expert'},
      {instrument: 'drums', difficulty: 'expert'},
    ]);
  });

  it('falls back to the highest charted difficulty when Expert is absent', () => {
    const trackData = [
      track('guitar', 'hard'),
      track('guitar', 'medium'),
      track('drums', 'expert'),
    ];

    expect(highestDifficultyTrackKeys(trackData)).toEqual([
      {instrument: 'guitar', difficulty: 'hard'},
      {instrument: 'drums', difficulty: 'expert'},
    ]);
  });

  it('returns a single entry for a single-instrument chart', () => {
    expect(highestDifficultyTrackKeys([track('bass', 'easy')])).toEqual([
      {instrument: 'bass', difficulty: 'easy'},
    ]);
  });

  it('ignores unsupported tracks and returns [] when none are supported', () => {
    expect(highestDifficultyTrackKeys([track('vocals', 'expert')])).toEqual([]);
  });
});

describe('trackKeyId / parseTrackKeyId', () => {
  it('round-trips every supported instrument/difficulty pair', () => {
    for (const t of availableTrackKeys([
      track('guitar', 'expert'),
      track('bass', 'hard'),
      track('drums', 'easy'),
    ])) {
      expect(parseTrackKeyId(trackKeyId(t))).toEqual(t);
    }
  });

  it('returns null for a malformed id', () => {
    expect(parseTrackKeyId('not-a-valid-id')).toBeNull();
    expect(parseTrackKeyId('guitar:')).toBeNull();
    expect(parseTrackKeyId(':expert')).toBeNull();
  });
});
