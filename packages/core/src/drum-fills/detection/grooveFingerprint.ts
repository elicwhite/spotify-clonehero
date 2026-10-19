/**
 * Canonical groove fingerprints for detected fills.
 *
 * Each detected fill carries a preceding-groove span (`grooveStartTick` ..
 * `grooveEndTick`). To support "pick a groove, drill many fills" practice we
 * derive two stable strings from that span:
 *
 *  - `grooveFingerprint`: a canonical, deterministic serialization of the
 *    dominant bar fingerprint of the groove span. Exact match = same groove
 *    pattern (same voices on the same slots).
 *  - `grooveSimilarityKey`: the same pattern with details that fragment
 *    otherwise-equivalent grooves removed — cymbal choice collapsed (hat/ride
 *    and crash both become a single "cymbal" class) and onset slots quantized
 *    to a coarser 16th-note grid so micro-timing / ghost ornamentation doesn't
 *    split a cluster. Equivalent grooves across different songs collapse onto
 *    the same key.
 *
 * Both are pure functions of `BarFingerprint[]`, so they are unit-testable and
 * run identically in the scan worker and the Node spot-check harness.
 */

import {fingerprintSimilarity} from './grooveModel';
import {
  type BarFingerprint,
  type DrumVoice,
  GRID_DIVISIONS_PER_BAR,
} from './types';

/** Stable bit per voice (matches grooveModel / classify ordering). */
const VOICE_BITS: Record<DrumVoice, number> = {
  kick: 1,
  snare: 2,
  hat: 4,
  tom: 8,
  crash: 16,
};

/** Stable single-letter token per voice, for human-readable keys. */
const VOICE_TOKEN: Record<DrumVoice, string> = {
  kick: 'K',
  snare: 'S',
  hat: 'H',
  tom: 'T',
  crash: 'C',
};

/**
 * Pick the canonical (dominant) bar fingerprint for a groove span.
 *
 * The span is the set of bar fingerprints fully contained in the groove's tick
 * range. The dominant bar is the one most similar to its neighbours (the
 * repeated groove bar); ties break toward the bar with the most onsets, then
 * earliest. Empty bars never win unless every bar is empty.
 */
export function pickCanonicalBar(
  spanFps: BarFingerprint[],
): BarFingerprint | null {
  const nonEmpty = spanFps.filter(fp => fp.onsets.length > 0);
  const pool = nonEmpty.length > 0 ? nonEmpty : spanFps;
  if (pool.length === 0) return null;
  if (pool.length === 1) return pool[0];

  let best: {fp: BarFingerprint; score: number} | null = null;
  for (const fp of pool) {
    let sim = 0;
    for (const other of pool) {
      if (other === fp) continue;
      sim += fingerprintSimilarity(fp, other);
    }
    if (
      !best ||
      sim > best.score ||
      (sim === best.score && fp.onsets.length > best.fp.onsets.length)
    ) {
      best = {fp, score: sim};
    }
  }
  return best!.fp;
}

/**
 * Select the bar fingerprints that belong to a fill's groove span.
 *
 * `grooveEndTick` is exclusive (it equals the fill's start tick). A bar belongs
 * to the span when it is fully contained in `[grooveStartTick, grooveEndTick)`.
 */
export function grooveSpanFingerprints(
  fingerprints: BarFingerprint[],
  grooveStartTick: number,
  grooveEndTick: number,
): BarFingerprint[] {
  return fingerprints.filter(
    fp => fp.startTick >= grooveStartTick && fp.endTick <= grooveEndTick,
  );
}

/**
 * Canonical groove fingerprint string for a span: the dominant bar serialized
 * as `slot:voiceMask` onsets, normalized so position within the song is
 * irrelevant. Returns `''` for an empty/onset-less span.
 */
export function canonicalGrooveFingerprint(spanFps: BarFingerprint[]): string {
  const bar = pickCanonicalBar(spanFps);
  if (!bar || bar.onsets.length === 0) return '';
  return bar.onsets.map(o => `${o.slot}:${voiceMaskOf(o.voices)}`).join('|');
}

/**
 * Similarity key for a groove span: the dominant bar with cymbal choice
 * collapsed (hat/ride/crash → one "cymbal" class) and onsets requantized to a
 * 16th-note grid, so equivalent grooves cluster across songs.
 *
 * Slots are folded from the 48/bar onset grid to 16/bar. Multiple onsets that
 * fold onto the same coarse slot merge their (collapsed) voice sets. The key is
 * a deterministic, order-independent serialization of `slot:tokens`.
 */
export function grooveSimilarityKey(spanFps: BarFingerprint[]): string {
  const bar = pickCanonicalBar(spanFps);
  if (!bar || bar.onsets.length === 0) return '';

  // Fold onto a 16th-note grid (48 / 16 = 3 fine slots per coarse slot).
  const COARSE = 16;
  const fold = GRID_DIVISIONS_PER_BAR / COARSE;

  const coarse = new Map<number, Set<string>>();
  for (const onset of bar.onsets) {
    const slot = Math.min(COARSE - 1, Math.round(onset.slot / fold));
    let set = coarse.get(slot);
    if (!set) {
      set = new Set<string>();
      coarse.set(slot, set);
    }
    for (const v of onset.voices) set.add(collapseVoiceToken(v));
  }

  return [...coarse.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([slot, tokens]) => `${slot}:${[...tokens].sort().join('')}`)
    .join('|');
}

/**
 * Similarity key for a fill span: a canonical fill fingerprint with dynamics
 * stripped, mirroring `grooveSimilarityKey` but spanning every bar of the fill
 * (a fill may be 0.5-2 bars) rather than picking one dominant bar.
 *
 * For each bar of the span the onsets are folded onto a 16th-note grid and
 * cymbal choice is collapsed (hat/crash → one "cymbal" class), so two
 * otherwise-identical fills that differ only in ghost-note micro-timing or
 * crash-vs-ride choice collapse onto the same key. Bars are joined with `/`
 * (preserving fill shape across bars) and onsets within a bar with `|`. The key
 * is empty for an onset-less span.
 *
 * Equivalent fills across different songs collapse onto the same key, enabling
 * cross-song dedupe of the library (plan 0045 §5).
 */
export function fillSimilarityKey(spanFps: BarFingerprint[]): string {
  const COARSE = 16;
  const fold = GRID_DIVISIONS_PER_BAR / COARSE;

  const barKeys: string[] = [];
  let sawOnset = false;
  for (const bar of spanFps) {
    const coarse = new Map<number, Set<string>>();
    for (const onset of bar.onsets) {
      sawOnset = true;
      const slot = Math.min(COARSE - 1, Math.round(onset.slot / fold));
      let set = coarse.get(slot);
      if (!set) {
        set = new Set<string>();
        coarse.set(slot, set);
      }
      for (const v of onset.voices) set.add(collapseVoiceToken(v));
    }
    barKeys.push(
      [...coarse.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([slot, tokens]) => `${slot}:${[...tokens].sort().join('')}`)
        .join('|'),
    );
  }

  if (!sawOnset) return '';
  return barKeys.join('/');
}

/** Bitmask for a voice set (stable, order-independent). */
function voiceMaskOf(voices: Set<DrumVoice>): number {
  let m = 0;
  for (const v of voices) m |= VOICE_BITS[v];
  return m;
}

/**
 * Collapse a voice to its similarity-class token: every cymbal (hat, ride, and
 * crash all already map to `hat`/`crash` in the voice model) becomes a single
 * `Y` token; kick/snare/tom keep their identity.
 */
function collapseVoiceToken(v: DrumVoice): string {
  if (v === 'hat' || v === 'crash') return 'Y';
  return VOICE_TOKEN[v];
}
