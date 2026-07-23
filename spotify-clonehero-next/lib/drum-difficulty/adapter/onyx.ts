/**
 * Onyx input projection.
 *
 * Onyx (`onyx_reduce.py`) works in exact rational "beats" = tick / resolution,
 * with NO tick rescale (unlike HOPCAT), so every position here is a
 * {@link Rational}. Two representations are produced:
 *
 *  1. `resolvedGems` — scan-chart's already tom/cymbal- and disco-resolved Pro
 *     lanes (from {@link RawDrumNote.lane}). This is the RECOMMENDED input for
 *     the Onyx port: a faithful native `compute_pro` is impossible from
 *     `ParsedChart` (its raw region markers are gone — see `adapter/index.ts`),
 *     and scan-chart's resolution matches Onyx's `compute_pro` lane-for-lane
 *     (Onyx AMBIGUITY #4), so consuming resolved lanes is both correct and the
 *     only fully-recoverable path.
 *  2. `rawGems` + `tomStatus` + `discoStatus` — the unresolved color gems plus
 *     per-note-synthesized status edges, for a port that would rather run a
 *     `compute_pro` port. The edges are synthesized one-per-note at each note's
 *     own position, so `compute_pro`'s `status_at` (most-recent edge <= pos)
 *     returns exactly that note's resolved status — reproducing route (1)'s
 *     output at every note position.
 */

import {Rational} from '../rational';
import type {DrumLane, DrumPad, RawDrumChart} from '../types';

/** Onyx `Gem` — `kind` in kick/red/pro; color/protype set for pro only. */
export interface OnyxGem {
  kind: 'kick' | 'red' | 'pro';
  color: '' | 'yellow' | 'blue' | 'green';
  /** '' when unresolved (raw color-only, pre-`compute_pro`). */
  protype: '' | 'cymbal' | 'tom';
}

/** A `(position, value)` status edge, as `compute_pro`'s `applyStatus` reads. */
export interface StatusEdge {
  pos: Rational;
  value: boolean;
}

export interface OnyxInput {
  /** Scan-chart-resolved Pro lanes (recommended path). */
  resolvedGems: {pos: Rational; lane: DrumLane}[];
  /** Unresolved color gems (kick/red/pro-color, protype=''). */
  rawGems: {pos: Rational; gem: OnyxGem}[];
  /** Per-color tom-status edges (is_tom) for a native `compute_pro`. */
  tomStatus: {
    yellow: StatusEdge[];
    blue: StatusEdge[];
    green: StatusEdge[];
  };
  /** Disco-flip status edges (is_disco) for a native `compute_pro`. */
  discoStatus: StatusEdge[];
  overdrivePhrases: {start: Rational; end: Rational}[];
  sections: {pos: Rational; name: string}[];
  /** Measure start positions in beats (Onyx `build_measure_map`). */
  measureStarts: Rational[];
}

function rawGemOf(pad: DrumPad): OnyxGem {
  switch (pad) {
    case 'kick':
      return {kind: 'kick', color: '', protype: ''};
    case 'red':
      return {kind: 'red', color: '', protype: ''};
    case 'yellow':
      return {kind: 'pro', color: 'yellow', protype: ''};
    case 'blue':
      return {kind: 'pro', color: 'blue', protype: ''};
    case 'green':
      return {kind: 'pro', color: 'green', protype: ''};
  }
}

/**
 * Onyx `build_measure_map` in beat-space: one measure start per bar, a leading
 * 4/4 if the first TS event is missing/late, the trailing segment running one
 * bar past `endBeats`. Exact-rational, matching the Python port.
 */
export function buildMeasureStartBeats(chart: RawDrumChart): Rational[] {
  const {resolution} = chart;
  let events = chart.timeSignatures.map(ts => ({
    start: Rational.fromTick(ts.tick, resolution),
    num: ts.numerator,
    den: ts.denominator,
  }));
  events.sort((a, b) => a.start.compare(b.start));
  if (events.length === 0 || !events[0].start.eq(Rational.ZERO)) {
    events = [{start: Rational.ZERO, num: 4, den: 4}, ...events];
  }

  const endBeats = Rational.fromTick(chart.endTick, resolution);
  const starts: Rational[] = [];
  for (let i = 0; i < events.length; i++) {
    const {start, num, den} = events[i];
    const barBeats = Rational.of(num * 4, den);
    let segEnd: Rational;
    if (i + 1 < events.length) {
      segEnd = events[i + 1].start;
    } else {
      const base = endBeats.gt(start) ? endBeats : start;
      segEnd = base.add(barBeats);
    }
    let pos = start;
    while (pos.lt(segEnd)) {
      starts.push(pos);
      pos = pos.add(barBeats);
    }
  }
  return starts;
}

export function toOnyxInput(chart: RawDrumChart): OnyxInput {
  const {resolution} = chart;

  // Onyx's raw-pitch reader (`onyx_midi_io.py`: `TIER_BASE.x = 96`, lane
  // offsets 0-5) only reads pitch 96 as the Expert kick and never sees the
  // pitch-95 2x-bass pedal, so Onyx's Expert gem stream excludes double-kick
  // notes entirely. Match that: drop `doubleKick` notes from every Onyx
  // projection. (Kicks never contribute tom/disco edges, so this only affects
  // the gem streams.)
  const notes = chart.notes.filter(n => !n.doubleKick);

  const resolvedGems = notes.map(n => ({
    pos: Rational.fromTick(n.tick, resolution),
    lane: n.lane,
  }));

  const rawGems = notes.map(n => ({
    pos: Rational.fromTick(n.tick, resolution),
    gem: rawGemOf(n.pad),
  }));

  const tomStatus = {
    yellow: [] as StatusEdge[],
    blue: [] as StatusEdge[],
    green: [] as StatusEdge[],
  };
  const discoStatus: StatusEdge[] = [];
  for (const n of notes) {
    const pos = Rational.fromTick(n.tick, resolution);
    if (n.pad === 'yellow' || n.pad === 'blue' || n.pad === 'green') {
      tomStatus[n.pad].push({pos, value: !n.cymbal});
    }
    if (n.pad === 'red' || n.pad === 'yellow') {
      discoStatus.push({pos, value: n.disco === 'flip'});
    }
  }

  const overdrivePhrases = chart.overdrivePhrases.map(p => ({
    start: Rational.fromTick(p.startTick, resolution),
    end: Rational.fromTick(p.endTick, resolution),
  }));
  const sections = chart.sections.map(s => ({
    pos: Rational.fromTick(s.tick, resolution),
    name: s.name,
  }));

  return {
    resolvedGems,
    rawGems,
    tomStatus,
    discoStatus,
    overdrivePhrases,
    sections,
    measureStarts: buildMeasureStartBeats(chart),
  };
}
