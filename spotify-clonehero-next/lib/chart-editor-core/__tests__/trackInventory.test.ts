import {
  availableTrackKeys,
  findPreferredTrack,
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

describe('preferredTrackKey / findPreferredTrack', () => {
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
    expect(findPreferredTrack(trackData)).toMatchObject({
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
    expect(findPreferredTrack([track('vocals', 'expert')])).toBeUndefined();
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
