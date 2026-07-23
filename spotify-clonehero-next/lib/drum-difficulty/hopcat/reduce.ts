/**
 * HOPCAT `reduce_5lane` orchestrator (drums-only path) — a faithful port of
 * `reduce_port.py`'s `reduce_5lane_drums` and its `DEFAULT_CONFIG`. Cascades
 * Expert -> Hard -> Medium -> Easy, each tier derived from the one above it.
 *
 * `fix_sustains` is intentionally not ported (it only adjusts note duration,
 * never position/lane, so it can't change the (ms, lane) edit-rate score —
 * see `reduce_port.py` AMBIGUITIES #4).
 */

import {MeasureMap} from '../measureMap';
import type {Note, TextEvent} from './reduceNotes';
import {
  TIER_BASE,
  tierOf,
  removeNotes,
  removeKick,
  singleSnare,
  unflipDiscobeat,
  simplifyRoll,
} from './reduceNotes';

export interface HopcatConfig {
  levels: {h: boolean; m: boolean; e: boolean};
  grid: {h: string; m: string; e: string};
  same: {h: boolean; m: boolean; e: boolean};
  sparse: {h: boolean; m: boolean; e: boolean};
  singlesnare: {h: string; m: string; e: string};
  tolerance: number;
  unflip: string;
  remove_kick_medium: boolean;
}

export const DEFAULT_CONFIG: HopcatConfig = {
  levels: {h: true, m: true, e: true},
  grid: {h: 'e', m: 'q', e: 'h'},
  same: {h: false, m: false, e: false},
  sparse: {h: true, m: true, e: true},
  singlesnare: {h: 'n', m: 'n', e: 'n'},
  tolerance: 20,
  unflip: 'h',
  // Gates BOTH Medium's and Easy's remove_kick — reduce_port keeps these
  // coupled deliberately (no separate remove_kick_easy key).
  remove_kick_medium: true,
};

const ARRAY_DRUMKIT: Record<string, string> = {x: '3', h: '2', m: '1', e: '0'};

/**
 * "Clean {dst} and copy from {src}": delete existing dst-tier notes, re-derive
 * them as src-tier notes shifted down 12 semitones, and duplicate src's mix
 * markers renumbered to dst's drumkit index. C3toolbox.py:4991-5023.
 */
export function cascadeCopy(
  notes: Note[],
  events: TextEvent[],
  srcTier: string,
  dstTier: string,
): {notes: Note[]; events: TextEvent[]} {
  const srcOffset = TIER_BASE[srcTier];
  const dstOffset = TIER_BASE[dstTier];
  const newNotes = notes.filter(n => tierOf(n.pitch) !== dstTier);
  // Iterate a snapshot so appended dst notes aren't re-processed.
  for (const n of [...newNotes]) {
    if (tierOf(n.pitch) === srcTier) {
      newNotes.push({
        pos: n.pos,
        pitch: n.pitch - (srcOffset - dstOffset),
        vel: n.vel,
        dur: n.dur,
      });
    }
  }

  const srcKey = ARRAY_DRUMKIT[srcTier];
  const dstKey = ARRAY_DRUMKIT[dstTier];
  const newEvents = events.filter(e => !e.text.includes(`[mix ${dstKey}`));
  for (const e of [...newEvents]) {
    if (e.text.includes(`[mix ${srcKey}`)) {
      newEvents.push({
        pos: e.pos,
        text: e.text.split(`mix ${srcKey}`).join(`mix ${dstKey}`),
      });
    }
  }
  return {notes: newNotes, events: newEvents};
}

export function reduce5laneDrums(
  notes: Note[],
  events: TextEvent[],
  mm: MeasureMap,
  config: HopcatConfig = DEFAULT_CONFIG,
): {notes: Note[]; events: TextEvent[]} {
  const tol = config.tolerance;
  const unflipLevel = config.unflip;

  // ---- Hard, from Expert ----
  if (config.levels.h) {
    ({notes, events} = cascadeCopy(notes, events, 'x', 'h'));
    if (unflipLevel === 'h') {
      ({notes, events} = unflipDiscobeat(notes, events, mm, 'h', 20));
    }
    notes = removeNotes(
      notes,
      events,
      mm,
      config.grid.h,
      'h',
      tol,
      config.same.h,
      config.sparse.h,
    );
    notes = simplifyRoll(notes, events, 'h');
    if (config.singlesnare.h !== 'n') {
      notes = singleSnare(notes, 'h', config.singlesnare.h);
    }
  }

  // ---- Medium, from Hard ----
  if (config.levels.m) {
    ({notes, events} = cascadeCopy(notes, events, 'h', 'm'));
    if (unflipLevel === 'm') {
      ({notes, events} = unflipDiscobeat(notes, events, mm, 'm', 20));
    }
    if (config.remove_kick_medium) {
      notes = removeKick(notes, 'm', 'p');
    }
    notes = removeNotes(
      notes,
      events,
      mm,
      config.grid.m,
      'm',
      tol,
      config.same.m,
      config.sparse.m,
    );
    notes = simplifyRoll(notes, events, 'm');
    if (config.singlesnare.m !== 'n') {
      notes = singleSnare(notes, 'm', config.singlesnare.m);
    }
  }

  // ---- Easy, from Medium ----
  if (config.levels.e) {
    ({notes, events} = cascadeCopy(notes, events, 'm', 'e'));
    if (unflipLevel === 'e') {
      ({notes, events} = unflipDiscobeat(notes, events, mm, 'e', 20));
    }
    // Reuses remove_kick_medium, NOT a separate easy flag (kept coupled per
    // C3toolbox.py:5187-5188 / reduce_port DEFAULT_CONFIG note).
    if (config.remove_kick_medium) {
      notes = removeKick(notes, 'e', 'a');
    }
    notes = removeNotes(
      notes,
      events,
      mm,
      config.grid.e,
      'e',
      tol,
      config.same.e,
      config.sparse.e,
    );
    notes = simplifyRoll(notes, events, 'e');
    if (config.singlesnare.e !== 'n') {
      notes = singleSnare(notes, 'e', config.singlesnare.e);
    }
  }

  return {notes, events};
}
