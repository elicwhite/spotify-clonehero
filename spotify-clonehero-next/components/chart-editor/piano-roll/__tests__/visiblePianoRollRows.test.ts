import {visiblePianoRollRows} from '../sceneTypes';
import type {TrackRowScene} from '../sceneTypes';
import {trackKeyId} from '@/lib/chart-editor-core/trackInventory';
import type {TrackKey} from '@/lib/chart-edit';

function row(
  instrument: TrackKey['instrument'],
  difficulty: TrackKey['difficulty'],
): TrackRowScene {
  return {
    key: {instrument, difficulty},
    schema: {} as TrackRowScene['schema'],
    lanes: [],
    notes: [],
  };
}

describe('visiblePianoRollRows', () => {
  const drumsExpert = row('drums', 'expert');
  const guitarExpert = row('guitar', 'expert');
  const bassHard = row('bass', 'hard');
  const allRows = [drumsExpert, guitarExpert, bassHard];

  test('lists only rows whose track key is in visibleTrackKeys', () => {
    const visible = new Set([trackKeyId(drumsExpert.key)]);
    expect(visiblePianoRollRows(allRows, visible)).toEqual([drumsExpert]);
  });

  test('preserves row order among the visible subset', () => {
    const visible = new Set([
      trackKeyId(bassHard.key),
      trackKeyId(drumsExpert.key),
    ]);
    expect(visiblePianoRollRows(allRows, visible)).toEqual([
      drumsExpert,
      bassHard,
    ]);
  });

  test('an empty visibleTrackKeys set yields an empty row list, not a fallback to all rows', () => {
    expect(visiblePianoRollRows(allRows, new Set())).toEqual([]);
  });

  test('a visible key not present among the rows is simply ignored', () => {
    const visible = new Set(['vocals:expert']);
    expect(visiblePianoRollRows(allRows, visible)).toEqual([]);
  });

  test('all rows visible returns every row unchanged', () => {
    const visible = new Set(allRows.map(r => trackKeyId(r.key)));
    expect(visiblePianoRollRows(allRows, visible)).toEqual(allRows);
  });
});
