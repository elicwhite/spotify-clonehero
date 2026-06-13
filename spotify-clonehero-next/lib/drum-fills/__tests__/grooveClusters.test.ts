import {
  buildGrooveClusters,
  summarizeClusterDistribution,
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
    ...over,
  };
}

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

  it('sorts clusters by fill count descending', () => {
    const clusters = buildGrooveClusters([
      input({id: '1', grooveSimilarityKey: 'small'}),
      input({id: '2', grooveSimilarityKey: 'big'}),
      input({id: '3', grooveSimilarityKey: 'big'}),
      input({id: '4', grooveSimilarityKey: 'big'}),
    ]);
    expect(clusters.map(c => c.similarityKey)).toEqual(['big', 'small']);
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
