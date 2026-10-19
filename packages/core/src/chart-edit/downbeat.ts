/**
 * Placing a bar line at an arbitrary tick.
 *
 * One capability sits under three editor gestures: "make this a downbeat",
 * "insert a time signature change here", and dragging an existing time
 * signature marker to a new tick. All three mean the same thing musically —
 * a bar starts *here* — and all three have the same consequence: the measure
 * that used to run through this tick is now short, so it needs its own
 * signature whose length is exactly the gap.
 *
 * The plan is pure tick arithmetic over the authored `timeSignatures` list.
 * It never touches notes, tempos, or milliseconds; the command layer applies
 * the returned list and re-times the events.
 *
 * ## What a short measure looks like
 *
 * `.chart` encodes a time signature as `TS <numerator> [<denominator
 * exponent>]`, so the denominator must be a power of two (the exponent
 * defaults to 2, i.e. x/4). A measure short by a sixteenth cannot be written
 * in x/4, so the denominator moves finer until the gap divides exactly: a 4/4
 * bar cut a sixteenth early is written 15/16. The search starts at the
 * region's own denominator (so a gap that is a whole number of the region's
 * beats keeps the meter's feel — half of a 4/4 bar is 2/4, not 1/2) and only
 * ever moves finer, up to {@link MAX_TS_DENOMINATOR}.
 *
 * ## When the gap is not expressible
 *
 * With free placement (grid snap off) a target can land on a tick that no
 * legal signature can measure — 5 ticks at resolution 192 is not a whole
 * number of 64th notes. The plan then returns `status: 'inexact'` and no
 * edits at all. The user's target is never silently rounded somewhere else;
 * the caller reports that the position needs a finer grid.
 */

import {
  beatUnitTicks,
  normalizeTimeSignatures,
  type DerivedTimeSignature,
  type TimeSignatureInput,
} from './bar-derivation';

/** Finest denominator a placed bar line may use (a 64th-note beat). */
export const MAX_TS_DENOMINATOR = 64;

/** Power-of-two denominators a `.chart` TS event can encode, coarse → fine. */
const DENOMINATORS = [1, 2, 4, 8, 16, 32, 64] as const;

/** A time signature with no position. */
export interface Meter {
  numerator: number;
  denominator: number;
}

/** A time signature at a tick. */
export interface PlacedMeter extends Meter {
  tick: number;
}

export interface DownbeatPlanOk {
  status: 'ok';
  /** The complete replacement `timeSignatures` list, ascending by tick. */
  timeSignatures: DerivedTimeSignature[];
  /** The rewritten (short) measure before the new bar line, or null when the
   *  target already fell on a bar line and nothing had to be shortened. */
  shortMeasure: PlacedMeter | null;
  /** The meter that resumes at the target tick; later bar lines count from
   *  here, which is what makes a drifted grid follow the new downbeat. */
  resumed: PlacedMeter;
}

export interface DownbeatPlanNoop {
  status: 'noop';
  reason: 'invalid-target' | 'invalid-signature' | 'already-a-bar-line';
}

export interface DownbeatPlanInexact {
  status: 'inexact';
  reason: 'gap-not-expressible';
  /** Ticks between the enclosing bar's start and the target. */
  gapTicks: number;
  barStartTick: number;
  maxDenominator: number;
}

export type DownbeatPlan =
  | DownbeatPlanOk
  | DownbeatPlanNoop
  | DownbeatPlanInexact;

/** The normalized region containing `tick` (the last region at/before it). */
function regionAt(
  regions: readonly TimeSignatureInput[],
  tick: number,
): TimeSignatureInput {
  let region = regions[0];
  for (const r of regions) {
    if (r.tick <= tick) region = r;
    else break;
  }
  return region;
}

/**
 * Express `gapTicks` as a legal signature, preferring `preferredDenominator`
 * and otherwise moving finer. Returns null when no denominator up to
 * {@link MAX_TS_DENOMINATOR} divides the gap exactly.
 */
export function meterForGap(
  gapTicks: number,
  resolution: number,
  preferredDenominator: number,
): Meter | null {
  if (!(gapTicks > 0) || !(resolution > 0)) return null;
  for (const denominator of DENOMINATORS) {
    if (denominator < preferredDenominator) continue;
    if (denominator > MAX_TS_DENOMINATOR) break;
    const unit = beatUnitTicks(resolution, denominator);
    if (!Number.isInteger(unit) || unit <= 0) continue;
    if (gapTicks % unit !== 0) continue;
    return {numerator: gapTicks / unit, denominator};
  }
  return null;
}

function sameList(
  a: readonly DerivedTimeSignature[],
  b: readonly TimeSignatureInput[],
): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (ts, i) =>
      ts.tick === b[i].tick &&
      ts.numerator === b[i].numerator &&
      ts.denominator === b[i].denominator,
  );
}

/**
 * Plan the time-signature edits that put a bar line exactly at `targetTick`.
 *
 * The measure containing `targetTick` is split in two: the part before it
 * takes a signature whose length equals that part, and `meterAfter` (the
 * region's own meter unless the caller is moving a marker with its own
 * meter) is re-anchored at `targetTick` so every later bar line counts from
 * there.
 *
 * Idempotent: replanning at the same tick finds the target already on a bar
 * line carrying that meter and reports `noop`, so odd measures never stack.
 */
export function planDownbeatAt(
  timeSignatures: readonly TimeSignatureInput[],
  resolution: number,
  targetTick: number,
  meterAfter?: Meter,
): DownbeatPlan {
  if (!Number.isFinite(targetTick) || targetTick <= 0) {
    return {status: 'noop', reason: 'invalid-target'};
  }
  if (!(resolution > 0)) {
    return {status: 'noop', reason: 'invalid-signature'};
  }
  const tick = Math.round(targetTick);
  const regions = normalizeTimeSignatures(timeSignatures);
  const region = regionAt(regions, tick);

  const regionUnit = beatUnitTicks(resolution, region.denominator);
  const barTicks = region.numerator * regionUnit;
  if (!(barTicks > 0)) {
    return {status: 'noop', reason: 'invalid-signature'};
  }

  const barIndex = Math.floor((tick - region.tick) / barTicks);
  const barStart = region.tick + barIndex * barTicks;
  const gap = tick - barStart;

  // A target that already starts a bar, with no meter of its own to anchor,
  // has nothing to place: the bar line is there and every later one already
  // counts from it. Adding an event that restates the region's own meter
  // would only litter the lane with a removable chip that changes nothing.
  // A marker move passes its own `meterAfter`, so it still anchors here.
  if (tick === barStart && meterAfter === undefined) {
    return {status: 'noop', reason: 'already-a-bar-line'};
  }

  const resumedMeter: Meter = meterAfter ?? {
    numerator: region.numerator,
    denominator: region.denominator,
  };
  if (!(resumedMeter.numerator > 0) || !(resumedMeter.denominator > 0)) {
    return {status: 'noop', reason: 'invalid-signature'};
  }

  let shortMeasure: PlacedMeter | null = null;
  if (gap > 0) {
    const meter = meterForGap(gap, resolution, region.denominator);
    if (!meter) {
      return {
        status: 'inexact',
        reason: 'gap-not-expressible',
        gapTicks: gap,
        barStartTick: barStart,
        maxDenominator: MAX_TS_DENOMINATOR,
      };
    }
    shortMeasure = {tick: barStart, ...meter};
  }

  // Everything outside the split measure survives untouched. The split
  // measure's own anchor (if any) is replaced by the short signature, and the
  // target carries the resumed meter.
  const kept = regions.filter(ts => ts.tick < barStart || ts.tick > tick);
  const resumed: PlacedMeter = {tick, ...resumedMeter};
  const next: DerivedTimeSignature[] = [
    ...kept.map(ts => ({
      tick: ts.tick,
      numerator: ts.numerator,
      denominator: ts.denominator,
    })),
    ...(shortMeasure
      ? [
          {
            tick: shortMeasure.tick,
            numerator: shortMeasure.numerator,
            denominator: shortMeasure.denominator,
          },
        ]
      : []),
    {
      tick: resumed.tick,
      numerator: resumed.numerator,
      denominator: resumed.denominator,
    },
  ].sort((a, b) => a.tick - b.tick);

  if (sameList(next, regions)) {
    return {status: 'noop', reason: 'already-a-bar-line'};
  }

  return {status: 'ok', timeSignatures: next, shortMeasure, resumed};
}

/**
 * Plan moving the authored time signature at `fromTick` to `toTick`, keeping
 * its own meter. The source event is dropped first, then the move goes
 * through {@link planDownbeatAt} so a dropped marker has exactly the same
 * preceding-measure consequence as a freshly placed downbeat.
 *
 * The tick-0 signature is the chart's initial meter and never moves.
 */
export function planTimeSignatureMove(
  timeSignatures: readonly TimeSignatureInput[],
  resolution: number,
  fromTick: number,
  toTick: number,
): DownbeatPlan {
  if (fromTick === 0) return {status: 'noop', reason: 'invalid-target'};
  const source = timeSignatures.find(ts => ts.tick === fromTick);
  if (!source) return {status: 'noop', reason: 'invalid-target'};
  const without = timeSignatures.filter(ts => ts.tick !== fromTick);
  const plan = planDownbeatAt(without, resolution, toTick, {
    numerator: source.numerator,
    denominator: source.denominator,
  });
  // A drop that lands the marker back on its own tick leaves the chart
  // exactly as it was; compare against the list including the source event,
  // which `planDownbeatAt` never saw.
  if (
    plan.status === 'ok' &&
    sameList(plan.timeSignatures, normalizeTimeSignatures(timeSignatures))
  ) {
    return {status: 'noop', reason: 'already-a-bar-line'};
  }
  return plan;
}
