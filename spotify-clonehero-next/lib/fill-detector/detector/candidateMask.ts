/**
 * Candidate window detection using threshold-based rules
 */

import {AnalysisWindow, ValidatedConfig} from '../types';
import {mapScanChartNoteToVoice, DrumVoice} from '../drumLaneMap';
import {ticksToBeats} from '../quantize';

/**
 * Detection result for a single window
 */
export interface DetectionResult {
  isCandidate: boolean;
  reasons: string[];
  confidence: number; // 0-1 score indicating confidence in detection
}

/**
 * Applies threshold-based rules to identify fill candidate windows
 */
export function detectCandidateWindows(
  windows: AnalysisWindow[],
  config: ValidatedConfig,
): AnalysisWindow[] {
  const updatedWindows = windows.map(window => {
    const result = evaluateWindow(window, config);
    return {
      ...window,
      isCandidate: result.isCandidate,
    };
  });

  return updatedWindows;
}

/**
 * Evaluates a single window against detection criteria
 */
export function evaluateWindow(
  window: AnalysisWindow,
  config: ValidatedConfig,
): DetectionResult {
  const features = window.features;
  const thresholds = config.thresholds;
  const reasons: string[] = [];
  let confidence = 0;

  // Derive resolution from window size (windowBeats * resolution = window.endTick - window.startTick)
  const approxResolution = Math.max(
    1,
    Math.round((window.endTick - window.startTick) / (config.windowBeats || 1)),
  );
  const barTicks = 4 * approxResolution; // assume 4/4 for heuristic alignment
  const posInBarStart = window.startTick % barTicks;
  const posInBarEnd = window.endTick % barTicks;
  const nearBarStart = posInBarStart <= approxResolution * 0.5; // within half a beat of bar start
  const nearBarEnd = barTicks - posInBarEnd <= approxResolution * 0.5; // window ends close to bar boundary

  // Primary detection criteria (from design document)
  let primaryMatch = false;

  // Rule 1: High density + groove deviation
  if (
    features.densityZ > thresholds.densityZ &&
    features.grooveDist > thresholds.dist
  ) {
    reasons.push('High density with groove deviation');
    confidence += 0.4;
    primaryMatch = true;
  }

  // Rule 2: Tom ratio jump
  if (features.tomRatioJump > thresholds.tomJump) {
    reasons.push('Tom ratio spike');
    confidence += 0.3;
    primaryMatch = true;
  }

  // Rule 3: Stricter fallback - require extreme density and groove deviation
  if (
    features.noteDensity > 10 &&
    features.grooveDist > thresholds.dist * 1.1
  ) {
    reasons.push('Extremely high absolute density with groove deviation');
    confidence += 0.35;
    primaryMatch = true;
  }

  // Rule 4: Stricter tom content fallback - require density and tom jump together
  if (
    features.noteDensity > 5 &&
    features.tomRatioJump > thresholds.tomJump * 1.05
  ) {
    reasons.push('High tom content with jump');
    confidence += 0.25;
    primaryMatch = true;
  }

  // Rule 5: Bar-start tom emphasis (captures bar-long fills beginning on downbeat)
  if (!primaryMatch && window.notes.length > 0) {
    const tomCount = window.notes.filter(
      n => n.type === 3 || n.type === 5,
    ).length;
    const tomRatio =
      window.notes.length > 0 ? tomCount / window.notes.length : 0;
    if (
      nearBarStart &&
      tomRatio >= 0.7 &&
      features.densityZ > thresholds.densityZ * 0.9
    ) {
      reasons.push('Bar-start tom emphasis');
      confidence += 0.35;
      primaryMatch = true;
    }
  }

  // Rule 6: Bar-end tom burst (captures short fills resolving into next bar)
  if (!primaryMatch && window.notes.length > 0) {
    const tomCount = window.notes.filter(
      n => n.type === 3 || n.type === 5,
    ).length;
    const tomRatio =
      window.notes.length > 0 ? tomCount / window.notes.length : 0;
    if (
      nearBarEnd &&
      (tomRatio >= 0.55 || features.noteDensity >= 4.2) &&
      features.densityZ > thresholds.densityZ * 0.8
    ) {
      reasons.push('Bar-end tom burst');
      confidence += 0.3;
      primaryMatch = true;
    }
  }

  // Removed permissive early-song rule to avoid promoting repeating early sections

  // Secondary criteria (bonus scoring but not mandatory)
  if (features.hatDropout > 0.5) {
    reasons.push('Hat dropout');
    confidence += 0.1;
  }

  if (features.kickDrop > 0.3) {
    reasons.push('Kick drop');
    confidence += 0.1;
  }

  if (features.ioiStdZ > 1.5) {
    reasons.push('Irregular timing');
    confidence += 0.1;
  }

  if (features.ngramNovelty > 0) {
    reasons.push('Novel patterns');
    confidence += 0.1;
  }

  if (features.samePadBurst && features.densityZ > thresholds.densityZ * 0.9) {
    reasons.push('Same pad burst');
    confidence += 0.2;
  }

  if (features.crashResolve && features.noteDensity >= 3.0) {
    reasons.push('Crash resolution');
    confidence += 0.1;
  }

  // Apply additional heuristics
  const heuristicBonus = applyAdditionalHeuristics(window, config);
  confidence += heuristicBonus.confidenceBonus;
  reasons.push(...heuristicBonus.reasons);

  // Clamp confidence to [0, 1]
  confidence = Math.min(1, Math.max(0, confidence));

  return {
    isCandidate: primaryMatch,
    reasons,
    confidence,
  };
}

/**
 * Applies additional heuristic rules beyond the basic thresholds
 */
function applyAdditionalHeuristics(
  window: AnalysisWindow,
  config: ValidatedConfig,
): {confidenceBonus: number; reasons: string[]} {
  const features = window.features;
  const reasons: string[] = [];
  let confidenceBonus = 0;

  // Very high density is almost certainly a fill
  if (features.noteDensity > 8) {
    // 8 hits per beat is very dense
    reasons.push('Extremely high density');
    confidenceBonus += 0.3;
  }

  // Combination rules
  if (features.densityZ > 0.8 && features.tomRatioJump > 1.2) {
    reasons.push('Density + tom combo');
    confidenceBonus += 0.2;
  }

  if (features.hatDropout > 0.3 && features.kickDrop > 0.2) {
    reasons.push('Rhythm section dropout');
    confidenceBonus += 0.15;
  }

  if (features.samePadBurst && features.ioiStdZ > 0.8) {
    reasons.push('Complex burst pattern');
    confidenceBonus += 0.2;
  }

  // Penalize very low activity (likely not a fill)
  if (features.noteDensity < 1.0 && features.grooveDist < 1.0) {
    reasons.push('Low activity penalty');
    confidenceBonus -= 0.2;
  }

  return {confidenceBonus, reasons};
}

/**
 * Applies post-processing rules to refine candidate detection
 */
export function postProcessCandidates(
  windows: AnalysisWindow[],
  config: ValidatedConfig,
  resolution: number,
): AnalysisWindow[] {
  let processedWindows = [...windows];

  // Remove isolated single candidates (likely false positives)
  processedWindows = removeIsolatedCandidates(processedWindows);

  // Apply temporal constraints
  processedWindows = applyTemporalConstraints(
    processedWindows,
    config,
    resolution,
  );

  // Suppress repeating groove-like spans (data-driven, not song-specific)
  processedWindows = suppressRepeatingGrooveSpans(
    processedWindows,
    resolution,
    config,
  );

  // Frequency-based per-measure adjustment using hashed measure signatures
  processedWindows = adjustCandidatesByMeasureFrequency(
    processedWindows,
    resolution,
    config,
  );

  return processedWindows;
}

/**
 * Removes isolated candidate windows that are likely false positives
 */
function removeIsolatedCandidates(windows: AnalysisWindow[]): AnalysisWindow[] {
  const result = [...windows];

  for (let i = 0; i < result.length; i++) {
    if (!result[i].isCandidate) continue;

    // Check if this candidate has neighbors
    const hasLeftNeighbor = i > 0 && result[i - 1].isCandidate;
    const hasRightNeighbor = i < result.length - 1 && result[i + 1].isCandidate;

    // If isolated and not extremely confident, remove
    if (!hasLeftNeighbor && !hasRightNeighbor) {
      // Only keep if very high confidence or density
      const features = result[i].features;
      const isHighConfidence =
        features.densityZ > 2.0 || features.noteDensity > 10;

      if (!isHighConfidence) {
        result[i] = {...result[i], isCandidate: false};
      }
    }
  }

  return result;
}

/**
 * Heuristic: suppress candidates in an early multi-measure repeating section
 * Detect repeating groove by low novelty and low grooveDist over a span of bars.
 * If a contiguous block starting near bar 7 shows low novelty/deviation, demote candidates within it.
 */
function suppressRepeatingGrooveSpans(
  windows: AnalysisWindow[],
  resolution: number,
  config: ValidatedConfig,
): AnalysisWindow[] {
  const result = [...windows];
  if (result.length === 0) return result;

  const barTicks = 4 * resolution;

  // Build per-bar aggregates across the whole song
  interface BarAgg {
    startTick: number;
    endTick: number;
    novelty: number;
    groove: number;
    density: number;
  }
  const bars = new Map<number, BarAgg>();
  for (const w of result) {
    const barIndex = Math.floor(w.startTick / barTicks);
    const agg = bars.get(barIndex) || {
      startTick: barIndex * barTicks,
      endTick: (barIndex + 1) * barTicks,
      novelty: 0,
      groove: 0,
      density: 0,
    };
    agg.novelty += w.features.ngramNovelty || 0;
    agg.groove += w.features.grooveDist || 0;
    agg.density += w.features.noteDensity || 0;
    bars.set(barIndex, agg);
  }

  // Identify long spans (>= 4 bars) of low novelty and low groove deviation that likely represent repeating sections
  const barIndices = Array.from(bars.keys()).sort((a, b) => a - b);
  let spanStart: number | null = null;
  const spans: Array<{startBar: number; endBar: number}> = [];
  const noveltyThreshold = 0.1;
  const grooveThreshold = Math.max(1.2, config.thresholds.dist * 0.5);

  for (const idx of barIndices) {
    const agg = bars.get(idx)!;
    const avgNovelty = agg.novelty; // windows are evenly spaced; relative scale fine
    const avgGroove = agg.groove;
    const isGrooveBar =
      avgNovelty <= noveltyThreshold && avgGroove <= grooveThreshold;
    if (isGrooveBar) {
      if (spanStart === null) spanStart = idx;
    } else {
      if (spanStart !== null) {
        const end = idx - 1;
        if (end - spanStart + 1 >= 4)
          spans.push({startBar: spanStart, endBar: end});
        spanStart = null;
      }
    }
  }
  if (spanStart !== null) {
    const end = barIndices[barIndices.length - 1];
    if (end - spanStart + 1 >= 4)
      spans.push({startBar: spanStart, endBar: end});
  }

  if (spans.length === 0) return result;

  // Demote candidates fully contained in any groove-like span
  for (const span of spans) {
    const startTick = span.startBar * barTicks;
    const endTick = (span.endBar + 1) * barTicks;
    for (let i = 0; i < result.length; i++) {
      const w = result[i];
      if (w.isCandidate && w.startTick >= startTick && w.endTick <= endTick) {
        result[i] = {...w, isCandidate: false};
      }
    }
  }

  return result;
}

/**
 * Measure hashing and frequency-based up/downranking
 * - Build normalized per-measure signatures (5 voices x 16 slots) ignoring empty measures
 * - Compute frequencies of each signature across the song
 * - Cluster frequencies into low/high by largest-gap split
 * - Downrank candidates in high-frequency bars unless they exhibit strong-fill evidence
 * - Uprank windows in low-frequency bars if they exhibit moderate fill evidence near bar end
 */
function adjustCandidatesByMeasureFrequency(
  windows: AnalysisWindow[],
  resolution: number,
  config: ValidatedConfig,
): AnalysisWindow[] {
  const result = [...windows];
  if (result.length === 0) return result;

  const {barIndexToMask, maskToFrequency} = computeMeasureHashFrequencies(
    result,
    resolution,
  );
  if (maskToFrequency.size <= 1) {
    return result; // nothing to separate
  }

  // Group similar masks using a data-driven distance threshold
  const {maskToClusterId, clusterIdToTotalFrequency} =
    clusterSimilarMasks(maskToFrequency);
  const {highFreqClusterIds} = splitClustersByFrequency(
    clusterIdToTotalFrequency,
  );

  const barTicks = 4 * resolution;
  // Helper to decide strong vs moderate fill cues for a window
  function hasStrongEvidence(w: AnalysisWindow): boolean {
    const f = w.features;
    return (
      f.noteDensity >= 4.0 ||
      f.tomRatioJump > config.thresholds.tomJump ||
      (f.crashResolve && f.noteDensity >= 3.0) ||
      (f.samePadBurst && f.ioiStdZ >= 0.8)
    );
  }
  function hasModerateEvidence(
    w: AnalysisWindow,
    endNearBar: boolean,
  ): boolean {
    const f = w.features;
    return (
      endNearBar &&
      (f.densityZ > config.thresholds.densityZ * 0.8 ||
        f.ngramNovelty > 0 ||
        f.samePadBurst ||
        f.crashResolve)
    );
  }

  for (let i = 0; i < result.length; i++) {
    const w = result[i];
    const barIndex = Math.floor(w.endTick / barTicks); // bias toward where it resolves
    const mask = barIndexToMask.get(barIndex);
    if (!mask) continue; // empty bars ignored
    const clusterId = maskToClusterId.get(mask);
    if (clusterId === undefined) continue;

    const posInBarEnd = w.endTick % barTicks;
    const distanceToBarEnd = barTicks - posInBarEnd;
    const endNearBar = distanceToBarEnd <= 1.25 * resolution;

    if (highFreqClusterIds.has(clusterId)) {
      // Groove-like bar: only keep if strong evidence
      if (w.isCandidate && !hasStrongEvidence(w)) {
        result[i] = {...w, isCandidate: false};
      }
    }
  }

  return result;
}

function computeMeasureHashFrequencies(
  windows: AnalysisWindow[],
  resolution: number,
): {
  barIndexToMask: Map<number, string>;
  maskToFrequency: Map<string, number>;
} {
  const barTicks = 4 * resolution;
  const grid = Math.max(1, Math.floor(resolution / 4)); // 16th grid

  // Collect notes per bar with de-duplication
  const barToNotes = new Map<
    number,
    Map<string, {tick: number; type: number; flags?: number}>
  >();
  for (const w of windows) {
    for (const n of w.notes) {
      const barIndex = Math.floor(n.tick / barTicks);
      if (!barToNotes.has(barIndex)) barToNotes.set(barIndex, new Map());
      const key = `${n.tick}|${n.type}|${(n as any).flags ?? 0}`;
      barToNotes
        .get(barIndex)!
        .set(key, {tick: n.tick, type: n.type as any, flags: (n as any).flags});
    }
  }

  const barIndexToMask = new Map<number, string>();
  const maskToFrequency = new Map<string, number>();

  // Encode per bar
  for (const [barIndex, noteMap] of barToNotes.entries()) {
    if (noteMap.size === 0) continue; // ignore empty measures
    const startTick = barIndex * barTicks;
    // voices: KICK,SNARE,HAT,TOM,CYMBAL in fixed order
    const voiceOrder: DrumVoice[] = [
      DrumVoice.KICK,
      DrumVoice.SNARE,
      DrumVoice.HAT,
      DrumVoice.TOM,
      DrumVoice.CYMBAL,
    ];
    const voiceToBits = new Map<DrumVoice, number>();
    for (const v of voiceOrder) voiceToBits.set(v, 0);

    for (const {tick, type, flags} of noteMap.values()) {
      const slot = Math.floor((tick - startTick) / grid);
      if (slot < 0 || slot >= 16) continue;
      const voice = mapScanChartNoteToVoice(type as any, null, flags ?? 0);
      const current = voiceToBits.get(voice);
      if (current === undefined) continue; // ignore UNKNOWN and voices outside our set
      voiceToBits.set(voice, current | (1 << slot));
    }

    // If all voices are zero, treat as empty and skip
    const allZero = voiceOrder.every(v => (voiceToBits.get(v) || 0) === 0);
    if (allZero) continue;

    // Full mask: per-voice 16-bit hex, joined with |
    const mask = voiceOrder
      .map(v => (voiceToBits.get(v) || 0).toString(16).padStart(4, '0'))
      .join('|');
    barIndexToMask.set(barIndex, mask);
    maskToFrequency.set(mask, (maskToFrequency.get(mask) || 0) + 1);
  }

  return {barIndexToMask, maskToFrequency};
}

function hammingDistance(maskA: string, maskB: string): number {
  const partsA = maskA.split('|');
  const partsB = maskB.split('|');
  let dist = 0;
  const len = Math.min(partsA.length, partsB.length);
  for (let i = 0; i < len; i++) {
    const a = parseInt(partsA[i], 16);
    const b = parseInt(partsB[i], 16);
    let x = a ^ b;
    // popcount 16-bit
    x = x - ((x >>> 1) & 0x5555);
    x = (x & 0x3333) + ((x >>> 2) & 0x3333);
    dist += (((x + (x >>> 4)) & 0x0f0f) * 0x0101) >>> 8;
  }
  return dist;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor(p * (sorted.length - 1))),
  );
  return sorted[idx];
}

function clusterSimilarMasks(maskToFrequency: Map<string, number>): {
  maskToClusterId: Map<string, number>;
  clusterIdToTotalFrequency: Map<number, number>;
} {
  const masks = Array.from(maskToFrequency.keys());
  if (masks.length === 0)
    return {maskToClusterId: new Map(), clusterIdToTotalFrequency: new Map()};

  // Compute nearest-neighbor distance per mask
  const nearestDistances: number[] = [];
  for (let i = 0; i < masks.length; i++) {
    let best = Infinity;
    for (let j = 0; j < masks.length; j++) {
      if (i === j) continue;
      const d = hammingDistance(masks[i], masks[j]);
      if (d < best) best = d;
    }
    nearestDistances.push(isFinite(best) ? best : 0);
  }
  // Data-driven similarity threshold: 25th percentile of nearest-neighbor distances
  const nnThreshold = Math.max(
    0,
    Math.floor(percentile(nearestDistances, 0.25)),
  );

  // Single-linkage clustering with threshold
  const maskToClusterId = new Map<string, number>();
  let clusterIdCounter = 0;
  for (let i = 0; i < masks.length; i++) {
    if (maskToClusterId.has(masks[i])) continue;
    const cid = clusterIdCounter++;
    maskToClusterId.set(masks[i], cid);
    // expand cluster
    const queue = [masks[i]];
    while (queue.length > 0) {
      const cur = queue.pop()!;
      for (let j = 0; j < masks.length; j++) {
        const other = masks[j];
        if (maskToClusterId.has(other)) continue;
        const d = hammingDistance(cur, other);
        if (d <= nnThreshold) {
          maskToClusterId.set(other, cid);
          queue.push(other);
        }
      }
    }
  }

  const clusterIdToTotalFrequency = new Map<number, number>();
  for (const [mask, freq] of maskToFrequency.entries()) {
    const cid = maskToClusterId.get(mask)!;
    clusterIdToTotalFrequency.set(
      cid,
      (clusterIdToTotalFrequency.get(cid) || 0) + freq,
    );
  }

  return {maskToClusterId, clusterIdToTotalFrequency};
}

function splitClustersByFrequency(
  clusterIdToTotalFrequency: Map<number, number>,
): {
  highFreqClusterIds: Set<number>;
} {
  const entries = Array.from(clusterIdToTotalFrequency.entries());
  if (entries.length <= 1) return {highFreqClusterIds: new Set<number>()};
  const freqs = entries.map(([, f]) => f).sort((a, b) => a - b);
  let splitIdx = 0;
  let maxGap = -Infinity;
  for (let i = 0; i < freqs.length - 1; i++) {
    const gap = freqs[i + 1] - freqs[i];
    if (gap > maxGap) {
      maxGap = gap;
      splitIdx = i;
    }
  }
  const threshold = freqs[splitIdx];
  const highFreqClusterIds = new Set<number>();
  for (const [cid, f] of entries) {
    if (f > threshold) highFreqClusterIds.add(cid);
  }
  return {highFreqClusterIds};
}

/**
 * Applies temporal constraints based on musical structure
 */
function applyTemporalConstraints(
  windows: AnalysisWindow[],
  config: ValidatedConfig,
  resolution: number,
): AnalysisWindow[] {
  const result = [...windows];

  // Group consecutive candidates
  const candidateGroups: number[][] = [];
  let currentGroup: number[] = [];

  for (let i = 0; i < result.length; i++) {
    if (result[i].isCandidate) {
      currentGroup.push(i);
    } else {
      if (currentGroup.length > 0) {
        candidateGroups.push(currentGroup);
        currentGroup = [];
      }
    }
  }

  if (currentGroup.length > 0) {
    candidateGroups.push(currentGroup);
  }

  // Apply constraints to each group
  for (const group of candidateGroups) {
    if (group.length === 0) continue;

    const startWindow = result[group[0]];
    const endWindow = result[group[group.length - 1]];
    const durationBeats = ticksToBeats(
      endWindow.endTick - startWindow.startTick,
      resolution,
    );

    // Remove groups that are too short or too long
    if (
      durationBeats < config.thresholds.minBeats ||
      durationBeats > config.thresholds.maxBeats
    ) {
      for (const windowIndex of group) {
        result[windowIndex] = {...result[windowIndex], isCandidate: false};
      }
      continue;
    }

    // Compute group stats used for temporal preference and optional relaxation
    const avgDensity =
      group.reduce((s, idx) => s + result[idx].features.noteDensity, 0) /
      group.length;
    let totalNotes = 0;
    let tomOrCymNotes = 0;
    let avgIoiStdZ = 0;
    for (const idx of group) {
      const w = result[idx];
      avgIoiStdZ += w.features.ioiStdZ;
      for (const n of w.notes) {
        totalNotes += 1;
        const voice = mapScanChartNoteToVoice(
          n.type as any,
          null,
          (n as any).flags ?? 0,
        );
        if (voice === DrumVoice.TOM || voice === DrumVoice.CYMBAL)
          tomOrCymNotes += 1;
      }
    }
    avgIoiStdZ = group.length > 0 ? avgIoiStdZ / group.length : 0;
    const tomRatio = totalNotes > 0 ? tomOrCymNotes / totalNotes : 0;
    const strongFill = avgDensity >= 4.0 || tomRatio >= 0.6;
    const avgGrooveDist =
      group.reduce((s, idx) => s + result[idx].features.grooveDist, 0) /
      group.length;
    const avgNovelty =
      group.reduce((s, idx) => s + result[idx].features.ngramNovelty, 0) /
      group.length;
    const hasHatKickDrop = group.some(
      idx =>
        result[idx].features.hatDropout > 0.5 &&
        result[idx].features.kickDrop > 0.3,
    );

    // Prefer fills that conclude near the end of a bar, with a slightly wider window for strong fills
    const barLengthTicks = 4 * resolution; // assumes common time
    const endTick = endWindow.endTick;
    const posInBar = endTick % barLengthTicks;
    const distanceToBarEnd = barLengthTicks - posInBar;
    const allowedBeats = strongFill ? 1.5 : 1.25;
    const nearBarEnd = distanceToBarEnd <= allowedBeats * resolution;

    if (!nearBarEnd) {
      // If not near bar end, allow keeping the group only if it shows strong fill characteristics or crash resolve
      const hasCrashResolve = group.some(
        idx => result[idx].features.crashResolve,
      );
      if (!hasCrashResolve && !strongFill) {
        for (const windowIndex of group) {
          result[windowIndex] = {...result[windowIndex], isCandidate: false};
        }
      }
    }

    // Additional acceptors:
    // A) Short late-measure tom burst near bar end with timing variance
    // reuse variables defined above: distanceToBarEnd
    if (
      distanceToBarEnd <= 1.5 * resolution &&
      tomRatio >= 0.7 &&
      avgIoiStdZ >= 1.0
    ) {
      // keep as candidate (no demotion)
    }

    // B) One-beat sweep starting on bar or a bar-long roll
    const startTick = startWindow.startTick;
    const startPosInBar = startTick % barLengthTicks;
    const nearBarStart = startPosInBar <= 0.25 * resolution;
    const isOneBeat = durationBeats >= 0.95 && durationBeats <= 1.2;
    const isBarLong = durationBeats >= 3.8 && durationBeats <= 4.4;
    const samePadBurst = group.some(idx => result[idx].features.samePadBurst);
    if (
      (isOneBeat && nearBarStart && tomRatio >= 0.75 && samePadBurst) ||
      (isBarLong && nearBarStart && tomRatio >= 0.6)
    ) {
      // keep (no action needed)
    }

    // Final acceptance guard: require some groove deviation and either novelty or hat/kick dropout unless it's a strong fill
    const passesFinalGuard =
      strongFill ||
      (avgGrooveDist >= config.thresholds.dist * 0.9 &&
        (avgNovelty > 0 || hasHatKickDrop));
    if (!passesFinalGuard) {
      for (const windowIndex of group) {
        result[windowIndex] = {...result[windowIndex], isCandidate: false};
      }
    }
  }

  return result;
}

/**
 * Gets statistics about candidate detection results
 */
export function getCandidateStatistics(windows: AnalysisWindow[]): {
  totalWindows: number;
  candidateWindows: number;
  candidateRatio: number;
  averageConfidence: number;
  candidateGroups: number;
} {
  const totalWindows = windows.length;
  const candidateWindows = windows.filter(w => w.isCandidate).length;
  const candidateRatio = totalWindows > 0 ? candidateWindows / totalWindows : 0;

  // Calculate average confidence (would need to store this info)
  const averageConfidence = 0; // Placeholder - would need to modify data structure

  // Count candidate groups
  let candidateGroups = 0;
  let inGroup = false;

  for (const window of windows) {
    if (window.isCandidate && !inGroup) {
      candidateGroups++;
      inGroup = true;
    } else if (!window.isCandidate) {
      inGroup = false;
    }
  }

  return {
    totalWindows,
    candidateWindows,
    candidateRatio,
    averageConfidence,
    candidateGroups,
  };
}

/**
 * Validates detection parameters
 */
export function validateDetectionConfig(config: ValidatedConfig): string[] {
  const errors: string[] = [];
  const t = config.thresholds;

  if (t.densityZ <= 0) {
    errors.push('densityZ threshold must be positive');
  }

  if (t.dist <= 0) {
    errors.push('dist threshold must be positive');
  }

  if (t.tomJump <= 1) {
    errors.push('tomJump threshold should be > 1 (ratio multiplier)');
  }

  if (t.minBeats <= 0) {
    errors.push('minBeats must be positive');
  }

  if (t.maxBeats <= t.minBeats) {
    errors.push('maxBeats must be greater than minBeats');
  }

  if (t.mergeGapBeats < 0) {
    errors.push('mergeGapBeats must be non-negative');
  }

  if (t.burstMs <= 0) {
    errors.push('burstMs must be positive');
  }

  return errors;
}

/**
 * Creates a debug report for candidate detection
 */
export function createDetectionReport(
  windows: AnalysisWindow[],
  config: ValidatedConfig,
): string {
  const stats = getCandidateStatistics(windows);
  const configErrors = validateDetectionConfig(config);

  let report = '=== Fill Detection Report ===\n\n';

  report += `Total Windows: ${stats.totalWindows}\n`;
  report += `Candidate Windows: ${stats.candidateWindows}\n`;
  report += `Candidate Ratio: ${(stats.candidateRatio * 100).toFixed(1)}%\n`;
  report += `Candidate Groups: ${stats.candidateGroups}\n\n`;

  if (configErrors.length > 0) {
    report += 'Configuration Errors:\n';
    for (const error of configErrors) {
      report += `  - ${error}\n`;
    }
    report += '\n';
  }

  report += 'Thresholds Used:\n';
  report += `  Density Z-Score: ${config.thresholds.densityZ}\n`;
  report += `  Groove Distance: ${config.thresholds.dist}\n`;
  report += `  Tom Jump Ratio: ${config.thresholds.tomJump}\n`;
  report += `  Duration Range: ${config.thresholds.minBeats} - ${config.thresholds.maxBeats} beats\n`;

  return report;
}
