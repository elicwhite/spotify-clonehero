/**
 * Pure groove-clustering logic.
 *
 * Groups detected fills by their `grooveSimilarityKey` so that the same groove
 * (e.g. a straight-8ths backbeat) clusters across many songs, then summarizes
 * each cluster: how many fills, which songs/tempos/taxonomy it spans. The DB
 * query layer (`lib/drum-fills/db`) feeds rows into this; keeping the
 * aggregation here makes it unit-testable without a database.
 */

/** Minimal per-fill shape needed to build groove clusters. */
export interface GrooveClusterInput {
  id: string;
  grooveFingerprint: string | null;
  grooveSimilarityKey: string | null;
  chartHash: string;
  song: string;
  artist: string;
  tempoBpm: number;
  subdivision: string;
  complexity: number;
  lengthBars: number;
}

/** A cluster of fills that share a groove (by similarity key). */
export interface GrooveCluster {
  /** The shared similarity key (cluster identity). */
  similarityKey: string;
  /**
   * The most common canonical fingerprint within the cluster — a representative
   * exact groove used for rhythm-sketch rendering.
   */
  representativeFingerprint: string;
  fillCount: number;
  fillIds: string[];
  tempoMin: number;
  tempoMax: number;
  /** Distinct songs (by chart hash) the cluster spans. */
  distinctSongs: number;
  /** Distinct subdivisions present, sorted, with counts. */
  subdivisions: Array<{value: string; count: number}>;
  /** Distinct complexity values present, ascending. */
  complexities: number[];
  /** Distinct length-in-bars values present, ascending. */
  lengths: number[];
}

/**
 * Build groove clusters from fills.
 *
 * Fills with a null/empty similarity key are skipped (they have no usable
 * groove — e.g. a fill with no preceding groove). Clusters are sorted by fill
 * count descending, then by similarity key for stable ordering.
 */
export function buildGrooveClusters(
  fills: GrooveClusterInput[],
): GrooveCluster[] {
  const byKey = new Map<string, GrooveClusterInput[]>();
  for (const fill of fills) {
    const key = fill.grooveSimilarityKey;
    if (!key) continue;
    const list = byKey.get(key);
    if (list) list.push(fill);
    else byKey.set(key, [fill]);
  }

  const clusters: GrooveCluster[] = [];
  for (const [similarityKey, members] of byKey) {
    clusters.push(summarizeCluster(similarityKey, members));
  }

  clusters.sort(
    (a, b) =>
      b.fillCount - a.fillCount ||
      (a.similarityKey < b.similarityKey
        ? -1
        : a.similarityKey > b.similarityKey
          ? 1
          : 0),
  );
  return clusters;
}

function summarizeCluster(
  similarityKey: string,
  members: GrooveClusterInput[],
): GrooveCluster {
  let tempoMin = Infinity;
  let tempoMax = -Infinity;
  const songs = new Set<string>();
  const subdivCounts = new Map<string, number>();
  const fingerprintCounts = new Map<string, number>();
  const complexities = new Set<number>();
  const lengths = new Set<number>();
  const fillIds: string[] = [];

  for (const m of members) {
    fillIds.push(m.id);
    if (m.tempoBpm < tempoMin) tempoMin = m.tempoBpm;
    if (m.tempoBpm > tempoMax) tempoMax = m.tempoBpm;
    songs.add(m.chartHash);
    subdivCounts.set(m.subdivision, (subdivCounts.get(m.subdivision) ?? 0) + 1);
    if (m.grooveFingerprint) {
      fingerprintCounts.set(
        m.grooveFingerprint,
        (fingerprintCounts.get(m.grooveFingerprint) ?? 0) + 1,
      );
    }
    complexities.add(m.complexity);
    lengths.add(m.lengthBars);
  }

  // Representative exact fingerprint = most common within the cluster.
  let representativeFingerprint = '';
  let bestCount = -1;
  for (const [fp, count] of fingerprintCounts) {
    if (
      count > bestCount ||
      (count === bestCount && fp < representativeFingerprint)
    ) {
      bestCount = count;
      representativeFingerprint = fp;
    }
  }

  const subdivisions = [...subdivCounts.entries()]
    .map(([value, count]) => ({value, count}))
    .sort((a, b) => b.count - a.count || (a.value < b.value ? -1 : 1));

  return {
    similarityKey,
    representativeFingerprint,
    fillCount: members.length,
    fillIds,
    tempoMin: tempoMin === Infinity ? 0 : tempoMin,
    tempoMax: tempoMax === -Infinity ? 0 : tempoMax,
    distinctSongs: songs.size,
    subdivisions,
    complexities: [...complexities].sort((a, b) => a - b),
    lengths: [...lengths].sort((a, b) => a - b),
  };
}

/** Summary stats over a set of clusters, for inspection / spot-check output. */
export interface GrooveClusterStats {
  totalFills: number;
  /** Fills with a usable (non-empty) similarity key. */
  clusterableFills: number;
  distinctClusters: number;
  /** Clusters containing exactly one fill. */
  singletonClusters: number;
  /** Largest cluster's fill count. */
  largestCluster: number;
}

export function summarizeClusterDistribution(
  totalFills: number,
  clusters: GrooveCluster[],
): GrooveClusterStats {
  let clusterableFills = 0;
  let singletonClusters = 0;
  let largestCluster = 0;
  for (const c of clusters) {
    clusterableFills += c.fillCount;
    if (c.fillCount === 1) singletonClusters++;
    if (c.fillCount > largestCluster) largestCluster = c.fillCount;
  }
  return {
    totalFills,
    clusterableFills,
    distinctClusters: clusters.length,
    singletonClusters,
    largestCluster,
  };
}
