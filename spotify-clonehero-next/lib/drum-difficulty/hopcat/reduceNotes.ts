/**
 * Note-level HOPCAT reducers — a faithful TypeScript port of the drums path
 * of `reduce_port.py` (itself a port of C3toolbox's `reduce_5lane`). Every
 * documented quirk in the Python source is preserved deliberately, including
 * the ones its docstrings flag as latent bugs in the original tool
 * (`unflip_discobeat`'s always-truthy companion `or`; `remove_notes`'
 * absolute-tick second pass). Do not "fix" them — the goal is to reproduce
 * HOPCAT-as-deployed, not an idealized reducer. See `reduce_port.py`'s
 * `AMBIGUITIES` block for the full list.
 *
 * All ticks are at 480 TQN (`CORRECT_TQN`); the adapter rescales the source
 * chart to 480 before these run.
 */

import {MeasureMap} from '../measureMap';
import type {HopcatNote, HopcatTextEvent} from '../adapter';

export type Note = HopcatNote;
export type TextEvent = HopcatTextEvent;

// Tier base pitch: kick=base+0, snare(Red)=base+1, yellow=base+2, blue=base+3,
// green=base+4. Expert 96-100, Hard 84-88, Medium 72-76, Easy 60-64.
export const TIER_BASE: Record<string, number> = {x: 96, h: 84, m: 72, e: 60};
const LANE_OFFSET: Record<string, number> = {
  kick: 0,
  snare: 1,
  yellow: 2,
  blue: 3,
  green: 4,
};
const OFFSET_LANE: Record<number, string> = {0: 'kick', 1: 'snare', 2: 'yellow', 3: 'blue', 4: 'green'};

export const ROLL_MARKER = 126; // single-lane drum roll
export const SWELL_MARKER = 127; // two-lane cymbal swell

const CORRECT_TQN = 480;

// Grid-division fractions of a whole note (C3toolbox DIVISIONS).
const DIVISIONS: Record<string, number> = {
  w: 1,
  h: 0.5,
  q: 0.25,
  e: 0.125,
  s: 0.0625,
  t: 0.03125,
  f: 0.015625,
};
const NEXT_DIVISION: Record<string, string> = {
  w: 'h',
  h: 'q',
  q: 'e',
  e: 's',
  s: 't',
  t: 'f',
};
const LEVEL_DIVISION: Record<string, string> = {x: 's', h: 'e', m: 'q', e: 'h'};

const ARRAY_DRUMKIT: Record<string, string> = {x: '3', h: '2', m: '1', e: '0'};

export function tierOf(pitch: number): string | null {
  for (const tier of Object.keys(TIER_BASE)) {
    const base = TIER_BASE[tier];
    if (base <= pitch && pitch <= base + 4) return tier;
  }
  return null;
}

export function lanePitch(tier: string, lane: string): number {
  return TIER_BASE[tier] + LANE_OFFSET[lane];
}

export function laneOf(pitch: number): string {
  const tier = tierOf(pitch);
  if (tier === null) throw new Error(`laneOf: pitch ${pitch} is not a gem pitch`);
  return OFFSET_LANE[pitch - TIER_BASE[tier]];
}

// ---------------------------------------------------------------------------
// Chord grouping (note_objects / add_objects)
// ---------------------------------------------------------------------------

class Chord {
  pos: number;
  pitches: number[] = [];
  vels: number[] = [];
  durs: number[] = [];

  constructor(pos: number) {
    this.pos = pos;
  }

  sortedPitches(): number[] {
    return [...this.pitches].sort((a, b) => a - b);
  }

  toNotes(): Note[] {
    const out: Note[] = [];
    for (let i = 0; i < this.pitches.length; i++) {
      out.push({pos: this.pos, pitch: this.pitches[i], vel: this.vels[i], dur: this.durs[i]});
    }
    return out;
  }
}

/** Group a position-sorted note list into Chords (requires sorted input). */
function noteObjects(notes: Note[]): Chord[] {
  const chords: Chord[] = [];
  let cur: Chord | null = null;
  for (const n of notes) {
    if (cur === null || n.pos !== cur.pos) {
      cur = new Chord(n.pos);
      chords.push(cur);
    }
    cur.pitches.push(n.pitch);
    cur.vels.push(n.vel);
    cur.durs.push(n.dur);
  }
  return chords;
}

function chordsToNotes(chords: Chord[]): Note[] {
  const out: Note[] = [];
  for (const c of chords) out.push(...c.toNotes());
  return out;
}

/** `list == list` structural equality for two sorted-pitch tuples. */
function sameSortedPitches(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// ---------------------------------------------------------------------------
// remove_notes — grid-quantizing reducer (C3toolbox.py:1469-1667)
// ---------------------------------------------------------------------------

export function removeNotes(
  notes: Note[],
  _events: TextEvent[],
  mm: MeasureMap,
  grid: string,
  level: string,
  tolerance: number,
  same: boolean,
  sparse: boolean,
): Note[] {
  const division = Math.trunc(CORRECT_TQN * 4 * DIVISIONS[grid]);
  const leveltext = level;

  const passthrough: Note[] = [];
  const valid: Note[] = [];
  for (const n of notes) {
    if (tierOf(n.pitch) === leveltext) valid.push(n);
    else passthrough.push(n);
  }
  valid.sort((a, b) => a.pos - b.pos);

  const rollSpans: [number, number][] = [];
  for (const n of passthrough) {
    if (n.pitch === ROLL_MARKER || n.pitch === SWELL_MARKER) {
      rollSpans.push([n.pos, n.pos + n.dur]);
    }
  }
  const rollNoteTicks = new Set<number>();
  for (const n of valid) {
    for (const [start, end] of rollSpans) {
      if (start <= n.pos && n.pos <= end) {
        rollNoteTicks.add(n.pos);
        break;
      }
    }
  }

  const chords = noteObjects(valid);

  const kept: Chord[] = [];
  let sparsePosition = 0;
  for (let i = 0; i < chords.length; i++) {
    const c = chords[i];
    const rel = mm.mbt(c.pos).ticksSinceMeasureStart;
    const gridCheck = Math.floor(rel / division);
    const distToNextLine = division - (rel - gridCheck * division);
    const onGrid =
      rel - gridCheck * division <= tolerance || distToNextLine <= tolerance;
    if (rollNoteTicks.has(c.pos)) {
      kept.push(c);
      sparsePosition = c.pos;
    } else if (onGrid) {
      kept.push(c);
      sparsePosition = c.pos;
    } else if (sparse && c.pos - sparsePosition >= division) {
      kept.push(c);
      sparsePosition = c.pos;
    } else if (same) {
      const newdivision = Math.trunc(
        CORRECT_TQN * 4 * DIVISIONS[NEXT_DIVISION[grid]],
      );
      const gridCheck2 = Math.floor(rel / newdivision);
      const onFinerGrid =
        rel - gridCheck2 * newdivision <= tolerance ||
        division - (rel - gridCheck2 * newdivision) <= tolerance;
      if (
        onFinerGrid &&
        i > 0 &&
        sameSortedPitches(c.sortedPitches(), chords[i - 1].sortedPitches())
      ) {
        kept.push(c);
        sparsePosition = c.pos;
      }
    }
  }

  // Second pass (C3toolbox.py:1649-1664): grid_check on the ABSOLUTE tick,
  // not the measure-relative one — transcribed per source (see reduce_port).
  let result = kept;
  if (same || sparse) {
    const kept2: Chord[] = [];
    for (let i = 0; i < kept.length; i++) {
      const c = kept[i];
      const gridCheck = Math.floor(c.pos / division);
      const offGrid = c.pos - gridCheck * division > tolerance;
      if (offGrid && i < kept.length - 1 && !rollNoteTicks.has(c.pos)) {
        const nxt = kept[i + 1];
        const farEnough = nxt.pos - c.pos >= division;
        const sameAndHalf =
          same &&
          nxt.pos - c.pos >= division * 0.5 &&
          sameSortedPitches(nxt.sortedPitches(), c.sortedPitches());
        if (farEnough || sameAndHalf) {
          kept2.push(c);
        }
      } else {
        kept2.push(c);
      }
    }
    result = kept2;
  }

  return [...passthrough, ...chordsToNotes(result)];
}

// ---------------------------------------------------------------------------
// remove_kick — C3toolbox.py:1932-2007
// ---------------------------------------------------------------------------

export function removeKick(notes: Note[], level: string, what: string): Note[] {
  const leveltext = level;
  const kick = lanePitch(level, 'kick');
  const snare = lanePitch(level, 'snare');

  const passthrough: Note[] = [];
  const valid: Note[] = [];
  for (const n of notes) {
    if (tierOf(n.pitch) === leveltext || (110 <= n.pitch && n.pitch <= 112)) {
      valid.push(n);
    } else {
      passthrough.push(n);
    }
  }
  valid.sort((a, b) => a.pos - b.pos);
  const chords = noteObjects(valid);

  const outChords: Chord[] = [];
  for (const c of chords) {
    const pitches = c.sortedPitches();
    if (pitches.includes(kick) && pitches.length > 1) {
      const hit =
        what === 'a' ||
        (what === 's' && pitches.includes(snare)) ||
        (what === 't' && pitches.some(p => p === 110 || p === 111 || p === 112)) ||
        (what === 'p' &&
          (pitches.includes(snare) ||
            pitches.some(p => p === 110 || p === 111 || p === 112)));
      if (hit) {
        const sub = new Chord(c.pos);
        for (let i = 0; i < c.pitches.length; i++) {
          if (c.pitches[i] !== kick) {
            sub.pitches.push(c.pitches[i]);
            sub.vels.push(c.vels[i]);
            sub.durs.push(c.durs[i]);
          }
        }
        outChords.push(sub);
      } else {
        outChords.push(c);
      }
    } else {
      outChords.push(c);
    }
  }

  return [...passthrough, ...chordsToNotes(outChords)];
}

// ---------------------------------------------------------------------------
// single_snare — C3toolbox.py:1854-1930 (mirror of remove_kick on the snare)
// ---------------------------------------------------------------------------

export function singleSnare(notes: Note[], level: string, what: string): Note[] {
  const leveltext = level;
  const kick = lanePitch(level, 'kick');
  const snare = lanePitch(level, 'snare');
  const yellow = lanePitch(level, 'yellow');
  const blue = lanePitch(level, 'blue');
  const green = lanePitch(level, 'green');

  const passthrough: Note[] = [];
  const valid: Note[] = [];
  for (const n of notes) {
    if (tierOf(n.pitch) === leveltext || (110 <= n.pitch && n.pitch <= 112)) {
      valid.push(n);
    } else {
      passthrough.push(n);
    }
  }
  valid.sort((a, b) => a.pos - b.pos);
  const chords = noteObjects(valid);

  const outChords: Chord[] = [];
  for (const c of chords) {
    const pitches = c.sortedPitches();
    if (pitches.includes(snare) && pitches.length > 1) {
      const hit =
        what === 'a' ||
        (what === 'k' && pitches.includes(kick)) ||
        (what === 't' && pitches.some(p => p === 110 || p === 111 || p === 112)) ||
        (what === 'c' &&
          pitches.some(p => p === yellow || p === blue || p === green));
      if (hit) {
        const sub = new Chord(c.pos);
        for (let i = 0; i < c.pitches.length; i++) {
          const p = c.pitches[i];
          if (p === snare || (110 <= p && p <= 112)) {
            sub.pitches.push(p);
            sub.vels.push(c.vels[i]);
            sub.durs.push(c.durs[i]);
          }
        }
        outChords.push(sub);
      } else {
        outChords.push(c);
      }
    } else {
      outChords.push(c);
    }
  }

  return [...passthrough, ...chordsToNotes(outChords)];
}

// ---------------------------------------------------------------------------
// unflip_discobeat — C3toolbox.py:2268-2420
// ---------------------------------------------------------------------------

export function unflipDiscobeat(
  notes: Note[],
  events: TextEvent[],
  mm: MeasureMap,
  level: string,
  how: number,
): {notes: Note[]; events: TextEvent[]} {
  const division = Math.trunc(CORRECT_TQN * 4 * DIVISIONS['e']);
  const notey = lanePitch(level, 'yellow');
  const snare = lanePitch(level, 'snare');

  const starts = new Set<string>();
  const ends = new Set<string>();
  for (let d = 0; d < 5; d++) {
    starts.add(`[mix 3 drums${d}d]`);
    ends.add(`[mix 3 drums${d}]`);
  }

  const windows: [number, number][] = [];
  let openStart: number | null = null;
  const sortedEvents = [...events].sort((a, b) => a.pos - b.pos);
  for (const e of sortedEvents) {
    if (starts.has(e.text)) {
      if (openStart !== null) {
        throw new Error(
          'two consecutive disco-flip start markers -- malformed chart',
        );
      }
      openStart = e.pos;
    } else if (ends.has(e.text)) {
      if (openStart !== null) {
        windows.push([openStart, e.pos]);
        openStart = null;
      }
    }
  }
  if (openStart !== null) {
    let last = openStart;
    for (const n of notes) if (n.pos > last) last = n.pos;
    windows.push([openStart, last]);
  }

  const work = [...notes]; // pitches mutated in place, like C3toolbox
  // Indices into `work`, sorted by pos (stable, so equal-pos keeps order).
  // C3toolbox's `ordered.index(i)` equals this loop's own `idx` because the
  // index values are a unique 0..n-1 permutation.
  const ordered = work.map((_, i) => i).sort((a, b) => work[a].pos - work[b].pos);

  const toRemove = new Set<number>();
  const toAdd: Note[] = [];
  for (const [start, end] of windows) {
    const inWindow = ordered.filter(
      i => start <= work[i].pos && work[i].pos <= end,
    );
    let yellowCount = 0;
    let snareCount = 0;
    for (const i of inWindow) {
      if (work[i].pitch === notey) yellowCount++;
      else if (work[i].pitch === snare) snareCount++;
    }
    // Already-unflipped window: decline the (buggy interactive) prompt and
    // leave it alone — AMBIGUITY #1.
    if (yellowCount > snareCount) continue;

    for (let idx = 0; idx < ordered.length; idx++) {
      const i = ordered[idx];
      const n = work[i];
      if (!(start <= n.pos && n.pos <= end)) continue;
      if (n.pitch === notey) {
        n.pitch = snare;
        const rel = mm.mbt(n.pos).ticksSinceMeasureStart;
        const gridCheck = Math.floor(rel / division);
        const onGrid = rel - gridCheck * division <= how;
        // Companion-note condition's `or <pitch>` is always truthy
        // (AMBIGUITY #2): keep unless first/last note in the whole file.
        if (onGrid && 0 < idx && idx < ordered.length - 1) {
          toAdd.push({pos: n.pos, pitch: notey, vel: n.vel, dur: n.dur});
        }
      } else if (n.pitch === snare) {
        n.pitch = notey;
        const rel = mm.mbt(n.pos).ticksSinceMeasureStart;
        const gridCheck = Math.floor(rel / division);
        const offGrid = rel - gridCheck * division > how;
        if (offGrid) toRemove.add(n.pos);
      }
    }
  }

  const keptNotes = work.filter(
    n => !(n.pitch === notey && toRemove.has(n.pos)),
  );
  keptNotes.push(...toAdd);

  const newEvents: TextEvent[] = [];
  for (const e of events) {
    let text = e.text;
    for (let d = 0; d < 5; d++) {
      const flagged = `[mix ${ARRAY_DRUMKIT[level]} drums${d}d]`;
      const plain = `[mix ${ARRAY_DRUMKIT[level]} drums${d}]`;
      if (text === flagged) {
        text = plain;
        break;
      }
    }
    newEvents.push({pos: e.pos, text});
  }

  return {notes: keptNotes, events: newEvents};
}

// ---------------------------------------------------------------------------
// simplify_roll — C3toolbox.py:2423-2574
//
// DELIBERATE DEVIATION FROM DEPLOYED HOPCAT (confirmed 2026-07-22 against
// the real C3toolbox.py, not just reduce_port.py): in the actual shipped
// tool, this function is a no-op. `count_notes` (C3toolbox.py:282) sorts a
// dict's *string* keys by their 2nd character instead of by note count, so
// the "most common pitch" it returns is arbitrary; `simplify_roll` then
// takes the first CHARACTER of that pitch string as an int (:2485-2486,
// :2513-2516), which never equals a real 60-100 MIDI pitch, so
// `note_template` stays empty and the function bails out via `continue`
// before removing or adding anything. Roll/Cymbal-Swell-marked regions in
// real deployed HOPCAT therefore stay at full density (remove_notes already
// exempts roll-covered notes from quantization, C3toolbox.py:1628/1659).
//
// This port intentionally implements the INTENDED behavior instead (correct
// most-common-pitch counting + real roll/swell substitution), inherited
// from reduce_port.py's own independent fix of the same bug. Eli decided
// (2026-07-22) to keep this improved behavior rather than reproduce the
// original's dead-code no-op, on the reasoning that it produces a more
// useful reduction-quality comparison than faithfully reproducing a bug
// that just leaves rolls untouched. Every OTHER HOPCAT quirk on this page
// is preserved as-deployed; this is the one deliberate exception.
// ---------------------------------------------------------------------------

export function simplifyRoll(
  notes: Note[],
  _events: TextEvent[],
  level: string,
): Note[] {
  const leveltext = level;
  const sixteenth = Math.trunc(CORRECT_TQN * 0.125);

  function mostCommonPitches(start: number, end: number, n: number): number[] {
    // Insertion-ordered counts, then stable sort by descending count —
    // reproduces Python dict-order tie-breaking (first-seen pitch wins).
    const counts = new Map<number, number>();
    for (const note of notes) {
      if (start <= note.pos && note.pos <= end && tierOf(note.pitch) === leveltext) {
        counts.set(note.pitch, (counts.get(note.pitch) ?? 0) + 1);
      }
    }
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    return ranked.slice(0, n).map(([p]) => p);
  }

  const toRemoveKeys = new Set<string>(); // `${pitch},${pos}`
  const toAdd: Note[] = [];

  const rollSpans: [number, number][] = [];
  const swellSpans: [number, number][] = [];
  for (const n of notes) {
    if (n.pitch === ROLL_MARKER) rollSpans.push([n.pos, n.pos + n.dur]);
    else if (n.pitch === SWELL_MARKER) swellSpans.push([n.pos, n.pos + n.dur]);
  }

  for (const [start, end] of rollSpans) {
    const top = mostCommonPitches(start, end, 1);
    if (top.length === 0) continue;
    const pitch = top[0];
    const template = notes.find(
      n => start <= n.pos && n.pos <= end && n.pitch === pitch,
    );
    if (template === undefined) continue;
    for (const n of notes) {
      if (n.pitch === pitch && start <= n.pos && n.pos <= end) {
        toRemoveKeys.add(`${n.pitch},${n.pos}`);
      }
    }
    const sequence = Math.trunc(CORRECT_TQN * 4 * DIVISIONS[LEVEL_DIVISION[level]]);
    let loc = start;
    while (loc < end + 20) {
      toAdd.push({pos: Math.trunc(loc), pitch, vel: template.vel, dur: sixteenth});
      loc += sequence;
    }
  }

  for (const [start, end] of swellSpans) {
    const top = mostCommonPitches(start, end, 2);
    if (top.length < 2) continue;
    const p1 = top[0];
    const p2 = top[1];
    const template = notes.find(
      n => start <= n.pos && n.pos <= end && (n.pitch === p1 || n.pitch === p2),
    );
    if (template === undefined) continue;
    for (const n of notes) {
      if ((n.pitch === p1 || n.pitch === p2) && start <= n.pos && n.pos <= end) {
        toRemoveKeys.add(`${n.pitch},${n.pos}`);
      }
    }
    const sequence = CORRECT_TQN * 4 * DIVISIONS[level === 'h' ? 'q' : 'h'];
    const quarter = Math.trunc(CORRECT_TQN * 0.25);
    let loc = start;
    while (loc < end + 20) {
      toAdd.push({pos: Math.trunc(loc), pitch: p1, vel: template.vel, dur: quarter});
      loc += sequence;
    }
    loc = start + sequence * 0.5;
    while (loc < end + 20) {
      toAdd.push({pos: Math.trunc(loc), pitch: p2, vel: template.vel, dur: quarter});
      loc += sequence;
    }
  }

  const out = notes.filter(n => !toRemoveKeys.has(`${n.pitch},${n.pos}`));
  out.push(...toAdd);
  return out;
}
