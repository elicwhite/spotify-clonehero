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
import {buildSegments, msToTick, type TempoSegment} from './synctrack-ticks';

const BPM_EPS = 1e-3;

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
  const startTick = Math.max(0, Math.round(msToTick(ev.msTime, segs, resolution)));
  const endMs = ev.msTime + ev.msLength;
  const endTick = Math.round(msToTick(endMs, segs, resolution));
  const newLength = Math.max(0, endTick - startTick);
  return {...ev, tick: startTick, length: newLength};
}

/**
 * Returns a copy of `chart` whose SyncTrack is `sync`, with every other
 * event re-ticked so its audio time is unchanged.
 */
export function swapSynctrack(chart: ParsedChart, sync: Synctrack): ParsedChart {
  const resolution = chart.resolution;
  const segs = buildSegments(sync, resolution);

  // --- New tempos with computed ticks ---
  const sortedTempos = [...sync.tempos].sort((a, b) => a.ms - b.ms);
  const firstBpm = sortedTempos[0]?.bpm ?? 120;
  // Always emit a synthetic tempo at tick 0 using the FIRST predicted BPM so
  // chart events before the predicted origin still have a defined tempo
  // (without it, MIDI parsers default to 120 BPM and shift pre-origin events).
  const newTemposRaw = [
    {tick: 0, beatsPerMinute: firstBpm, msTime: 0},
    ...sortedTempos.map(t => ({
      tick: Math.max(0, Math.round(msToTick(t.ms, segs, resolution))),
      beatsPerMinute: t.bpm,
      msTime: t.ms,
    })),
  ];
  // Dedup on identical ticks (first wins, so the tick-0 anchor survives a
  // collision with the first predicted event).
  const tempoByTick = new Map<number, (typeof newTemposRaw)[number]>();
  for (const t of newTemposRaw) {
    if (!tempoByTick.has(t.tick)) tempoByTick.set(t.tick, t);
  }
  const dedupTempos = [...tempoByTick.values()].sort((a, b) => a.tick - b.tick);
  // Collapse consecutive same-BPM runs (the predictor emits one tempo per
  // beat; stable regions would otherwise be visual clutter in editors).
  const newTempos: typeof dedupTempos = [];
  for (const t of dedupTempos) {
    const prev = newTempos[newTempos.length - 1];
    if (prev && Math.abs(prev.beatsPerMinute - t.beatsPerMinute) < BPM_EPS) continue;
    newTempos.push(t);
  }

  // --- New time signatures ---
  const sortedTs = [...sync.timeSignatures].sort((a, b) => a.ms - b.ms);
  const newTsRaw = sortedTs.map((t, i) => {
    // The FIRST TS event must be at tick 0 — MIDI requires a TS at tick 0.
    const tick = i === 0 ? 0 : Math.max(0, Math.round(msToTick(t.ms, segs, resolution)));
    return {
      tick,
      numerator: t.numerator,
      denominator: t.denominator,
      msTime: t.ms,
      msLength: 0,
    };
  });
  // Drop no-op meter changes.
  const newTs: typeof newTsRaw = [];
  for (const t of newTsRaw) {
    const prev = newTs[newTs.length - 1];
    if (prev && prev.numerator === t.numerator && prev.denominator === t.denominator) continue;
    newTs.push(t);
  }

  // --- Re-tick every other event ---
  const rtE = <T extends {tick: number; msTime: number}>(e: T) =>
    reTickEvent(e, segs, resolution);
  const rtL = <T extends {tick: number; msTime: number; length: number; msLength: number}>(
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
      ...(anyTd.versusPhrases ? {versusPhrases: anyTd.versusPhrases.map(rtL)} : {}),
      ...(anyTd.animations ? {animations: anyTd.animations.map(rtL)} : {}),
      noteEventGroups: td.noteEventGroups.map(group => group.map(rtL)),
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
    unrecognizedEventsTrackTextEvents: chart.unrecognizedEventsTrackTextEvents.map(rtE),
    trackData: newTrackData,
    vocalTracks: newVocalTracks,
  } as ParsedChart;
}
