/**
 * Fill classification + dedupe.
 *
 * Turns a `DetectedFill` into a learnable taxonomy: length, subdivision,
 * voicing tags, complexity, and a tempo/position-independent fingerprint used
 * to dedupe near-identical fills within a song.
 */

import type {ParsedChart, ParsedTrackData} from '@/lib/chart-edit/types';
import {noteFlags} from '@/lib/chart-edit/types';
import {buildFingerprints, ticksPerBar} from './grooveModel';
import {fillSimilarityKey} from './grooveFingerprint';
import {
  type BarFingerprint,
  type Classification,
  type ClassifiedFill,
  type DetectedFill,
  type FillSubdivision,
  type VoicingTag,
  type DrumVoice,
} from './types';

/** Classify a single detected fill. */
export function classifyFill(
  chart: ParsedChart,
  track: ParsedTrackData,
  fill: DetectedFill,
  fingerprints?: BarFingerprint[],
): Classification {
  const fps = fingerprints ?? buildFingerprints(chart, track);
  const spanFps = fps.filter(
    fp => fp.startTick >= fill.startTick && fp.endTick <= fill.endTick,
  );

  const lengthBars = computeLengthBars(chart, fill, spanFps);
  const subdivision = computeSubdivision(spanFps);
  const voicingTags = computeVoicingTags(chart, track, fill);
  const complexity = computeComplexity(fill, spanFps);
  const difficultyScore = computeDifficultyScore(
    chart,
    track,
    fill,
    spanFps,
    subdivision,
    lengthBars,
  );
  const fingerprint = computeFingerprint(spanFps);
  const similarityKey = fillSimilarityKey(spanFps);

  return {
    lengthBars,
    subdivision,
    voicingTags,
    complexity,
    difficultyScore,
    fingerprint,
    similarityKey,
  };
}

/**
 * Continuous fill difficulty in [0, 100].
 *
 * Unlike the coarse 1–5 `complexity` (kept for filtering), this produces a fine
 * ordering so a groove cluster's fills form a smooth simple→complex ladder.
 *
 * Components (each normalized to [0, 1], then weighted; weights sum to 1):
 *
 *   onsetCount   0.14  raw note count (more notes = harder). [0, ~24] → [0, 1].
 *   peakRate     0.30  peak hits/sec at the fill's ACTUAL tempo — the dominant
 *                      term, so a 16th run at 180bpm scores far above the same
 *                      pattern at 90bpm. [0, 20 nps] → [0, 1].
 *   subdivision  0.16  rhythmic grain: 8th < 16th < triplet < mixed.
 *   voiceVariety 0.12  distinct voices used + how often consecutive onsets
 *                      change voice (linear movement around the kit).
 *   syncopation  0.12  fraction of onsets off the 8th-note grid.
 *   ornaments    0.08  flams / ghosts / accents present.
 *   length       0.08  fill length in bars (0.5 → 0, 1 → ~0.5, 2 → 1).
 *
 * The weights are documented here and intentionally make peak hit-rate at real
 * tempo the strongest signal, matching how a drummer experiences difficulty.
 */
export function computeDifficultyScore(
  chart: ParsedChart,
  track: ParsedTrackData,
  fill: DetectedFill,
  spanFps: BarFingerprint[],
  subdivision: FillSubdivision,
  lengthBars: number,
): number {
  // --- onset count ---
  let onsetCount = 0;
  for (const fp of spanFps) onsetCount += fp.onsets.length;
  const onsetScore = clamp(onsetCount / 24, 0, 1);

  // --- peak hit rate (notes/sec) at the fill's actual tempo ---
  // The tightest spacing between consecutive onsets, in ticks, sets the peak
  // rate. Convert ticks → seconds using the fill's tempo (BPM) and resolution.
  const onsetTicks: number[] = [];
  for (const fp of spanFps) for (const o of fp.onsets) onsetTicks.push(o.tick);
  onsetTicks.sort((a, b) => a - b);
  let minGapTicks = Infinity;
  for (let i = 1; i < onsetTicks.length; i++) {
    const gap = onsetTicks[i] - onsetTicks[i - 1];
    if (gap > 0 && gap < minGapTicks) minGapTicks = gap;
  }
  let peakNps = 0;
  if (minGapTicks !== Infinity) {
    const secPerTick = 60 / (fill.tempoBpm * chart.resolution);
    peakNps = 1 / (minGapTicks * secPerTick);
  }
  const peakScore = clamp(peakNps / 20, 0, 1);

  // --- subdivision grain ---
  // Derive grain from the actual inter-onset spacings (in 48/bar slots) rather
  // than the categorical `subdivision`, which lumps coarse spacings (quarter
  // notes) and genuinely complex mixed-grain fills both into "mixed". The
  // finest dominant spacing sets the base grain; spacing VARIANCE adds a
  // mixing bonus (a fill that mixes 16ths and triplets is harder than a clean
  // run of either).
  const spacings: number[] = [];
  for (const fp of spanFps) {
    for (let i = 1; i < fp.onsets.length; i++) {
      const d = fp.onsets[i].slot - fp.onsets[i - 1].slot;
      if (d > 0) spacings.push(d);
    }
  }
  let grainBase = 0;
  let mixBonus = 0;
  if (spacings.length > 0) {
    const sorted = [...spacings].sort((a, b) => a - b);
    const medianSpacing = sorted[Math.floor(sorted.length / 2)];
    // 12 slots = quarter (0), 6 = 8th (~0.35), 4 = triplet 8th (~0.6), 3 = 16th
    // (~0.85), <=2 = 32nd-ish (1). Map smaller spacing → higher grain.
    grainBase = clamp((12 - medianSpacing) / 9, 0, 1);
    const distinct = new Set(spacings).size;
    mixBonus = clamp((distinct - 1) / 4, 0, 1);
  }
  // `subdivision` still nudges the grain up for the explicitly-triplet/mixed
  // categories so those tags remain meaningful to the score.
  const subdivNudge =
    subdivision === 'mixed' ? 0.15 : subdivision === 'triplet' ? 0.1 : 0;
  const subdivScore = clamp(
    0.7 * grainBase + 0.2 * mixBonus + subdivNudge,
    0,
    1,
  );

  // --- voice variety + switch rate ---
  const voices = new Set<DrumVoice>();
  let switches = 0;
  let pairs = 0;
  for (const fp of spanFps) {
    for (let i = 0; i < fp.onsets.length; i++) {
      for (const v of fp.onsets[i].voices) voices.add(v);
      if (i > 0) {
        pairs++;
        if (mask(fp.onsets[i - 1].voices) !== mask(fp.onsets[i].voices)) {
          switches++;
        }
      }
    }
  }
  const varietyScore = clamp(voices.size / 5, 0, 1);
  const switchScore = pairs > 0 ? switches / pairs : 0;
  const voiceScore = 0.5 * varietyScore + 0.5 * switchScore;

  // --- syncopation (off the 8th-note grid) ---
  let total = 0;
  let offbeat = 0;
  for (const fp of spanFps) {
    for (const o of fp.onsets) {
      total++;
      if (o.slot % 6 !== 0) offbeat++;
    }
  }
  const syncScore = total > 0 ? offbeat / total : 0;

  // --- ornaments (flams / ghosts / accents) ---
  let hasFlam = false;
  let hasGhost = false;
  let hasAccent = false;
  for (const group of track.noteEventGroups) {
    if (group.length === 0) continue;
    const tick = group[0].tick;
    if (tick < fill.startTick || tick >= fill.endTick) continue;
    for (const note of group) {
      if (note.flags & noteFlags.flam) hasFlam = true;
      if (note.flags & noteFlags.ghost) hasGhost = true;
      if (note.flags & noteFlags.accent) hasAccent = true;
    }
  }
  const ornamentScore =
    (hasFlam ? 0.4 : 0) + (hasGhost ? 0.35 : 0) + (hasAccent ? 0.25 : 0);

  // --- length ---
  const lengthScore = clamp((lengthBars - 0.5) / 1.5, 0, 1);

  const raw =
    0.14 * onsetScore +
    0.3 * peakScore +
    0.16 * subdivScore +
    0.12 * voiceScore +
    0.12 * syncScore +
    0.08 * clamp(ornamentScore, 0, 1) +
    0.08 * lengthScore;

  return Math.round(clamp(raw, 0, 1) * 100);
}

function computeLengthBars(
  chart: ParsedChart,
  fill: DetectedFill,
  spanFps: BarFingerprint[],
): number {
  if (spanFps.length === 0) {
    // Fall back to tick-span vs one bar of the prevailing time signature.
    const sig = [...chart.timeSignatures]
      .sort((a, b) => a.tick - b.tick)
      .find(s => s.tick <= fill.startTick) ??
      chart.timeSignatures[0] ?? {numerator: 4, denominator: 4};
    const barTicks = ticksPerBar(
      chart.resolution,
      sig.numerator,
      sig.denominator,
    );
    const bars = (fill.endTick - fill.startTick) / barTicks;
    return roundLength(bars);
  }
  const total = spanFps.reduce(
    (acc, fp) => acc + (fp.endTick - fp.startTick),
    0,
  );
  const first = spanFps[0];
  const barTicks = first.endTick - first.startTick;
  return roundLength(total / barTicks);
}

function roundLength(bars: number): number {
  if (bars <= 0.75) return 0.5;
  if (bars <= 1.5) return 1;
  return 2;
}

/**
 * Determine subdivision from the inter-onset slot histogram.
 *
 * Slots are quantized to 48/bar. A spacing of 6 slots = 8th, 3 = 16th, 8 or 16
 * = triplet feel. We look at the dominant inter-onset spacing across the span.
 */
function computeSubdivision(spanFps: BarFingerprint[]): FillSubdivision {
  const spacings: number[] = [];
  for (const fp of spanFps) {
    for (let i = 1; i < fp.onsets.length; i++) {
      spacings.push(fp.onsets[i].slot - fp.onsets[i - 1].slot);
    }
  }
  if (spacings.length === 0) return '8th';

  let eighth = 0;
  let sixteenth = 0;
  let triplet = 0;
  let other = 0;
  for (const s of spacings) {
    if (s <= 0) continue;
    if (s === 3) sixteenth++;
    else if (s === 6) eighth++;
    else if (s === 8 || s === 16 || s === 4) triplet++;
    else other++;
  }

  const total = eighth + sixteenth + triplet + other;
  if (total === 0) return '8th';

  const dom = Math.max(eighth, sixteenth, triplet);
  // If no single class clearly dominates, call it mixed.
  if (dom / total < 0.5) return 'mixed';
  if (dom === sixteenth) return '16th';
  if (dom === triplet) return 'triplet';
  return '8th';
}

function computeVoicingTags(
  chart: ParsedChart,
  track: ParsedTrackData,
  fill: DetectedFill,
): VoicingTag[] {
  const tags: VoicingTag[] = [];
  const f = fill.features;

  if (f.tomFraction >= 0.3) tags.push('toms');
  if (f.snareFraction >= 0.85 && f.tomFraction < 0.15) tags.push('snare-only');
  if (f.kickFraction >= 0.25) tags.push('kick-woven');
  if (f.endsOnCrash) tags.push('crash-end');
  if (f.voiceCount >= 4) tags.push('cymbal-work');

  // Flam / ghost from raw flags in the fill span.
  let hasFlam = false;
  let hasGhost = false;
  for (const group of track.noteEventGroups) {
    if (group.length === 0) continue;
    const tick = group[0].tick;
    if (tick < fill.startTick || tick >= fill.endTick) continue;
    for (const note of group) {
      if (note.flags & noteFlags.flam) hasFlam = true;
      if (note.flags & noteFlags.ghost) hasGhost = true;
    }
  }
  if (hasFlam) tags.push('flams');
  if (hasGhost) tags.push('ghosts');

  return tags;
}

/**
 * Complexity 1-5 from density, syncopation, and voice-switch rate.
 */
function computeComplexity(
  fill: DetectedFill,
  spanFps: BarFingerprint[],
): number {
  const f = fill.features;

  // Density component: nps relative to typical 16th-note fill range.
  const densityScore = clamp(f.notesPerSecond / 12, 0, 1);

  // Syncopation: fraction of onsets on off-grid (not on 8th-note slots).
  let total = 0;
  let offbeat = 0;
  for (const fp of spanFps) {
    for (const o of fp.onsets) {
      total++;
      if (o.slot % 6 !== 0) offbeat++;
    }
  }
  const syncScore = total > 0 ? offbeat / total : 0;

  // Voice-switching: how often consecutive onsets change voice set.
  let switches = 0;
  let pairs = 0;
  for (const fp of spanFps) {
    for (let i = 1; i < fp.onsets.length; i++) {
      pairs++;
      const prev = mask(fp.onsets[i - 1].voices);
      const cur = mask(fp.onsets[i].voices);
      if (prev !== cur) switches++;
    }
  }
  const switchScore = pairs > 0 ? switches / pairs : 0;

  const raw = 0.45 * densityScore + 0.3 * syncScore + 0.25 * switchScore;
  return clamp(Math.round(1 + raw * 4), 1, 5);
}

/**
 * Tempo/position-independent fingerprint for dedupe.
 *
 * Concatenates each bar's onset (slot:voiceMask) pattern, normalized to the
 * span start so two identical fills at different song positions match.
 */
export function computeFingerprint(spanFps: BarFingerprint[]): string {
  if (spanFps.length === 0) return '';
  return spanFps
    .map(fp => fp.onsets.map(o => `${o.slot}:${mask(o.voices)}`).join('|'))
    .join('/');
}

const VOICE_BITS: Record<DrumVoice, number> = {
  kick: 1,
  snare: 2,
  hat: 4,
  tom: 8,
  crash: 16,
};

function mask(voices: Set<DrumVoice>): number {
  let m = 0;
  for (const v of voices) m |= VOICE_BITS[v];
  return m;
}

function clamp(x: number, lo: number, hi: number): number {
  if (Number.isNaN(x)) return lo;
  return Math.max(lo, Math.min(hi, x));
}

/**
 * Classify all detected fills in a chart and dedupe near-identical ones.
 *
 * Fills sharing the same fingerprint are collapsed: one representative kept,
 * `repetitions` counts how many were found.
 */
export function classifyAndDedupe(
  chart: ParsedChart,
  track: ParsedTrackData,
  fills: DetectedFill[],
): ClassifiedFill[] {
  const fingerprints = buildFingerprints(chart, track);
  const byPrint = new Map<string, ClassifiedFill>();
  const result: ClassifiedFill[] = [];

  for (const fill of fills) {
    const classification = classifyFill(chart, track, fill, fingerprints);
    const print = classification.fingerprint;

    if (print && byPrint.has(print)) {
      byPrint.get(print)!.repetitions++;
      continue;
    }
    const entry: ClassifiedFill = {fill, classification, repetitions: 1};
    if (print) byPrint.set(print, entry);
    result.push(entry);
  }

  return result;
}
