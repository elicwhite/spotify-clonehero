/**
 * Swap a chart's SyncTrack for a predicted SyncTrack while preserving every
 * event's wall-clock (audio) time.
 *
 * Strategy (from drum-to-chart's spotcheck tooling):
 * 1. Every parsed event has `tick` (under the old tempos) and `msTime`
 *    (computed by the parser using the old tempos).
 * 2. Keep `msTime` unchanged — notes still hit at the same audio moments —
 *    and compute each event's new `tick` under the predicted synctrack.
 * 3. Replace `tempos` and `timeSignatures` with the prediction, ticks
 *    computed from accumulated beats (ms=0 anchored at tick=0).
 *
 * The chart's resolution is kept as-is.
 */

import type {ParsedChart} from '@eliwhite/scan-chart';
import type {Synctrack} from './types';
import {buildSyncLayout, msToTick, type TempoSegment} from './synctrack-ticks';

const BPM_EPS = 1e-3;

export interface SwapSynctrackOptions {
  /**
   * Quantize note start/end ticks to the nearest musical subdivision:
   * 16th notes (resolution/4) or 16th-note triplets (resolution/6, which
   * also covers 8th-note triplets). On clean human-charted notes with an
   * accurate predicted tempo map, naive nearest-position snapping is the
   * validated-correct quantizer (autoresearch-subdiv: acc1 = 1.000 on
   * clean onsets). The vocabulary is deliberately coarser than that
   * project's 24-slot metric grid: a uniform fine grid leaves notes one
   * micro-slot off the beat (the predicted map's ~9 ms median residual
   * exceeds half a 1/24-beat slot at fast tempos) and notation renders
   * as tuplet soup. Ties prefer the straight (16th) position.
   * Only notes are quantized; sections, star power, lyrics etc. keep
   * their exact times.
   */
  quantizeNotes?: boolean;
}

function reTickEvent<T extends {tick: number; msTime: number}>(
  ev: T,
  segs: TempoSegment[],
  resolution: number,
): T {
  const newTick = Math.round(msToTick(ev.msTime, segs, resolution));
  return {...ev, tick: Math.max(0, newTick)};
}

function reTickLengthEvent<
  T extends {tick: number; msTime: number; length: number; msLength: number},
>(ev: T, segs: TempoSegment[], resolution: number): T {
  const startTick = Math.max(
    0,
    Math.round(msToTick(ev.msTime, segs, resolution)),
  );
  const endMs = ev.msTime + ev.msLength;
  const endTick = Math.round(msToTick(endMs, segs, resolution));
  const newLength = Math.max(0, endTick - startTick);
  return {...ev, tick: startTick, length: newLength};
}

/**
 * Returns a copy of `chart` whose SyncTrack is `sync`, with every other
 * event re-ticked so its audio time is unchanged.
 */
export function swapSynctrack(
  chart: ParsedChart,
  sync: Synctrack,
  options: SwapSynctrackOptions = {},
): ParsedChart {
  const resolution = chart.resolution;
  const {segs, leadInTs} = buildSyncLayout(sync, resolution);

  const straightTicks = resolution / 4; // 16th notes
  const tripletTicks = resolution / 6; // 16th-note triplets
  const noteTick = (ms: number) => {
    const frac = msToTick(ms, segs, resolution);
    let tick: number;
    if (options.quantizeNotes) {
      const straight = Math.round(frac / straightTicks) * straightTicks;
      const triplet = Math.round(frac / tripletTicks) * tripletTicks;
      // Tie goes to the straight position.
      tick = Math.round(
        Math.abs(straight - frac) <= Math.abs(triplet - frac)
          ? straight
          : triplet,
      );
    } else {
      tick = Math.round(frac);
    }
    return Math.max(0, tick);
  };
  const reTickNote = <
    T extends {tick: number; msTime: number; length: number; msLength: number},
  >(
    ev: T,
  ): T => {
    const startTick = noteTick(ev.msTime);
    const endTick =
      ev.msLength > 0 ? noteTick(ev.msTime + ev.msLength) : startTick;
    return {...ev, tick: startTick, length: Math.max(0, endTick - startTick)};
  };

  // --- New tempos, written directly from the segment map ---
  // The game integrates the tempo events from tick 0 = time 0, so the
  // written list must BE the segment map (including the lead-in / collapse
  // segment buildSegments synthesizes to anchor ms=0 at tick 0). Writing
  // sync.tempos with a plain tick-0 anchor instead would re-time the
  // pre-origin tick region and shift every note against the audio.
  const newTemposRaw = segs.map(s => ({
    tick: Math.max(0, Math.round(s.tick)),
    beatsPerMinute: s.bpm,
    msTime: Math.max(0, s.ms),
  }));
  // Dedup on identical ticks. Last wins: when a synthesized anchor segment
  // rounds onto the same tick as the segment after it, the later BPM is the
  // one that governs the region from that tick onward.
  const tempoByTick = new Map<number, (typeof newTemposRaw)[number]>();
  for (const t of newTemposRaw) {
    tempoByTick.set(t.tick, t);
  }
  const dedupTempos = [...tempoByTick.values()].sort((a, b) => a.tick - b.tick);
  // Collapse consecutive same-BPM runs (the predictor emits one tempo per
  // beat; stable regions would otherwise be visual clutter in editors).
  const newTempos: typeof dedupTempos = [];
  for (const t of dedupTempos) {
    const prev = newTempos[newTempos.length - 1];
    if (prev && Math.abs(prev.beatsPerMinute - t.beatsPerMinute) < BPM_EPS)
      continue;
    newTempos.push(t);
  }

  // --- New time signatures ---
  const sortedTs = [...sync.timeSignatures].sort((a, b) => a.ms - b.ms);
  const newTsRaw = sortedTs.map((t, i) => {
    // The FIRST real TS event anchors the grid: tick 0, or the end of the
    // partial lead-in bar when the layout uses one. (MIDI requires a TS at
    // tick 0 — provided by the lead-in TS in that case.)
    const tick =
      i === 0
        ? (leadInTs?.endTick ?? 0)
        : Math.max(0, Math.round(msToTick(t.ms, segs, resolution)));
    return {
      tick,
      numerator: t.numerator,
      denominator: t.denominator,
      msTime: t.ms,
      msLength: 0,
    };
  });
  if (leadInTs) {
    // Charter "shortened first measure": the non-whole-bar remainder of the
    // lead-in is its own r/4 bar so the origin still lands on a bar line.
    newTsRaw.unshift({
      tick: 0,
      numerator: leadInTs.numerator,
      denominator: leadInTs.denominator,
      msTime: 0,
      msLength: 0,
    });
  }
  // Drop no-op meter changes.
  const newTs: typeof newTsRaw = [];
  for (const t of newTsRaw) {
    const prev = newTs[newTs.length - 1];
    if (
      prev &&
      prev.numerator === t.numerator &&
      prev.denominator === t.denominator
    )
      continue;
    newTs.push(t);
  }

  // --- Re-tick every other event ---
  const rtE = <T extends {tick: number; msTime: number}>(e: T) =>
    reTickEvent(e, segs, resolution);
  const rtL = <
    T extends {tick: number; msTime: number; length: number; msLength: number},
  >(
    e: T,
  ) => reTickLengthEvent(e, segs, resolution);

  const newTrackData = chart.trackData.map(td => {
    const anyTd = td as any;
    return {
      ...td,
      starPowerSections: td.starPowerSections.map(rtL),
      ...(anyTd.rejectedStarPowerSections
        ? {rejectedStarPowerSections: anyTd.rejectedStarPowerSections.map(rtL)}
        : {}),
      soloSections: td.soloSections.map(rtL),
      flexLanes: td.flexLanes.map(rtL),
      drumFreestyleSections: td.drumFreestyleSections.map(rtL),
      textEvents: td.textEvents.map(rtE),
      ...(anyTd.versusPhrases
        ? {versusPhrases: anyTd.versusPhrases.map(rtL)}
        : {}),
      ...(anyTd.animations ? {animations: anyTd.animations.map(rtL)} : {}),
      noteEventGroups: td.noteEventGroups.map(group => group.map(reTickNote)),
    };
  });

  // --- Vocal tracks ---
  const newVocalTracks = structuredClone(chart.vocalTracks) as any;
  for (const partName of Object.keys(newVocalTracks.parts ?? {})) {
    const part = newVocalTracks.parts[partName];
    const reTickPhrase = (p: any) => ({
      ...rtL(p),
      notes: p.notes.map(rtL),
      lyrics: p.lyrics.map(rtE),
    });
    part.notePhrases = part.notePhrases.map(reTickPhrase);
    part.staticLyricPhrases = part.staticLyricPhrases.map(reTickPhrase);
    part.starPowerSections = part.starPowerSections.map(rtL);
    part.rangeShifts = part.rangeShifts.map(rtL);
    part.lyricShifts = part.lyricShifts.map(rtL);
    part.textEvents = part.textEvents.map(rtE);
  }
  if (newVocalTracks.rangeShifts) {
    newVocalTracks.rangeShifts = newVocalTracks.rangeShifts.map(rtL);
  }
  if (newVocalTracks.lyricShifts) {
    newVocalTracks.lyricShifts = newVocalTracks.lyricShifts.map(rtL);
  }

  return {
    ...chart,
    tempos: newTempos,
    timeSignatures: newTs,
    endEvents: chart.endEvents.map(rtE),
    sections: chart.sections.map(rtE),
    unrecognizedEventsTrackTextEvents:
      chart.unrecognizedEventsTrackTextEvents.map(rtE),
    trackData: newTrackData,
    vocalTracks: newVocalTracks,
  } as ParsedChart;
}
