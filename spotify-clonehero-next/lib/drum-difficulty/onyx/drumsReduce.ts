/**
 * Onyx `drumsReduce` (Reductions.hs:441-537), ported from `onyx_reduce.py`.
 *
 * All beat-space math goes through {@link Rational} (exact bigint arithmetic);
 * the Python original is exact `Fraction` arithmetic by construction ("no
 * epsilon: beats are always exact rationals"), so a float port would silently
 * reintroduce the imprecision it avoids. `diff` is `'h'` / `'m'` / `'e'`.
 */

import {Rational} from '../rational';
import {bisectLeft, bisectRight, insort} from './bisect';
import {gemEq, KICK, pro, RED, sortGems, type Gem} from './computePro';

// ---------------------------------------------------------------------------
// Measure map — beats-within-measure for isMeasure / isAligned.
// onyx_reduce.py:MeasureMap / build_measure_map (Reductions.hs:452-456).
// Beats are literal quarter-note beats, independent of the TS denominator
// (AMBIGUITY #2): a num/den measure is `num * 4/den` quarter-note-beats long.
// ---------------------------------------------------------------------------

export class MeasureMap {
  readonly starts: Rational[];

  constructor(starts: Rational[]) {
    if (starts.length === 0) throw new Error('need at least one measure');
    this.starts = starts; // sorted, ascending
  }

  beatsWithinMeasure(pos: Rational): Rational {
    let idx = bisectRight(this.starts, pos) - 1;
    if (idx < 0) idx = 0;
    return pos.sub(this.starts[idx]);
  }
}

export interface TsEvent {
  start: Rational;
  num: number;
  den: number;
}

/** onyx_reduce.py:build_measure_map. `endBeats` bounds the trailing segment. */
export function buildMeasureMap(
  tsEvents: TsEvent[],
  endBeats: Rational,
): MeasureMap {
  let events = tsEvents;
  if (events.length === 0 || !events[0].start.eq(Rational.ZERO)) {
    events = [{start: Rational.ZERO, num: 4, den: 4}, ...events];
  }
  events = [...events].sort((a, b) => a.start.compare(b.start));

  const starts: Rational[] = [];
  for (let i = 0; i < events.length; i++) {
    const {start, num, den} = events[i];
    const barBeats = Rational.of(num * 4, den);
    let segEnd: Rational;
    if (i + 1 < events.length) {
      segEnd = events[i + 1].start;
    } else {
      const base = endBeats.gt(start) ? endBeats : start;
      segEnd = base.add(barBeats);
    }
    let pos = start;
    while (pos.lt(segEnd)) {
      starts.push(pos);
      pos = pos.add(barBeats);
    }
  }
  return new MeasureMap(starts);
}

export function isMeasure(mm: MeasureMap, pos: Rational): boolean {
  return mm.beatsWithinMeasure(pos).eq(Rational.ZERO);
}

/** `divn`-aligned: beats-within-measure divided by `divn` is an integer. */
export function isAligned(
  mm: MeasureMap,
  divn: Rational,
  pos: Rational,
): boolean {
  return mm.beatsWithinMeasure(pos).div(divn).isInteger();
}

const HALF = Rational.of(1, 2);
const ONE = Rational.ONE;
const TWO = Rational.of(2, 1);

/** Reductions.hs:457-463. Lower = more important (kept preferentially). */
export function priority(mm: MeasureMap, pos: Rational): number {
  return (
    (isMeasure(mm, pos) ? 0 : 1) +
    (isAligned(mm, TWO, pos) ? 0 : 1) +
    (isAligned(mm, ONE, pos) ? 0 : 1) +
    (isAligned(mm, HALF, pos) ? 0 : 1)
  );
}

const DIFF_RANK: Record<string, number> = {e: 0, m: 1, h: 2};

// ---------------------------------------------------------------------------
// kept/keys collision-window model. `kept` maps a beat position (by canonical
// Rational string) to its coincident gems; `keys` is the sorted Rational list
// of occupied positions. Mirrors the Python `Dict[Beats, List[Gem]]` + sorted
// `keys` pair the reducers thread through.
// ---------------------------------------------------------------------------

export type Kept = Map<string, Gem[]>;

/**
 * Truncated subtraction (Haskell's `-|` monus over the non-negative `U.Beats`):
 * clamps to zero rather than going negative, so a window's lower bound never
 * falls below beat 0.
 */
function monus(a: Rational, b: Rational): Rational {
  return Rational.max(Rational.ZERO, a.sub(b));
}

/** Keys `k` with `lo < k < hi` — Map.split excludes the split point. */
function openInterval(
  sortedKeys: Rational[],
  lo: Rational,
  hi: Rational,
): Rational[] {
  const i = bisectRight(sortedKeys, lo);
  const j = bisectLeft(sortedKeys, hi);
  return sortedKeys.slice(i, j);
}

function bySortedPriority(
  mm: MeasureMap,
): (a: Rational, b: Rational) => number {
  return (a, b) => priority(mm, a) - priority(mm, b) || a.compare(b);
}

/** Reductions.hs:464-472. */
export function keepSnares(
  mm: MeasureMap,
  diff: string,
  snarePositions: Rational[],
): {kept: Kept; keys: Rational[]} {
  const ordered = [...snarePositions].sort(bySortedPriority(mm));
  const padding = diff === 'h' ? HALF : ONE;
  const kept: Kept = new Map();
  const keys: Rational[] = [];
  for (const pos of ordered) {
    if (openInterval(keys, monus(pos, padding), pos.add(padding)).length === 0) {
      kept.set(pos.toString(), [RED]);
      insort(keys, pos);
    }
  }
  return {kept, keys};
}

/** Reductions.hs:473-486. Mutates `kept`/`keys` in place. */
export function keepKit(
  mm: MeasureMap,
  diff: string,
  kitByPos: {pos: Rational; gems: Gem[]}[],
  kept: Kept,
  keys: Rational[],
): {kept: Kept; keys: Rational[]} {
  const ordered = [...kitByPos].sort(
    (a, b) => priority(mm, a.pos) - priority(mm, b.pos) || a.pos.compare(b.pos),
  );
  const padding = diff === 'h' ? HALF : ONE;
  const greenCymbal = pro('green', 'cymbal');
  const yellowCymbal = pro('yellow', 'cymbal');
  const blueCymbal = pro('blue', 'cymbal');
  for (const {pos, gems} of ordered) {
    const s = sortGems(gems);
    let gems2: Gem[];
    if (
      s.length === 2 &&
      s[0].kind === 'pro' &&
      s[0].protype === 'cymbal' &&
      gemEq(s[1], greenCymbal)
    ) {
      gems2 = [greenCymbal];
    } else if (
      s.length === 2 &&
      gemEq(s[0], yellowCymbal) &&
      gemEq(s[1], blueCymbal)
    ) {
      gems2 = [blueCymbal];
    } else if (
      s.length === 2 &&
      s[0].kind === 'pro' &&
      s[0].protype === 'tom' &&
      s[1].kind === 'pro' &&
      s[1].protype === 'tom' &&
      DIFF_RANK[diff] <= DIFF_RANK['m']
    ) {
      gems2 = [s[0]];
    } else {
      gems2 = gems;
    }

    const posStr = pos.toString();
    const window = openInterval(keys, monus(pos, padding), pos.add(padding));
    const ok =
      window.length === 0 ||
      (window.length === 1 && window[0].eq(pos) && kept.has(posStr));
    if (ok) {
      if (!kept.has(posStr)) {
        insort(keys, pos);
        kept.set(posStr, [...gems2]);
      } else {
        kept.set(posStr, [...gems2, ...kept.get(posStr)!]);
      }
    }
  }
  return {kept, keys};
}

/** Reductions.hs:487-500. */
export function keepKicks(
  mm: MeasureMap,
  diff: string,
  kickPositions: Rational[],
  kept: Kept,
  keys: Rational[],
): {kept: Kept; keys: Rational[]} {
  const ordered = [...kickPositions].sort(bySortedPriority(mm));
  const padding = diff === 'h' ? ONE : TWO;
  for (const pos of ordered) {
    const posStr = pos.toString();
    const window = openInterval(keys, monus(pos, padding), pos.add(padding));
    const hasKick = window.some(k =>
      (kept.get(k.toString()) ?? []).some(g => gemEq(g, KICK)),
    );
    // hasOneHandGem is `Map.lookup posn slice` in Haskell: the lookup is against
    // the open window, not `kept`, so a note at `posn` counts only when `posn`
    // itself falls inside the window (never true at `posn == 0`).
    const atPos = window.some(k => k.eq(pos)) ? kept.get(posStr) : undefined;
    const hasOneHandGem = atPos !== undefined && atPos.length === 1;
    if (!hasKick && (diff !== 'm' || window.length === 0 || hasOneHandGem)) {
      if (!kept.has(posStr)) {
        insort(keys, pos);
        kept.set(posStr, [KICK]);
      } else {
        kept.set(posStr, [KICK, ...kept.get(posStr)!]);
      }
    }
  }
  return {kept, keys};
}

// ---------------------------------------------------------------------------
// Easy-only per-section simplification — Reductions.hs:501-536.
// ---------------------------------------------------------------------------

/** Reductions.hs:507-509. `start` inclusive, `end` exclusive (null = open). */
function sliceGems(
  keys: Rational[],
  kept: Kept,
  start: Rational,
  end: Rational | null,
): Gem[] {
  const out: Gem[] = [];
  const startStr = start.toString();
  if (kept.has(startStr)) out.push(...kept.get(startStr)!);
  const i = bisectRight(keys, start);
  const j = end === null ? keys.length : bisectLeft(keys, end);
  for (const k of keys.slice(i, j)) out.push(...kept.get(k.toString())!);
  return out;
}

function inRange(k: Rational, start: Rational, end: Rational | null): boolean {
  return start.lte(k) && (end === null || k.lt(end));
}

/** Reductions.hs:520-525. */
function makeSnareKick(
  keys: Rational[],
  kept: Kept,
  start: Rational,
  end: Rational | null,
): {kept: Kept; keys: Rational[]} {
  const newKept: Kept = new Map();
  const newKeys: Rational[] = [];
  const greenCymbal = pro('green', 'cymbal');
  for (const k of keys) {
    const gems = kept.get(k.toString())!;
    if (inRange(k, start, end)) {
      let filtered: Gem[];
      if (k.eq(start) && gems.some(g => gemEq(g, greenCymbal))) {
        filtered = gems.filter(g => !gemEq(g, KICK));
      } else {
        filtered = gems.filter(g => gemEq(g, KICK) || gemEq(g, RED));
      }
      if (filtered.length > 0) {
        newKept.set(k.toString(), filtered);
        newKeys.push(k);
      }
    } else {
      newKept.set(k.toString(), gems);
      newKeys.push(k);
    }
  }
  return {kept: newKept, keys: newKeys};
}

/** Reductions.hs:526-529. */
function makeNoKick(
  keys: Rational[],
  kept: Kept,
  start: Rational,
  end: Rational | null,
): {kept: Kept; keys: Rational[]} {
  const newKept: Kept = new Map();
  const newKeys: Rational[] = [];
  for (const k of keys) {
    const gems = kept.get(k.toString())!;
    if (inRange(k, start, end)) {
      const filtered = gems.filter(g => !gemEq(g, KICK));
      if (filtered.length > 0) {
        newKept.set(k.toString(), filtered);
        newKeys.push(k);
      }
    } else {
      newKept.set(k.toString(), gems);
      newKeys.push(k);
    }
  }
  return {kept: newKept, keys: newKeys};
}

/** Reductions.hs:507-519. */
export function makeEasy(
  keys: Rational[],
  kept: Kept,
  start: Rational,
  end: Rational | null,
): {kept: Kept; keys: Rational[]} {
  const sl = sliceGems(keys, kept, start, end);
  const hihat = pro('yellow', 'cymbal');
  const nKicks = sl.filter(g => gemEq(g, KICK)).length;
  const nHihats = sl.filter(g => gemEq(g, hihat)).length;
  const nOtherKit = sl.filter(
    g => !gemEq(g, KICK) && !gemEq(g, RED) && !gemEq(g, hihat),
  ).length;
  let fn: typeof makeSnareKick;
  if (nKicks === 0) {
    fn = makeNoKick;
  } else if (nKicks > nHihats + nOtherKit) {
    fn = makeSnareKick;
  } else if (nHihats > nOtherKit) {
    fn = makeSnareKick;
  } else {
    fn = makeNoKick;
  }
  return fn(keys, kept, start, end);
}

// ---------------------------------------------------------------------------
// ensureODNotes — Reductions.hs:419-439. Flat (pos, Gem) streams.
// ---------------------------------------------------------------------------

export interface FlatGem {
  pos: Rational;
  gem: Gem;
}

/**
 * Guarantee every OD phrase keeps >= 1 note by reinserting the earliest
 * ORIGINAL (pre-reduction) event at/after the phrase start when the reduced
 * stream has none in `[start, end)`. onyx_reduce.py:ensure_od_notes.
 */
export function ensureOdNotes(
  odPhrases: {start: Rational; end: Rational}[],
  originalFlat: FlatGem[],
  reducedFlat: FlatGem[],
): FlatGem[] {
  const reduced = [...reducedFlat].sort((a, b) => a.pos.compare(b.pos));
  const reducedPositions = reduced.map(r => r.pos);
  const originalSorted = [...originalFlat].sort((a, b) => a.pos.compare(b.pos));
  const originalPositions = originalSorted.map(o => o.pos);
  for (const {start, end} of odPhrases) {
    const i = bisectLeft(reducedPositions, start);
    const j = bisectLeft(reducedPositions, end);
    if (i < j) continue; // already has >= 1 reduced note in [start, end)
    const k = bisectLeft(originalPositions, start);
    if (k < originalSorted.length) {
      const {pos, gem} = originalSorted[k];
      const idx = bisectRight(reducedPositions, pos);
      reduced.splice(idx, 0, {pos, gem});
      reducedPositions.splice(idx, 0, pos);
    }
  }
  return reduced;
}

// ---------------------------------------------------------------------------
// drumsReduce — Reductions.hs:441-537 (drums-only).
// ---------------------------------------------------------------------------

export function drumsReduce(
  diff: string,
  mm: MeasureMap,
  odPhrases: {start: Rational; end: Rational}[],
  sections: {pos: Rational; name: string}[],
  source: FlatGem[],
): FlatGem[] {
  const snareSet = new Map<string, Rational>();
  const kickSet = new Map<string, Rational>();
  const kitByPos = new Map<string, {pos: Rational; gems: Gem[]}>();
  for (const {pos, gem} of source) {
    if (gemEq(gem, RED)) {
      snareSet.set(pos.toString(), pos);
    } else if (gemEq(gem, KICK)) {
      kickSet.set(pos.toString(), pos);
    } else {
      const key = pos.toString();
      const entry = kitByPos.get(key);
      if (entry) entry.gems.push(gem);
      else kitByPos.set(key, {pos, gems: [gem]});
    }
  }
  const snarePositions = [...snareSet.values()].sort((a, b) => a.compare(b));
  const kickPositions = [...kickSet.values()].sort((a, b) => a.compare(b));
  // sorted(kit_by_pos.items()) — ascending by position.
  const kitSorted = [...kitByPos.values()].sort((a, b) => a.pos.compare(b.pos));

  let {kept, keys} = keepSnares(mm, diff, snarePositions);
  ({kept, keys} = keepKit(mm, diff, kitSorted, kept, keys));
  ({kept, keys} = keepKicks(mm, diff, kickPositions, kept, keys));

  if (diff === 'e') {
    const sectionStarts = [...sections].sort((a, b) => a.pos.compare(b.pos));
    for (let i = 0; i < sectionStarts.length; i++) {
      const start = sectionStarts[i].pos;
      const end =
        i + 1 < sectionStarts.length ? sectionStarts[i + 1].pos : null;
      ({kept, keys} = makeEasy(keys, kept, start, end));
    }
  }

  const reducedFlat: FlatGem[] = [];
  for (const k of keys) {
    for (const gem of kept.get(k.toString())!) {
      reducedFlat.push({pos: k, gem});
    }
  }
  return ensureOdNotes(odPhrases, source, reducedFlat);
}
