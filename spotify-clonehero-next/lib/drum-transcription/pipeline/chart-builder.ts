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
 * musical grid with the same quantizer /tempo uses (snapGroupToGrid plus the
 * caller-owned abstain band), so onsets land on 16th / triplet grid lines
 * instead of arbitrary ticks — except onsets whose nearest grid line is past
 * the tolerance, which are left un-snapped rather than dragged onto the grid.
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
import {noteId} from '@/lib/chart-edit';
import {
  swapSynctrack,
  DEFAULT_SNAP_TOLERANCE_MS,
} from '@/lib/tempo-map/swap-synctrack';
import {snapGroupToGrid, snapTickUniform} from '@/lib/tempo-map/quantize-grid';
import type {SnapMode} from '../ml/class-mapping';
import type {LinkSegSections, Synctrack} from '@/lib/tempo-map/types';
import type {MeterStats} from '@/lib/tempo-map/meter-confidence';
import {
  buildTimedTempos,
  msToTick,
  tickToMs,
  getNextMeasureTick,
} from '../timing';
import {getChartMapping} from '../ml/class-mapping';
import type {RawDrumEvent} from '../ml/types';
import {SYSTEMATIC_ONSET_MS} from '../ml/types';
import type {DrumNote, DrumNoteFlags, TimedTempo} from '../chart-types';

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
  /** LinkSeg functional section labels (null when unavailable). */
  sections?: LinkSegSections | null;
}

export interface TempoLike {
  tick: number;
  beatsPerMinute: number;
}

/** One ExpertDrums track's shape, used by both {@link buildChartDocument}
 * (fresh chart) and {@link buildChartDocumentFromExistingChart} (add-or-
 * replace onto an existing chart). */
type DrumsTrack = ChartDocument['parsedChart']['trackData'][number];

/** An empty ExpertDrums track skeleton — every non-note field a fresh drums
 * track needs, with no notes yet (see {@link addNotesToDrumsTrack}). */
function createEmptyDrumsTrack(): DrumsTrack {
  return {
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
  } as never as DrumsTrack;
}

/** Adds each snapped {@link DrumNote} to a drums track via chart-edit's
 * addDrumNote (mutates `track` in place). */
function addNotesToDrumsTrack(track: DrumsTrack, notes: DrumNote[]): void {
  for (const note of notes) {
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
  sections?: LinkSegSections | null,
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
    charter: 'MusicCharts.tools',
    diff_drums: 0,
  };

  // Quantize raw events against the tempo list actually written to the
  // chart (the game integrates these from tick 0 = time 0).
  const tempos: TempoLike[] = parsedChart.tempos.map(t => ({
    tick: t.tick,
    beatsPerMinute: t.beatsPerMinute,
  }));
  // Snap each onset tick to the musical grid (16ths / 16th-triplets) with
  // the SAME quantizer /tempo uses (swapSynctrack), including its abstain
  // band: an onset whose nearest grid line is more than
  // DEFAULT_SNAP_TOLERANCE_MS away (at the local tempo) is left at its raw
  // rounded tick rather than force-snapped, since force-snapping genuine
  // off-grid onsets makes the chart worse. Without any snapping, msToTick
  // lands notes on arbitrary ticks (e.g. 1913 instead of 1920) and they read
  // as off-grid in the editor. The confidence keys built by
  // buildConfidenceData use these SAME snapped ticks so the editor's
  // confidence panel matches every note.
  //
  // Snapping can collapse two nearby onsets onto the same (tick, noteType) —
  // including cross-class collisions like HT (yellow tom) + HH (yellow
  // cymbal) — which would write an invalid doubled note. Dedup keeps the
  // higher-confidence event (its flags win); ties prefer the cymbal.
  const drumNotes = dedupSnappedNotes(events, tempos, RESOLUTION);

  // Add an ExpertDrums track
  const track = createEmptyDrumsTrack();
  parsedChart.trackData = [track];
  addNotesToDrumsTrack(track, drumNotes);

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

  const timeSigs = parsedChart.timeSignatures.map(ts => ({
    tick: ts.tick,
    numerator: ts.numerator,
    denominator: ts.denominator,
  }));

  // Enumerate real measure (bar-line) ticks up to the chart end.
  const barTicks: number[] = [];
  {
    let t = 0;
    while (t < endTick) {
      barTicks.push(t);
      const next = getNextMeasureTick(t, 1, RESOLUTION, timeSigs);
      if (next <= t) break; // safety: never loop in place
      t = next;
    }
  }
  const snapToBar = (tick: number): number => {
    // nearest bar-line to `tick`
    let best = barTicks[0];
    let bestD = Math.abs(tick - best);
    for (let i = 1; i < barTicks.length; i++) {
      const d = Math.abs(tick - barTicks[i]);
      if (d < bestD) {
        bestD = d;
        best = barTicks[i];
      } else if (barTicks[i] > tick) {
        break; // barTicks ascending: distance only grows past `tick`
      }
    }
    return best;
  };

  if (sections && sections.labels.length > 0) {
    // LinkSeg functional labels: a marker at each segment start (times[0..S-1]),
    // snapped to the nearest bar-line. Number repeated labels (Verse 1, Verse 2, ...).
    const total = new Map<string, number>();
    for (const name of sections.labels)
      total.set(name, (total.get(name) ?? 0) + 1);
    const seen = new Map<string, number>();
    let prevTick = -1;
    for (let i = 0; i < sections.labels.length; i++) {
      const base = sections.labels[i];
      const rawTick = msToTick(sections.times[i] * 1000, timedTempos, RESOLUTION);
      const tick = snapToBar(rawTick);
      // If two boundaries snap to the same bar-line, keep the first and skip this
      // one WITHOUT advancing the repeat counter — otherwise addSection would
      // replace the prior marker and leave an orphan (e.g. "Verse 2" with no "Verse 1").
      if (tick === prevTick) continue;
      const idx = (seen.get(base) ?? 0) + 1;
      seen.set(base, idx);
      const name = (total.get(base) ?? 0) > 1 ? `${base} ${idx}` : base;
      addSection(doc, tick, name);
      prevTick = tick;
    }
  } else {
    // Fallback (no LinkSeg): section markers every 4 bars.
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
  }

  return doc;
}

/**
 * Build a ChartDocument from raw drum events, reusing an EXISTING chart's own
 * SyncTrack (tempos/timeSignatures/resolution) instead of a predicted one.
 *
 * Used by the "existing chart" flow (chart-flow feature): when the user
 * supplies their own chart package, its tempo map is the ground truth for
 * note placement — scoring against a provided grid instead of a predicted
 * one is worth ~+0.08 edit_rate_w offline, so this path must snap onsets to
 * `existing`'s own tempo list, never a freshly-predicted Synctrack. Feature
 * extraction and model inference are unaffected; only this chart-WRITING
 * step differs from {@link buildChartDocument}.
 *
 * Everything about the existing chart is preserved as-is (other instrument
 * tracks, sections, metadata, ini fields, assets) — only the `drums`/
 * `expert` track is replaced (or added, if the chart had none) and the end
 * event is extended if the new drum notes or audio duration run past it.
 */
export function buildChartDocumentFromExistingChart(
  existing: ChartDocument,
  events: RawDrumEvent[],
  durationSeconds: number,
): ChartDocument {
  const parsedChart = {
    ...existing.parsedChart,
    trackData: [...existing.parsedChart.trackData],
  };

  // Four-lane pro drums: without this, writeChartFolder drops the cymbal
  // marker notes (66/67/68) and every cymbal re-parses as a tom.
  parsedChart.drumType = drumTypes.fourLanePro;

  // Force .chart-format output regardless of the uploaded chart's own
  // source format. `format` here is just a writeChartFolder serialization
  // switch on the shared ParsedChart structure (mid vs. chart both parse
  // into the same tick/track shape) — but the app's project storage and
  // editor universally read/write `notes.chart` (runner.ts's
  // projectFileExists/writeProjectText calls hardcode that filename). A
  // MIDI-sourced existing chart (`notes.mid`) previously left `format:
  // 'mid'` untouched, so writeChartFolder emitted `notes.mid` instead and
  // the hardcoded notes.chart lookup after it threw ("writeChartFolder did
  // not produce notes.chart") — every real chart shipped as .mid failed
  // the chart-flow round trip.
  parsedChart.format = 'chart';

  const resolution = parsedChart.resolution || RESOLUTION;

  // Quantize raw events against the EXISTING chart's own tempo list (the
  // provided grid), not a predicted synctrack.
  const tempos: TempoLike[] = parsedChart.tempos.map(t => ({
    tick: t.tick,
    beatsPerMinute: t.beatsPerMinute,
  }));
  const drumNotes = dedupSnappedNotes(events, tempos, resolution);

  const drumsTrack = createEmptyDrumsTrack();
  addNotesToDrumsTrack(drumsTrack, drumNotes);

  // Add-or-replace: if the existing chart already had an Expert Drums track,
  // replace it in place; otherwise append the new track.
  const existingIdx = parsedChart.trackData.findIndex(
    t => t.instrument === 'drums' && t.difficulty === 'expert',
  );
  if (existingIdx >= 0) {
    parsedChart.trackData[existingIdx] = drumsTrack;
  } else {
    parsedChart.trackData.push(drumsTrack);
  }

  // Extend the end event if the new drum notes (or the transcribed audio's
  // duration) run past the chart's current end — never shorten it.
  const timedTempos = buildTimedTempos(tempos, resolution);
  const lastNoteTick =
    drumNotes.length > 0 ? Math.max(...drumNotes.map(n => n.tick)) : 0;
  const durationTicks = msToTick(
    durationSeconds * 1000,
    timedTempos,
    resolution,
    'ceil',
  );
  const existingEndTick =
    parsedChart.endEvents.length > 0
      ? Math.max(...parsedChart.endEvents.map(e => e.tick))
      : 0;
  const endTick = Math.max(
    existingEndTick,
    lastNoteTick + resolution,
    durationTicks,
  );
  if (endTick > existingEndTick) {
    parsedChart.endEvents = [{tick: endTick, msTime: 0, msLength: 0}];
  }

  return {parsedChart, assets: existing.assets};
}

/**
 * Snap one onset's audio time to the grid, abstaining when the nearest grid
 * line is too far to trust.
 *
 * The grid is lane-dependent (Phase B per-lane quantizer). `snapMode`
 * 'candidate' snaps to the nearest 16th / 16th-triplet musical subdivision via
 * {@link snapGroupToGrid} (pitched lanes + hihat); 'uniform' snaps to the
 * nearest 1/24-beat line via {@link snapTickUniform} (crash/crash-2/ride, where
 * candidate snapping regressed). In both modes, if the snap would move the note
 * more than `toleranceMs` from its true audio position (at the local tempo, via
 * {@link tickToMs}) the note is left at its raw rounded tick instead of
 * force-snapped. Both {@link dedupSnappedNotes} and {@link buildConfidenceData}
 * route through this one function so a note's tick and its confidence key are
 * always the identical snap decision.
 */
function snapOnsetTick(
  ms: number,
  timedTempos: TimedTempo[],
  resolution: number,
  snapMode: SnapMode = 'candidate',
  toleranceMs: number = DEFAULT_SNAP_TOLERANCE_MS,
): number {
  // Correct the systematic CRNN-vs-charter onset offset NOTE-side (the model
  // fires ~SYSTEMATIC_ONSET_MS before charters place the note). Applied here at
  // chart placement so the beat grid stays on true positions (not a grid
  // shift). The drift/abstain check is relative to the corrected position too.
  const adjMs = ms + SYSTEMATIC_ONSET_MS;
  const frac = msToTick(adjMs, timedTempos, resolution);
  const snapped =
    snapMode === 'uniform'
      ? snapTickUniform(frac, resolution)
      : snapGroupToGrid(frac, resolution);
  const driftMs = Math.abs(tickToMs(snapped, timedTempos, resolution) - adjMs);
  return driftMs > toleranceMs ? Math.max(0, Math.round(frac)) : snapped;
}

/**
 * Convert raw events to snapped, deduplicated DrumNotes.
 *
 * Each onset is quantized with msToTick against the chart's tempo list and
 * snapped to the 16th / 16th-triplet grid (abstaining when off-grid past the
 * tolerance — see {@link snapOnsetTick}). Events that land on the same
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
    const tick = snapOnsetTick(
      event.timeSeconds * 1000,
      timedTempos,
      resolution,
      mapping.snapMode,
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
    // Snap to the same grid as the chart notes (see buildChartDocument), via
    // the SAME snapOnsetTick helper (abstain band + per-lane snapMode
    // included). Key by the canonical noteId (`${tick}:${type}`) so these keys
    // match exactly what the editor looks up per note — a `${tick}-${type}`
    // (dash) key silently misses every lookup and shows all notes as 100%.
    const tick = snapOnsetTick(ms, timedTempos, resolution, mapping.snapMode);
    const key = noteId({tick, type: mapping.noteType});
    // If multiple events map to the same tick+type, keep the highest confidence
    if (notes[key] === undefined || event.confidence > notes[key]) {
      notes[key] = event.confidence;
    }
  }

  return {notes};
}
