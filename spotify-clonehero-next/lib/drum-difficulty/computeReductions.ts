/**
 * `/difficulties` page orchestration: uploaded files -> parsed chart + audio +
 * per-reducer reduced tiers, or a typed rejection for the page's error states.
 *
 * The heavy, testable work (adapter routing, running each reducer) lives here;
 * the client component only turns the resulting {@link ReducedNote} lists into
 * renderable `Track`s and mounts the grid. Reducers are run per-reducer inside
 * try/catch so one throwing (on a pathological chart) surfaces as an error on
 * just that reducer's three cells, never blanking the grid (plan §8).
 *
 * HOPCAT input routing mirrors the fully-validated production path: when the
 * upload carries a real `notes.mid`, HOPCAT parses those raw bytes directly
 * (`parseRawMidiForHopcat`, tick-exact on the full corpus); a `.chart`-only
 * upload with no `notes.mid` falls back to the scan-chart-derived adapter
 * (`toHopcatInput`, with its documented narrower limitations). Onyx always uses
 * the scan-chart-resolved path.
 *
 * A Harmonix-charted upload (`metadata.charter` containing "harmonix") also
 * gets its own authored Hard/Medium/Easy drums tracks surfaced as
 * `harmonixTiers` — real ground truth, not a reducer output, used for an
 * optional fourth grid row (see `DifficultiesClient.tsx`).
 */

import type {LoadedFiles} from '../../components/chart-picker/chart-file-readers';
import {readChart} from '../chart-edit';
import {getChartDelayMs} from '../chart-utils/chartDelay';
import {
  findAudioFiles,
  type Files,
  type ParsedChart,
} from '../preview/chorus-chart-processing';
import type {Track} from '../preview/highway/types';

import {parsedChartToRawDrums, toHopcatInput, toOnyxInput} from './adapter';
import {parseRawMidiForHopcat} from './adapter/hopcatRawMidi';
import {
  reduceHopcatToNotes,
  reduceOnyxToNotes,
  TIERS,
  type ReducedNote,
  type Tier,
} from './toRenderableTrack';
import {
  loadOursModels,
  reduceOursFromChart,
  type OursModels,
  type OursOutNote,
} from './ours/reduce';
import type {AdapterRejection, RawDrumChart} from './types';

export type ReducerName = 'hopcat' | 'onyx';

/** Why the page can't render a grid for this upload (all non-blank states). */
export type ReductionRejection = AdapterRejection | {reason: 'no-audio'};

/** Per-reducer outcome: reduced tiers, or a message for that reducer's cells. */
export type ReducerTiers =
  | {ok: true; tiers: Record<Tier, ReducedNote[]>}
  | {ok: false; error: string};

/**
 * Ours' outcome. Unlike HOPCAT/Onyx it's produced asynchronously (its ~37MB
 * model set is fetched lazily), and its notes carry their own original
 * tick/msTime, so they're kept as {@link OursOutNote}s (not rescaled
 * {@link ReducedNote}s) all the way to {@link oursNotesToTrack}.
 */
export type OursReducerTiers =
  | {ok: true; tiers: Record<Tier, OursOutNote[]>}
  | {ok: false; error: string};

export interface ReductionModel {
  parsedChart: ParsedChart;
  /** Adapter IR for the Expert track — Ours is run against this once its
   * models finish loading (see {@link runOurs}). */
  rawDrumChart: RawDrumChart;
  /** The real Expert drums track, for the tall left column. */
  expertTrack: Track;
  /** Audio stems for the one shared `AudioManager`. */
  audioFiles: Files;
  chartDelayMs: number;
  reducers: Record<ReducerName, ReducerTiers>;
  /** The chart's own authored Hard/Medium/Easy drums tracks, shown as a
   * fourth grid row when the chart is charted by Harmonix (a real official
   * reduction to compare the reducers against) — `null` otherwise, or if any
   * tier is unexpectedly missing despite the charter match. */
  harmonixTiers: Record<Tier, Track> | null;
}

export type ReductionResult =
  | {ok: true; model: ReductionModel}
  | ({ok: false} & ReductionRejection);

function findNotesMidBytes(files: Files): Uint8Array | null {
  const mid = files.find(f => f.fileName.toLowerCase() === 'notes.mid');
  return mid ? mid.data : null;
}

function findExpertDrumsTrack(chart: ParsedChart): Track | undefined {
  return chart.trackData.find(
    t => t.instrument === 'drums' && t.difficulty === 'expert',
  ) as Track | undefined;
}

function findDrumsTrack(
  chart: ParsedChart,
  difficulty: Tier,
): Track | undefined {
  return chart.trackData.find(
    t => t.instrument === 'drums' && t.difficulty === difficulty,
  ) as Track | undefined;
}

/** A chart's charter is considered Harmonix if the field contains
 * "harmonix" (case-insensitive), not just an exact match — real-world
 * charter fields vary ("Harmonix", "Harmonix Music Systems", etc.). */
export function isHarmonixCharter(charter: string | undefined): boolean {
  return (charter ?? '').toLowerCase().includes('harmonix');
}

/** The chart's own authored Hard/Medium/Easy drums tracks, for the optional
 * fourth "Harmonix" grid row — real ground truth to compare the reducers
 * against, shown only for Harmonix-charted uploads with all three tiers
 * present. */
function findHarmonixTiers(chart: ParsedChart): Record<Tier, Track> | null {
  if (!isHarmonixCharter(chart.metadata.charter)) return null;
  const tiers = {} as Record<Tier, Track>;
  for (const tier of TIERS) {
    const track = findDrumsTrack(chart, tier);
    if (!track) return null;
    tiers[tier] = track;
  }
  return tiers;
}

function runHopcat(
  rawChart: RawDrumChart,
  midiBytes: Uint8Array | null,
): ReducerTiers {
  try {
    const input = midiBytes
      ? parseRawMidiForHopcat(midiBytes)
      : toHopcatInput(rawChart);
    return {ok: true, tiers: reduceHopcatToNotes(input, rawChart)};
  } catch (e) {
    return {ok: false, error: e instanceof Error ? e.message : String(e)};
  }
}

function runOnyx(rawChart: RawDrumChart): ReducerTiers {
  try {
    return {ok: true, tiers: reduceOnyxToNotes(toOnyxInput(rawChart))};
  } catch (e) {
    return {ok: false, error: e instanceof Error ? e.message : String(e)};
  }
}

/**
 * Run Ours against an already-loaded model set. Kept separate from
 * {@link computeReductions} (which is synchronous) because Ours' models are
 * fetched lazily; the page calls this once {@link loadOursModels} resolves. A
 * throw here surfaces only on Ours' three cells, never blanking HOPCAT/Onyx
 * (plan §8).
 */
export function runOurs(
  rawChart: RawDrumChart,
  parsedChart: ParsedChart,
  models: OursModels,
): OursReducerTiers {
  try {
    return {
      ok: true,
      tiers: reduceOursFromChart(rawChart, parsedChart, models),
    };
  } catch (e) {
    return {ok: false, error: e instanceof Error ? e.message : String(e)};
  }
}

/**
 * Parse the uploaded chart, validate it (drums/Expert/pro/audio), and run both
 * reducers. Returns a typed rejection for every non-blank error state the page
 * must surface (§8): no drums, no Expert track, non-pro-drums, no audio.
 */
export function computeReductions(loaded: LoadedFiles): ReductionResult {
  const doc = readChart(loaded.files as never, {pro_drums: true});
  const parsedChart = doc.parsedChart as unknown as ParsedChart;

  const adapted = parsedChartToRawDrums(doc.parsedChart);
  if (!adapted.ok) {
    const {ok: _ok, ...rejection} = adapted;
    return {ok: false, ...rejection};
  }

  const expertTrack = findExpertDrumsTrack(parsedChart);
  if (!expertTrack) {
    return {ok: false, reason: 'no-expert-track'};
  }

  const audioFiles = findAudioFiles(loaded.files as unknown as Files);
  if (audioFiles.length === 0) {
    return {ok: false, reason: 'no-audio'};
  }

  const midiBytes = findNotesMidBytes(loaded.files as unknown as Files);

  return {
    ok: true,
    model: {
      parsedChart,
      rawDrumChart: adapted.chart,
      expertTrack,
      audioFiles,
      chartDelayMs: getChartDelayMs(parsedChart.metadata),
      reducers: {
        hopcat: runHopcat(adapted.chart, midiBytes),
        onyx: runOnyx(adapted.chart),
      },
      harmonixTiers: findHarmonixTiers(parsedChart),
    },
  };
}

export {loadOursModels};
export type {OursModels};
