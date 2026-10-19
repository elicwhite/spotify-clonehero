/**
 * Every measured figure this landing page states, with its provenance.
 *
 * The scorer reports edits per ground-truth note. The landing page multiplies
 * those rates by 100 so readers can interpret them as "edits per 100 notes."
 */
import type {
  LandingMetric,
  LandingProvenance,
} from '@/components/landing/StatChip';

const P = (measuredOn: string, note?: string): LandingProvenance => ({
  script: 'analysis/threeway_comparison/',
  measuredOn,
  asOf: '2026-08-07',
  ...(note !== undefined ? {note} : {}),
});

const CHART_FLOW_PROV = P(
  'The v3 test split, which was not used to train this tool. Every system used the tempo map from the finished reference chart. Whole-chart values average the song scores; kit-part values pool the edits and notes for that part.',
  'The test script reports edits per note. The displayed value is multiplied by 100.',
);

const ADTOF_CHART_FLOW_PROV = P(
  'The v3 test split, which was not used to train this tool. ADTOF used the tempo map from the finished reference chart. Its five note types were mapped to fixed lanes before the test.',
  'The fixed lane mapping did not use answers from the finished charts. ADTOF cannot identify which tom or which cymbal.',
);

const AUDIO_FLOW_PROV = P(
  'The v3 test split, which was not used to train this tool. Each system made a tempo map from the audio before placing its notes.',
  'The test script reports edits per note. The displayed value is multiplied by 100.',
);

const ADTOF_AUDIO_FLOW_PROV = P(
  'The v3 test split, which was not used to train this tool. ADTOF placed the drum notes with a fixed lane mapping. This tool made the tempo map from the audio.',
  'ADTOF does not make tempo maps on its own. This row measures this tool with ADTOF placing the drum notes.',
);

const metric = (
  value: string,
  label: string,
  prov: LandingProvenance,
): LandingMetric => ({value, label, prov});

export const DATA_DISCLAIMER =
  'Tested once on 367 songs that were not used to train this tool. Whether ADTOF or Octave were trained on any of them is unknown. Confidence intervals have not been calculated.';

export interface ComparisonRow {
  family: string;
  ours: LandingMetric;
  adtof: LandingMetric;
  octave: LandingMetric;
}

/**
 * Note-content comparison on the reference chart's beat grid. ADTOF uses the
 * fixed/naive lane mapping: unlike its oracle mapping, this could exist in a
 * product without looking at the finished chart.
 */
export const COMPARISON_ROWS: readonly ComparisonRow[] = [
  {
    family: 'Whole chart',
    ours: metric('20.3', 'edits per 100 notes, this tool', CHART_FLOW_PROV),
    adtof: metric(
      '40.0',
      'edits per 100 notes, ADTOF with fixed lane mapping',
      ADTOF_CHART_FLOW_PROV,
    ),
    octave: metric('148.6', 'edits per 100 notes, Octave', CHART_FLOW_PROV),
  },
  {
    family: 'Kick',
    ours: metric(
      '7.2',
      'kick edits per 100 kick notes, this tool',
      CHART_FLOW_PROV,
    ),
    adtof: metric(
      '13.0',
      'kick edits per 100 kick notes, ADTOF',
      ADTOF_CHART_FLOW_PROV,
    ),
    octave: metric(
      '140.0',
      'kick edits per 100 kick notes, Octave',
      CHART_FLOW_PROV,
    ),
  },
  {
    family: 'Snare',
    ours: metric(
      '13.1',
      'snare edits per 100 snare notes, this tool',
      CHART_FLOW_PROV,
    ),
    adtof: metric(
      '21.1',
      'snare edits per 100 snare notes, ADTOF',
      ADTOF_CHART_FLOW_PROV,
    ),
    octave: metric(
      '147.4',
      'snare edits per 100 snare notes, Octave',
      CHART_FLOW_PROV,
    ),
  },
  {
    family: 'Hi-hat',
    ours: metric(
      '28.3',
      'hi-hat edits per 100 hi-hat notes, this tool',
      CHART_FLOW_PROV,
    ),
    adtof: metric(
      '57.6',
      'hi-hat edits per 100 hi-hat notes, ADTOF',
      ADTOF_CHART_FLOW_PROV,
    ),
    octave: metric(
      '154.0',
      'hi-hat edits per 100 hi-hat notes, Octave',
      CHART_FLOW_PROV,
    ),
  },
  {
    family: 'Toms',
    ours: metric(
      '79.1',
      'tom edits per 100 tom notes, this tool',
      CHART_FLOW_PROV,
    ),
    adtof: metric(
      '144.5',
      'tom edits per 100 tom notes, ADTOF',
      ADTOF_CHART_FLOW_PROV,
    ),
    octave: metric(
      '102.6',
      'tom edits per 100 tom notes, Octave',
      CHART_FLOW_PROV,
    ),
  },
  {
    family: 'Cymbals',
    ours: metric(
      '49.3',
      'cymbal edits per 100 cymbal notes, this tool',
      CHART_FLOW_PROV,
    ),
    adtof: metric(
      '135.9',
      'cymbal edits per 100 cymbal notes, ADTOF',
      ADTOF_CHART_FLOW_PROV,
    ),
    octave: metric(
      '236.4',
      'cymbal edits per 100 cymbal notes, Octave',
      CHART_FLOW_PROV,
    ),
  },
];

/** Starting from audio: the notes plus the tempo map made from the song. */
export const GENERATED_TEMPO_MAP_ROWS: readonly ComparisonRow[] = [
  {
    family: 'Whole chart',
    ours: metric(
      '34.8',
      'edits per 100 notes when this tool starts from audio',
      AUDIO_FLOW_PROV,
    ),
    adtof: metric(
      '54.5',
      'edits per 100 notes when ADTOF places the notes and this tool makes the tempo map',
      ADTOF_AUDIO_FLOW_PROV,
    ),
    octave: metric(
      '154.1',
      'edits per 100 notes when Octave starts from audio',
      AUDIO_FLOW_PROV,
    ),
  },
  {
    family: 'Kick',
    ours: metric(
      '24.4',
      'kick edits per 100 kick notes when this tool starts from audio',
      AUDIO_FLOW_PROV,
    ),
    adtof: metric(
      '30.3',
      'kick edits per 100 kick notes when ADTOF places the notes and this tool makes the tempo map',
      ADTOF_AUDIO_FLOW_PROV,
    ),
    octave: metric(
      '145.9',
      'kick edits per 100 kick notes when Octave starts from audio',
      AUDIO_FLOW_PROV,
    ),
  },
  {
    family: 'Snare',
    ours: metric(
      '30.2',
      'snare edits per 100 snare notes when this tool starts from audio',
      AUDIO_FLOW_PROV,
    ),
    adtof: metric(
      '37.4',
      'snare edits per 100 snare notes when ADTOF places the notes and this tool makes the tempo map',
      ADTOF_AUDIO_FLOW_PROV,
    ),
    octave: metric(
      '153.6',
      'snare edits per 100 snare notes when Octave starts from audio',
      AUDIO_FLOW_PROV,
    ),
  },
  {
    family: 'Hi-hat',
    ours: metric(
      '40.3',
      'hi-hat edits per 100 hi-hat notes when this tool starts from audio',
      AUDIO_FLOW_PROV,
    ),
    adtof: metric(
      '69.9',
      'hi-hat edits per 100 hi-hat notes when ADTOF places the notes and this tool makes the tempo map',
      ADTOF_AUDIO_FLOW_PROV,
    ),
    octave: metric(
      '158.8',
      'hi-hat edits per 100 hi-hat notes when Octave starts from audio',
      AUDIO_FLOW_PROV,
    ),
  },
  {
    family: 'Toms',
    ours: metric(
      '89.6',
      'tom edits per 100 tom notes when this tool starts from audio',
      AUDIO_FLOW_PROV,
    ),
    adtof: metric(
      '155.6',
      'tom edits per 100 tom notes when ADTOF places the notes and this tool makes the tempo map',
      ADTOF_AUDIO_FLOW_PROV,
    ),
    octave: metric(
      '109.3',
      'tom edits per 100 tom notes when Octave starts from audio',
      AUDIO_FLOW_PROV,
    ),
  },
  {
    family: 'Cymbals',
    ours: metric(
      '64.9',
      'cymbal edits per 100 cymbal notes when this tool starts from audio',
      AUDIO_FLOW_PROV,
    ),
    adtof: metric(
      '151.4',
      'cymbal edits per 100 cymbal notes when ADTOF places the notes and this tool makes the tempo map',
      ADTOF_AUDIO_FLOW_PROV,
    ),
    octave: metric(
      '241.8',
      'cymbal edits per 100 cymbal notes when Octave starts from audio',
      AUDIO_FLOW_PROV,
    ),
  },
];
