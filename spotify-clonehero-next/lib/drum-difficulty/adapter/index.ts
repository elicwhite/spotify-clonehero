/**
 * scan-chart -> raw-drums adapter.
 *
 * Turns a scan-chart `ParsedChart` into the shared {@link RawDrumChart} IR the
 * difficulty reducers consume. This is the highest-risk correctness code in
 * the feature (plan §4): the Python ports read raw Rock Band MIDI (pitches
 * 96-100, tom markers 110-112, `[mix N drums*]` disco text, 480 TQN), whereas
 * production input is scan-chart's already-resolved `ParsedChart`.
 *
 * What scan-chart's parser actually gives us (verified against
 * `notes-parser.ts` `resolveDrumModifiers`):
 *  - The note `type` stays the raw 5-lane pad color (kick/red/yellow/blue/
 *    green). Tom/cymbal and disco-flip are NOT baked into the lane — they are
 *    exposed as per-note *flags* (`tom`/`cymbal`, `disco`/`discoNoflip`).
 *  - The raw `[mix N drums*]` disco text events and 110-112 tom-marker note
 *    spans are consumed by the parser and are NOT re-emitted anywhere in
 *    `ParsedChart`. Their *effect* survives only as those per-note flags.
 *
 * Consequence (documented for the Onyx port author): a faithful native
 * `compute_pro` port is not possible from `ParsedChart` alone, because the raw
 * region markers it reads are gone. But it is unnecessary — scan-chart already
 * resolves tom/cymbal and disco per-note, and Onyx AMBIGUITY #4 corroborates
 * that scan-chart's disco resolution matches Onyx's `compute_pro` lane-for-lane
 * on a real disco chart. So we resolve the Pro lane here (see
 * {@link resolveLane}) and let `adapter/onyx.ts` expose either the resolved
 * lanes directly or per-note-synthesized status edges for a `compute_pro`
 * that reproduces the same result at note positions.
 */

import {noteTypes, noteFlags, drumTypes} from '../../chart-edit/types';
import type {
  ParsedChart,
  ParsedTrackData,
  NoteEvent,
} from '../../chart-edit/types';
import type {
  AdapterResult,
  DiscoState,
  DrumLane,
  DrumPad,
  RawDrumChart,
  RawDrumNote,
} from '../types';

/** HOPCAT's hardcoded grid resolution (`CORRECT_TQN`). */
export const HOPCAT_TQN = 480;

/**
 * Rescale a source-resolution tick to what it would be at 480 TQN, for
 * feeding HOPCAT (whose grid math is hardcoded to 480 and never rescales).
 *
 * Rounding policy: nearest integer, ties rounded up (`Math.round`, and ticks
 * are non-negative so this is "ties away from zero"). This scenario has no
 * Python precedent — real RB `notes.mid` are always 480, so the port never
 * faced a non-480 source. The choice is safe because every power-of-two and
 * triplet grid position at the common 192 resolution rescales to an *exact*
 * integer at 480 (192*480/192=480, 96->240, 48->120, 64->160, ...); only
 * genuinely off-grid ticks land on a .5 boundary, and there the ±0.5-tick
 * result is far inside HOPCAT's default 20-tick grid tolerance.
 */
export function rescaleTickTo480(tick: number, resolution: number): number {
  if (resolution === HOPCAT_TQN) return tick;
  return Math.round((tick * HOPCAT_TQN) / resolution);
}

const PAD_BY_NOTE_TYPE: Partial<Record<number, DrumPad>> = {
  [noteTypes.kick]: 'kick',
  [noteTypes.redDrum]: 'red',
  [noteTypes.yellowDrum]: 'yellow',
  [noteTypes.blueDrum]: 'blue',
  [noteTypes.greenDrum]: 'green',
};

/**
 * Resolve a raw pad + tom/cymbal + disco status into the final Pro lane.
 * Mirrors Onyx `compute_pro`: disco flip swaps red<->yellow (red -> hihat,
 * yellow -> snare) regardless of the yellow's own tom/cymbal status; every
 * other lane uses its tom/cymbal flag.
 */
export function resolveLane(
  pad: DrumPad,
  cymbal: boolean,
  disco: DiscoState,
): DrumLane {
  switch (pad) {
    case 'kick':
      return 'kick';
    case 'red':
      return disco === 'flip' ? 'hihat' : 'snare';
    case 'yellow':
      if (disco === 'flip') return 'snare';
      return cymbal ? 'hihat' : 'high-tom';
    case 'blue':
      return cymbal ? 'ride' : 'mid-tom';
    case 'green':
      return cymbal ? 'crash' : 'floor-tom';
  }
}

function discoOf(flags: number): DiscoState {
  if (flags & noteFlags.disco) return 'flip';
  if (flags & noteFlags.discoNoflip) return 'noflip';
  return 'off';
}

function toRawNote(ev: NoteEvent): RawDrumNote | null {
  const pad = PAD_BY_NOTE_TYPE[ev.type];
  if (!pad) return null;
  const cymbal = (ev.flags & noteFlags.cymbal) !== 0;
  const disco = discoOf(ev.flags);
  return {
    tick: ev.tick,
    msTime: ev.msTime,
    length: ev.length,
    pad,
    cymbal,
    disco,
    lane: resolveLane(pad, cymbal, disco),
    doubleKick: (ev.flags & noteFlags.doubleKick) !== 0,
    flags: ev.flags,
  };
}

function findExpertDrumsTrack(chart: ParsedChart): ParsedTrackData | undefined {
  return chart.trackData.find(
    t => t.instrument === 'drums' && t.difficulty === 'expert',
  );
}

/**
 * Convert a `ParsedChart` into the shared drum-reduction IR, or a typed
 * rejection (plan §8) when the chart isn't a pro-drums chart with an Expert
 * track and notes.
 */
export function parsedChartToRawDrums(chart: ParsedChart): AdapterResult {
  if (chart.drumType === null) {
    return {ok: false, reason: 'no-drums'};
  }
  if (chart.drumType === drumTypes.fiveLane) {
    return {ok: false, reason: 'not-pro-drums', drumType: 'five-lane'};
  }
  if (chart.drumType === drumTypes.fourLane) {
    // Non-pro 4-lane: no cymbal markers, everything resolves to tom. The
    // reducers were designed and evaluated on tom/cymbal-resolved pro-drums
    // charts, so mapping this through their gem model would silently
    // misrepresent it. Reject explicitly.
    return {ok: false, reason: 'not-pro-drums', drumType: 'four-lane'};
  }

  const track = findExpertDrumsTrack(chart);
  if (!track) {
    return {ok: false, reason: 'no-expert-track'};
  }

  const notes: RawDrumNote[] = [];
  for (const group of track.noteEventGroups) {
    for (const ev of group) {
      const raw = toRawNote(ev);
      if (raw) notes.push(raw);
    }
  }
  if (notes.length === 0) {
    return {ok: false, reason: 'no-notes'};
  }

  const overdrivePhrases = track.starPowerSections.map(sp => ({
    startTick: sp.tick,
    endTick: sp.tick + sp.length,
  }));
  const rollMarkers = track.flexLanes.map(fl => ({
    startTick: fl.tick,
    endTick: fl.tick + fl.length,
    isDouble: fl.isDouble,
  }));
  const sections = chart.sections.map(s => ({tick: s.tick, name: s.name}));
  const tempos = chart.tempos.map(t => ({
    tick: t.tick,
    beatsPerMinute: t.beatsPerMinute,
  }));
  const timeSignatures = chart.timeSignatures.map(ts => ({
    tick: ts.tick,
    numerator: ts.numerator,
    denominator: ts.denominator,
  }));

  let endTick = 0;
  for (const n of notes) endTick = Math.max(endTick, n.tick + n.length);
  for (const p of overdrivePhrases) endTick = Math.max(endTick, p.endTick);
  for (const r of rollMarkers) endTick = Math.max(endTick, r.endTick);
  for (const s of sections) endTick = Math.max(endTick, s.tick);
  for (const ts of timeSignatures) endTick = Math.max(endTick, ts.tick);

  const raw: RawDrumChart = {
    resolution: chart.resolution,
    notes,
    tempos,
    timeSignatures,
    sections,
    overdrivePhrases,
    rollMarkers,
    endTick,
  };
  return {ok: true, chart: raw};
}

export {toHopcatInput} from './hopcat';
export {toOnyxInput} from './onyx';
export type {HopcatNote, HopcatTextEvent, HopcatInput} from './hopcat';
export type {OnyxGem, OnyxInput, StatusEdge} from './onyx';
