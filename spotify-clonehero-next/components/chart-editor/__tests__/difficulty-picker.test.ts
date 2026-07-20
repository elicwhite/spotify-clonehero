import {computeAvailableDifficulties} from '../DifficultyPicker';
import type {ParsedTrackData} from '@/lib/chart-edit';

function track(instrument: string, difficulty: string): ParsedTrackData {
  return {instrument, difficulty} as unknown as ParsedTrackData;
}

describe('computeAvailableDifficulties', () => {
  it('returns charted difficulties for the instrument in expert-first order', () => {
    const trackData = [
      track('guitar', 'medium'),
      track('guitar', 'expert'),
      track('guitar', 'hard'),
      track('drums', 'expert'),
    ];
    expect(computeAvailableDifficulties(trackData, 'guitar')).toEqual([
      'expert',
      'hard',
      'medium',
    ]);
  });

  it('returns an empty list when the instrument has no charted difficulties', () => {
    const trackData = [track('drums', 'expert')];
    expect(computeAvailableDifficulties(trackData, 'guitar')).toEqual([]);
  });

  it('returns a single-element list for a single-difficulty chart', () => {
    const trackData = [track('guitar', 'expert')];
    expect(computeAvailableDifficulties(trackData, 'guitar')).toEqual([
      'expert',
    ]);
  });

  it('ignores duplicate difficulty entries', () => {
    const trackData = [track('guitar', 'expert'), track('guitar', 'expert')];
    expect(computeAvailableDifficulties(trackData, 'guitar')).toEqual([
      'expert',
    ]);
  });
});
