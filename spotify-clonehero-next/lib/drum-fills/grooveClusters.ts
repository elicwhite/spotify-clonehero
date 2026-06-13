/**
 * Pure groove-clustering logic.
 *
 * Groups detected fills by their `grooveSimilarityKey` so that the same groove
 * (e.g. a straight-8ths backbeat) clusters across many songs, then summarizes
 * each cluster: how many fills, which songs/tempos/taxonomy it spans. The DB
 * query layer (`lib/drum-fills/db`) feeds rows into this; keeping the
 * aggregation here makes it unit-testable without a database.
 */

import {scoreGrooveDifficulty} from './detection/grooveDifficulty';

/**
 * Minimum fills for a groove cluster to be worth drilling. Grooves with fewer
 * are suppressed from the Grooves list — too little fill vocabulary to rotate.
 */
export const MIN_DRILLABLE_FILLS = 3;

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
  /** Continuous fill difficulty (0-100); used as the groove-sort tie-break. */
  difficultyScore: number;
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
  /**
   * Intrinsic difficulty of the beat itself (0-100) — the primary sort key.
   * Scored from the representative fingerprint + median tempo (see
   * `scoreGrooveDifficulty`); falls back to median complexity when no
   * fingerprint is available.
   */
  grooveDifficulty: number;
  /** Easiest member fill's difficulty (0-100) — the sort tie-break. */
  easiestFillDifficulty: number;
}

/**
 * Build groove clusters from fills.
 *
 * Fills with a null/empty similarity key are skipped (they have no usable
 * groove — e.g. a fill with no preceding groove). Clusters are sorted by
 * intrinsic groove difficulty ascending (easiest beats first), then by the
 * easiest available fill, then by similarity key for stable ordering.
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
      a.grooveDifficulty - b.grooveDifficulty ||
      a.easiestFillDifficulty - b.easiestFillDifficulty ||
      (a.similarityKey < b.similarityKey
        ? -1
        : a.similarityKey > b.similarityKey
          ? 1
          : 0),
  );
  return clusters;
}

/** Median of a non-empty numeric list. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
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
  const tempos: number[] = [];
  const complexityValues: number[] = [];
  let easiestFillDifficulty = Infinity;

  for (const m of members) {
    fillIds.push(m.id);
    if (m.tempoBpm < tempoMin) tempoMin = m.tempoBpm;
    if (m.tempoBpm > tempoMax) tempoMax = m.tempoBpm;
    tempos.push(m.tempoBpm);
    songs.add(m.chartHash);
    subdivCounts.set(m.subdivision, (subdivCounts.get(m.subdivision) ?? 0) + 1);
    if (m.grooveFingerprint) {
      fingerprintCounts.set(
        m.grooveFingerprint,
        (fingerprintCounts.get(m.grooveFingerprint) ?? 0) + 1,
      );
    }
    complexities.add(m.complexity);
    complexityValues.push(m.complexity);
    lengths.add(m.lengthBars);
    if (m.difficultyScore < easiestFillDifficulty) {
      easiestFillDifficulty = m.difficultyScore;
    }
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

  // Intrinsic difficulty of the beat (proposal 1): score the representative
  // fingerprint at the cluster's median tempo. With no fingerprint (rare),
  // fall back to median fill complexity scaled to 0-100.
  const medianBpm = tempos.length > 0 ? median(tempos) : 0;
  const grooveDifficulty = representativeFingerprint
    ? scoreGrooveDifficulty(representativeFingerprint, medianBpm)
    : Math.round((median(complexityValues) / 5) * 100);

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
    grooveDifficulty,
    easiestFillDifficulty:
      easiestFillDifficulty === Infinity ? 0 : easiestFillDifficulty,
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
