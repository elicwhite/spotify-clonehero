/**
 * The notation engine: turns a beat's onsets into written notes, rests and
 * tuplets. Ported from sightkick (src/chart-parser/parser.ts). Thanks!
 *
 * Every charted gem is a zero-length midi event, so rhythm has to be inferred:
 *
 *  1. Per beat, collapse hits too close to separate without ever dropping one:
 *     different drums become a chord, the same drum a flam (earlier hit kept as
 *     a grace note). This guarantees the remaining onsets are separable.
 *  2. Notate each beat by generating candidate notations — every whole-beat
 *     subdivision (straight, triplet, quintuplet, septuplet, ...) plus recursive
 *     half-splits — and picking the lowest `complexity + λ·distortion`. An exact
 *     chart reproduces literally (zero distortion); a messy off-grid chart is
 *     regularized only when that buys enough readability. Tuplet groups are
 *     emitted as explicit metadata.
 */

import {Head, Note, TupletMeta} from './types';
import {chunkSpan, makeRest, namedDuration} from './durations';

/**
 * All hits at one chart tick. `heads` is sorted by staff pitch with unique
 * keys; `graceChords` carries flam grace notes produced by cluster collapsing.
 */
export interface Onset {
  tick: number;
  heads: Head[];
  graceChords?: Head[][] | undefined;
}

export interface Meter {
  beatsPerMeasure: number;
  beatTicks: number;
  beatFraction: number;
  isCompound: boolean;
}

interface NotationInfo {
  notatedDivisor: number;
  tuplet: {numNotes: number; notesOccupied: number} | null;
}

/**
 * One way to notate a span: notes/rests plus the tuplet groups they belong to.
 * `complexity` (how busy/ugly the result looks) and `dispSum` (how far onsets
 * were moved from their literal ticks) feed the cost function; the lowest-cost
 * candidate for a span wins.
 */
interface Candidate {
  events: Note[];
  tuplets: TupletMeta[];
  complexity: number;
  dispSum: number;
  onsetCount: number;
}

// Whole-span subdivisions offered in a simple (non-compound) meter, keyed by the
// number of slots. `notatedDivisor` is the binary value the written notes are
// drawn from; the remaining scaling is carried by the tuplet ratio.
const SIMPLE_DIVISORS: {[slots: number]: NotationInfo} = {
  1: {notatedDivisor: 1, tuplet: null},
  2: {notatedDivisor: 2, tuplet: null},
  3: {notatedDivisor: 2, tuplet: {numNotes: 3, notesOccupied: 2}},
  4: {notatedDivisor: 4, tuplet: null},
  5: {notatedDivisor: 4, tuplet: {numNotes: 5, notesOccupied: 4}},
  6: {notatedDivisor: 4, tuplet: {numNotes: 6, notesOccupied: 4}},
  7: {notatedDivisor: 4, tuplet: {numNotes: 7, notesOccupied: 4}},
  8: {notatedDivisor: 8, tuplet: null},
  16: {notatedDivisor: 16, tuplet: null},
};
// Whole-span subdivisions in a compound (dotted-beat) meter. Dividing a dotted
// value by these yields plain/dotted durations, so no tuplets are needed.
const COMPOUND_DIVISORS: {[slots: number]: NotationInfo} = {
  1: {notatedDivisor: 1, tuplet: null},
  2: {notatedDivisor: 2, tuplet: null},
  3: {notatedDivisor: 3, tuplet: null},
  4: {notatedDivisor: 4, tuplet: null},
  6: {notatedDivisor: 6, tuplet: null},
  12: {notatedDivisor: 12, tuplet: null},
};
// Cost-function weights — the "look and feel" knobs. A candidate's cost is
// `complexity + LAMBDA · meanDistortion`. Complexity sums filler rests wedged
// between hits, sub-16th note values, distinct durations, and raw symbol count;
// distortion is the mean tick displacement of onsets from their literal
// positions as a fraction of a beat. "Prefer the original unless it's a mess"
// falls out for free: an exact chart has zero distortion and minimal complexity,
// so it always wins; a messy literal reading only loses when a simpler grid is
// cheap enough to justify the movement.
const W_FILL = 3.0;
const W_FINE = 2.0;
const W_VAR = 1.0;
const W_EVT = 0.5;
const W_SPLIT = 0.5;
const LAMBDA = 15;
const KEY_LETTERS = ['c', 'd', 'e', 'f', 'g', 'a', 'b'];

function keyPitch(key: string) {
  const [letter, octave] = key.split('/');

  return Number(octave) * 7 + KEY_LETTERS.indexOf(letter);
}

/** Sort heads by staff pitch and collapse duplicate keys (last one wins). */
export function sortHeads(heads: Head[]): Head[] {
  const byKey = new Map<string, Head>();

  heads.forEach(head => byKey.set(head.key, head));

  return [...byKey.values()].sort((a, b) => keyPitch(a.key) - keyPitch(b.key));
}

export function makeMeter(
  numerator: number,
  denominator: number,
  ppq: number,
): Meter {
  const pulseTicks = (ppq * 4) / denominator;
  const isCompound = denominator >= 8 && numerator >= 6 && numerator % 3 === 0;
  const beatsPerMeasure = isCompound ? numerator / 3 : numerator;
  const beatTicks = isCompound ? pulseTicks * 3 : pulseTicks;

  return {
    beatsPerMeasure,
    beatTicks,
    beatFraction: beatTicks / (ppq * 4),
    isCompound,
  };
}

/**
 * Collapse the onsets of one beat that fall in the same finest-resolution slot,
 * without ever dropping a hit. Two onsets too close to separate become either a
 * chord (different drums — meant to be simultaneous) or a flam (same drum — the
 * earlier hit is kept as a grace note on the later one). After this every
 * returned onset occupies a distinct finest-grid slot, so the grid fitter can
 * always give each its own position. `finestDivisions` is the finest subdivision
 * the meter offers (the resolution floor).
 */
function resolveNearCoincidence(
  onsets: Onset[],
  beatStart: number,
  beatTicks: number,
  finestDivisions: number,
): Onset[] {
  const spacing = beatTicks / finestDivisions;
  const slotOf = (tick: number) =>
    Math.min(
      finestDivisions - 1,
      Math.max(0, Math.round((tick - beatStart) / spacing)),
    );
  const clusters: Onset[][] = [];

  onsets.forEach(onset => {
    const last = clusters[clusters.length - 1];

    if (last && slotOf(last[0].tick) === slotOf(onset.tick)) {
      last.push(onset);
    } else {
      clusters.push([onset]);
    }
  });

  return clusters.map(resolveCluster);
}

function resolveCluster(cluster: Onset[]): Onset {
  if (cluster.length === 1) {
    return cluster[0];
  }

  const occurrences = cluster.flatMap(onset =>
    onset.heads.map(head => ({tick: onset.tick, head})),
  );
  // For each drum, its latest occurrence is the main hit; earlier repeats of the
  // same drum become grace notes.
  const lastTickByKey = new Map<string, number>();

  occurrences.forEach(({tick, head}) => {
    lastTickByKey.set(
      head.key,
      Math.max(lastTickByKey.get(head.key) ?? -Infinity, tick),
    );
  });

  const mainHeads = occurrences
    .filter(({tick, head}) => tick === lastTickByKey.get(head.key))
    .map(({head}) => head);
  const graceByTick = new Map<number, Head[]>();

  occurrences.forEach(({tick, head}) => {
    if (tick < (lastTickByKey.get(head.key) as number)) {
      const chord = graceByTick.get(tick) ?? [];

      chord.push(head);
      graceByTick.set(tick, chord);
    }
  });

  const graceChords = [...graceByTick.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, chord]) => sortHeads(chord));

  return {
    tick: cluster[cluster.length - 1].tick,
    heads: sortHeads(mainHeads),
    graceChords: graceChords.length > 0 ? graceChords : undefined,
  };
}

function halvingsPast16th(duration: string): number {
  if (duration === '32') {
    return 1;
  }

  if (duration === '64') {
    return 2;
  }

  return 0;
}

/** How busy/ugly a notated span looks; higher is worse. */
function complexityOf(events: Note[]): number {
  let filler = 0;
  let fine = 0;
  const values = new Set<string>();

  events.forEach((event, index) => {
    // A rest is "filler" if it is wedged between hits (a hit before and after);
    // leading and trailing rests are real silence, not clutter.
    if (
      event.isRest &&
      events.slice(0, index).some(e => !e.isRest) &&
      events.slice(index + 1).some(e => !e.isRest)
    ) {
      filler += 1;
    }

    fine += halvingsPast16th(event.duration);
    values.add(`${event.duration}.${event.dots}`);
  });

  return (
    W_FILL * filler +
    W_FINE * fine +
    W_VAR * Math.max(0, values.size - 1) +
    W_EVT * events.length
  );
}

function candidateCost(candidate: Candidate, beatTicks: number): number {
  const distortion = candidate.onsetCount
    ? candidate.dispSum / candidate.onsetCount / beatTicks
    : 0;

  return candidate.complexity + LAMBDA * distortion;
}

function restFill(startTick: number, fraction: number): Candidate {
  const named = namedDuration(fraction) ?? {duration: 'q', dots: 0};

  return {
    events: [makeRest(Math.round(startTick), named.duration, named.dots)],
    tuplets: [],
    complexity: 0,
    dispSum: 0,
    onsetCount: 0,
  };
}

function hitNote(
  onset: Onset,
  tick: number,
  duration: string,
  dots: number,
): Note {
  const accents = onset.heads.filter(h => h.accent).map(h => h.key);
  const ghosts = onset.heads.filter(h => h.ghost).map(h => h.key);

  return {
    notes: onset.heads.map(h => h.key),
    noteIds: onset.heads.map(h => h.id),
    duration,
    dots,
    isRest: false,
    tick,
    sourceTick: onset.tick,
    ms: 0,
    graceNotes: onset.graceChords?.map(chord => chord.map(h => h.key)),
    graceNoteIds: onset.graceChords?.map(chord => chord.map(h => h.id)),
    accents: accents.length > 0 ? accents : undefined,
    ghosts: ghosts.length > 0 ? ghosts : undefined,
  };
}

/**
 * Notate a span on a single uniform grid of `divisions` slots. Returns null if
 * the grid can't represent the span (two onsets land in one slot, or the slot
 * value isn't a writable duration). Each note tiles up to the next onset's slot,
 * so there are no filler rests beyond what an awkward gap forces.
 */
function buildGrid(
  onsets: Onset[],
  startTick: number,
  durationTicks: number,
  fraction: number,
  divisions: number,
  info: NotationInfo,
  nextId: () => number,
): Candidate | null {
  const slotFraction = fraction / info.notatedDivisor;

  if (!namedDuration(slotFraction)) {
    return null;
  }

  const spacing = durationTicks / divisions;
  const slotOf = (tick: number) =>
    Math.min(
      divisions - 1,
      Math.max(0, Math.round((tick - startTick) / spacing)),
    );
  const slots = onsets.map(onset => slotOf(onset.tick));

  if (new Set(slots).size !== slots.length) {
    return null;
  }

  const occupants = new Map<number, Onset>();
  let dispSum = 0;

  slots.forEach((slot, index) => {
    occupants.set(slot, onsets[index]);
    dispSum += Math.abs(startTick + slot * spacing - onsets[index].tick);
  });

  const boundaries = [...new Set([0, ...slots])].sort((a, b) => a - b);
  const events: Note[] = [];

  boundaries.forEach((boundary, index) => {
    const next = boundaries[index + 1] ?? divisions;
    const onset = occupants.get(boundary);
    let slot = boundary;

    chunkSpan(boundary, next - boundary, slotFraction, true).forEach(
      (size, chunkIndex) => {
        const named = namedDuration(size * slotFraction);

        if (named) {
          const tick = Math.round(startTick + slot * spacing);

          events.push(
            !onset || chunkIndex > 0
              ? makeRest(tick, named.duration, named.dots)
              : hitNote(onset, tick, named.duration, named.dots),
          );
        }

        slot += size;
      },
    );
  });

  const tuplets: TupletMeta[] = [];

  if (info.tuplet && events.length > 1) {
    const id = nextId();

    events.forEach(event => {
      event.tupletId = id;
    });
    tuplets.push({
      id,
      numNotes: info.tuplet.numNotes,
      notesOccupied: info.tuplet.notesOccupied,
    });
  }

  return {
    events,
    tuplets,
    complexity: complexityOf(events),
    dispSum,
    onsetCount: onsets.length,
  };
}

/**
 * Best notation of one span: try every whole-span grid the meter offers, plus a
 * recursive split into halves, and keep the lowest-cost candidate. Completeness
 * is structural — every candidate gives each onset its own slot, so a note is
 * never dropped regardless of which candidate wins.
 */
function notateSpan(
  onsets: Onset[],
  startTick: number,
  durationTicks: number,
  fraction: number,
  divisors: {[slots: number]: NotationInfo},
  minSpacing: number,
  beatTicks: number,
  allowSplit: boolean,
  nextId: () => number,
): Candidate {
  if (onsets.length === 0) {
    return restFill(startTick, fraction);
  }

  const candidates: Candidate[] = [];

  Object.keys(divisors).forEach(key => {
    const divisions = Number(key);

    if (durationTicks / divisions < minSpacing - 1e-9) {
      return;
    }

    const info = divisors[divisions];

    // Only use a quintuplet/septuplet when the onsets actually fill it; a prime
    // tuplet held loosely (e.g. 6 even notes forced into a 7:4) is a misfit that
    // should decompose or use a binary grid instead.
    if (info.tuplet && divisions >= 5 && onsets.length < divisions) {
      return;
    }

    const candidate = buildGrid(
      onsets,
      startTick,
      durationTicks,
      fraction,
      divisions,
      info,
      nextId,
    );

    if (candidate) {
      candidates.push(candidate);
    }
  });

  if (
    allowSplit &&
    onsets.length > 1 &&
    namedDuration(fraction / 2) &&
    durationTicks / 2 >= minSpacing - 1e-9
  ) {
    const mid = startTick + durationTicks / 2;
    const tolerance = durationTicks / 32;
    const left = onsets.filter(onset => mid - onset.tick > tolerance);
    const right = onsets.filter(onset => mid - onset.tick <= tolerance);
    const leftC = notateSpan(
      left,
      startTick,
      durationTicks / 2,
      fraction / 2,
      divisors,
      minSpacing,
      beatTicks,
      true,
      nextId,
    );
    const rightC = notateSpan(
      right,
      mid,
      durationTicks / 2,
      fraction / 2,
      divisors,
      minSpacing,
      beatTicks,
      true,
      nextId,
    );
    const events = [...leftC.events, ...rightC.events];

    candidates.push({
      events,
      tuplets: [...leftC.tuplets, ...rightC.tuplets],
      complexity: complexityOf(events) + W_SPLIT,
      dispSum: leftC.dispSum + rightC.dispSum,
      onsetCount: leftC.onsetCount + rightC.onsetCount,
    });
  }

  if (candidates.length === 0) {
    // Unreachable in practice: the resolver guarantees the finest grid separates
    // every onset. Fall back to it regardless of the spacing floor.
    const finest = Math.max(...Object.keys(divisors).map(Number));

    return (
      buildGrid(
        onsets,
        startTick,
        durationTicks,
        fraction,
        finest,
        divisors[finest],
        nextId,
      ) ?? restFill(startTick, fraction)
    );
  }

  return candidates.reduce((best, candidate) =>
    candidateCost(candidate, beatTicks) < candidateCost(best, beatTicks)
      ? candidate
      : best,
  );
}

/**
 * Notate one measure's worth of beat-bucketed onsets. Runs of silent beats
 * collapse into as few rests as the meter allows; each sounding beat is
 * resolved (chords/flams) and notated via the candidate search.
 */
export function notateMeasure(
  measureStartTick: number,
  meter: Meter,
  beatOnsets: Onset[][],
  nextId: () => number,
): {notes: Note[]; tuplets: TupletMeta[]} {
  const notes: Note[] = [];
  const tuplets: TupletMeta[] = [];
  const divisors = meter.isCompound ? COMPOUND_DIVISORS : SIMPLE_DIVISORS;
  const finest = Math.max(...Object.keys(divisors).map(Number));
  const minSpacing = meter.beatTicks / finest;
  let beatIndex = 0;

  while (beatIndex < meter.beatsPerMeasure) {
    if (beatOnsets[beatIndex].length === 0) {
      let run = 1;

      while (
        beatIndex + run < meter.beatsPerMeasure &&
        beatOnsets[beatIndex + run].length === 0
      ) {
        run += 1;
      }

      // Collapse the run of silent beats into as few rests as the meter
      // allows. Dotted rests read poorly in simple meters but are the norm
      // in compound ones.
      let slot = beatIndex;

      chunkSpan(beatIndex, run, meter.beatFraction, meter.isCompound).forEach(
        size => {
          const named = namedDuration(size * meter.beatFraction);

          if (named) {
            notes.push(
              makeRest(
                Math.round(measureStartTick + slot * meter.beatTicks),
                named.duration,
                named.dots,
              ),
            );
          }

          slot += size;
        },
      );
      beatIndex += run;
    } else {
      const beatStart = measureStartTick + beatIndex * meter.beatTicks;
      const resolved = resolveNearCoincidence(
        beatOnsets[beatIndex],
        beatStart,
        meter.beatTicks,
        finest,
      );
      const candidate = notateSpan(
        resolved,
        beatStart,
        meter.beatTicks,
        meter.beatFraction,
        divisors,
        minSpacing,
        meter.beatTicks,
        !meter.isCompound,
        nextId,
      );

      notes.push(...candidate.events);
      tuplets.push(...candidate.tuplets);
      beatIndex += 1;
    }
  }

  return {notes, tuplets};
}
