/**
 * Build a small, self-contained "practice chart" for the synth practice modes.
 *
 * The isolated / roulette / groove-session modes merge a groove and a fill that
 * generally come from *different* songs, so there is no real chart to display or
 * play — instead we author our own: N groove bars followed by the fill bar(s),
 * at a single tempo, starting at tick 0. The highway, the sheet music, the
 * scoring window, and the synthesized backing audio (see ./backingAudio) are all
 * derived from this one chart, and AudioManager remains the single clock — the
 * backing WAV is rendered at exactly this chart's ms timing, so
 * `audioManager.chartTime` is chart time with no mapping layer.
 *
 * Pure: no DOM, no audio, no React.
 */

import {createEmptyChart} from '@eliwhite/scan-chart';
import type {
  NoteEvent,
  ParsedChart,
  ParsedTrackData,
} from '@/lib/chart-edit/types';
import {noteFlags, noteTypes} from '@/lib/chart-edit/types';
import type {DrumLane} from '@/lib/drum-fills/midi/padMapping';
import {fillNoteId} from '@/lib/drum-fills/midi/noteId';
import type {BackingPattern} from './backingTrack';
import type {ExpectedFillNote} from './fillNotes';

/** Ticks per quarter note in the generated chart. */
export const PRACTICE_CHART_RESOLUTION = 192;

/** A fill note positioned relative to the fill start, in beats. */
export interface PracticeChartFillNote {
  /** Beats from the start of the fill span (quarter-note beats). */
  beatOffset: number;
  lane: DrumLane;
  isCymbal: boolean;
}

/** Everything the synth practice path needs, derived from one chart. */
export interface PracticeChartBundle {
  chart: ParsedChart;
  track: ParsedTrackData;
  /** The fill notes to score, in this chart's absolute ms time. */
  expectedNotes: ExpectedFillNote[];
  /** Chart ms where the groove starts (after any lead-in bars; 0 with none). */
  grooveStartMs: number;
  /** Chart ms where the groove ends / the fill window opens. */
  grooveEndMs: number;
  /** Chart ms of the first fill note (grooveEndMs when the fill is empty). */
  fillStartMs: number;
  /** Chart ms where the fill bars (and the loop) end. */
  fillEndMs: number;
  /** Tempo of the chart in quarter-note BPM. */
  bpm: number;
}

/**
 * Convert source-chart fill notes into beat offsets relative to the fill start,
 * so they can be re-authored into the practice chart at its own tempo.
 */
export function fillNotesToBeatOffsets(
  notes: readonly Pick<ExpectedFillNote, 'tick' | 'lane' | 'isCymbal'>[],
  fillStartTick: number,
  sourceResolution: number,
): PracticeChartFillNote[] {
  return notes.map(n => ({
    beatOffset: (n.tick - fillStartTick) / sourceResolution,
    lane: n.lane,
    isCymbal: n.isCymbal,
  }));
}

type NoteType = NoteEvent['type'];

/** Map a Clone Hero drum lane (+ cymbal flag) to a scan-chart note type/flags. */
function laneToNote(
  lane: DrumLane,
  isCymbal: boolean,
): {type: NoteType; flags: number} {
  switch (lane) {
    case 'kick':
      return {type: noteTypes.kick, flags: 0};
    case 'red':
      return {type: noteTypes.redDrum, flags: 0};
    case 'yellow':
      return {
        type: noteTypes.yellowDrum,
        flags: isCymbal ? noteFlags.cymbal : noteFlags.tom,
      };
    case 'blue':
      return {
        type: noteTypes.blueDrum,
        flags: isCymbal ? noteFlags.cymbal : noteFlags.tom,
      };
    case 'green':
      return {
        type: noteTypes.greenDrum,
        flags: isCymbal ? noteFlags.cymbal : noteFlags.tom,
      };
  }
}

/** Map a synth groove voice to its chart representation. */
function grooveVoiceToNote(voice: 'kick' | 'snare' | 'hat'): {
  type: NoteType;
  flags: number;
} {
  switch (voice) {
    case 'kick':
      return {type: noteTypes.kick, flags: 0};
    case 'snare':
      return {type: noteTypes.redDrum, flags: 0};
    case 'hat':
      return {type: noteTypes.yellowDrum, flags: noteFlags.cymbal};
  }
}

interface PlannedNote {
  tick: number;
  type: NoteType;
  flags: number;
}

/** Group planned notes by tick into sorted noteEventGroups with ms times. */
function toNoteEventGroups(
  planned: PlannedNote[],
  msPerTick: number,
): NoteEvent[][] {
  const byTick = new Map<number, PlannedNote[]>();
  for (const n of planned) {
    const arr = byTick.get(n.tick) ?? [];
    arr.push(n);
    byTick.set(n.tick, arr);
  }
  return [...byTick.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([tick, notes]) =>
      notes.map(n => ({
        tick,
        msTime: tick * msPerTick,
        length: 0,
        msLength: 0,
        type: n.type,
        flags: n.flags,
      })),
    );
}

/**
 * Author the practice chart: optional `leadInBars` of empty bars (so the loop
 * starts with a clear highway and the practiced content scrolls into view, like
 * Clone Hero's practice mode), then `pattern.grooveBars` bars of the (folded)
 * groove, then the fill notes across `pattern.fillBars` bars, at `bpm`, in
 * `pattern.beatsPerBar`/4 time. The groove starts at the first beat after the
 * lead-in (tick 0 when there is no lead-in).
 */
export function buildPracticeChart(args: {
  pattern: BackingPattern;
  bpm: number;
  fillNotes: PracticeChartFillNote[];
  /** Empty bars before the groove (lead-in). Default 0. */
  leadInBars?: number;
}): PracticeChartBundle {
  const {pattern, bpm, fillNotes, leadInBars = 0} = args;
  const res = PRACTICE_CHART_RESOLUTION;
  const msPerBeat = 60000 / bpm;
  const msPerTick = msPerBeat / res;
  const {beatsPerBar, grooveBars, fillBars} = pattern;

  // Lead-in shifts every authored beat forward; the groove begins after it.
  const leadInBeats = leadInBars * beatsPerBar;

  const planned: PlannedNote[] = [];

  // Groove bars: the folded one-bar groove repeated for each groove bar,
  // positioned after the lead-in.
  for (let bar = 0; bar < grooveBars; bar++) {
    const barStartBeat = (leadInBars + bar) * beatsPerBar;
    for (const hit of pattern.groove) {
      // Click is a separate layer in the backing audio, never a chart note.
      if (hit.lane === 'click') continue;
      const def = grooveVoiceToNote(hit.lane);
      planned.push({
        tick: Math.round((barStartBeat + hit.beatOffset) * res),
        type: def.type,
        flags: def.flags,
      });
    }
  }

  // Fill notes, re-authored after the lead-in + groove bars.
  const fillStartBeat = (leadInBars + grooveBars) * beatsPerBar;
  const fillStartTick = Math.round(fillStartBeat * res);
  const expectedNotes: ExpectedFillNote[] = [];
  for (const note of fillNotes) {
    const tick = fillStartTick + Math.round(note.beatOffset * res);
    const def = laneToNote(note.lane, note.isCymbal);
    planned.push({tick, type: def.type, flags: def.flags});
    expectedNotes.push({
      id: fillNoteId(tick, note.lane, note.isCymbal),
      tick,
      msTime: tick * msPerTick,
      lane: note.lane,
      isCymbal: note.isCymbal,
    });
  }

  expectedNotes.sort(
    (a, b) => a.msTime - b.msTime || a.lane.localeCompare(b.lane),
  );

  const grooveStartMs = leadInBeats * msPerBeat;
  const grooveEndMs = fillStartBeat * msPerBeat;
  const fillEndMs =
    (leadInBars + grooveBars + fillBars) * beatsPerBar * msPerBeat;
  const fillStartMs =
    expectedNotes.length > 0 ? expectedNotes[0].msTime : grooveEndMs;

  const track = {
    instrument: 'drums',
    difficulty: 'expert',
    starPowerSections: [],
    rejectedStarPowerSections: [],
    soloSections: [],
    flexLanes: [],
    drumFreestyleSections: [],
    trackEvents: [],
    textEvents: [],
    versusPhrases: [],
    animations: [],
    unrecognizedMidiEvents: [],
    noteEventGroups: toNoteEventGroups(planned, msPerTick),
  } as unknown as ParsedTrackData;

  const empty = createEmptyChart({format: 'chart', resolution: res, bpm});
  const chart = {
    ...empty,
    resolution: res,
    tempos: [{tick: 0, beatsPerMinute: bpm, msTime: 0}],
    timeSignatures: [
      {
        tick: 0,
        numerator: beatsPerBar,
        denominator: 4,
        msTime: 0,
        msLength: fillEndMs,
      },
    ],
    sections: [
      {
        tick: Math.round(leadInBeats * res),
        name: 'Groove',
        msTime: grooveStartMs,
        msLength: grooveEndMs - grooveStartMs,
      },
      {
        tick: fillStartTick,
        name: 'Fill',
        msTime: grooveEndMs,
        msLength: fillEndMs - grooveEndMs,
      },
    ],
    trackData: [track],
  } as unknown as ParsedChart;

  return {
    chart,
    track,
    expectedNotes,
    grooveStartMs,
    grooveEndMs,
    fillStartMs,
    fillEndMs,
    bpm,
  };
}
