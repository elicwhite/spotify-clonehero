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
  const fingerprint = computeFingerprint(spanFps);

  return {lengthBars, subdivision, voicingTags, complexity, fingerprint};
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
