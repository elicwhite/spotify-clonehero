import {
  DIFFICULTY_UNSET,
  difficultyFieldsForChart,
  normalizeDifficulty,
  readDifficultyValues,
  toIniDifficulties,
} from '../songIniFields';

function track(instrument: string, difficulty = 'expert') {
  return {instrument, difficulty} as never;
}

describe('difficultyFieldsForChart', () => {
  it('offers one field per charted instrument, plus Pro Drums for drums', () => {
    expect(
      difficultyFieldsForChart({
        trackData: [track('drums'), track('guitar'), track('bass')],
      }),
    ).toEqual(['diff_guitar', 'diff_bass', 'diff_drums_real']);
  });

  it('offers no field for plain drums or keys, which are not edited', () => {
    expect(
      difficultyFieldsForChart({
        trackData: [track('drums'), track('keys')],
      }),
    ).toEqual(['diff_drums_real']);
  });

  it('does not offer fields for instruments the chart lacks', () => {
    expect(difficultyFieldsForChart({trackData: [track('guitar')]})).toEqual([
      'diff_guitar',
    ]);
  });

  it('de-duplicates an instrument charted at several difficulties', () => {
    expect(
      difficultyFieldsForChart({
        trackData: [
          track('guitar', 'expert'),
          track('guitar', 'hard'),
          track('guitar', 'easy'),
        ],
      }),
    ).toEqual(['diff_guitar']);
  });

  it('is empty for a chart with no playable tracks', () => {
    expect(difficultyFieldsForChart({trackData: []})).toEqual([]);
  });
});

describe('normalizeDifficulty', () => {
  it.each([0, 1, 6])('keeps in-range value %i', value => {
    expect(normalizeDifficulty(value)).toBe(value);
  });

  it.each([undefined, -1, 7, 666, 3.5])('reads %p as unset', value => {
    expect(normalizeDifficulty(value as number | undefined)).toBeNull();
  });
});

describe('readDifficultyValues / toIniDifficulties', () => {
  it('round-trips a set value and maps unset back to the -1 sentinel', () => {
    const read = readDifficultyValues({diff_drums: 4, diff_bass: -1});
    expect(read.diff_drums).toBe(4);
    expect(read.diff_bass).toBeNull();

    const written = toIniDifficulties(read);
    expect(written.diff_drums).toBe(4);
    expect(written.diff_bass).toBe(DIFFICULTY_UNSET);
  });

  it('leaves fields the caller did not mention alone', () => {
    expect(toIniDifficulties({diff_drums: 2})).toEqual({diff_drums: 2});
  });
});
