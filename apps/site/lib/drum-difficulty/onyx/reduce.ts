/**
 * Onyx `drumsComplete` orchestrator — Reductions.hs:389-417 / onyx_reduce.py.
 *
 * Regenerates Hard/Medium/Easy from Expert in an always-regenerate cascade:
 * Hard <- Expert, Medium <- Hard, and **Easy <- Hard, NOT Medium**
 * (Reductions.hs:408 — intentional, preserved).
 */

import {Rational} from '../rational';
import type {OnyxInput} from '../adapter/onyx';
import {gemToLane, laneToGem, type Gem} from './computePro';
import {drumsReduce, MeasureMap, type FlatGem} from './drumsReduce';

export interface OnyxTiers<T> {
  hard: T;
  medium: T;
  easy: T;
}

/** Reductions.hs:389-417 cascade. `expertPro` is the Pro-resolved Expert. */
export function drumsComplete(
  mm: MeasureMap,
  odPhrases: {start: Rational; end: Rational}[],
  sections: {pos: Rational; name: string}[],
  expertPro: FlatGem[],
): OnyxTiers<FlatGem[]> {
  const hard = drumsReduce('h', mm, odPhrases, sections, expertPro);
  const medium = drumsReduce('m', mm, odPhrases, sections, hard);
  const easy = drumsReduce('e', mm, odPhrases, sections, hard); // from Hard
  return {hard, medium, easy};
}

/**
 * A single reduced Onyx gem in the fixture-comparison shape: `tick = beats ×
 * 480` (always integral for real RB charts), plus the resolved lane and gem
 * fields matching `expected-onyx.json`.
 */
export interface OnyxOutNote {
  tick: number;
  lane: string;
  kind: Gem['kind'];
  color: Gem['color'];
  protype: Gem['protype'];
}

function toOutNote(f: FlatGem): OnyxOutNote {
  const tick = f.pos.mulInt(480);
  if (!tick.isInteger()) {
    throw new Error(`non-integral tick for beat ${f.pos.toString()}`);
  }
  return {
    tick: Number(tick.num),
    lane: gemToLane(f.gem),
    kind: f.gem.kind,
    color: f.gem.color,
    protype: f.gem.protype,
  };
}

/**
 * Run the full Onyx reduction off the adapter's {@link OnyxInput}, consuming
 * scan-chart's pre-resolved Pro lanes (`resolvedGems`) directly — the
 * production path (see {@link computePro} header for why raw markers aren't
 * used). Returns each tier in the `expected-onyx.json` note shape.
 */
export function reduceOnyx(input: OnyxInput): OnyxTiers<OnyxOutNote[]> {
  const mm = new MeasureMap(input.measureStarts);
  const expertPro: FlatGem[] = input.resolvedGems.map(g => ({
    pos: g.pos,
    gem: laneToGem(g.lane),
  }));
  const tiers = drumsComplete(
    mm,
    input.overdrivePhrases,
    input.sections,
    expertPro,
  );
  return {
    hard: tiers.hard.map(toOutNote),
    medium: tiers.medium.map(toOutNote),
    easy: tiers.easy.map(toOutNote),
  };
}
