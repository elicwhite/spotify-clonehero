/**
 * Every measured figure the /tempo landing page states, with its provenance.
 *
 * Figures are drafted from the current state of the drum-to-chart research
 * repo, never carried over from an older revision of this page. Each entry
 * names the source that produced it and what it was measured on.
 *
 * `provisional` means the figure has not been re-confirmed on the current
 * pipeline. Provisional figures render with a visible marker on the page, not
 * only in this file.
 *
 * Scale discipline: quality figures here come from 1,022 to 1,960-song sets.
 * Only the corpus-composition figures describe the large corpus, and they say
 * nothing about output quality. Breakdowns this page wanted and could not
 * source (works/doesn't-work rate at full-corpus scale, per-genre and
 * per-time-signature strata on the shipped grid stack) were requested in
 * drum-to-chart docs/requests/2026-08-06-tempo-landing-page-data.md; until
 * they land the page states only what is measured below.
 */
import type {
  LandingMetric,
  LandingProvenance,
} from '@/components/landing/StatChip';

/** The grid stack these figures describe. */
export const GRID_STACK =
  'Beat This! + DBA converter, KS-warp / REACH-EXTENSION finalize';

export const DATA_DISCLAIMER =
  'These figures describe the pipeline as of the dates given. The system is under active development. Figures marked provisional were measured before the current grid stack and transcription checkpoint shipped, and have not been re-run on them.';

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
 * The two meter medians come from the same heldout run, so they share a
 * provenance body. The score they report is `chart_f1_abs`, which slots
 * detected onsets by integer beat index and ignores time-signature
 * numerators entirely; that is why the page can say a low score here is a
 * beat-grid failure rather than a wrong time-signature marker.
 */
const METER_PROV = (note: string) =>
  P(
    'autoresearch-tempo/PHASE_SUMMARY.md (METER section); wiki/autoresearch-tempo.md §METER',
    '~1,500-song heldout set, split by whether the reference chart changes meter or leaves 4/4. Score is chart_f1_abs, which is time-signature-independent. Measured at the phase-open gate, before the origin re-anchor and the KS-warp grid stack shipped.',
    '2026-07-03',
    true,
    note,
  );

/**
 * Post-snap battery on the full 1,022-song corpus at the REACH-EXTENSION
 * guard-alone ship point. Source: wiki/autoresearch-tempo-grid.md Phase B,
 * commit 2f227d7.
 */
const GRID_PHASE_B_PROV = (note: string) =>
  P(
    'wiki/autoresearch-tempo-grid.md Phase B (commit 2f227d7)',
    '1,022-song corpus, audio-flow post-snap battery, KS-warp / REACH-EXTENSION guard-alone. Measured on the previously deployed transcription checkpoint.',
    '2026-07-16',
    true,
    note,
  );

export const METRICS = {
  meterSteady: {
    value: '0.445',
    label: 'median grid score, constant 4/4',
    prov: METER_PROV(
      'songs whose reference chart stays in 4/4 for the whole song',
    ),
  },
  meterDiverse: {
    value: '0.000',
    label: 'median grid score, meter changes or odd time',
    prov: METER_PROV(
      'songs whose reference chart changes meter or is not 4/4; a zero here is a beat-grid failure, not a time-signature-marker failure',
    ),
  },
  keepable: {
    value: '84.6%',
    label: 'of predicted maps were worth keeping',
    prov: GRID_PHASE_B_PROV(
      'the map-sanity gate the product uses for "worth keeping at all"; the remaining ~15% are maps the product model expects you to discard',
    ),
  },
  catastrophic: {
    value: '15.1%',
    label: 'of grids were catastrophic',
    prov: P(
      'probe_gridalign_killgate.py (g6_cohort_split); cross-referenced by probe_partc_eq2_crossref.py, commit a0fd0b7',
      '1,071-song set. Near-beat-multiple cohort definition. Split 46% single-beat phase error (n = 75) / 54% octave-class (n = 87); most of the octave-class songs are a downbeat slip rather than a clean tempo ratio.',
      '2026-07-13',
      true,
    ),
  },
  octave: {
    value: '~5%',
    label: 'of songs come out at double or half tempo',
    prov: P(
      'F84 charter grid-divergence decomposition, commit 1df050b; wiki/autoresearch-tempo.md §F84',
      'the doubled/halved class, called out there as the only divergence class a listener notices in the audio flow',
      '2026-07-11',
      true,
    ),
  },
  meterFlagAuc: {
    value: '0.76',
    label: 'separation between the two groups (AUC)',
    prov: P(
      'autoresearch-tempo/analysis/ts_meter_confidence_probe.py',
      'drum-to-chart heldout set, against reference non-4/4 labels. Flagged songs median grid score 0.000 vs 0.452 unflagged; about 26% of charted songs flag. Shipped as lib/tempo-map/meter-confidence.ts.',
      '2026-07-03',
      true,
    ),
  },
  meterFlagRate: {
    value: '~26%',
    label: 'of songs get the irregular-meter flag',
    prov: P(
      'autoresearch-tempo/analysis/ts_meter_confidence_probe.py',
      'drum-to-chart heldout set of charted songs. The same run that validated the flag: flagged songs had a median grid score of 0.000 vs 0.452 unflagged (AUC 0.76 against reference non-4/4 labels). Shipped as lib/tempo-map/meter-confidence.ts.',
      '2026-07-03',
      true,
    ),
  },
  downbeatF1: {
    value: '0.58',
    label: 'downbeat detection score',
    prov: P(
      'wiki/autoresearch-tempo.md §METER, numerator/TS probe',
      'the METER phase ruled-out probes, on the same heldout set. The weakest link in the chain the time signatures are derived from.',
      '2026-07-03',
      true,
    ),
  },
  markersPredicted: {
    value: '556',
    label: 'markers, predicted map',
    prov: GRID_PHASE_B_PROV(
      'the warped map has roughly one marker per beat; collapsing it into a few sections was measured and made the map worse, so the density stays',
    ),
  },
  markersHuman: {
    value: '37',
    label: 'markers, hand-authored chart',
    prov: GRID_PHASE_B_PROV(
      'the reference chart for the same songs, as its charter wrote it',
    ),
  },
  gtzanBeat: {
    value: '89.0',
    label: 'beat score on GTZAN',
    prov: P(
      'analysis/gtzan_beat_eval/ (baseline + A′ runners, scorer); wiki/gtzan-beat-eval.md',
      'GTZAN test-only, 999 annotated tracks, the protocol the Beat This! paper uses (mir_eval F1 at ±70 ms, per-piece mean, checkpoint held out from GTZAN). The published with-decoder row for the same model is 88.1.',
      '2026-07-20',
      false,
    ),
  },
  consistent: {
    value: '92.5%',
    label: 'of predicted maps pass an internal-consistency check',
    prov: P(
      'probe_partc_predgrid_quotient.py, commit 65b736b (fixed 94873c8)',
      '1,071 songs. The windowed-residual consistency discriminator from the human-floor work, applied to the model’s own predicted grids. Passing it does not mean being close to the reference: about 97% of the remaining gap is genuine grid error rather than a difference of charting convention.',
      '2026-07-13',
      true,
    ),
  },
  tempoStabilityNull: {
    value: 'no measurable link',
    label: 'between tempo-change frequency and grid quality',
    prov: P(
      'wiki/autoresearch-tempo.md §Slip-FT Tier-0 (ruled-out levers table)',
      'correlation test between grid-cost differential and BPM / tempo-change count, on the same tempo-quality analysis as the meter medians. Meter (4/4 vs not) was the strong correlate; tempo-change frequency was not.',
      '2026-07-03',
      true,
    ),
  },
  corpusMeterDiverse: {
    value: '~32%',
    label: 'of the corpus changes meter or is not 4/4',
    prov: P(
      'wiki/autoresearch-tempo.md §METER (stratum definition)',
      'corpus composition, from the reference charts’ own time signatures. This describes what songs look like, not how well the tool does on them.',
      '2026-07-03',
      false,
    ),
  },
  corpusMajority4: {
    value: '91.5%',
    label: 'of songs are majority 4/4',
    prov: P(
      'wiki/autoresearch-tempo.md (TS-change detection leverage cap)',
      'corpus composition, from the reference charts’ own time signatures. A song can be majority 4/4 and still change meter, so this and the figure beside it are not complements.',
      '2026-07-03',
      false,
    ),
  },
} as const satisfies Record<string, LandingMetric>;

export type MetricId = keyof typeof METRICS;
