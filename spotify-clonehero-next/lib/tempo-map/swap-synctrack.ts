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
import {
  buildSyncLayout,
  msToTick,
  tickToMs,
  type TempoSegment,
} from './synctrack-ticks';
import {snapGroupToGrid} from './quantize-grid';

const BPM_EPS = 1e-3;

/** Default abstain band for {@link SwapSynctrackOptions.snapToleranceMs}. A
 * measured 11.7% of real chart misalignment is grid error (the note's true
 * audio position sits between musical subdivisions), and force-snapping those
 * makes the chart worse — so a note whose nearest grid line is farther than
 * this many ms (at the local tempo) is left un-snapped. Exported so the
 * drum-transcription chart-builder applies the identical band on its path. */
export const DEFAULT_SNAP_TOLERANCE_MS = 40;

export interface SwapSynctrackOptions {
  /**
   * Quantize note start/end ticks to the nearest musical subdivision via
   * {@link snapGroupToGrid} (16th notes or 16th-note triplets). Only notes
   * are quantized; sections, star power, lyrics etc. keep their exact times.
   */
  quantizeNotes?: boolean;
  /**
   * Abstain band, in ms at the local tempo. When quantizing, a note whose
   * nearest grid line is farther than this from its true audio position is
   * left un-snapped (plain rounded tick) rather than force-snapped. Only
   * applies when {@link quantizeNotes} is set. Defaults to
   * {@link DEFAULT_SNAP_TOLERANCE_MS}.
   */
  snapToleranceMs?: number;
  /**
   * How chart sections (`sections`) are re-ticked (plan 0061 §3 class (a),
   * step 3).
   *  - `'preserve'` (default): exact audio-time re-tick, identical to every
   *    other non-note event — keeps the /tempo prediction path byte-identical.
   *  - `'snap-whole-note'`: snap each section to the nearest whole-note
   *    gridline (`resolution * 4` ticks) to its old audio position, per
   *    Decision 4 ("sections snap to the grid"). Used only by the
   *    audio-anchored hand-edit remap.
   */
  sectionPolicy?: 'preserve' | 'snap-whole-note';
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

  const quantize = options.quantizeNotes ?? false;
  const snapToleranceMs = options.snapToleranceMs ?? DEFAULT_SNAP_TOLERANCE_MS;
  const sectionPolicy = options.sectionPolicy ?? 'preserve';

  // Exact (un-quantized) re-tick: preserves every note's audio time to the
  // nearest tick. Used for the quantizeNotes=false path (unchanged) and as
  // the abstain fallback inside the quantized path.
  const rawTick = (ms: number) =>
    Math.max(0, Math.round(msToTick(ms, segs, resolution)));
  const reTickNoteRaw = <
    T extends {
      tick: number;
      msTime: number;
      length: number;
      msLength: number;
    },
  >(
    ev: T,
  ): T => {
    const startTick = rawTick(ev.msTime);
    const endTick =
      ev.msLength > 0 ? rawTick(ev.msTime + ev.msLength) : startTick;
    return {...ev, tick: startTick, length: Math.max(0, endTick - startTick)};
  };

  // Snap one audio position to a grid tick, abstaining (raw rounded tick)
  // when the snap would move the note more than snapToleranceMs at the local
  // tempo. groupLanes is threaded to the scorer so a future lane-dependent
  // scorer keeps a chord on one subdivision family. Only called when
  // quantizing.
  const snapPos = (ms: number, groupLanes: number[]): number => {
    const frac = msToTick(ms, segs, resolution);
    const snapped = snapGroupToGrid(frac, resolution, groupLanes);
    const driftMs = Math.abs(tickToMs(snapped, segs, resolution) - ms);
    return driftMs > snapToleranceMs ? Math.max(0, Math.round(frac)) : snapped;
  };

  // Re-tick a whole noteEventGroup (a simultaneous chord). Off (raw) path is
  // byte-identical to the pre-quantizer behavior. When quantizing, every
  // member's START is decided by ONE snap of the group's shared audio time,
  // so a chord can never split across slots under any scorer; each member's
  // END is snapped independently (sustains have their own lengths).
  const reTickGroup = <
    T extends {
      tick: number;
      msTime: number;
      length: number;
      msLength: number;
    },
  >(
    group: T[],
  ): T[] => {
    if (!quantize || group.length === 0) return group.map(reTickNoteRaw);
    const groupLanes = group.map(n => (n as {type?: number}).type ?? 0);
    const startTick = snapPos(group[0].msTime, groupLanes);
    return group.map(ev => {
      const endTick =
        ev.msLength > 0
          ? snapPos(ev.msTime + ev.msLength, groupLanes)
          : startTick;
      return {
        ...ev,
        tick: startTick,
        length: Math.max(0, endTick - startTick),
      };
    });
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
    T extends {
      tick: number;
      msTime: number;
      length: number;
      msLength: number;
    },
  >(
    e: T,
  ) => reTickLengthEvent(e, segs, resolution);

  // Section re-tick: 'preserve' matches every other non-note event (exact
  // audio-time re-tick); 'snap-whole-note' rounds to the nearest whole-note
  // gridline (resolution*4 ticks) to the section's old audio position.
  const wholeNoteTicks = resolution * 4;
  const rtSection = <T extends {tick: number; msTime: number}>(e: T): T => {
    if (sectionPolicy !== 'snap-whole-note')
      return reTickEvent(e, segs, resolution);
    const frac = msToTick(e.msTime, segs, resolution);
    const snapped = Math.max(
      0,
      Math.round(frac / wholeNoteTicks) * wholeNoteTicks,
    );
    return {...e, tick: snapped};
  };

  const newTrackData = chart.trackData.map(td => {
    const anyTd = td as any;
    return {
      ...td,
      starPowerSections: td.starPowerSections.map(rtL),
      ...(anyTd.rejectedStarPowerSections
        ? {
            rejectedStarPowerSections: anyTd.rejectedStarPowerSections.map(rtL),
          }
        : {}),
      soloSections: td.soloSections.map(rtL),
      flexLanes: td.flexLanes.map(rtL),
      drumFreestyleSections: td.drumFreestyleSections.map(rtL),
      textEvents: td.textEvents.map(rtE),
      ...(anyTd.versusPhrases
        ? {versusPhrases: anyTd.versusPhrases.map(rtL)}
        : {}),
      ...(anyTd.animations ? {animations: anyTd.animations.map(rtL)} : {}),
      noteEventGroups: td.noteEventGroups.map(reTickGroup),
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
    sections: chart.sections.map(rtSection),
    unrecognizedEventsTrackTextEvents:
      chart.unrecognizedEventsTrackTextEvents.map(rtE),
    trackData: newTrackData,
    vocalTracks: newVocalTracks,
  } as ParsedChart;
}
