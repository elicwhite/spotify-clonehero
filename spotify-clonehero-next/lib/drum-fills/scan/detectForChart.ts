/**
 * Pure (DOM-free) glue between a parsed chart and the detection engine.
 *
 * Given a `ParsedChart`, this finds the Expert drums track, derives a stable
 * chart hash + per-fill ids, runs detection + classification, and returns
 * serializable `ScannedFill` records. Kept separate from the worker so it can
 * be unit-tested with synthetic charts (no `Worker`, no file handles).
 */

import {calculateTrackHash} from '@eliwhite/scan-chart';
import type {ParsedChart} from '@/lib/chart-edit/types';
import {
  detectFills,
  getExpertDrumsTrack,
} from '@/lib/drum-fills/detection/detectFills';
import {classifyAndDedupe} from '@/lib/drum-fills/detection/classify';
import {buildFingerprints} from '@/lib/drum-fills/detection/grooveModel';
import {
  canonicalGrooveFingerprint,
  grooveSimilarityKey,
  grooveSpanFingerprints,
} from '@/lib/drum-fills/detection/grooveFingerprint';
import type {
  ClassifiedFill,
  FillSubdivision,
} from '@/lib/drum-fills/detection/types';
import type {Subdivision} from '@/lib/drum-fills/db';
import type {ScannedFill, ScannedSongMeta} from './types';

/** Map detection-engine subdivisions onto the DB/taxonomy vocabulary. */
const SUBDIVISION_MAP: Record<FillSubdivision, Subdivision> = {
  '8th': '8ths',
  '16th': '16ths',
  triplet: 'triplets',
  mixed: 'mixed',
};

export function mapSubdivision(s: FillSubdivision): Subdivision {
  return SUBDIVISION_MAP[s];
}

/**
 * Derive a stable hash identifying this chart's Expert drums track. Uses
 * scan-chart's `calculateTrackHash` (blake3 over the track's notes), which is
 * deterministic across rescans of the same chart and independent of file
 * packaging (folder vs .sng). Falls back to a structural hash if the helper is
 * unavailable for this chart.
 */
export function computeChartHash(chart: ParsedChart): string {
  try {
    return calculateTrackHash(chart as never, 'drums', 'expert').hash;
  } catch {
    // Fallback: hash the expert-drums note ticks. Not cryptographic, but stable.
    const track = getExpertDrumsTrack(chart);
    const notes = track?.noteEventGroups ?? [];
    let h = 2166136261 >>> 0;
    for (const group of notes) {
      for (const n of group) {
        h = (h ^ n.tick) >>> 0;
        h = Math.imul(h, 16777619) >>> 0;
        h = (h ^ n.type) >>> 0;
        h = Math.imul(h, 16777619) >>> 0;
      }
    }
    return `fallback-${h.toString(16)}`;
  }
}

/**
 * Run fill detection on a parsed chart and return persistable records.
 * Returns an empty array if the chart has no Expert drums track or no fills.
 */
export function detectFillsForChart(
  chart: ParsedChart,
  meta: Omit<ScannedSongMeta, 'chartHash'> & {chartHash?: string},
): ScannedFill[] {
  const track = getExpertDrumsTrack(chart);
  if (!track) return [];

  const raw = detectFills(chart);
  if (raw.length === 0) return [];

  const classified: ClassifiedFill[] = classifyAndDedupe(chart, track, raw);
  if (classified.length === 0) return [];

  const chartHash = meta.chartHash ?? computeChartHash(chart);

  // Fingerprints are needed to derive each fill's groove fingerprint/key; build
  // once and reuse across all fills in the chart.
  const fingerprints = buildFingerprints(chart, track);

  return classified.map((cf, i) => {
    const c = cf.classification;
    const grooveSpan = grooveSpanFingerprints(
      fingerprints,
      cf.fill.grooveStartTick,
      cf.fill.grooveEndTick,
    );
    const grooveFingerprint = canonicalGrooveFingerprint(grooveSpan);
    const grooveSimKey = grooveSimilarityKey(grooveSpan);
    // Stable id: chartHash + fingerprint keeps the same fill stable across
    // rescans; the ordinal disambiguates the rare empty-fingerprint case.
    const idSuffix = c.fingerprint ? c.fingerprint : `pos${cf.fill.startTick}`;
    return {
      id: `${chartHash}:${idSuffix}:${i}`,
      chartHash,
      libraryPath: meta.libraryPath,
      song: meta.song,
      artist: meta.artist,
      charter: meta.charter,
      startTick: cf.fill.startTick,
      endTick: cf.fill.endTick,
      grooveStartTick: cf.fill.grooveStartTick,
      grooveEndTick: cf.fill.grooveEndTick,
      tempoBpm: cf.fill.tempoBpm,
      lengthBars: c.lengthBars,
      subdivision: mapSubdivision(c.subdivision),
      complexity: c.complexity,
      voicingTags: c.voicingTags,
      difficultyScore: c.difficultyScore,
      fingerprint: c.fingerprint,
      grooveFingerprint,
      grooveSimilarityKey: grooveSimKey,
      fillSimilarityKey: c.similarityKey,
      confidence: cf.fill.confidence,
      features: cf.fill.features,
    };
  });
}
