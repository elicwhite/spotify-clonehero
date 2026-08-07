/**
 * Every measured figure this landing page states, with its provenance.
 *
 * Figures are drafted from the current state of the drum-to-chart research
 * repo, never carried over from an older revision of this page. Each entry
 * names the script that produced it and what it was measured on.
 *
 * `provisional` means the figure has not been re-confirmed on the current
 * pipeline. Provisional figures render with a visible marker on the page, not
 * only in this file.
 */
import type {
  LandingMetric,
  LandingProvenance,
} from '@/components/landing/StatChip';

/** The shipped transcription model these figures describe. */
export const MODEL_CHECKPOINT = 't5 (armA_s0), eight lanes';

export const DATA_DISCLAIMER =
  'These scores are measured as of 2026-07-18.';

const P = (
  script: string,
  measuredOn: string,
  asOf: string,
  provisional: boolean,
  note?: string,
): LandingProvenance => ({
  script,
  measuredOn,
  asOf,
  provisional,
  ...(note !== undefined ? {note} : {}),
});

/**
 * Provenance shared by every measured cell of the comparison table. The page's
 * footnote stays short, so the eval details live here: the reference the songs
 * were scored against, whose conventions those are, and which system's training
 * data they overlap.
 */
const COMPARISON_PROV = (note?: string) =>
  P(
    'analysis/strum_comparison/',
    '73 songs scored against this project’s reference charts and lane names, which are its conventions and not a neutral standard. Most of the 73 sit inside STRUM’s training data and outside this model’s. Measured on the previously deployed model.',
    '2026-07-18',
    true,
    note,
  );

export const METRICS = {
  comparisonOverallOurs: {
    value: '0.285',
    label: 'edits per note, this tool',
    prov: COMPARISON_PROV(
      'the full draft chart, as it would open in the editor',
    ),
  },
  comparisonOverallOctave: {
    value: '1.486',
    label: 'edits per note, Octave',
    prov: COMPARISON_PROV(
      'STRUM’s chart after Octave’s shipped tempo refit and snap, the chart a user receives',
    ),
  },
} as const satisfies Record<string, LandingMetric>;

export type MetricId = keyof typeof METRICS;

/** A per-family row of the comparison table. Provenance is the footnote. */
export interface FamilyRow {
  family: string;
  ours: string;
  octave: string;
}

/**
 * Per-family edits per note, chart-flow, Arm A (n = 73).
 * Source: wiki/strum-comparison.md, "Per-family edit/GT ratio (chart-flow)".
 *
 * ADTOF has no per-family cells yet: a fresh measurement on the same songs was
 * requested (drum-to-chart docs/requests/2026-08-06-landing-page-comparison-data.md)
 * and the table renders a pending placeholder until that run lands.
 */
export const COMPARISON_FAMILY_ROWS: readonly FamilyRow[] = [
  {family: 'Kick', ours: '0.15', octave: '1.38'},
  {family: 'Snare', ours: '0.23', octave: '1.45'},
  {family: 'Hi-hat', ours: '0.43', octave: '1.50'},
  {family: 'Toms', ours: '0.89', octave: '1.03'},
  {family: 'Cymbals', ours: '0.62', octave: '2.66'},
];
