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
import {snapGroupToGrid} from '@/lib/tempo-map/quantize-grid';
import {finalizeSynctrack} from '@/lib/tempo-map/finalize-synctrack';
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
import {
  SYSTEMATIC_ONSET_MS_CHART_FLOW,
  SYSTEMATIC_ONSET_MS_AUDIO_FLOW,
} from '../ml/types';
import {
  DEFAULT_PHASE_ALIGN_CONFIG,
  type PhaseAlignGateConfig,
} from '../ml/phase-align-config';
import {computePhaseAlignShiftMs, type PhaseAlignResult} from './phase-align';

/**
 * Which grid a chart's note placement is measured against — selects the
 * flow-specific {@link SYSTEMATIC_ONSET_MS_CHART_FLOW} /
 * {@link SYSTEMATIC_ONSET_MS_AUDIO_FLOW} correction in {@link snapOnsetTick}.
 * 'chart' = the existing-chart flow (buildChartDocumentFromExistingChart,
 * placement measured against the chart's own SyncTrack). 'audio' = the
 * audio-only flow (buildChartDocument, placement measured against a
 * model-predicted grid, which carries its own bias).
 */
export type OnsetFlow = 'chart' | 'audio';
import {noteFlags} from '@eliwhite/scan-chart';
import type {DrumNote, TimedTempo} from '../chart-types';

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
      flags: note.flags,
    });
  }
}

/** Result of {@link buildDrumsTrackFromOnsets}. */
export interface BuiltDrumsTrack {
  track: DrumsTrack;
  /** The audio-flow phase-align decision (a no-op result for flow==='chart'). */
  phaseAlign: PhaseAlignResult;
}

/**
 * The onset -> tick -> snapGroupToGrid snap stage plus ExpertDrums-track
 * assembly, factored out of {@link buildChartDocument} so it is the ONE
 * implementation of the audio/chart-flow note snap.
 *
 * Reused verbatim by the class-(b) RE-PREDICT tempo remap (plan 0061 §3),
 * which re-runs this exact snap from retained decoded onsets against a
 * re-warped lattice — never from the notes' stored msTime, which carries the
 * old (wrong) lattice's quantization baked in.
 *
 * Snaps each onset against `tempos` (the tick-domain tempo list actually
 * written to the chart) with the shared quantizer + abstain band, dedups
 * same-(tick,type) collisions, and assembles a fresh track. For flow==='audio'
 * it first computes the per-song phase-align shift (a model-predicted grid can
 * carry a global phase bias); flow==='chart' trusts the grid and never
 * phase-aligns. Note msTime/msLength are left as addDrumNote's placeholders —
 * the caller retimes.
 */
export function buildDrumsTrackFromOnsets(
  events: RawDrumEvent[],
  tempos: TempoLike[],
  resolution: number,
  flow: OnsetFlow,
  phaseAlignConfig: PhaseAlignGateConfig = DEFAULT_PHASE_ALIGN_CONFIG,
): BuiltDrumsTrack {
  const phaseAlign: PhaseAlignResult =
    flow === 'audio'
      ? computePhaseAlignShiftMs(
          events.map(
            e => e.timeSeconds * 1000 + SYSTEMATIC_ONSET_MS_AUDIO_FLOW,
          ),
          buildTimedTempos(tempos, resolution),
          resolution,
          phaseAlignConfig,
        )
      : {shiftMs: 0, applied: false, bestScore: 0, noshiftScore: 0};

  const notes = dedupSnappedNotes(
    events,
    tempos,
    resolution,
    flow,
    phaseAlign.shiftMs,
  );
  const track = createEmptyDrumsTrack();
  addNotesToDrumsTrack(track, notes);
  return {track, phaseAlign};
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
  phaseAlignConfig: PhaseAlignGateConfig = DEFAULT_PHASE_ALIGN_CONFIG,
  /** Mutated in place with the phase-align decision, when provided — lets
   * callers (e.g. the pipeline runner) reuse the SAME shift for
   * buildConfidenceData without recomputing it against a second, possibly
   * inconsistent, tempo map. See {@link buildConfidenceData}'s
   * `phaseAlignShiftMs` param. */
  outPhaseAlign?: {result?: PhaseAlignResult},
): ChartDocument {
  // Create an empty parsed chart (single tempo + 4/4 time signature)
  let parsedChart = createEmptyChart({
    format: 'chart',
    resolution: RESOLUTION,
    bpm: DEFAULT_BPM,
    timeSignature: {numerator: 4, denominator: 4},
  });

  if (synctrack && synctrack.tempos.length > 0) {
    // KS-WARP (kick+snare onset-anchored drift warp, #104) / REACH-EXTENSION
    // (#112, SHIPPED — Eli GO "ship guard alone", 2026-07-17, supersedes the
    // whole-song d5 gate below): on songs where the predicted grid has
    // drifted from the true tempo, softly pull it back toward the decoded
    // kick+snare backbeat before installing it. Delegated to
    // finalizeSynctrack (lib/tempo-map/finalize-synctrack.ts) — the SAME
    // function /tempo's tempo-only pipeline calls
    // (drum-transcription/pipeline/tempo-track.ts) on the same
    // (rawSynctrack, events) inputs, so the two features cannot produce
    // different grids from the same audio. Onsets MUST be RAW (uncorrected)
    // times, matching the Python reference's SF.decode("raw", ...) contract
    // — see ks-warp.ts's module docstring. Only applies to a
    // freshly-predicted synctrack, never to an existing chart's own tempo
    // list (buildChartDocumentFromExistingChart below does not call this).
    const effectiveSynctrack = finalizeSynctrack(synctrack, events);
    // The empty chart has no events to re-tick, so swapSynctrack just
    // installs the predicted tempos/time signatures with correct ticks
    // (including lead-in / origin handling — see synctrack-ticks.ts).
    parsedChart = swapSynctrack(parsedChart, effectiveSynctrack);
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
  const timedTempos = buildTimedTempos(tempos, RESOLUTION);

  // Snap each onset to the musical grid (16ths / 16th-triplets) with the
  // shared quantizer + abstain band and assemble the ExpertDrums track. The
  // whole onset->tick->snap stage — including the audio-flow PHASE-ALIGN
  // shift (a per-song global time shift maximizing onset alignment to strong
  // metrical positions; only fires under a decisive gate) — lives in the
  // reusable {@link buildDrumsTrackFromOnsets} so the class-(b) RE-PREDICT
  // tempo remap re-runs the identical snap. The confidence keys built by
  // buildConfidenceData use these SAME snapped ticks (via the shared
  // snapOnsetTick) so the editor's confidence panel matches every note.
  const {track, phaseAlign} = buildDrumsTrackFromOnsets(
    events,
    tempos,
    RESOLUTION,
    'audio',
    phaseAlignConfig,
  );
  if (outPhaseAlign) outPhaseAlign.result = phaseAlign;
  parsedChart.trackData = [track];

  // Calculate end tick (slightly after last note or based on duration),
  // using the real tempo map to convert the audio duration.
  // Snapping can nudge a note past its neighbor, so take the max tick rather
  // than assuming the last array element is latest.
  const drumTicks = track.noteEventGroups.flat().map(n => n.tick);
  const lastNoteTick = drumTicks.length > 0 ? Math.max(...drumTicks) : 0;
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
      const rawTick = msToTick(
        sections.times[i] * 1000,
        timedTempos,
        RESOLUTION,
      );
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

  // `parsedChart.format` (inherited from `existing` above) is left as-is.
  // `.chart` and `.mid` are both first-class writeChartFolder output
  // formats — this builder only touches note/track content, never format.
  // Storage/editor code downstream must handle whichever format the source
  // chart used (see lib/drum-transcription/storage/opfs.ts's
  // findProjectChartFile / CHART_FILE_BASENAMES) rather than assuming
  // `notes.chart`.

  const resolution = parsedChart.resolution || RESOLUTION;

  // Quantize raw events against the EXISTING chart's own tempo list (the
  // provided grid), not a predicted synctrack. Same snap stage as the
  // audio-flow builder, via the shared {@link buildDrumsTrackFromOnsets}.
  const tempos: TempoLike[] = parsedChart.tempos.map(t => ({
    tick: t.tick,
    beatsPerMinute: t.beatsPerMinute,
  }));
  const {track: drumsTrack} = buildDrumsTrackFromOnsets(
    events,
    tempos,
    resolution,
    'chart',
  );

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
  const drumTicks = drumsTrack.noteEventGroups.flat().map(n => n.tick);
  const lastNoteTick = drumTicks.length > 0 ? Math.max(...drumTicks) : 0;
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
 * The grid is lane-dependent (Phase B per-lane quantizer), though every lane's
 * `snapMode` is currently 'candidate' — snap to the nearest 16th / 16th-triplet
 * musical subdivision via {@link snapGroupToGrid} (the 'uniform' 1/24-beat
 * carve-out for crash/crash-2/ride was dropped 2026-07-04 and its
 * implementation removed, drum-to-chart plan §4 step 5 R5-3 — see
 * {@link SnapMode}). If the snap would move the note more than `toleranceMs`
 * from its true audio position (at the local tempo, via {@link tickToMs}) the
 * note is left at its raw rounded tick instead of force-snapped. Both
 * {@link dedupSnappedNotes} and {@link buildConfidenceData} route through this
 * one function so a note's tick and its confidence key are always the
 * identical snap decision.
 */
function snapOnsetTick(
  ms: number,
  timedTempos: TimedTempo[],
  resolution: number,
  snapMode: SnapMode = 'candidate',
  toleranceMs: number = DEFAULT_SNAP_TOLERANCE_MS,
  flow: OnsetFlow = 'audio',
  /** PHASE-ALIGN shift (ms), audio-flow only — see phase-align.ts. Always
   * 0 for flow==='chart' (an existing chart's grid is trusted as-is; the
   * lever never applies there — see {@link buildChartDocumentFromExistingChart}). */
  phaseAlignShiftMs: number = 0,
): number {
  // Correct the systematic CRNN-vs-charter onset offset NOTE-side (the model
  // fires ~SYSTEMATIC_ONSET_MS_{CHART,AUDIO}_FLOW before charters place the
  // note — the two differ because the audio-flow's predicted grid carries its
  // own bias). Applied here at chart placement so the beat grid stays on true
  // positions (not a grid shift). The drift/abstain check is relative to the
  // corrected position too.
  const systematicOnsetMs =
    flow === 'chart'
      ? SYSTEMATIC_ONSET_MS_CHART_FLOW
      : SYSTEMATIC_ONSET_MS_AUDIO_FLOW;
  const adjMs =
    ms + systematicOnsetMs + (flow === 'audio' ? phaseAlignShiftMs : 0);
  const frac = msToTick(adjMs, timedTempos, resolution);
  // snapMode is currently always 'candidate' (the 'uniform' branch was
  // removed, drum-to-chart plan §4 step 5 R5-3); kept as a parameter so a
  // future GROUP-level policy can reintroduce branching without re-widening
  // the call sites (see SnapMode's docstring).
  void snapMode;
  const snapped = snapGroupToGrid(frac, resolution);
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
  flow: OnsetFlow,
  phaseAlignShiftMs: number = 0,
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
      DEFAULT_SNAP_TOLERANCE_MS,
      flow,
      phaseAlignShiftMs,
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

    const flags = mapping.isCymbal ? noteFlags.cymbal : 0;
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
  flow: OnsetFlow = 'audio',
  /** PHASE-ALIGN shift (ms) actually applied by {@link buildChartDocument}
   * for this project — pass the SAME value the chart used (e.g.
   * `outPhaseAlign.result.shiftMs`) so confidence keys match the chart's
   * snapped ticks exactly. Ignored for flow==='chart'. */
  phaseAlignShiftMs: number = 0,
): {notes: Record<string, number>} {
  const notes: Record<string, number> = {};

  // Build confidence by converting each raw event to its tick+type key directly,
  // rather than matching by index (which breaks after the sort in rawEventsToDrumNotes).
  const timedTempos = buildTimedTempos(tempos, resolution);

  for (const event of events) {
    const mapping = getChartMapping(event.drumClass);
    const ms = event.timeSeconds * 1000;
    // Snap to the same grid as the chart notes (see buildChartDocument), via
    // the SAME snapOnsetTick helper (abstain band + per-lane snapMode +
    // flow-specific systematic-onset constant + phase-align shift included).
    // Key by the canonical noteId (`${tick}:${type}`) so these keys match
    // exactly what the editor looks up per note — a `${tick}-${type}` (dash)
    // key silently misses every lookup and shows all notes as 100%.
    const tick = snapOnsetTick(
      ms,
      timedTempos,
      resolution,
      mapping.snapMode,
      DEFAULT_SNAP_TOLERANCE_MS,
      flow,
      phaseAlignShiftMs,
    );
    const key = noteId({tick, type: mapping.noteType});
    // If multiple events map to the same tick+type, keep the highest confidence
    if (notes[key] === undefined || event.confidence > notes[key]) {
      notes[key] = event.confidence;
    }
  }

  return {notes};
}
