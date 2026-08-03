/**
 * Builds `generate-difficulties`' run input from a chart doc, and names the
 * reasons a chart can't be reduced (plan 0074 Design D). Separate from
 * `tasks.ts` because this is chart inspection, not task definition, and the
 * UI calls it directly to decide what to say before starting a run.
 */

import type {ChartDocument, ParsedChart} from '@/lib/chart-edit';
import {findTrack} from '@/lib/chart-edit';
import type {SupportedTrackInstrument} from '@/lib/chart-editor-core';
import {parsedChartToRawDrums} from '@/lib/drum-difficulty/adapter';
import {buildOursInput} from '@/lib/drum-difficulty/ours/featurize';
import type {DifficultyGenerationInput} from './difficulty-client';

/** Why a chart can't be reduced for an instrument. Typed rather than
 *  pre-rendered copy: the reason is surfaced with the instrument's label by
 *  the UI layer (`useDifficultyGeneration`). */
export type DifficultyGenerationBlockReason =
  | 'no-expert-track'
  | 'no-expert-notes'
  | 'no-drums'
  | 'not-pro-drums-five-lane'
  | 'not-pro-drums-four-lane';

export type DifficultyGenerationInputResult =
  | {ok: true; input: DifficultyGenerationInput}
  | {ok: false; reason: DifficultyGenerationBlockReason};

/** The chart minus its tracks. `reduceGuitarDifficulties` reads only
 *  `resolution`, `tempos`, `timeSignatures` and `sections` (via
 *  `buildGuitarFeatureContext` / `tickToMs` / `decodeRanges`), and the
 *  request crosses a `postMessage` structured clone, so every other
 *  instrument's note data is dropped instead of copied per run. */
function timingOnlyChart(chart: ParsedChart): ParsedChart {
  return {...chart, trackData: []};
}

/** Maps a drums-adapter rejection to the reason the UI reports. */
function drumsBlockReason(
  rejection: Exclude<
    ReturnType<typeof parsedChartToRawDrums>,
    {ok: true}
  >['reason'],
  drumType: 'five-lane' | 'four-lane' | undefined,
): DifficultyGenerationBlockReason {
  switch (rejection) {
    case 'no-drums':
      return 'no-drums';
    case 'no-expert-track':
      return 'no-expert-track';
    case 'no-notes':
      return 'no-expert-notes';
    case 'not-pro-drums':
      return drumType === 'five-lane'
        ? 'not-pro-drums-five-lane'
        : 'not-pro-drums-four-lane';
  }
}

/**
 * Builds `generate-difficulties`' run input from a chart doc's Expert track
 * for `instrument` (plan 0074 Phase 4). Drums assembles the ML featurizer's
 * `OursSongInput` via the shared `parsedChartToRawDrums` adapter; guitar/bass
 * hand their Expert track straight through alongside the chart's timing,
 * mirroring `reduceGuitarDifficulties`'s own signature. Returns a typed
 * rejection when the chart can't be reduced, so the caller can say which of
 * "no Expert track", "no notes" or "not a Pro Drums chart" applies rather
 * than collapsing all three into one message.
 *
 * The empty-Expert check is made here for guitar/bass too, not left to the
 * reducer: `reduceGuitarDifficulties` throws its own untyped error only after
 * the worker has spawned and downloaded three ONNX models.
 */
export function buildDifficultyGenerationInput(
  doc: ChartDocument,
  instrument: SupportedTrackInstrument,
): DifficultyGenerationInputResult {
  const expert = findTrack(doc, {instrument, difficulty: 'expert'});
  if (!expert) return {ok: false, reason: 'no-expert-track'};

  if (instrument === 'drums') {
    const adapterResult = parsedChartToRawDrums(doc.parsedChart);
    if (!adapterResult.ok) {
      return {
        ok: false,
        reason: drumsBlockReason(
          adapterResult.reason,
          'drumType' in adapterResult ? adapterResult.drumType : undefined,
        ),
      };
    }
    return {
      ok: true,
      input: {
        instrument: 'drums',
        input: buildOursInput(adapterResult.chart, doc.parsedChart),
      },
    };
  }

  const noteCount = expert.track.noteEventGroups.reduce(
    (sum, group) => sum + group.length,
    0,
  );
  if (noteCount === 0) return {ok: false, reason: 'no-expert-notes'};

  return {
    ok: true,
    input: {
      instrument,
      chart: timingOnlyChart(doc.parsedChart),
      expertTrack: expert.track,
    },
  };
}
