import {
  buildGrooveClusters,
  filterAndSortGrooves,
  summarizeClusterDistribution,
  type GrooveCluster,
  type GrooveClusterInput,
} from '../grooveClusters';

function input(over: Partial<GrooveClusterInput> = {}): GrooveClusterInput {
  return {
    id: 'f',
    grooveFingerprint: 'gfp',
    grooveSimilarityKey: 'gsk',
    chartHash: 'h1',
    song: 'Song',
    artist: 'Artist',
    tempoBpm: 120,
    subdivision: '16ths',
    complexity: 3,
    lengthBars: 1,
    difficultyScore: 50,
    ...over,
  };
}

// Real canonical fingerprints (slot:mask, 48/bar). kick=1 snare=2 hat=4.
// Straight-8ths backbeat: hat every 8th, kick on 1&3, snare on 2&4.
const EASY_GROOVE = '0:5|6:4|12:6|18:4|24:5|30:4|36:6|42:4';
// Busy 16th-hat groove with a syncopated extra kick (harder beat).
const HARD_GROOVE =
  '0:5|3:4|6:4|9:4|12:6|15:4|18:5|21:4|24:5|27:4|30:4|33:4|36:6|39:4|42:5|45:4';

describe('buildGrooveClusters', () => {
  it('groups fills by similarity key and counts them', () => {
    const clusters = buildGrooveClusters([
      input({id: 'a', grooveSimilarityKey: 'k1'}),
      input({id: 'b', grooveSimilarityKey: 'k1'}),
      input({id: 'c', grooveSimilarityKey: 'k2'}),
    ]);
    expect(clusters).toHaveLength(2);
    expect(clusters[0].similarityKey).toBe('k1');
    expect(clusters[0].fillCount).toBe(2);
    expect(clusters[0].fillIds.sort()).toEqual(['a', 'b']);
    expect(clusters[1].similarityKey).toBe('k2');
    expect(clusters[1].fillCount).toBe(1);
  });

  it('sorts clusters by intrinsic groove difficulty ascending', () => {
    const clusters = buildGrooveClusters([
      input({
        id: '1',
        grooveSimilarityKey: 'hard',
        grooveFingerprint: HARD_GROOVE,
        tempoBpm: 180,
      }),
      input({
        id: '2',
        grooveSimilarityKey: 'easy',
        grooveFingerprint: EASY_GROOVE,
        tempoBpm: 110,
      }),
    ]);
    // Easiest beat first, regardless of fill count.
    expect(clusters.map(c => c.similarityKey)).toEqual(['easy', 'hard']);
    expect(clusters[0].grooveDifficulty).toBeLessThan(
      clusters[1].grooveDifficulty,
    );
  });

  it('breaks difficulty ties by the easiest available fill', () => {
    // Same groove fingerprint/tempo => equal grooveDifficulty; the cluster with
    // an easier entry-point fill sorts first.
    const clusters = buildGrooveClusters([
      input({
        id: 'a',
        grooveSimilarityKey: 'harder-entry',
        grooveFingerprint: EASY_GROOVE,
        difficultyScore: 60,
      }),
      input({
        id: 'b',
        grooveSimilarityKey: 'easier-entry',
        grooveFingerprint: EASY_GROOVE,
        difficultyScore: 20,
      }),
    ]);
    expect(clusters.map(c => c.similarityKey)).toEqual([
      'easier-entry',
      'harder-entry',
    ]);
  });

  it('skips fills with a null/empty similarity key', () => {
    const clusters = buildGrooveClusters([
      input({id: 'a', grooveSimilarityKey: null}),
      input({id: 'b', grooveSimilarityKey: ''}),
      input({id: 'c', grooveSimilarityKey: 'k'}),
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].fillIds).toEqual(['c']);
  });

  it('summarizes tempo range, distinct songs, and taxonomy spread', () => {
    const clusters = buildGrooveClusters([
      input({
        id: 'a',
        grooveSimilarityKey: 'k',
        chartHash: 'h1',
        tempoBpm: 100,
        subdivision: '8ths',
        complexity: 2,
        lengthBars: 1,
      }),
      input({
        id: 'b',
        grooveSimilarityKey: 'k',
        chartHash: 'h1',
        tempoBpm: 180,
        subdivision: '16ths',
        complexity: 4,
        lengthBars: 0.5,
      }),
      input({
        id: 'c',
        grooveSimilarityKey: 'k',
        chartHash: 'h2',
        tempoBpm: 140,
        subdivision: '16ths',
        complexity: 4,
        lengthBars: 2,
      }),
    ]);
    const c = clusters[0];
    expect(c.tempoMin).toBe(100);
    expect(c.tempoMax).toBe(180);
    expect(c.distinctSongs).toBe(2);
    // 16ths appears twice, 8ths once -> sorted by count desc.
    expect(c.subdivisions[0]).toEqual({value: '16ths', count: 2});
    expect(c.subdivisions[1]).toEqual({value: '8ths', count: 1});
    expect(c.complexities).toEqual([2, 4]);
    expect(c.lengths).toEqual([0.5, 1, 2]);
  });

  it('picks the most common canonical fingerprint as representative', () => {
    const clusters = buildGrooveClusters([
      input({id: 'a', grooveSimilarityKey: 'k', grooveFingerprint: 'fpX'}),
      input({id: 'b', grooveSimilarityKey: 'k', grooveFingerprint: 'fpX'}),
      input({id: 'c', grooveSimilarityKey: 'k', grooveFingerprint: 'fpY'}),
    ]);
    expect(clusters[0].representativeFingerprint).toBe('fpX');
  });
});

describe('groove voicing + progress', () => {
  it('derives the beat voices from the representative fingerprint', () => {
    // EASY_GROOVE uses kick(1), snare(2), hat(4) — no tom/crash.
    const c = buildGrooveClusters([
      input({grooveSimilarityKey: 'k', grooveFingerprint: EASY_GROOVE}),
    ])[0];
    expect(c.grooveVoices.sort()).toEqual(['hat', 'kick', 'snare']);
  });

  it('classifies progress: not-started / in-progress / mastered', () => {
    const notStarted = buildGrooveClusters([
      input({id: 'a', grooveSimilarityKey: 'n', srsState: 'new'}),
      input({id: 'b', grooveSimilarityKey: 'n', srsState: null}),
    ])[0];
    expect(notStarted.progress).toBe('not-started');

    const inProgress = buildGrooveClusters([
      input({id: 'a', grooveSimilarityKey: 'p', srsState: 'learning'}),
      input({id: 'b', grooveSimilarityKey: 'p', srsState: 'new'}),
    ])[0];
    expect(inProgress.progress).toBe('in-progress');

    const mastered = buildGrooveClusters([
      input({id: 'a', grooveSimilarityKey: 'm', srsState: 'mastered'}),
      input({id: 'b', grooveSimilarityKey: 'm', srsState: 'mastered'}),
    ])[0];
    expect(mastered.progress).toBe('mastered');
  });

  it('marks in-progress when a ladder is started even with no SRS', () => {
    const c = buildGrooveClusters(
      [input({grooveSimilarityKey: 'lad', srsState: null})],
      {ladderKeys: new Set(['lad'])},
    )[0];
    expect(c.progress).toBe('in-progress');
  });
});

describe('filterAndSortGrooves', () => {
  const base = (over: Partial<GrooveCluster>): GrooveCluster => ({
    similarityKey: 'k',
    representativeFingerprint: '',
    fillCount: 5,
    fillIds: [],
    tempoMin: 120,
    tempoMax: 120,
    distinctSongs: 1,
    subdivisions: [],
    complexities: [],
    lengths: [],
    grooveDifficulty: 50,
    easiestFillDifficulty: 50,
    grooveVoices: ['kick', 'snare', 'hat'],
    progress: 'not-started',
    ...over,
  });

  const crit = (over = {}) => ({
    minFills: 3,
    progress: [] as GrooveCluster['progress'][],
    voices: [] as GrooveCluster['grooveVoices'],
    sort: 'difficulty-asc' as const,
    ...over,
  });

  it('filters by minFills', () => {
    const out = filterAndSortGrooves(
      [
        base({similarityKey: 'a', fillCount: 3}),
        base({similarityKey: 'b', fillCount: 8}),
      ],
      crit({minFills: 5}),
    );
    expect(out.map(c => c.similarityKey)).toEqual(['b']);
  });

  it('filters by progress', () => {
    const out = filterAndSortGrooves(
      [
        base({similarityKey: 'a', progress: 'mastered'}),
        base({similarityKey: 'b', progress: 'not-started'}),
      ],
      crit({progress: ['not-started']}),
    );
    expect(out.map(c => c.similarityKey)).toEqual(['b']);
  });

  it('filters by voicing with contains-all semantics', () => {
    const out = filterAndSortGrooves(
      [
        base({
          similarityKey: 'withCrash',
          grooveVoices: ['kick', 'snare', 'hat', 'crash'],
        }),
        base({
          similarityKey: 'noCrash',
          grooveVoices: ['kick', 'snare', 'hat'],
        }),
      ],
      crit({voices: ['crash']}),
    );
    expect(out.map(c => c.similarityKey)).toEqual(['withCrash']);
  });

  it('sorts by difficulty asc/desc and most-fills', () => {
    const cs = [
      base({similarityKey: 'easy', grooveDifficulty: 20, fillCount: 4}),
      base({similarityKey: 'hard', grooveDifficulty: 80, fillCount: 9}),
    ];
    expect(
      filterAndSortGrooves(cs, crit({sort: 'difficulty-asc'})).map(
        c => c.similarityKey,
      ),
    ).toEqual(['easy', 'hard']);
    expect(
      filterAndSortGrooves(cs, crit({sort: 'difficulty-desc'})).map(
        c => c.similarityKey,
      ),
    ).toEqual(['hard', 'easy']);
    expect(
      filterAndSortGrooves(cs, crit({sort: 'fills-desc'})).map(
        c => c.similarityKey,
      ),
    ).toEqual(['hard', 'easy']);
  });
});

describe('summarizeClusterDistribution', () => {
  it('counts singletons and the largest cluster', () => {
    const clusters = buildGrooveClusters([
      input({id: '1', grooveSimilarityKey: 'big'}),
      input({id: '2', grooveSimilarityKey: 'big'}),
      input({id: '3', grooveSimilarityKey: 'big'}),
      input({id: '4', grooveSimilarityKey: 'solo'}),
    ]);
    const stats = summarizeClusterDistribution(10, clusters);
    expect(stats.totalFills).toBe(10);
    expect(stats.clusterableFills).toBe(4);
    expect(stats.distinctClusters).toBe(2);
    expect(stats.singletonClusters).toBe(1);
    expect(stats.largestCluster).toBe(3);
  });
});
