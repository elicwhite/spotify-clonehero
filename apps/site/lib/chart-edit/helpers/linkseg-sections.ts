/**
 * LinkSeg functional-section labels → chart section markers.
 *
 * The model reports segment edges in seconds plus one label per segment.
 * Turning that into chart sections is the same job on both surfaces that do
 * it — the drum-transcription chart builder (fresh audio-flow chart) and the
 * editor's Sections assist card — so the ms→tick conversion, bar-line
 * snapping, and repeat numbering live here once.
 *
 * The input shape is described structurally rather than importing
 * `LinkSegSections` from `lib/tempo-map`, so `lib/chart-edit` keeps no
 * dependency on the tempo pipeline.
 */

import {getNextMeasureTick, msToTick} from '@/lib/drum-transcription/timing';
import type {TimedTempo} from '@/lib/drum-transcription/chart-types';

/** Segment edges in seconds (length S+1, including 0 and the duration) plus
 *  one product-facing label per segment (length S). */
export interface LinkSegSectionInput {
  times: number[];
  labels: string[];
}

/** A section marker ready for `addSection`. */
export interface SectionMarker {
  tick: number;
  name: string;
}

export interface TimeSignatureMarker {
  tick: number;
  numerator: number;
  denominator: number;
}

/**
 * Every bar-line tick from 0 up to (but not past) `endTick`. Built by walking
 * `getNextMeasureTick`, so mid-song time-signature changes move the ladder
 * exactly the way the chart's own bars move.
 */
export function buildBarTicks(
  resolution: number,
  timeSignatures: readonly TimeSignatureMarker[],
  endTick: number,
): number[] {
  const barTicks: number[] = [];
  let t = 0;
  while (t < endTick) {
    barTicks.push(t);
    const next = getNextMeasureTick(t, 1, resolution, [...timeSignatures]);
    if (next <= t) break; // safety: never loop in place
    t = next;
  }
  return barTicks;
}

/** Nearest bar-line to `tick` in an ascending `barTicks` ladder. */
export function snapTickToBar(
  tick: number,
  barTicks: readonly number[],
): number {
  let best = barTicks[0];
  let bestD = Math.abs(tick - best);
  for (let i = 1; i < barTicks.length; i++) {
    const d = Math.abs(tick - barTicks[i]);
    if (d < bestD) {
      bestD = d;
      best = barTicks[i];
    } else if (barTicks[i] > tick) {
      break; // ascending: distance only grows past `tick`
    }
  }
  return best;
}

export interface LinkSegMarkerOptions {
  /** Tick-domain tempo list the section times are converted through. */
  timedTempos: TimedTempo[];
  resolution: number;
  /** Ascending bar-line ladder from {@link buildBarTicks}. */
  barTicks: readonly number[];
}

/**
 * One marker per segment start (`times[0..S-1]`), snapped to the nearest
 * bar-line, with repeated labels numbered ("Verse 1", "Verse 2", ...).
 *
 * Two boundaries that snap to the same bar-line collapse to the first, and
 * the dropped one does NOT advance its label's repeat counter — otherwise
 * the numbering would skip and leave an orphan ("Verse 2" with no "Verse 1").
 * Labels that occur once keep their bare name.
 */
export function linkSegSectionsToMarkers(
  sections: LinkSegSectionInput,
  {timedTempos, resolution, barTicks}: LinkSegMarkerOptions,
): SectionMarker[] {
  if (sections.labels.length === 0 || barTicks.length === 0) return [];

  const total = new Map<string, number>();
  for (const name of sections.labels) {
    total.set(name, (total.get(name) ?? 0) + 1);
  }

  const markers: SectionMarker[] = [];
  const seen = new Map<string, number>();
  let prevTick = -1;
  for (let i = 0; i < sections.labels.length; i++) {
    const base = sections.labels[i];
    const rawTick = msToTick(sections.times[i] * 1000, timedTempos, resolution);
    const tick = snapTickToBar(rawTick, barTicks);
    if (tick === prevTick) continue;
    const idx = (seen.get(base) ?? 0) + 1;
    seen.set(base, idx);
    markers.push({
      tick,
      name: (total.get(base) ?? 0) > 1 ? `${base} ${idx}` : base,
    });
    prevTick = tick;
  }
  return markers;
}
