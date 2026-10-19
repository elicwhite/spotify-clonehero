/**
 * Downbeat-flag store operations (plan 0061 §3b, §6; plan 0062 §8).
 *
 * Pure, denominator-aware operations on the {@link DownbeatFlags} store — the
 * canonical source of truth for bar structure. None of these move a note,
 * lyric, section, or tempo in time (plan 0061 §3a class (c) — bar relabel):
 * they only re-flag which beats are downbeats. The command layer re-derives
 * the persisted `timeSignatures` from the mutated flags via
 * {@link deriveTimeSignatures} so the chart and the store never diverge.
 *
 * Two editing operations live here:
 *  - `markDownbeat` / `unmarkDownbeat` — the fine-grained per-beat toggle
 *    (0062 §8's context menu); a new downbeat inherits the denominator of the
 *    nearest preceding downbeat (equivalently the nearest preceding TS event).
 *  - `rephaseDownbeats` — §6's whole-song phase-rotation tap gesture: snap the
 *    tap to the nearest beat, compute its phase within its bar, and if the
 *    phase is non-zero rotate the entire flag lattice so the tapped beat (and
 *    every bar-length step from it, in both directions) becomes a downbeat.
 *    Whole-song by design — phase error is a global property of how the beat
 *    tracker locked on, so a forward-only rotation would fabricate a
 *    meter-change boundary at the tap that no real song exhibits.
 */

import type {ParsedChart} from './types';
import {
  beatUnitTicks,
  deriveBeatGrid,
  normalizeTimeSignatures,
  type DownbeatEntry,
  type DownbeatFlags,
  type TimeSignatureInput,
} from './bar-derivation';

// ---------------------------------------------------------------------------
// Chart span
// ---------------------------------------------------------------------------

/**
 * The last tick the bar grid must cover for a chart: the maximum tick across
 * time signatures, tempos, sections, end events, and every note (including
 * its sustain length). The `DownbeatFlags` store and every downbeat command
 * derive the grid over `[0, chartEndTick]`, so both always see the same span
 * and can't disagree about how many bars exist.
 */
export function chartEndTick(parsedChart: ParsedChart): number {
  let max = 0;
  const consider = (tick: number) => {
    if (tick > max) max = tick;
  };

  for (const ts of parsedChart.timeSignatures) consider(ts.tick);
  for (const t of parsedChart.tempos) consider(t.tick);
  for (const s of parsedChart.sections) consider(s.tick);
  for (const e of parsedChart.endEvents) consider(e.tick);
  for (const track of parsedChart.trackData) {
    for (const group of track.noteEventGroups) {
      for (const note of group) consider(note.tick + (note.length ?? 0));
    }
  }

  return max;
}

// ---------------------------------------------------------------------------
// Beat snapping
// ---------------------------------------------------------------------------

/**
 * Snap a tick to the nearest beat in the denominator-scaled grid, or null when
 * the chart has no beats. "Beat" is the denominator-scaled beat unit of the
 * region containing the tick (an eighth note in x/8, a sixteenth in x/16), so
 * the tap gesture and the mark gesture both land on a real grid beat — never a
 * fractional position that would corrupt the save-direction derivation.
 *
 * Nearest-beat snapping absorbs the ±50ms of tap imprecision the research
 * measured as safe: at any musical tempo a beat is far more than 50ms wide, so
 * a tap within 50ms of a beat always resolves to that beat.
 */
export function snapTickToNearestBeat(
  timeSignatures: readonly TimeSignatureInput[],
  resolution: number,
  endTick: number,
  tick: number,
): number | null {
  const beats = deriveBeatGrid(timeSignatures, resolution, endTick);
  if (beats.length === 0) return null;

  let bestTick = beats[0].tick;
  let bestDist = Math.abs(beats[0].tick - tick);
  for (let i = 1; i < beats.length; i++) {
    const dist = Math.abs(beats[i].tick - tick);
    if (dist < bestDist) {
      bestDist = dist;
      bestTick = beats[i].tick;
    }
  }
  return bestTick;
}

// ---------------------------------------------------------------------------
// Region lookup
// ---------------------------------------------------------------------------

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

/** The beat index of `tick` within its region, counted from the region's
 *  start in that region's denominator-scaled beat unit. */
function beatInRegion(
  region: TimeSignatureInput,
  resolution: number,
  tick: number,
): number {
  const unit = beatUnitTicks(resolution, region.denominator);
  return Math.round((tick - region.tick) / unit);
}

// ---------------------------------------------------------------------------
// Per-beat mark / unmark (0062 §8)
// ---------------------------------------------------------------------------

/**
 * Mark `tick` as a downbeat: a single sorted insert into `downbeats`. The new
 * entry inherits the denominator of the nearest preceding downbeat (which is
 * the denominator of the region it falls in, since every region starts on a
 * downbeat). No-op — returns null — when `tick <= 0` (beat 0 is always a
 * downbeat) or a downbeat already exists there.
 *
 * `tick` must already be beat-aligned (the command snaps it with
 * {@link snapTickToNearestBeat}); marking off-beat would create a fractional
 * bar on the save-direction derivation.
 */
export function markDownbeat(
  flags: DownbeatFlags,
  tick: number,
): DownbeatFlags | null {
  if (tick <= 0) return null;
  if (flags.downbeats.some(d => d.tick === tick)) return null;

  // Denominator of the nearest preceding entry.
  let denominator = flags.downbeats[0]?.denominator ?? 4;
  for (const d of flags.downbeats) {
    if (d.tick <= tick) denominator = d.denominator;
    else break;
  }

  const downbeats: DownbeatEntry[] = [...flags.downbeats, {tick, denominator}];
  downbeats.sort((a, b) => a.tick - b.tick);
  return {downbeats};
}

/**
 * Remove the downbeat at `tick`: a single filtered removal. No-op — returns
 * null — when `tick === 0` (beat 0 is never removable) or no downbeat exists
 * there.
 */
export function unmarkDownbeat(
  flags: DownbeatFlags,
  tick: number,
): DownbeatFlags | null {
  if (tick === 0) return null;
  if (!flags.downbeats.some(d => d.tick === tick)) return null;
  return {downbeats: flags.downbeats.filter(d => d.tick !== tick)};
}

// ---------------------------------------------------------------------------
// Whole-song phase rotation (§6)
// ---------------------------------------------------------------------------

/**
 * §6's tap "this is beat 1" gesture. Snaps `tapTick` to the nearest beat,
 * computes that beat's phase `p` within its bar (its beat index mod the bar's
 * numerator), and — when `p !== 0` — rotates the entire flag lattice so every
 * beat at phase `p` (per region, in that region's own beat unit and numerator)
 * becomes a downbeat, in both directions across the whole song. Tick 0 is
 * always pinned as a downbeat (0061 §3b invariant), so a non-zero rotation
 * leaves a short pickup bar at the very start — but no meter-change boundary
 * at the tap itself.
 *
 * Returns null (a no-op) when `p === 0` (the tapped beat is already a
 * downbeat) or the chart has no beats.
 */
export function rephaseDownbeats(
  timeSignatures: readonly TimeSignatureInput[],
  resolution: number,
  endTick: number,
  tapTick: number,
): DownbeatFlags | null {
  const beats = deriveBeatGrid(timeSignatures, resolution, endTick);
  if (beats.length === 0) return null;

  const regions = normalizeTimeSignatures(timeSignatures);

  const snapped = snapTickToNearestBeat(
    timeSignatures,
    resolution,
    endTick,
    tapTick,
  );
  if (snapped == null) return null;

  const tapRegion = regionAt(regions, snapped);
  const tapPhase =
    ((beatInRegion(tapRegion, resolution, snapped) % tapRegion.numerator) +
      tapRegion.numerator) %
    tapRegion.numerator;
  if (tapPhase === 0) return null;

  const downbeats: DownbeatEntry[] = [];
  for (const beat of beats) {
    const region = regionAt(regions, beat.tick);
    if (!(region.numerator > 0)) continue;
    const phase =
      ((tapPhase % region.numerator) + region.numerator) % region.numerator;
    if (
      beatInRegion(region, resolution, beat.tick) % region.numerator ===
      phase
    ) {
      downbeats.push({tick: beat.tick, denominator: region.denominator});
    }
  }

  // Pin the tick-0 downbeat (never dropped by a rotation).
  if (downbeats.length === 0 || downbeats[0].tick !== 0) {
    downbeats.unshift({tick: 0, denominator: regions[0].denominator});
  }

  return {downbeats};
}
