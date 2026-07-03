/**
 * Chart document construction for the drum transcription pipeline.
 *
 * Builds a ChartDocument from raw CRNN drum events, optionally under a real
 * predicted synctrack (from lib/tempo-map). The synctrack's ms-domain
 * tempos/timeSignatures are converted to tick domain by the SAME code the
 * /tempo feature uses (swapSynctrack -> buildSyncLayout), so lead-in /
 * origin semantics match. Drum events are then converted to ticks with
 * msToTick over the tick-domain tempo list actually written to the chart —
 * the ground truth the game integrates from tick 0 — and snapped to the
 * musical grid with the same quantizer /tempo uses (snapTickToGrid), so
 * onsets land on 16th / triplet grid lines instead of arbitrary ticks.
 *
 * When no synctrack is available (tempo pipeline failed or unavailable),
 * falls back to a flat 120 BPM chart.
 */

import {
  createEmptyChart,
  addDrumNote,
  addSection,
  drumTypes,
} from '@/lib/chart-edit';
import type {ChartDocument} from '@/lib/chart-edit';
import {swapSynctrack} from '@/lib/tempo-map/swap-synctrack';
import {snapTickToGrid} from '@/lib/tempo-map/quantize-grid';
import type {Synctrack} from '@/lib/tempo-map/types';
import type {MeterStats} from '@/lib/tempo-map/meter-confidence';
import {
  buildTimedTempos,
  msToTick,
  getNextMeasureTick,
} from '../timing';
import {getChartMapping} from '../ml/class-mapping';
import type {RawDrumEvent} from '../ml/types';
import type {DrumNote, DrumNoteFlags} from '../chart-types';

/** Default resolution (ticks per quarter note). */
export const RESOLUTION = 480;

/** Fallback BPM when no tempo detection is available. */
export const DEFAULT_BPM = 120;

/** Shape persisted to the project's synctrack.json. */
export interface StoredSynctrack {
  synctrack: Synctrack;
  /** Meter regularity diagnostics for the editor (irregular-meter warning). */
  meterStats: MeterStats | null;
  drumOnsetOffsetMs: number | null;
}

export interface TempoLike {
  tick: number;
  beatsPerMinute: number;
}

/**
 * Build a ChartDocument from raw drum events.
 *
 * With a synctrack: installs the predicted tempos/time signatures (tick
 * domain, via swapSynctrack) and quantizes events against that real tempo
 * map. Without one: single flat DEFAULT_BPM tempo + 4/4.
 */
export function buildChartDocument(
  events: RawDrumEvent[],
  songName: string,
  durationSeconds: number,
  synctrack?: Synctrack | null,
): ChartDocument {
  // Create an empty parsed chart (single tempo + 4/4 time signature)
  let parsedChart = createEmptyChart({
    format: 'chart',
    resolution: RESOLUTION,
    bpm: DEFAULT_BPM,
    timeSignature: {numerator: 4, denominator: 4},
  });

  if (synctrack && synctrack.tempos.length > 0) {
    // The empty chart has no events to re-tick, so swapSynctrack just
    // installs the predicted tempos/time signatures with correct ticks
    // (including lead-in / origin handling — see synctrack-ticks.ts).
    parsedChart = swapSynctrack(parsedChart, synctrack);
  }

  // Four-lane pro drums: without this, writeChartFolder drops the cymbal
  // marker notes (66/67/68) and every cymbal re-parses as a tom.
  parsedChart.drumType = drumTypes.fourLanePro;

  // Set metadata on the parsed chart
  parsedChart.metadata = {
    ...parsedChart.metadata,
    name: songName,
    artist: 'Unknown',
    charter: 'Drum Transcription AI',
    diff_drums: 0,
  };

  // Quantize raw events against the tempo list actually written to the
  // chart (the game integrates these from tick 0 = time 0).
  const tempos: TempoLike[] = parsedChart.tempos.map(t => ({
    tick: t.tick,
    beatsPerMinute: t.beatsPerMinute,
  }));
  // Snap each onset tick to the musical grid (16ths / 16th-triplets) with
  // the SAME quantizer /tempo uses (swapSynctrack quantizeNotes). Without
  // this, msToTick lands notes on arbitrary ticks (e.g. 1913 instead of
  // 1920) and they read as off-grid in the editor. The confidence keys built
  // by buildConfidenceData use these SAME snapped ticks so the editor's
  // confidence panel matches every note.
  //
  // Snapping can collapse two nearby onsets onto the same (tick, noteType) —
  // including cross-class collisions like HT (yellow tom) + HH (yellow
  // cymbal) — which would write an invalid doubled note. Dedup keeps the
  // higher-confidence event (its flags win); ties prefer the cymbal.
  const drumNotes = dedupSnappedNotes(events, tempos, RESOLUTION);

  // Add an ExpertDrums track
  parsedChart.trackData = [
    {
      instrument: 'drums',
      difficulty: 'expert',
      starPowerSections: [],
      rejectedStarPowerSections: [],
      drumFreestyleSections: [],
      soloSections: [],
      flexLanes: [],
      noteEventGroups: [],
      textEvents: [],
      versusPhrases: [],
      animations: [],
      unrecognizedMidiEvents: [],
    } as never,
  ];

  const track = parsedChart.trackData[0];

  // Add each drum note using chart-edit's addDrumNote
  for (const note of drumNotes) {
    addDrumNote(track, {
      tick: note.tick,
      type: note.type,
      length: note.length,
      flags: {
        cymbal: note.flags.cymbal,
        doubleKick: note.flags.doubleKick,
        accent: note.flags.accent,
        ghost: note.flags.ghost,
      },
    });
  }

  // Calculate end tick (slightly after last note or based on duration),
  // using the real tempo map to convert the audio duration.
  const timedTempos = buildTimedTempos(tempos, RESOLUTION);
  // Snapping can nudge a note past its neighbor, so take the max tick rather
  // than assuming the last array element is latest.
  const lastNoteTick =
    drumNotes.length > 0 ? Math.max(...drumNotes.map(n => n.tick)) : 0;
  const durationTicks = msToTick(
    durationSeconds * 1000,
    timedTempos,
    RESOLUTION,
    'ceil',
  );
  const endTick = Math.max(lastNoteTick + RESOLUTION, durationTicks);

  // Add end event
  parsedChart.endEvents = [{tick: endTick, msTime: 0, msLength: 0}];

  const doc: ChartDocument = {parsedChart, assets: []};

  // Create section markers every 4 bars, walking real measure boundaries
  // under the (possibly variable) time signatures.
  const timeSigs = parsedChart.timeSignatures.map(ts => ({
    tick: ts.tick,
    numerator: ts.numerator,
    denominator: ts.denominator,
  }));
  let barStartTick = 0;
  let bar = 0;
  while (barStartTick < endTick) {
    if (bar % 4 === 0) {
      addSection(
        doc,
        barStartTick,
        bar === 0 ? 'Intro' : `Section ${bar / 4 + 1}`,
      );
    }
    const next = getNextMeasureTick(barStartTick, 1, RESOLUTION, timeSigs);
    if (next <= barStartTick) break; // safety: never loop in place
    barStartTick = next;
    bar++;
  }

  return doc;
}

/**
 * Convert raw events to snapped, deduplicated DrumNotes.
 *
 * Each onset is quantized with msToTick against the chart's tempo list and
 * snapped to the 16th / 16th-triplet grid. Events that land on the same
 * (tick, noteType) are collapsed to one note: the higher-confidence event
 * wins and its tom/cymbal flags are kept; on a confidence tie the cymbal
 * wins (cymbals dominate the shared yellow/blue/green pads in practice).
 */
function dedupSnappedNotes(
  events: RawDrumEvent[],
  tempos: TempoLike[],
  resolution: number,
): DrumNote[] {
  const timedTempos = buildTimedTempos(tempos, resolution);

  const byKey = new Map<
    string,
    {note: DrumNote; confidence: number; isCymbal: boolean}
  >();

  for (const event of events) {
    const mapping = getChartMapping(event.drumClass);
    const tick = snapTickToGrid(
      msToTick(event.timeSeconds * 1000, timedTempos, resolution),
      resolution,
    );
    const key = `${tick}-${mapping.noteType}`;
    const existing = byKey.get(key);

    const wins =
      existing === undefined ||
      event.confidence > existing.confidence ||
      (event.confidence === existing.confidence &&
        mapping.isCymbal &&
        !existing.isCymbal);
    if (!wins) continue;

    const flags: DrumNoteFlags = {};
    if (mapping.isCymbal) flags.cymbal = true;
    byKey.set(key, {
      note: {tick, type: mapping.noteType, length: 0, flags},
      confidence: event.confidence,
      isCymbal: mapping.isCymbal,
    });
  }

  const notes = [...byKey.values()].map(entry => entry.note);
  notes.sort((a, b) => a.tick - b.tick);
  return notes;
}

/**
 * Build confidence data from raw events and the chart's tempo list.
 *
 * Creates a mapping from note key (tick-noteType) to confidence score,
 * matching the format the editor expects.
 */
export function buildConfidenceData(
  events: RawDrumEvent[],
  tempos: TempoLike[],
  resolution: number,
): {notes: Record<string, number>} {
  const notes: Record<string, number> = {};

  // Build confidence by converting each raw event to its tick+type key directly,
  // rather than matching by index (which breaks after the sort in rawEventsToDrumNotes).
  const timedTempos = buildTimedTempos(tempos, resolution);

  for (const event of events) {
    const mapping = getChartMapping(event.drumClass);
    const ms = event.timeSeconds * 1000;
    // Snap to the same grid as the chart notes (see buildChartDocument) so the
    // `${tick}-${noteType}` keys line up with the notes written to the chart.
    const tick = snapTickToGrid(
      msToTick(ms, timedTempos, resolution),
      resolution,
    );
    const key = `${tick}-${mapping.noteType}`;
    // If multiple events map to the same tick+type, keep the highest confidence
    if (notes[key] === undefined || event.confidence > notes[key]) {
      notes[key] = event.confidence;
    }
  }

  return {notes};
}
