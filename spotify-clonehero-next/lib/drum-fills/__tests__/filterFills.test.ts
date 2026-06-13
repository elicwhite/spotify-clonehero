import {
  filterFills,
  hasActiveFilters,
  masteryOf,
  availableVoicingTags,
  sortFills,
  DEFAULT_LIBRARY_FILTERS,
  type LibraryFilters,
} from '../library/filterFills';
import type {FillWithSrs, SrsState} from '@/lib/local-db/drum-fills';

function makeFill(over: Partial<FillWithSrs> = {}): FillWithSrs {
  return {
    id: 'f1',
    chartHash: 'h1',
    libraryPath: 'Songs/Foo',
    song: 'You Suck at Love',
    artist: 'Simple Plan',
    charter: 'X',
    startTick: 0,
    endTick: 100,
    grooveStartTick: 0,
    grooveEndTick: 0,
    tempoBpm: 156,
    lengthBars: 1,
    subdivision: '16ths',
    complexity: 4,
    voicingTags: ['toms', 'crash-end'],
    difficultyScore: 50,
    fingerprint: 'fp',
    grooveFingerprint: 'gfp',
    grooveSimilarityKey: 'gsk',
    fillSimilarityKey: 'fsk',
    confidence: 0.9,
    features: {},
    createdAt: 0,
    srs: null,
    ...over,
  };
}

function withState(state: SrsState): FillWithSrs {
  return makeFill({
    srs: {
      state,
      ease: 2.5,
      intervalDays: 1,
      dueAt: 0,
      passStreak: 0,
      updatedAt: 0,
    },
  });
}

const f = (over: Partial<FillWithSrs>) => makeFill(over);

describe('masteryOf', () => {
  it('treats missing srs as unpracticed', () => {
    expect(masteryOf(makeFill({srs: null}))).toBe('unpracticed');
  });
  it('returns the srs state otherwise', () => {
    expect(masteryOf(withState('mastered'))).toBe('mastered');
  });
});

describe('filterFills', () => {
  const base = DEFAULT_LIBRARY_FILTERS;

  it('returns all with default filters', () => {
    const fills = [f({id: 'a'}), f({id: 'b'})];
    expect(filterFills(fills, base)).toHaveLength(2);
  });

  it('matches search on song and artist, case-insensitively', () => {
    const fills = [
      f({id: 'a', song: 'Trashed and Scattered', artist: 'Avenged Sevenfold'}),
      f({id: 'b', song: 'You Suck at Love', artist: 'Simple Plan'}),
    ];
    const filters: LibraryFilters = {...base, search: 'aVeNgEd'};
    expect(filterFills(fills, filters).map(x => x.id)).toEqual(['a']);
    expect(
      filterFills(fills, {...base, search: 'suck'}).map(x => x.id),
    ).toEqual(['b']);
  });

  it('filters by subdivision', () => {
    const fills = [
      f({id: 'a', subdivision: '16ths'}),
      f({id: 'b', subdivision: 'triplets'}),
    ];
    expect(
      filterFills(fills, {...base, subdivisions: ['triplets']}).map(x => x.id),
    ).toEqual(['b']);
  });

  it('filters by length bars', () => {
    const fills = [f({id: 'a', lengthBars: 1}), f({id: 'b', lengthBars: 2})];
    expect(
      filterFills(fills, {...base, lengthBars: [2]}).map(x => x.id),
    ).toEqual(['b']);
  });

  it('requires ALL selected voicing tags', () => {
    const fills = [
      f({id: 'a', voicingTags: ['toms', 'crash-end']}),
      f({id: 'b', voicingTags: ['toms']}),
    ];
    expect(
      filterFills(fills, {
        ...base,
        voicingTags: ['toms', 'crash-end'],
      }).map(x => x.id),
    ).toEqual(['a']);
  });

  it('filters by complexity range', () => {
    const fills = [
      f({id: 'a', complexity: 2}),
      f({id: 'b', complexity: 4}),
      f({id: 'c', complexity: 5}),
    ];
    expect(
      filterFills(fills, {...base, minComplexity: 4, maxComplexity: 5}).map(
        x => x.id,
      ),
    ).toEqual(['b', 'c']);
  });

  it('filters by tempo range', () => {
    const fills = [
      f({id: 'slow', tempoBpm: 90}),
      f({id: 'fast', tempoBpm: 180}),
    ];
    expect(
      filterFills(fills, {...base, minTempo: 150, maxTempo: 200}).map(
        x => x.id,
      ),
    ).toEqual(['fast']);
  });

  it('filters by mastery state including unpracticed', () => {
    const fills = [
      f({id: 'new', srs: null}),
      withState('learning'),
      withState('mastered'),
    ];
    expect(
      filterFills(fills, {...base, mastery: ['unpracticed']}).map(x => x.id),
    ).toEqual(['new']);
    expect(
      filterFills(fills, {...base, mastery: ['learning', 'mastered']}),
    ).toHaveLength(2);
  });

  it('combines multiple filters (AND)', () => {
    const fills = [
      f({id: 'match', subdivision: '16ths', complexity: 4, tempoBpm: 156}),
      f({id: 'wrongSub', subdivision: '8ths', complexity: 4, tempoBpm: 156}),
      f({id: 'wrongTempo', subdivision: '16ths', complexity: 4, tempoBpm: 90}),
    ];
    const filters: LibraryFilters = {
      ...base,
      subdivisions: ['16ths'],
      minComplexity: 3,
      maxComplexity: 5,
      minTempo: 120,
      maxTempo: 200,
    };
    expect(filterFills(fills, filters).map(x => x.id)).toEqual(['match']);
  });
});

describe('hasActiveFilters', () => {
  it('is false for defaults', () => {
    expect(hasActiveFilters(DEFAULT_LIBRARY_FILTERS)).toBe(false);
  });
  it('is true when any field changes', () => {
    expect(hasActiveFilters({...DEFAULT_LIBRARY_FILTERS, search: 'a'})).toBe(
      true,
    );
    expect(hasActiveFilters({...DEFAULT_LIBRARY_FILTERS, minTempo: 100})).toBe(
      true,
    );
    expect(
      hasActiveFilters({...DEFAULT_LIBRARY_FILTERS, mastery: ['mastered']}),
    ).toBe(true);
  });
});

describe('availableVoicingTags', () => {
  it('returns sorted distinct tags', () => {
    const fills = [
      f({id: 'a', voicingTags: ['toms', 'crash-end']}),
      f({id: 'b', voicingTags: ['toms', 'kick-woven']}),
    ];
    expect(availableVoicingTags(fills)).toEqual([
      'crash-end',
      'kick-woven',
      'toms',
    ]);
  });
  it('returns empty for no fills', () => {
    expect(availableVoicingTags([])).toEqual([]);
  });
});

describe('sortFills', () => {
  const fills = [
    f({id: 'mid', difficultyScore: 50, tempoBpm: 120}),
    f({id: 'easy', difficultyScore: 10, tempoBpm: 90}),
    f({id: 'hard', difficultyScore: 90, tempoBpm: 180}),
    f({id: 'unrated', difficultyScore: null, tempoBpm: 150}),
  ];

  it('leaves order unchanged for default', () => {
    expect(sortFills(fills, 'default').map(x => x.id)).toEqual([
      'mid',
      'easy',
      'hard',
      'unrated',
    ]);
  });

  it('sorts difficulty ascending with null last', () => {
    expect(sortFills(fills, 'difficulty-asc').map(x => x.id)).toEqual([
      'easy',
      'mid',
      'hard',
      'unrated',
    ]);
  });

  it('sorts difficulty descending with null last', () => {
    expect(sortFills(fills, 'difficulty-desc').map(x => x.id)).toEqual([
      'hard',
      'mid',
      'easy',
      'unrated',
    ]);
  });

  it('sorts by tempo', () => {
    expect(sortFills(fills, 'tempo-asc').map(x => x.id)).toEqual([
      'easy',
      'mid',
      'unrated',
      'hard',
    ]);
    expect(sortFills(fills, 'tempo-desc').map(x => x.id)).toEqual([
      'hard',
      'unrated',
      'mid',
      'easy',
    ]);
  });

  it('does not mutate the input', () => {
    const input = [...fills];
    sortFills(input, 'difficulty-asc');
    expect(input.map(x => x.id)).toEqual(['mid', 'easy', 'hard', 'unrated']);
  });
});
