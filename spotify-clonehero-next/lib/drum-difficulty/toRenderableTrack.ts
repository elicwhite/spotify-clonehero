/**
 * Reducer output -> renderable highway `Track`.
 *
 * The two reducers each emit their reduced tiers in their own internal shape
 * (HOPCAT: pitch-encoded raw-pad gems at 480 TQN; Onyx: resolved-lane gems with
 * `tick = beats * 480`). Neither is what `lib/preview/highway` renders from — it
 * consumes a scan-chart `Track` (`noteEventGroups` of `NoteEvent`s carrying
 * `type`/`flags`/`msTime`). This module normalizes both reducers to a common
 * `ReducedNote{tick480, lane}` and builds a synthetic drums `Track` per tier.
 *
 * Both reducers work in a "480 ticks per quarter note" domain (HOPCAT hardcodes
 * `CORRECT_TQN = 480`; Onyx's `OnyxOutNote.tick` is `beats * 480`), so a single
 * `tick480 -> source tick -> msTime` conversion covers both:
 *   sourceTick = tick480 * resolution / 480,  msTime = tickToMs(chart, sourceTick)
 * which is exact for the common grid positions and resolution-independent.
 *
 * Disco flip and tom/cymbal are already resolved into the `lane` before a
 * `Track` is built, so the synthetic notes carry explicit tom/cymbal flags and
 * no disco flags — the drums schema's `normalizeForRender` is then a no-op.
 */

import {noteFlags, noteTypes} from '@eliwhite/scan-chart';
import type {ParsedChart} from '../preview/chorus-chart-processing';
import type {Track} from '../preview/highway/types';
import {tickToMs} from '../chart-utils/tickToMs';

import type {DrumLane, RawDrumChart} from './types';
import type {HopcatInput} from './adapter/hopcat';
import type {OnyxInput} from './adapter/onyx';
import {reduce5laneDrums} from './hopcat/reduce';
import {laneOf, tierOf, type Note as HopcatOutNote} from './hopcat/reduceNotes';
import {reduceOnyx} from './onyx/reduce';
import type {OursOutNote} from './ours/reduce';

/** The 480-TQN domain both reducers emit ticks in. */
const REDUCER_TQN = 480;

export type Tier = 'hard' | 'medium' | 'easy';
export const TIERS: readonly Tier[] = ['hard', 'medium', 'easy'];

/** HOPCAT tags its tiers h/m/e; map our tier names to them. */
const TIER_TAG: Record<Tier, string> = {hard: 'h', medium: 'm', easy: 'e'};

/**
 * One reduced gem in the common intermediate form: a tick in the reducers'
 * shared 480-per-quarter domain plus a fully-resolved pro-drum lane.
 */
export interface ReducedNote {
  tick480: number;
  lane: DrumLane;
}

/** DrumLane -> scan-chart drum note type + flags (tom/cymbal already decided). */
const LANE_TO_TYPE_FLAGS: Record<DrumLane, {type: number; flags: number}> = {
  kick: {type: noteTypes.kick, flags: noteFlags.none},
  snare: {type: noteTypes.redDrum, flags: noteFlags.none},
  hihat: {type: noteTypes.yellowDrum, flags: noteFlags.cymbal},
  'high-tom': {type: noteTypes.yellowDrum, flags: noteFlags.tom},
  ride: {type: noteTypes.blueDrum, flags: noteFlags.cymbal},
  'mid-tom': {type: noteTypes.blueDrum, flags: noteFlags.tom},
  crash: {type: noteTypes.greenDrum, flags: noteFlags.cymbal},
  'floor-tom': {type: noteTypes.greenDrum, flags: noteFlags.tom},
};

// ---------------------------------------------------------------------------
// Onyx -> ReducedNote (lane already resolved by the reducer)
// ---------------------------------------------------------------------------

export function reduceOnyxToNotes(
  input: OnyxInput,
): Record<Tier, ReducedNote[]> {
  const tiers = reduceOnyx(input);
  const map = (notes: {tick: number; lane: string}[]): ReducedNote[] =>
    notes.map(n => ({tick480: n.tick, lane: n.lane as DrumLane}));
  return {
    hard: map(tiers.hard),
    medium: map(tiers.medium),
    easy: map(tiers.easy),
  };
}

// ---------------------------------------------------------------------------
// HOPCAT -> ReducedNote (raw pad + tom/cymbal resolved from the Expert source)
// ---------------------------------------------------------------------------

/**
 * Build a step-function resolver for a physical cymbal-capable color's
 * tom/cymbal status, from the Expert source notes. RB tom markers behave as a
 * step function (a lane stays tom/cymbal until the next explicit note on that
 * lane changes it), so the status at any tick is that of the most recent Expert
 * note on the same color at or before it. HOPCAT works in raw pad colors and
 * applies disco itself, so this is keyed by the raw pad, not the resolved lane.
 */
function makeCymbalResolver(
  rawChart: RawDrumChart,
): (pad: 'yellow' | 'blue' | 'green', sourceTick: number) => boolean {
  const perColor: Record<
    'yellow' | 'blue' | 'green',
    {tick: number; cymbal: boolean}[]
  > = {yellow: [], blue: [], green: []};
  for (const n of rawChart.notes) {
    if (n.pad === 'yellow' || n.pad === 'blue' || n.pad === 'green') {
      perColor[n.pad].push({tick: n.tick, cymbal: n.cymbal});
    }
  }
  for (const k of ['yellow', 'blue', 'green'] as const) {
    perColor[k].sort((a, b) => a.tick - b.tick);
  }
  return (pad, sourceTick) => {
    const arr = perColor[pad];
    if (arr.length === 0) return true; // no source info: RB default is cymbal
    let lo = 0;
    let hi = arr.length - 1;
    let idx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (arr[mid].tick <= sourceTick) {
        idx = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return idx < 0 ? arr[0].cymbal : arr[idx].cymbal;
  };
}

const PAD_LANE_FOR_COLOR: Record<
  'yellow' | 'blue' | 'green',
  {tom: DrumLane; cymbal: DrumLane}
> = {
  yellow: {tom: 'high-tom', cymbal: 'hihat'},
  blue: {tom: 'mid-tom', cymbal: 'ride'},
  green: {tom: 'floor-tom', cymbal: 'crash'},
};

/**
 * Run HOPCAT and split its output into per-tier {@link ReducedNote}s. HOPCAT's
 * output pads are raw colors (kick/snare/yellow/blue/green); tom vs cymbal is
 * resolved from the Expert source (`rawChart`) via {@link makeCymbalResolver}.
 */
export function reduceHopcatToNotes(
  input: HopcatInput,
  rawChart: RawDrumChart,
): Record<Tier, ReducedNote[]> {
  const {notes} = reduce5laneDrums(input.notes, input.events, input.measureMap);
  const cymbalOf = makeCymbalResolver(rawChart);
  const resolution = rawChart.resolution;

  const forTier = (tier: Tier): ReducedNote[] => {
    const tag = TIER_TAG[tier];
    const out: ReducedNote[] = [];
    for (const n of notes as HopcatOutNote[]) {
      if (tierOf(n.pitch) !== tag) continue;
      const pad = laneOf(n.pitch); // kick/snare/yellow/blue/green
      let lane: DrumLane;
      if (pad === 'kick') lane = 'kick';
      else if (pad === 'snare') lane = 'snare';
      else {
        const color = pad as 'yellow' | 'blue' | 'green';
        const sourceTick = (n.pos * resolution) / REDUCER_TQN;
        const isCymbal = cymbalOf(color, sourceTick);
        lane = isCymbal
          ? PAD_LANE_FOR_COLOR[color].cymbal
          : PAD_LANE_FOR_COLOR[color].tom;
      }
      out.push({tick480: n.pos, lane});
    }
    return out;
  };

  return {
    hard: forTier('hard'),
    medium: forTier('medium'),
    easy: forTier('easy'),
  };
}

// ---------------------------------------------------------------------------
// ReducedNote[] -> synthetic drums Track
// ---------------------------------------------------------------------------

/** Wrap per-tick note-event groups in the minimal synthetic drums `Track`. */
function drumTrackFrom(
  noteEventGroups: {
    tick: number;
    msTime: number;
    length: number;
    msLength: number;
    type: number;
    flags: number;
  }[][],
  difficulty: Tier,
): Track {
  return {
    instrument: 'drums',
    difficulty,
    starPowerSections: [],
    rejectedStarPowerSections: [],
    soloSections: [],
    flexLanes: [],
    drumFreestyleSections: [],
    textEvents: [],
    versusPhrases: [],
    animations: [],
    unrecognizedMidiEvents: [],
    noteEventGroups,
  } as unknown as Track;
}

/**
 * Build a renderable drums {@link Track} from reduced notes. Notes are grouped
 * into same-tick chords (deduping identical lanes), positioned in ms via the
 * source chart's tempo map, and given explicit tom/cymbal flags.
 */
export function reducedNotesToTrack(
  reduced: ReducedNote[],
  chart: ParsedChart,
  difficulty: Tier,
): Track {
  const resolution = chart.resolution;

  const byTick = new Map<number, ReducedNote[]>();
  for (const n of reduced) {
    const arr = byTick.get(n.tick480);
    if (arr) arr.push(n);
    else byTick.set(n.tick480, [n]);
  }
  const ticks = [...byTick.keys()].sort((a, b) => a - b);

  const noteEventGroups = ticks.map(tick480 => {
    const sourceTick = (tick480 * resolution) / REDUCER_TQN;
    const msTime = tickToMs(chart, sourceTick);
    const tick = Math.round(sourceTick);
    const group = byTick.get(tick480)!;
    const seen = new Set<number>();
    const events = [];
    for (const n of group) {
      const {type, flags} = LANE_TO_TYPE_FLAGS[n.lane];
      const key = (type << 16) | flags;
      if (seen.has(key)) continue;
      seen.add(key);
      events.push({tick, msTime, length: 0, msLength: 0, type, flags});
    }
    return events;
  });

  return drumTrackFrom(noteEventGroups, difficulty);
}

// ---------------------------------------------------------------------------
// OursOutNote[] -> synthetic drums Track (no tick rescale — Ours never re-times)
// ---------------------------------------------------------------------------

/**
 * Ours lane -> note type + flags. Reuses the shared 8-lane map and adds
 * `open-hat` (a yellow cymbal), the one lane in Ours' vocabulary beyond the
 * shared {@link DrumLane} set. Ours' relane heads only ever emit lanes covered
 * here, so an uncovered lane is skipped defensively rather than mis-rendered.
 */
const OURS_LANE_TO_TYPE_FLAGS: Record<string, {type: number; flags: number}> = {
  ...LANE_TO_TYPE_FLAGS,
  'open-hat': {type: noteTypes.yellowDrum, flags: noteFlags.cymbal},
};

/**
 * Build a renderable drums {@link Track} from Ours' reduced notes. Unlike
 * HOPCAT/Onyx, each note already carries its ORIGINAL source-resolution `tick`
 * and `msTime` (Ours never re-times a note — it only drops or relanes), so no
 * tick-domain rescale or tempo-map lookup is needed: chord the notes by tick,
 * dedupe identical lanes, and emit them directly.
 */
export function oursNotesToTrack(
  notes: OursOutNote[],
  difficulty: Tier,
): Track {
  const byTick = new Map<number, OursOutNote[]>();
  for (const n of notes) {
    const arr = byTick.get(n.tick);
    if (arr) arr.push(n);
    else byTick.set(n.tick, [n]);
  }
  const ticks = [...byTick.keys()].sort((a, b) => a - b);

  const noteEventGroups = ticks
    .map(tick => {
      const group = byTick.get(tick)!;
      const msTime = group[0].msTime;
      const seen = new Set<number>();
      const events = [];
      for (const n of group) {
        const tf = OURS_LANE_TO_TYPE_FLAGS[n.lane];
        if (!tf) continue;
        const key = (tf.type << 16) | tf.flags;
        if (seen.has(key)) continue;
        seen.add(key);
        events.push({
          tick,
          msTime,
          length: 0,
          msLength: 0,
          type: tf.type,
          flags: tf.flags,
        });
      }
      return events;
    })
    .filter(g => g.length > 0);

  return drumTrackFrom(noteEventGroups, difficulty);
}
