/**
 * Intrinsic groove difficulty (plan: groove sort, proposal 1).
 *
 * Scores how hard the *beat itself* is to play — the thing you loop
 * continuously in a groove session — independent of the fills mapped to it.
 * Derived purely from the canonical groove fingerprint (`slot:voiceMask`
 * onsets over a 48/bar grid) plus the groove's tempo, so it is deterministic
 * and unit-testable.
 *
 * Components (weights documented inline; each normalized to 0..1):
 *   onset rate   0.40  onsets/sec — couples density and tempo (a 16th-note
 *                      hat groove at 200bpm dwarfs straight 8ths at 120).
 *   kick work    0.25  kick rate + how syncopated the kicks are (off the beat).
 *   syncopation  0.15  fraction of onsets off the 8th-note grid.
 *   coordination 0.10  voice variety + simultaneous foot+hand hits.
 *   double kick  0.10  presence of two kicks inside a 16th (gallops/blasts).
 *
 * The result is 0..100. An empty fingerprint returns 0 (caller decides how to
 * order unknowns).
 */

import {GRID_DIVISIONS_PER_BAR, type DrumVoice} from './types';

/** Voice bits, matching grooveFingerprint's VOICE_BITS. */
const KICK = 1;
const SNARE = 2;
const HAT = 4;
const TOM = 8;
const CRASH = 16;

/** Voice bit → voice name, for deriving which voices a groove's beat uses. */
const BIT_TO_VOICE: Array<[number, DrumVoice]> = [
  [KICK, 'kick'],
  [SNARE, 'snare'],
  [HAT, 'hat'],
  [TOM, 'tom'],
  [CRASH, 'crash'],
];

/**
 * The set of voices the groove's beat itself uses (kick/snare/hat/tom/crash),
 * derived from its canonical fingerprint. Used to filter grooves by voicing
 * (e.g. "beats with a crash"). Returns voices in a stable order.
 */
export function grooveVoicesFromFingerprint(fingerprint: string): DrumVoice[] {
  let union = 0;
  for (const onset of parseGrooveFingerprint(fingerprint)) union |= onset.mask;
  return BIT_TO_VOICE.filter(([bit]) => union & bit).map(([, voice]) => voice);
}

/** Assumed beats per bar — the fingerprint grid is per-bar; 4/4 dominates. */
const BEATS_PER_BAR = 4;
/** Grid slots per beat (48 / 4) and per 8th/16th note. */
const SLOTS_PER_BEAT = GRID_DIVISIONS_PER_BAR / BEATS_PER_BAR; // 12
const SLOTS_PER_8TH = SLOTS_PER_BEAT / 2; // 6
const SLOTS_PER_16TH = SLOTS_PER_BEAT / 4; // 3

interface GrooveOnset {
  slot: number;
  mask: number;
}

/** Parse a canonical groove fingerprint (`slot:mask|slot:mask|...`). */
export function parseGrooveFingerprint(fingerprint: string): GrooveOnset[] {
  if (!fingerprint) return [];
  const onsets: GrooveOnset[] = [];
  for (const token of fingerprint.split('|')) {
    const colon = token.indexOf(':');
    if (colon < 0) continue;
    const slot = Number(token.slice(0, colon));
    const mask = Number(token.slice(colon + 1));
    if (Number.isFinite(slot) && Number.isFinite(mask))
      onsets.push({slot, mask});
  }
  return onsets.sort((a, b) => a.slot - b.slot);
}

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * Score a groove's intrinsic difficulty (0..100) from its canonical fingerprint
 * and tempo. Returns 0 for an empty fingerprint.
 */
export function scoreGrooveDifficulty(
  fingerprint: string,
  bpm: number,
): number {
  const onsets = parseGrooveFingerprint(fingerprint);
  if (onsets.length === 0) return 0;

  const tempo = bpm > 0 ? bpm : 120;
  const secPerBar = (60 / tempo) * BEATS_PER_BAR;

  // --- onset rate (density × tempo) ---
  const onsetRate = onsets.length / secPerBar; // onsets/sec
  // ~14 onsets/sec ≈ fast continuous 16ths; treat that as the hard ceiling.
  const rateScore = clamp01(onsetRate / 14);

  // --- kick work ---
  const kicks = onsets.filter(o => o.mask & KICK);
  const kickRate = kicks.length / secPerBar;
  const syncopatedKicks =
    kicks.length > 0
      ? kicks.filter(o => o.slot % SLOTS_PER_BEAT !== 0).length / kicks.length
      : 0;
  // Two kicks within a 16th = double-kick gallop/blast.
  let doubleKick = false;
  for (let i = 1; i < kicks.length; i++) {
    if (kicks[i].slot - kicks[i - 1].slot <= SLOTS_PER_16TH) {
      doubleKick = true;
      break;
    }
  }
  const kickScore =
    0.5 * clamp01(kickRate / 6) + 0.5 * clamp01(syncopatedKicks);

  // --- syncopation (onsets off the 8th-note grid) ---
  const offEighth = onsets.filter(o => o.slot % SLOTS_PER_8TH !== 0).length;
  const syncopationScore = clamp01(offEighth / onsets.length);

  // --- coordination (voice variety + simultaneous foot+hand) ---
  let voiceUnion = 0;
  let footHandCombos = 0;
  for (const o of onsets) {
    voiceUnion |= o.mask;
    const hasFoot = (o.mask & KICK) !== 0;
    const hasHand = (o.mask & (SNARE | TOM)) !== 0;
    if (hasFoot && hasHand) footHandCombos++;
  }
  const distinctVoices = [KICK, SNARE, HAT, TOM, CRASH].filter(
    b => voiceUnion & b,
  ).length;
  const coordinationScore =
    0.5 * clamp01(distinctVoices / 5) +
    0.5 * clamp01(footHandCombos / onsets.length);

  const score =
    100 *
    (0.4 * rateScore +
      0.25 * kickScore +
      0.15 * syncopationScore +
      0.1 * coordinationScore +
      0.1 * (doubleKick ? 1 : 0));

  return Math.round(Math.max(0, Math.min(100, score)));
}
