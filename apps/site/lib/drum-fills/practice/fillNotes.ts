/**
 * Derive the per-note practice data for a single detected fill.
 *
 * Given a parsed chart, its Expert drums track, and a fill's tick span (plus the
 * preceding groove span), this produces:
 *  - {@link ExpectedFillNote}[]: the notes the player must hit, in absolute
 *    millisecond time, classified to a Clone Hero lane + cymbal flag so the
 *    MIDI hit matcher can score them.
 *  - a {@link FillGroovePattern}: the groove bar(s) reduced to a synthesizable
 *    {@link BackingPattern} (kick/snare/hat + click) for the isolated-loop mode,
 *    plus the loop's musical layout (groove bars, fill bars, beats per bar, bpm).
 *
 * Pure: no DOM, no audio, no React. The only chart dependency is the tempo map
 * (for tick → ms) and the time-signature map (for bar layout), both read through
 * small structural slices so this stays unit-testable with synthetic charts.
 */

import {tickToMs} from '@/lib/chart-utils/tickToMs';
import type {ParsedChart, ParsedTrackData} from '@/lib/chart-edit/types';
import {
  computeBars,
  noteEventToVoice,
  ticksPerBar,
  type BarSpan,
} from '@/lib/drum-fills/detection/grooveModel';
import type {DrumVoice} from '@/lib/drum-fills/detection/types';
import type {DrumLane} from '@/lib/drum-fills/midi/padMapping';
import {fillNoteIdFromRaw} from '@/lib/drum-fills/midi/noteId';
import type {BackingPattern, GrooveHit} from './backingTrack';

/** A single note inside the fill, in absolute ms time, classified for scoring. */
export interface ExpectedFillNote {
  /** Stable id: absolute tick + lane + cymbal flag. */
  id: string;
  tick: number;
  msTime: number;
  lane: DrumLane;
  isCymbal: boolean;
}

/** Everything the practice screen needs to drive one fill. */
export interface FillPracticeData {
  /** Notes to hit during the fill span, sorted by time. */
  notes: ExpectedFillNote[];
  /** Absolute ms time of the fill's first note (or the span start). */
  fillStartMs: number;
  /** Absolute ms time of the fill span end. */
  fillEndMs: number;
  /** Absolute ms time of the groove span start (the loop's musical start). */
  grooveStartMs: number;
  /** Absolute ms time where the groove ends / fill begins. */
  grooveEndMs: number;
  /** Number of complete groove bars preceding the fill. */
  grooveBars: number;
  /** Number of bars the fill spans (rounded up, min 1). */
  fillBars: number;
  /** Beats per bar at the fill (time-signature numerator). */
  beatsPerBar: number;
  /** Tempo in quarter-note BPM at the fill start. */
  bpm: number;
}

/** Map a detection voice to the synthesizer's backing voice. */
function voiceToBackingVoice(voice: DrumVoice): GrooveHit['lane'] | null {
  switch (voice) {
    case 'kick':
      return 'kick';
    case 'snare':
      return 'snare';
    case 'hat':
      return 'hat';
    // Toms / crashes are not part of the simple synth kit; fold toms into snare
    // so the groove still has a backbeat-ish feel, drop crashes.
    case 'tom':
      return 'snare';
    case 'crash':
      return null;
  }
}

/**
 * Build the expected fill notes and loop layout for a fill.
 *
 * `fill` provides tick spans (matching the DB columns). Notes whose group's
 * first tick falls in [startTick, endTick) are included; each lane present in
 * the group becomes one {@link ExpectedFillNote} (so a kick+snare flam yields
 * two notes at the same time).
 */
export function buildFillPracticeData(
  chart: ParsedChart,
  track: ParsedTrackData,
  fill: {
    startTick: number;
    endTick: number;
    grooveStartTick: number;
    grooveEndTick: number;
    tempoBpm: number;
  },
): FillPracticeData {
  const notes: ExpectedFillNote[] = [];

  for (const group of track.noteEventGroups) {
    if (group.length === 0) continue;
    const tick = group[0].tick;
    if (tick < fill.startTick || tick >= fill.endTick) continue;
    const msTime = tickToMs(chart, tick);
    for (const note of group) {
      const resolved = fillNoteIdFromRaw(tick, note);
      if (!resolved) continue;
      notes.push({
        id: resolved.id,
        tick,
        msTime,
        lane: resolved.lane,
        isCymbal: resolved.isCymbal,
      });
    }
  }

  notes.sort((a, b) => a.msTime - b.msTime || a.lane.localeCompare(b.lane));

  const grooveStartMs = tickToMs(chart, fill.grooveStartTick);
  const grooveEndMs = tickToMs(chart, fill.grooveEndTick);
  const fillEndMs = tickToMs(chart, fill.endTick);
  const fillStartMs = notes.length > 0 ? notes[0].msTime : grooveEndMs;

  // Bar layout from the time-signature map. Use the bar containing the fill
  // start to read beats-per-bar; count whole groove bars between groove start
  // and the fill, and fill bars across the fill span.
  const bars = computeBars(chart, fill.endTick + 1);
  const beatsPerBar = beatsPerBarAt(chart, bars, fill.startTick);
  const grooveBars = countBars(bars, fill.grooveStartTick, fill.grooveEndTick);
  const fillBars = Math.max(1, countBars(bars, fill.startTick, fill.endTick));

  return {
    notes,
    fillStartMs,
    fillEndMs,
    grooveStartMs,
    grooveEndMs,
    grooveBars: Math.max(1, grooveBars),
    fillBars,
    beatsPerBar,
    bpm: fill.tempoBpm,
  };
}

/** Beats per bar (numerator) for the bar containing `tick`. */
function beatsPerBarAt(
  chart: Pick<ParsedChart, 'resolution'>,
  bars: BarSpan[],
  tick: number,
): number {
  const bar = bars.find(b => tick >= b.startTick && tick < b.endTick);
  if (bar) return bar.numerator;
  if (bars.length > 0) return bars[bars.length - 1].numerator;
  return 4;
}

/** Count whole bars whose start falls in [startTick, endTick). */
function countBars(
  bars: BarSpan[],
  startTick: number,
  endTick: number,
): number {
  let n = 0;
  for (const bar of bars) {
    if (bar.startTick >= startTick && bar.startTick < endTick) n++;
  }
  return n;
}

/**
 * Reduce the groove span to a synthesizable {@link BackingPattern}.
 *
 * Quantizes the groove's onsets to beat offsets within one bar (folding
 * multi-bar grooves onto a single representative bar so the synth loops cleanly)
 * and maps voices to the simple kit. Returns a click-on-every-beat pattern with
 * `fillBars` of silence after the groove.
 */
export function buildGroovePattern(
  chart: ParsedChart,
  track: ParsedTrackData,
  fill: {
    startTick: number;
    grooveStartTick: number;
    grooveEndTick: number;
  },
  layout: {grooveBars: number; fillBars: number; beatsPerBar: number},
): BackingPattern {
  const bars = computeBars(chart, fill.startTick + 1);
  const grooveBarSpan = bars.find(
    b =>
      fill.grooveStartTick >= b.startTick && fill.grooveStartTick < b.endTick,
  );
  // Ticks per bar for the groove region; fall back to a 4/4 bar at resolution.
  const barTicks = grooveBarSpan
    ? grooveBarSpan.endTick - grooveBarSpan.startTick
    : ticksPerBar(chart.resolution, layout.beatsPerBar, 4);
  const ticksPerBeat = barTicks / layout.beatsPerBar;

  // Collect unique (beatOffset, voice) hits across the groove span, folded into
  // a single bar by modulo on the beat offset.
  const seen = new Set<string>();
  const groove: GrooveHit[] = [];
  for (const group of track.noteEventGroups) {
    if (group.length === 0) continue;
    const tick = group[0].tick;
    if (tick < fill.grooveStartTick || tick >= fill.grooveEndTick) continue;
    const relBeat = (tick - fill.grooveStartTick) / ticksPerBeat;
    const beatOffset = roundToGrid(relBeat % layout.beatsPerBar);
    for (const note of group) {
      const voice = noteEventToVoice(note);
      if (!voice) continue;
      const backing = voiceToBackingVoice(voice);
      if (!backing) continue;
      const key = `${beatOffset}:${backing}`;
      if (seen.has(key)) continue;
      seen.add(key);
      groove.push({beatOffset, lane: backing});
    }
  }

  groove.sort((a, b) => a.beatOffset - b.beatOffset);

  return {
    groove,
    beatsPerBar: layout.beatsPerBar,
    grooveBars: layout.grooveBars,
    fillBars: layout.fillBars,
    click: true,
  };
}

/** Round a beat offset to the nearest 1/4-beat (16th-note grid). */
function roundToGrid(beat: number): number {
  return Math.round(beat * 4) / 4;
}
