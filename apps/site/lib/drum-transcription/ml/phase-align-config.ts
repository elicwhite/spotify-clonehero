/**
 * Tunable lever config for the PHASE-ALIGN step (audio-flow only).
 *
 * Per-song global note-phase self-alignment: sweep a bounded time shift over
 * the predicted onsets and apply it, before tick-snapping, only when the
 * shift resolves a decisively misaligned song onto strong metrical grid
 * positions. See lib/drum-transcription/pipeline/phase-align.ts for the
 * ported objective/gate (source: drum-to-chart's
 * analysis/probe_phase_self_alignment_v2.py and
 * wiki/phase-align-v2-spec.md's t4-specific section).
 *
 * RULED DEFAULT (Eli, 2026-07-14): the t4 gate's 7.1%-coverage point —
 * `baselineMassMax=0.20, ratioMin=4.0, postMassMin=0.4` — zero P10 AND P25
 * best-quartile regressions on t4 (the spec's dual-veto stress test), a
 * strictly better default than System C ever offered at any coverage level.
 *
 * Other swept points on t4 (for one-line tuning — see the spec's t4 table):
 *   - 0.15 / 6.0 / 0.4  = System C's exact gate, "strict": 3.0% coverage,
 *     0 P10/P25 regressions (most conservative clean point).
 *   - 0.25 / 3.0 / 0.4  = 14.4% coverage, 1 P25 regression (2 all-applied),
 *     first point where the coverage/regression tradeoff kicks in.
 *   - 0.30 / 2.0 / 0.4  = 23.3% coverage (broadest swept), 1 P25 regression,
 *     4 all-applied — same single P25 regression as 0.25/3.0, more coverage
 *     for the same bounded risk.
 */
export interface PhaseAlignGateConfig {
  /** Master on/off switch for the whole lever. */
  enabled: boolean;
  /** Condition (a): apply only if the unshifted on-grid metrical mass is at
   * or below this (song is genuinely misaligned as-is). */
  baselineMassMax: number;
  /** Condition (b): apply only if bestMass / baselineMass is at or above
   * this (the improvement is decisive, not a marginal nudge). */
  ratioMin: number;
  /** Condition (c): apply only if the post-shift mass is at or above this
   * (the shift actually resolves onsets onto the grid). */
  postMassMin: number;
}

export const DEFAULT_PHASE_ALIGN_CONFIG: PhaseAlignGateConfig = {
  enabled: true,
  baselineMassMax: 0.2,
  ratioMin: 4.0,
  postMassMin: 0.4,
};

/** localStorage key for the dev override (read once at pipeline start). */
export const PHASE_ALIGN_GATE_STORAGE_KEY = 'phaseAlignGate';

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Load the phase-align gate config, applying a localStorage dev override
 * (key {@link PHASE_ALIGN_GATE_STORAGE_KEY}) on top of
 * {@link DEFAULT_PHASE_ALIGN_CONFIG} if present.
 *
 * Read-once: call this at pipeline start and thread the result through, not
 * per-song — a mid-run change shouldn't retroactively affect songs already
 * scored. Malformed or partial overrides fall back to the default per-field
 * (a bad `ratioMin` doesn't invalidate a valid `enabled`), so a typo in
 * localStorage can never crash the pipeline or silently corrupt the gate
 * with `NaN`/`undefined`.
 */
export function loadPhaseAlignConfig(): PhaseAlignGateConfig {
  if (typeof localStorage === 'undefined') return DEFAULT_PHASE_ALIGN_CONFIG;

  let raw: string | null;
  try {
    raw = localStorage.getItem(PHASE_ALIGN_GATE_STORAGE_KEY);
  } catch {
    return DEFAULT_PHASE_ALIGN_CONFIG;
  }
  if (!raw) return DEFAULT_PHASE_ALIGN_CONFIG;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_PHASE_ALIGN_CONFIG;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return DEFAULT_PHASE_ALIGN_CONFIG;
  }
  const p = parsed as Record<string, unknown>;

  return {
    enabled:
      typeof p['enabled'] === 'boolean'
        ? p['enabled']
        : DEFAULT_PHASE_ALIGN_CONFIG.enabled,
    baselineMassMax: isFiniteNumber(p['baselineMassMax'])
      ? p['baselineMassMax']
      : DEFAULT_PHASE_ALIGN_CONFIG.baselineMassMax,
    ratioMin: isFiniteNumber(p['ratioMin'])
      ? p['ratioMin']
      : DEFAULT_PHASE_ALIGN_CONFIG.ratioMin,
    postMassMin: isFiniteNumber(p['postMassMin'])
      ? p['postMassMin']
      : DEFAULT_PHASE_ALIGN_CONFIG.postMassMin,
  };
}
