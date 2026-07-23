/**
 * Onyx Gem / ProType taxonomy and `compute_pro`.
 *
 * Direct port of `onyx_reduce.py`'s Gem model (Drums.hs:156-163) and
 * `compute_pro` (Drums.hs:328-345). **Production note:** the `/difficulties`
 * pipeline consumes scan-chart's already-resolved Pro lanes
 * (`adapter/onyx.ts`'s `resolvedGems`), NOT raw markers — a faithful native
 * `compute_pro` is impossible from `ParsedChart` (the raw region markers are
 * gone) and unnecessary (scan-chart resolves tom/cymbal/disco identically,
 * corroborated by the Python port's own AMBIGUITY #4). `compute_pro` is ported
 * here so the type/shape documents the Python port's own model and as a
 * fallback path should scan-chart's resolved lanes ever diverge from it on a
 * fixture; the unit tests port `test_onyx_reduce.py`'s `compute_pro` cases.
 */

import {Rational} from '../rational';

export type GemKind = 'kick' | 'red' | 'pro';
export type GemColor = '' | 'yellow' | 'blue' | 'green';
export type GemProType = '' | 'cymbal' | 'tom';

/** One resolved (or, when `protype === ''`, color-only) drum gem. */
export interface Gem {
  kind: GemKind;
  color: GemColor;
  protype: GemProType;
}

// Derived-Ord ranks (Haskell `deriving (Ord)`), used by `sortGems` and the
// coincident-position priority ordering. onyx_reduce.py:_KIND_RANK et al.
const KIND_RANK: Record<GemKind, number> = {kick: 0, red: 1, pro: 2};
const COLOR_RANK: Record<string, number> = {yellow: 0, blue: 1, green: 2};
const TYPE_RANK: Record<string, number> = {cymbal: 0, tom: 1};

export const KICK: Gem = {kind: 'kick', color: '', protype: ''};
export const RED: Gem = {kind: 'red', color: '', protype: ''};

export function pro(color: GemColor, protype: GemProType): Gem {
  return {kind: 'pro', color, protype};
}

export function gemEq(a: Gem, b: Gem): boolean {
  return a.kind === b.kind && a.color === b.color && a.protype === b.protype;
}

/** Canonical map/set key for a gem — structural equality as a string. */
export function gemKey(g: Gem): string {
  return `${g.kind}|${g.color}|${g.protype}`;
}

function sortKey(g: Gem): [number, number, number] {
  return [
    KIND_RANK[g.kind],
    g.color in COLOR_RANK ? COLOR_RANK[g.color] : -1,
    g.protype in TYPE_RANK ? TYPE_RANK[g.protype] : -1,
  ];
}

/** `sort gems` (Reductions.hs:476) — ascending by derived-Ord rank. Stable. */
export function sortGems(gems: Gem[]): Gem[] {
  return [...gems].sort((a, b) => {
    const ka = sortKey(a);
    const kb = sortKey(b);
    return ka[0] - kb[0] || ka[1] - kb[1] || ka[2] - kb[2];
  });
}

const GEM_TO_LANE: Record<string, string> = {
  'kick||': 'kick',
  'red||': 'snare',
  'pro|yellow|cymbal': 'hihat',
  'pro|yellow|tom': 'high-tom',
  'pro|blue|cymbal': 'ride',
  'pro|blue|tom': 'mid-tom',
  'pro|green|cymbal': 'crash',
  'pro|green|tom': 'floor-tom',
};

const LANE_TO_GEM: Record<string, Gem> = {
  kick: KICK,
  snare: RED,
  hihat: pro('yellow', 'cymbal'),
  'high-tom': pro('yellow', 'tom'),
  ride: pro('blue', 'cymbal'),
  'mid-tom': pro('blue', 'tom'),
  crash: pro('green', 'cymbal'),
  'floor-tom': pro('green', 'tom'),
};

export function gemToLane(g: Gem): string {
  const lane = GEM_TO_LANE[gemKey(g)];
  if (lane === undefined) throw new Error(`no lane for gem ${gemKey(g)}`);
  return lane;
}

export function laneToGem(lane: string): Gem {
  const g = LANE_TO_GEM[lane];
  if (g === undefined) throw new Error(`no gem for lane ${lane}`);
  return g;
}

/** A `(position, value)` status edge, as `compute_pro`'s `applyStatus` reads. */
export interface StatusEdge {
  pos: Rational;
  value: boolean;
}

/**
 * `applyStatus`-style lookup: the most recent edge at or before `pos`
 * (`edges` must be pre-sorted by position). Returns `false` before the first
 * edge. onyx_reduce.py `compute_pro.status_at`.
 */
function statusAt(edges: StatusEdge[], pos: Rational): boolean {
  // bisect_right on the edge positions, then step back one.
  let lo = 0;
  let hi = edges.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (pos.lt(edges[mid].pos)) hi = mid;
    else lo = mid + 1;
  }
  const idx = lo - 1;
  return idx >= 0 ? edges[idx].value : false;
}

export interface TomStatus {
  yellow: StatusEdge[];
  blue: StatusEdge[];
  green: StatusEdge[];
}

/**
 * Resolve raw color-only gems into Pro (cymbal/tom + disco-flip) gems.
 * onyx_reduce.py:compute_pro / Drums.hs:328-345.
 */
export function computePro(
  rawGems: {pos: Rational; gem: Gem}[],
  tomStatus: Partial<TomStatus>,
  discoStatus: StatusEdge[],
): {pos: Rational; gem: Gem}[] {
  const out: {pos: Rational; gem: Gem}[] = [];
  for (const {pos, gem} of rawGems) {
    const isDisco = statusAt(discoStatus, pos);
    if (gem.kind === 'kick') {
      out.push({pos, gem: KICK});
    } else if (gem.kind === 'red') {
      out.push({pos, gem: isDisco ? pro('yellow', 'cymbal') : RED});
    } else if (gem.kind === 'pro') {
      if (gem.color === 'yellow' && isDisco) {
        out.push({pos, gem: RED});
      } else {
        const edges =
          gem.color === 'yellow'
            ? tomStatus.yellow
            : gem.color === 'blue'
              ? tomStatus.blue
              : gem.color === 'green'
                ? tomStatus.green
                : undefined;
        const isTom = edges ? statusAt(edges, pos) : false;
        out.push({pos, gem: pro(gem.color, isTom ? 'tom' : 'cymbal')});
      }
    } else {
      throw new Error(`unexpected raw gem kind ${(gem as Gem).kind}`);
    }
  }
  return out;
}
