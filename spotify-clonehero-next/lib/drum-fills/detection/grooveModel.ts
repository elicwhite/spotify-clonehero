/**
 * Groove model: turn an Expert drums track into per-bar rhythmic fingerprints
 * and infer the dominant local groove.
 *
 * A fingerprint quantizes every note-onset in a bar onto a fixed grid
 * (`GRID_DIVISIONS_PER_BAR` slots) and records the set of drum voices present
 * at each slot. Fingerprints are compared by slot/voice overlap to detect when
 * a bar departs from the surrounding groove (the basis for fill detection).
 */

import type {ParsedChart, ParsedTrackData} from '@/lib/chart-edit/types';
import {noteTypes, noteFlags} from '@/lib/chart-edit/types';
import {
  type BarFingerprint,
  type DrumVoice,
  type GridOnset,
  GRID_DIVISIONS_PER_BAR,
} from './types';

/** A bar's tick span and the time signature in effect. */
export interface BarSpan {
  barIndex: number;
  startTick: number;
  endTick: number;
  numerator: number;
  denominator: number;
}

/**
 * Map a drum NoteEvent (type + flags) to its voice class.
 *
 * Cymbal-flagged yellow ≈ hat (closed/open hat / ride class for grooves),
 * cymbal-flagged blue/green ≈ crash. Tom-flagged (or default for pro-drums)
 * yellow/blue/green ≈ tom. Red is snare, kick is kick.
 */
export function noteEventToVoice(note: {
  type: number;
  flags: number;
}): DrumVoice | null {
  switch (note.type) {
    case noteTypes.kick:
      return 'kick';
    case noteTypes.redDrum:
      return 'snare';
    case noteTypes.yellowDrum:
      // Yellow cymbal = hi-hat class; yellow tom = tom.
      return note.flags & noteFlags.cymbal ? 'hat' : 'tom';
    case noteTypes.blueDrum:
      return note.flags & noteFlags.cymbal ? 'crash' : 'tom';
    case noteTypes.greenDrum:
      return note.flags & noteFlags.cymbal ? 'crash' : 'tom';
    default:
      return null;
  }
}

/** Ticks in one bar of the given time signature at the chart resolution. */
export function ticksPerBar(
  resolution: number,
  numerator: number,
  denominator: number,
): number {
  // quarter notes per bar = numerator * (4 / denominator)
  return Math.round((resolution * 4 * numerator) / denominator);
}

/**
 * Compute the bar grid for a song over the tick range that contains notes.
 *
 * Walks tick-by-bar from the first time signature, switching bar length when a
 * later time signature's tick is reached at a bar boundary (CH semantics:
 * time-sig changes land on bar boundaries). Generates bars until `endTick`.
 */
export function computeBars(
  chart: Pick<ParsedChart, 'resolution' | 'timeSignatures'>,
  endTick: number,
): BarSpan[] {
  const resolution = chart.resolution;
  const sigs =
    chart.timeSignatures.length > 0
      ? [...chart.timeSignatures].sort((a, b) => a.tick - b.tick)
      : [{tick: 0, numerator: 4, denominator: 4}];

  const bars: BarSpan[] = [];
  let tick = sigs[0].tick;
  let barIndex = 0;
  let sigIdx = 0;

  // Safety bound to avoid pathological infinite loops on malformed charts.
  const MAX_BARS = 100000;

  while (tick < endTick && bars.length < MAX_BARS) {
    // Advance to the latest sig whose tick is <= current tick.
    while (sigIdx + 1 < sigs.length && sigs[sigIdx + 1].tick <= tick) {
      sigIdx++;
    }
    const sig = sigs[sigIdx];
    const barTicks = ticksPerBar(resolution, sig.numerator, sig.denominator);
    if (barTicks <= 0) break;

    bars.push({
      barIndex,
      startTick: tick,
      endTick: tick + barTicks,
      numerator: sig.numerator,
      denominator: sig.denominator,
    });

    barIndex++;
    tick += barTicks;
  }

  return bars;
}

/**
 * Build a fingerprint for one bar from its note groups.
 *
 * `groups` is the subset of `track.noteEventGroups` whose first note's tick
 * falls within [bar.startTick, bar.endTick). Onsets are quantized to
 * GRID_DIVISIONS_PER_BAR slots.
 */
export function buildBarFingerprint(
  bar: BarSpan,
  groups: ParsedTrackData['noteEventGroups'],
): BarFingerprint {
  const barTicks = bar.endTick - bar.startTick;
  const slotMap = new Map<number, GridOnset>();

  for (const group of groups) {
    if (group.length === 0) continue;
    const tick = group[0].tick;
    if (tick < bar.startTick || tick >= bar.endTick) continue;

    const rel = (tick - bar.startTick) / barTicks;
    let slot = Math.round(rel * GRID_DIVISIONS_PER_BAR);
    if (slot >= GRID_DIVISIONS_PER_BAR) slot = GRID_DIVISIONS_PER_BAR - 1;
    if (slot < 0) slot = 0;

    let onset = slotMap.get(slot);
    if (!onset) {
      onset = {slot, voices: new Set<DrumVoice>(), tick};
      slotMap.set(slot, onset);
    }
    for (const note of group) {
      const voice = noteEventToVoice(note);
      if (voice) onset.voices.add(voice);
    }
  }

  const onsets = [...slotMap.values()].sort((a, b) => a.slot - b.slot);
  const key = onsets
    .map(o => `${o.slot}:${voiceMask([...o.voices])}`)
    .join(',');

  return {
    barIndex: bar.barIndex,
    startTick: bar.startTick,
    endTick: bar.endTick,
    divisions: GRID_DIVISIONS_PER_BAR,
    onsets,
    key,
  };
}

const VOICE_BITS: Record<DrumVoice, number> = {
  kick: 1,
  snare: 2,
  hat: 4,
  tom: 8,
  crash: 16,
};

/** Bitmask for a set of voices (stable, order-independent). */
export function voiceMask(voices: DrumVoice[]): number {
  let mask = 0;
  for (const v of voices) mask |= VOICE_BITS[v];
  return mask;
}

/**
 * Build per-bar fingerprints for an entire track.
 *
 * Groups are bucketed by bar in a single pass for efficiency on large charts.
 */
export function buildFingerprints(
  chart: Pick<ParsedChart, 'resolution' | 'timeSignatures'>,
  track: ParsedTrackData,
): BarFingerprint[] {
  const groups = track.noteEventGroups.filter(g => g.length > 0);
  if (groups.length === 0) return [];

  const sortedGroups = [...groups].sort((a, b) => a[0].tick - b[0].tick);
  const lastTick = sortedGroups[sortedGroups.length - 1][0].tick;
  const bars = computeBars(chart, lastTick + 1);

  const fingerprints: BarFingerprint[] = [];
  let gi = 0;
  for (const bar of bars) {
    const barGroups: ParsedTrackData['noteEventGroups'] = [];
    while (gi < sortedGroups.length && sortedGroups[gi][0].tick < bar.endTick) {
      if (sortedGroups[gi][0].tick >= bar.startTick) {
        barGroups.push(sortedGroups[gi]);
      }
      gi++;
    }
    // A group exactly on the boundary belongs to the next bar; rewind if we
    // consumed one that starts at bar.endTick (defensive — loop condition uses
    // strict `<` so this shouldn't happen, but keep gi monotonic).
    fingerprints.push(buildBarFingerprint(bar, barGroups));
  }

  return fingerprints;
}

/**
 * Similarity between two bar fingerprints in [0, 1].
 *
 * Computed as a slot/voice Jaccard-style overlap: for every slot present in
 * either fingerprint, compare the voice sets. 1 = identical, 0 = disjoint.
 * Empty-vs-empty is treated as identical (1).
 */
export function fingerprintSimilarity(
  a: BarFingerprint,
  b: BarFingerprint,
): number {
  if (a.onsets.length === 0 && b.onsets.length === 0) return 1;

  const slotsA = new Map<number, Set<DrumVoice>>();
  for (const o of a.onsets) slotsA.set(o.slot, o.voices);
  const slotsB = new Map<number, Set<DrumVoice>>();
  for (const o of b.onsets) slotsB.set(o.slot, o.voices);

  const allSlots = new Set<number>([...slotsA.keys(), ...slotsB.keys()]);
  let intersection = 0;
  let union = 0;
  for (const slot of allSlots) {
    const va = slotsA.get(slot) ?? new Set<DrumVoice>();
    const vb = slotsB.get(slot) ?? new Set<DrumVoice>();
    const all = new Set<DrumVoice>([...va, ...vb]);
    for (const v of all) {
      const inA = va.has(v);
      const inB = vb.has(v);
      union++;
      if (inA && inB) intersection++;
    }
  }
  return union === 0 ? 1 : intersection / union;
}

/**
 * Infer the dominant local groove for `barIndex` using the preceding window.
 *
 * Returns the most common fingerprint among the previous `window` bars, but
 * only if it repeats at least `minCount` times (an established groove). Returns
 * null when there is no stable groove (intro, constant variation, sparse).
 */
export function inferLocalGroove(
  fingerprints: BarFingerprint[],
  barIndex: number,
  options: {window: number; minCount: number; similarity: number},
): BarFingerprint | null {
  const {window, minCount, similarity} = options;
  const start = Math.max(0, barIndex - window);
  const candidates = fingerprints.slice(start, barIndex);
  if (candidates.length === 0) return null;

  // Cluster candidates by similarity; pick the largest cluster.
  let best: {rep: BarFingerprint; count: number} | null = null;
  for (const cand of candidates) {
    if (cand.onsets.length === 0) continue;
    let count = 0;
    for (const other of candidates) {
      if (fingerprintSimilarity(cand, other) >= similarity) count++;
    }
    if (!best || count > best.count) best = {rep: cand, count};
  }

  if (!best || best.count < minCount) return null;
  return best.rep;
}
