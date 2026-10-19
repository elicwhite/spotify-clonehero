/**
 * Pure grid-scene derivation for the piano-roll timeline (plan 0062 §4/§8).
 *
 * Bar lines, bar numbering, and the bar.beat readout are derived from the
 * shared denominator-aware module `deriveBeatGrid` (0061 §3b / task 61-6a) —
 * the *same* function the highway `GridOverlay` consumes — never from a
 * panel-local `tick % (4*RES)` calculation. This is the "one derivation for
 * every derived fact" invariant: if the ruler and the highway ever disagree
 * about where a bar line is, that is a bug in this module, not a rendering
 * detail.
 *
 * ms positions come from the canonical `tickToMs` + `buildTimedTempos`
 * (`lib/drum-transcription/timing.ts`); no tick↔ms logic is forked here.
 */

import {
  deriveBeatGrid,
  type TimeSignatureInput,
} from '@/lib/chart-edit/bar-derivation';
import {tickToMs} from '@/lib/drum-transcription/timing';
import type {TimedTempo} from '@/lib/drum-transcription/chart-types';

/** One beat in the derived grid, with its real-time position and bar number. */
export interface GridBeat {
  tick: number;
  ms: number;
  /** True when this beat starts a bar. */
  isDownbeat: boolean;
  /** 1-based bar this beat belongs to. */
  barNumber: number;
  /** Time-signature denominator of the region containing this beat. */
  denominator: number;
}

/**
 * Derive every beat in `[0, endTick]` from the chart's time signatures, tag
 * each with its real-time ms (via the tempo map) and the 1-based bar it falls
 * in. Bar numbers advance on each downbeat (`deriveBeatGrid`'s `isDownbeat`).
 */
export function buildBeatGrid(
  timeSignatures: readonly TimeSignatureInput[],
  resolution: number,
  endTick: number,
  timedTempos: TimedTempo[],
): GridBeat[] {
  const beats = deriveBeatGrid(timeSignatures, resolution, endTick);
  let barNumber = 0;
  return beats.map(beat => {
    if (beat.isDownbeat) barNumber += 1;
    return {
      tick: beat.tick,
      ms: tickToMs(beat.tick, timedTempos, resolution),
      isDownbeat: beat.isDownbeat,
      barNumber: Math.max(1, barNumber),
      denominator: beat.denominator,
    };
  });
}

/** The bar/beat position (1-based) at a tick, from a derived beat grid. */
export function barBeatAtTick(
  tick: number,
  beats: readonly GridBeat[],
): {bar: number; beat: number} {
  if (beats.length === 0) return {bar: 1, beat: 1};
  let barNumber = 1;
  let barStartIndex = 0;
  for (let i = 0; i < beats.length; i++) {
    if (beats[i].tick > tick) break;
    if (beats[i].isDownbeat) {
      barNumber = beats[i].barNumber;
      barStartIndex = i;
    }
  }
  // Count beats from the bar's downbeat to the last beat at//before `tick`.
  let beatInBar = 1;
  for (let i = barStartIndex; i < beats.length; i++) {
    if (beats[i].tick > tick) break;
    beatInBar = i - barStartIndex + 1;
  }
  return {bar: barNumber, beat: beatInBar};
}
