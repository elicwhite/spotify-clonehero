/**
 * Rendering for `DifficultyGenerationBlockReason` (plan 0074 Design D). The
 * reason is typed precisely so its copy lives in one place: both surfaces
 * that can refuse a run — the in-editor Generate bar / Chart Assist card
 * (`useDifficultyGeneration`) and the `/drum-difficulties` /
 * `/guitar-difficulties` picker — render it from here, so a new reason can't
 * compile in one and silently go unhandled in the other.
 */

import type {SupportedTrackInstrument} from '@/lib/chart-editor-core';
import type {DifficultyGenerationBlockReason} from '@/lib/assist/difficulty-input';
import {INSTRUMENT_LABEL} from './trackLabels';

/**
 * Who the reader is. `editor` speaks about the chart already open ("No Drums
 * Expert track to generate from."); `picker` speaks about the chart the user
 * just dropped ("This chart has no Expert Drums to generate from.").
 */
export type DifficultyGenerationMessageTone = 'editor' | 'picker';

export function difficultyGenerationBlockMessage(
  instrument: SupportedTrackInstrument,
  reason: DifficultyGenerationBlockReason,
  tone: DifficultyGenerationMessageTone = 'editor',
): string {
  const label = INSTRUMENT_LABEL[instrument];
  switch (reason) {
    case 'no-expert-track':
    case 'no-drums':
      return tone === 'picker'
        ? `This chart has no Expert ${label} to generate from.`
        : `No ${label} Expert track to generate from.`;
    case 'no-expert-notes':
      return tone === 'picker'
        ? `This chart's Expert ${label} track has no notes to generate from.`
        : `The ${label} Expert track has no notes to generate from.`;
    case 'not-pro-drums-five-lane':
      return 'Difficulty generation needs a Pro Drums chart. This chart is five-lane drums.';
    case 'not-pro-drums-four-lane':
      return 'Difficulty generation needs a Pro Drums chart. This chart is four-lane drums with no cymbal markers.';
  }
}
