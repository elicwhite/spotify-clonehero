import {
  availableHighwayTracks,
  findPreferredHighwayTrack,
} from '../TrackScopePicker';
import type {ParsedTrackData} from '@/lib/chart-edit';

function track(instrument: string, difficulty: string): ParsedTrackData {
  return {instrument, difficulty} as unknown as ParsedTrackData;
}

describe('availableHighwayTracks', () => {
  it('returns guitar, bass, and drums in instrument and difficulty order', () => {
    const trackData = [
      track('drums', 'hard'),
      track('bass', 'expert'),
      track('guitar', 'medium'),
      track('guitar', 'expert'),
      track('vocals', 'expert'),
    ];

    expect(availableHighwayTracks(trackData)).toEqual([
      {instrument: 'guitar', difficulty: 'expert'},
      {instrument: 'guitar', difficulty: 'medium'},
      {instrument: 'bass', difficulty: 'expert'},
      {instrument: 'drums', difficulty: 'hard'},
    ]);
  });

  it('ignores unsupported tracks', () => {
    expect(
      availableHighwayTracks([
        track('vocals', 'expert'),
        track('keys', 'expert'),
      ]),
    ).toEqual([]);
  });
});

describe('findPreferredHighwayTrack', () => {
  it('prefers guitar Expert before drums Expert', () => {
    const preferred = findPreferredHighwayTrack([
      track('drums', 'expert'),
      track('guitar', 'hard'),
      track('bass', 'expert'),
      track('guitar', 'expert'),
    ]);

    expect(preferred).toMatchObject({
      instrument: 'guitar',
      difficulty: 'expert',
    });
  });

  it('prefers drums Expert when guitar Expert is absent', () => {
    const preferred = findPreferredHighwayTrack([
      track('bass', 'expert'),
      track('drums', 'expert'),
      track('guitar', 'hard'),
    ]);

    expect(preferred).toMatchObject({
      instrument: 'drums',
      difficulty: 'expert',
    });
  });

  it('falls back to any Expert, then the first available track', () => {
    expect(
      findPreferredHighwayTrack([
        track('bass', 'expert'),
        track('guitar', 'hard'),
      ]),
    ).toMatchObject({instrument: 'bass', difficulty: 'expert'});
    expect(
      findPreferredHighwayTrack([
        track('drums', 'hard'),
        track('guitar', 'medium'),
      ]),
    ).toMatchObject({instrument: 'guitar', difficulty: 'medium'});
  });

  it('returns no track when the chart has no supported highway', () => {
    expect(findPreferredHighwayTrack([track('vocals', 'expert')])).toBe(
      undefined,
    );
  });
});
