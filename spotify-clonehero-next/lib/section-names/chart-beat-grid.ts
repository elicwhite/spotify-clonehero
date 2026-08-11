/**
 * The chart's own tempo map as a LinkSeg beat source.
 *
 * LinkSeg is robust to where its beats come from: the drum-to-chart probe
 * (`analysis/linkseg_eval/make_grid_beats.py`) fed it a "perfect grid"
 * generated straight from ground-truth chart tempo maps and the section
 * output moved <0.02 against LinkSeg's native beat tracker. So a chart that
 * already has a grid — an opened chart, or one whose tempo map the editor
 * generated — needs no beat-tracking pass at all before labeling sections;
 * only the audio itself is still required, for the beat-synced mel windows.
 *
 * Beats here are QUARTER NOTES, walked straight off the resolution, which is
 * what that probe used. Deliberately not the time-signature beat grid
 * (`bar-derivation.ts`): a 6/8 region's beat unit is an eighth note, which
 * would hand LinkSeg twice the beats over that stretch.
 */

import {tickToMs} from '@/lib/chart-utils/tickToMs';
import type {ParsedChart} from '@/lib/preview/chorus-chart-processing';

/** Backstop against a pathological chart (a zero/absurd resolution, a
 *  duration read from a broken decode) spinning this loop forever. LinkSeg
 *  itself halves anything past 1500 beats. */
const MAX_BEATS = 100_000;

/** Slack on the duration bound: ms-per-tick accumulation puts a beat that
 *  lands exactly on the audio end a few femtoseconds past it, and dropping
 *  the final beat over that is noise, not a decision. */
const DURATION_EPSILON_SECONDS = 1e-6;

/**
 * Quarter-note beat times in seconds, from tick 0 through `durationSeconds`.
 *
 * The walk runs on ticks and converts each one through the chart's tempo map,
 * so tempo changes are honored and a chart shorter than its audio simply
 * extends at its last tempo — the same extrapolation `tickToMs` performs for
 * any tick past the final tempo event.
 */
export function chartQuarterNoteBeatTimes(
  parsedChart: ParsedChart,
  durationSeconds: number,
): number[] {
  const resolution = parsedChart.resolution;
  if (!(resolution > 0) || !(durationSeconds > 0)) return [];

  const times: number[] = [];
  for (let i = 0; i < MAX_BEATS; i++) {
    const seconds = tickToMs(parsedChart, i * resolution) / 1000;
    if (seconds > durationSeconds + DURATION_EPSILON_SECONDS) break;
    // A chart whose lead-in is written as a compressed pre-audio segment
    // (`synctrack-ticks.ts`) can place its first ticks a hair below zero.
    if (seconds >= 0) times.push(seconds);
  }
  return times;
}

/**
 * Whether this chart's tempo map describes the music, rather than being the
 * flat default a blank project opens with.
 *
 * Two things qualify a grid: more than one tempo event (nothing writes a
 * tempo change by accident — a generated map lands dozens), or notes charted
 * against it (whatever the map says, it is the grid this chart's content
 * lives on). A blank project — one 120 BPM event, no notes — has a grid that
 * means nothing musically, so section labeling still detects beats from the
 * audio.
 */
export function hasMusicalTempoGrid(parsedChart: ParsedChart): boolean {
  if (parsedChart.tempos.length > 1) return true;
  return parsedChart.trackData.some(track =>
    track.noteEventGroups.some(group => group.length > 0),
  );
}
