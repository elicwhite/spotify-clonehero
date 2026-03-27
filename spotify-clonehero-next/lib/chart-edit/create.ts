/**
 * Create a minimal valid ChartDocument from scratch.
 *
 * Useful for starting a new chart (e.g. after drum transcription)
 * without needing to import an existing file.
 */

import type { ChartDocument } from './types';

export function createChart(options?: {
  format?: 'chart' | 'mid';
  resolution?: number;
  bpm?: number;
  timeSignature?: { numerator: number; denominator: number };
}): ChartDocument {
  const resolution = options?.resolution ?? 480;
  const bpm = options?.bpm ?? 120;
  const numerator = options?.timeSignature?.numerator ?? 4;
  const denominator = options?.timeSignature?.denominator ?? 4;

  return {
    chartTicksPerBeat: resolution,
    tempos: [
      {
        tick: 0,
        beatsPerMinute: bpm,
      },
    ],
    timeSignatures: [
      {
        tick: 0,
        numerator,
        denominator,
      },
    ],
    trackData: [],
    sections: [],
    lyrics: [],
    endEvents: [],
    vocalPhrases: [],
    hasLyrics: false,
    hasVocals: false,
    originalFormat: options?.format ?? 'chart',
    metadata: {},
    assets: [],
  };
}
