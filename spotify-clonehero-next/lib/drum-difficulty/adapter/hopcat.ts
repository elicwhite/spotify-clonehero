/**
 * HOPCAT input projection.
 *
 * Reverse-maps the shared {@link RawDrumChart} IR into HOPCAT's own input
 * model (`reduce_port.py`): pitch-encoded Expert gems, tom-marker notes,
 * roll/swell marker notes, and `[mix 3 drums*]` disco text events — with all
 * tick positions rescaled to 480 TQN (`CORRECT_TQN`), since HOPCAT's grid
 * math is hardcoded to 480 and never rescales.
 *
 * Gems are emitted at their *raw pad* pitch (pre-disco-swap): HOPCAT applies
 * the disco flip itself, inside `unflip_discobeat`, driven by the disco text
 * events reconstructed here — so feeding raw pad colors + disco markers
 * reproduces HOPCAT's raw-MIDI input, not scan-chart's resolved lanes.
 */

import {buildMeasures, MeasureMap} from '../measureMap';
import {HOPCAT_TQN, rescaleTickTo480} from './index';
import type {RawDrumChart, RawDrumNote} from '../types';

/** Expert-tier gem pitches (`TIER_BASE['x'] + LANE_OFFSET[lane]`). */
const PAD_PITCH = {
  kick: 96,
  red: 97, // snare
  yellow: 98,
  blue: 99,
  green: 100,
} as const;

/**
 * RB "2x bass pedal" pitch. A double-kick note lives at 95 in raw notes.mid,
 * which HOPCAT's `tier_of` treats as tier-less (95 < 96): it is passed through
 * untouched and never enters a reduced tier. Emitting these at the normal kick
 * pitch (96) instead would cascade them into Hard/Medium/Easy and diverge from
 * HOPCAT. See parity fixtures reduction-10/11/14.
 */
const DOUBLE_KICK_PITCH = 95;

/** Tom-status marker pitches (110/111/112 for yellow/blue/green toms). */
const TOM_MARKER_PITCH = {
  yellow: 110,
  blue: 111,
  green: 112,
} as const;

const ROLL_MARKER = 126;
const SWELL_MARKER = 127;

const DEFAULT_VEL = 100;

export interface HopcatNote {
  pos: number;
  pitch: number;
  vel: number;
  dur: number;
}

export interface HopcatTextEvent {
  pos: number;
  text: string;
}

export interface HopcatInput {
  notes: HopcatNote[];
  events: HopcatTextEvent[];
  measureMap: MeasureMap;
}

function rescaleSpan(
  startTick: number,
  length: number,
  resolution: number,
): {pos: number; dur: number} {
  const pos = rescaleTickTo480(startTick, resolution);
  const end = rescaleTickTo480(startTick + length, resolution);
  return {pos, dur: end - pos};
}

/**
 * Reconstruct disco-flip text-event windows from the per-note disco flags.
 *
 * scan-chart consumes the original `[mix N drums*]` markers into per-note
 * flags and never re-emits the raw text, so the literal marker ticks are
 * unrecoverable. We bracket each maximal run of `disco === 'flip'` red/yellow
 * gems: a start marker at the first flipped note and an end marker one tick
 * past the last flipped note.
 *
 * This is note-position-faithful for the flipped notes themselves, but it
 * cannot reproduce HOPCAT's *inclusive* window boundary (`unflip_discobeat`
 * uses `start <= pos <= end`, so HOPCAT also flips the note sitting exactly on
 * the `[mix N drums*]` end-marker tick, which scan-chart leaves un-flagged).
 * That boundary note's identity is genuinely lost: the real end-marker tick
 * does not coincide with the first note after the run (fixture reduction-05's
 * marker is two notes past the last flipped gem, on a red; reduction-01's is
 * on a kick with an Expert gem in between), so no note-position heuristic
 * recovers it — every alternative that fixes one fixture breaks another.
 * The residual is <=2 notes on charts whose disco region ends exactly on a
 * red/yellow gem (reduction-05 only, in the fixture set); reproducing it
 * tick-exactly needs scan-chart to preserve the raw disco end-marker ticks
 * upstream. See the ADAPTER_LIMITED note in `hopcat/__tests__/parity.test.ts`.
 *
 * Only `'flip'` triggers a window; `'noflip'` (disco-no-flip, authored
 * un-swapped) is not a flip marker and is skipped, matching HOPCAT's `*d`
 * suffix requirement.
 */
function discoTextEvents(
  notes: RawDrumNote[],
  resolution: number,
): HopcatTextEvent[] {
  const events: HopcatTextEvent[] = [];
  let openStart: number | null = null;
  let lastFlipTick = 0;
  for (const n of notes) {
    if (n.pad !== 'red' && n.pad !== 'yellow') continue;
    if (n.disco === 'flip') {
      if (openStart === null) openStart = n.tick;
      lastFlipTick = n.tick;
    } else if (openStart !== null) {
      events.push({
        pos: rescaleTickTo480(openStart, resolution),
        text: '[mix 3 drums0d]',
      });
      events.push({
        pos: rescaleTickTo480(lastFlipTick + 1, resolution),
        text: '[mix 3 drums0]',
      });
      openStart = null;
    }
  }
  if (openStart !== null) {
    // Unterminated flip: HOPCAT runs it to the last note (reduce_port.py
    // windows-append fallback), so emit only the start.
    events.push({
      pos: rescaleTickTo480(openStart, resolution),
      text: '[mix 3 drums0d]',
    });
  }
  return events;
}

export function toHopcatInput(chart: RawDrumChart): HopcatInput {
  const {resolution} = chart;
  const notes: HopcatNote[] = [];

  // Per-lane cymbal status of the previous note on that lane (null = none yet).
  // A raw RB tom-marker span emits a single note-ON where the lane's tom status
  // turns on; `remove_kick('p')`/`single_snare` only ever consult 110-112 by
  // exact same-tick chord membership, so the sole tick that can affect the
  // reducers is that cymbal->tom transition. Emitting one marker per tom gem
  // (as before) over-fires the check on every kick+tom chord in the run; we
  // instead synthesize the marker only at each transition into tom (first
  // tom-flagged note after a cymbal-flagged note on that lane, or the lane's
  // first note when it opens in tom mode), which is what the raw note-ON tick
  // reconstructs to.
  const lanePrevCymbal: Record<'yellow' | 'blue' | 'green', boolean | null> = {
    yellow: null,
    blue: null,
    green: null,
  };

  for (const n of chart.notes) {
    const {pos, dur} = rescaleSpan(n.tick, n.length, resolution);
    const pitch =
      n.pad === 'kick' && n.doubleKick ? DOUBLE_KICK_PITCH : PAD_PITCH[n.pad];
    notes.push({pos, pitch, vel: DEFAULT_VEL, dur});

    if (n.pad === 'yellow' || n.pad === 'blue' || n.pad === 'green') {
      const isTom = !n.cymbal;
      const prevCymbal = lanePrevCymbal[n.pad];
      if (isTom && prevCymbal !== false) {
        notes.push({
          pos,
          pitch: TOM_MARKER_PITCH[n.pad],
          vel: DEFAULT_VEL,
          dur: 0,
        });
      }
      lanePrevCymbal[n.pad] = n.cymbal;
    }
  }

  for (const r of chart.rollMarkers) {
    const {pos, dur} = rescaleSpan(
      r.startTick,
      r.endTick - r.startTick,
      resolution,
    );
    notes.push({
      pos,
      pitch: r.isDouble ? SWELL_MARKER : ROLL_MARKER,
      vel: DEFAULT_VEL,
      dur,
    });
  }

  notes.sort((a, b) => a.pos - b.pos);

  const events = discoTextEvents(chart.notes, resolution);

  const tsEvents = chart.timeSignatures.map(
    ts =>
      [rescaleTickTo480(ts.tick, resolution), ts.numerator, ts.denominator] as [
        number,
        number,
        number,
      ],
  );
  const measureMap = buildMeasures(
    tsEvents,
    HOPCAT_TQN,
    rescaleTickTo480(chart.endTick, resolution),
  );

  return {notes, events, measureMap};
}
