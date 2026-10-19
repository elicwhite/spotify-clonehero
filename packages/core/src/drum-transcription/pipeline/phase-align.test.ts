import {
  metricalMass,
  computePhaseAlignShiftMs,
  STRONG_POSITIONS,
  TOL_BEAT,
  MIN_ONSETS_FOR_SEARCH,
} from './phase-align';
import {buildTimedTempos} from '../timing';
import {DEFAULT_PHASE_ALIGN_CONFIG} from '../ml/phase-align-config';
import type {PhaseAlignGateConfig} from '../ml/phase-align-config';

// Flat 120 BPM, resolution 480: 1 beat (quarter note) = 500ms exactly, so
// beta = ms / 500 and every fixture below can be reasoned about in whole
// beats without rounding noise.
const RESOLUTION = 480;
const BPM = 120;
const MS_PER_BEAT = 500;
const timedTempos = buildTimedTempos(
  [{tick: 0, beatsPerMinute: BPM}],
  RESOLUTION,
);

describe('metricalMass', () => {
  it('scores an onset exactly on the downbeat at the quarter weight (1.0)', () => {
    expect(metricalMass([0.0])).toBeCloseTo(1.0, 6);
    expect(metricalMass([3.0])).toBeCloseTo(1.0, 6); // integer beat -> frac 0
  });

  it('scores an onset exactly on the "&" 8th at its weight (0.6)', () => {
    expect(metricalMass([0.5])).toBeCloseTo(0.6, 6);
  });

  it('scores an onset exactly on the "e"/"a" 8th-adjacent position at its weight (0.3)', () => {
    expect(metricalMass([0.25])).toBeCloseTo(0.3, 6);
    expect(metricalMass([0.75])).toBeCloseTo(0.3, 6);
  });

  it('scores an onset on a weak 16th position at its weight (0.15)', () => {
    expect(metricalMass([0.125])).toBeCloseTo(0.15, 6);
    expect(metricalMass([0.875])).toBeCloseTo(0.15, 6);
  });

  it('scores a genuinely off-grid onset at 0 (outside every tolerance window)', () => {
    // 0.2 beat is >TOL_BEAT (~0.0417) from every strong position (nearest are
    // 0.125 at 0.075 away and 0.25 at 0.05 away).
    expect(metricalMass([0.2])).toBe(0);
  });

  it('averages weighted membership across onsets (mean, not sum)', () => {
    expect(metricalMass([0.0, 0.5])).toBeCloseTo((1.0 + 0.6) / 2, 6);
    expect(metricalMass([0.0, 0.5, 0.2])).toBeCloseTo((1.0 + 0.6 + 0) / 3, 6);
  });

  it('is invariant to which integer beat an onset falls in (mod-1 phase only)', () => {
    expect(metricalMass([0.0])).toBeCloseTo(metricalMass([7.0]), 6);
    expect(metricalMass([-0.125])).toBeCloseTo(metricalMass([0.875]), 6);
  });

  it('respects a tighter tolerance than the default', () => {
    // 0.03 beat from the downbeat: within the default TOL_BEAT (~0.0417) but
    // outside a tighter tol of 0.01.
    expect(metricalMass([0.03], TOL_BEAT)).toBeCloseTo(1.0, 6);
    expect(metricalMass([0.03], 0.01)).toBe(0);
  });

  it('STRONG_POSITIONS matches the ported spec table exactly', () => {
    expect(Object.fromEntries(STRONG_POSITIONS)).toEqual({
      0: 1.0,
      0.5: 0.6,
      0.25: 0.3,
      0.75: 0.3,
      0.125: 0.15,
      0.375: 0.15,
      0.625: 0.15,
      0.875: 0.15,
    });
  });
});

describe('computePhaseAlignShiftMs — gate behavior', () => {
  const N = 12;

  it('Rooftops-class fixture: notes uniformly one 32nd-note early -> gate FIRES and the shift recovers the offset onto a strong position', () => {
    // One 32nd note = 1/8 beat = 62.5ms at 120 BPM. Every onset sits at
    // beat phase (k - 0.125) = frac 0.875 (a real, matched weak 16th
    // position, weight 0.15) — exactly Eli's Rooftops scenario ("every
    // note the 32nd before the beat").
    const onsets: number[] = [];
    for (let k = 1; k <= N; k++) onsets.push(k * MS_PER_BEAT - 62.5);

    const result = computePhaseAlignShiftMs(
      onsets,
      timedTempos,
      RESOLUTION,
      DEFAULT_PHASE_ALIGN_CONFIG,
    );

    expect(result.noshiftScore).toBeCloseTo(0.15, 6);
    expect(result.applied).toBe(true);
    expect(result.bestScore).toBeCloseTo(1.0, 6);
    expect(result.bestScore / result.noshiftScore).toBeGreaterThanOrEqual(
      DEFAULT_PHASE_ALIGN_CONFIG.ratioMin,
    );

    // Applying the shift must land every onset within TOL_BEAT of the
    // downbeat (a strong metrical position) — i.e. what the pipeline then
    // hands to tick-snapping resolves cleanly onto the grid.
    const toleranceMs = TOL_BEAT * MS_PER_BEAT;
    for (const t of onsets) {
      const shifted = t + result.shiftMs;
      const beat = shifted / MS_PER_BEAT;
      const distToNearestBeat = Math.abs(beat - Math.round(beat));
      expect(distToNearestBeat * MS_PER_BEAT).toBeLessThanOrEqual(
        toleranceMs + 1e-6,
      );
    }
  });

  it('well-aligned fixture: notes already on the downbeat -> gate does NOT fire', () => {
    const onsets: number[] = [];
    for (let k = 1; k <= N; k++) onsets.push(k * MS_PER_BEAT);

    const result = computePhaseAlignShiftMs(
      onsets,
      timedTempos,
      RESOLUTION,
      DEFAULT_PHASE_ALIGN_CONFIG,
    );

    expect(result.noshiftScore).toBeCloseTo(1.0, 6);
    expect(result.noshiftScore).toBeGreaterThan(
      DEFAULT_PHASE_ALIGN_CONFIG.baselineMassMax,
    );
    expect(result.applied).toBe(false);
    expect(result.shiftMs).toBe(0);
  });

  it("consistent-weak-position fixture (all onsets on the 'e' 16th, beat phase 0.25) -> gate does NOT fire because baseline mass already clears the threshold", () => {
    // Every onset sits exactly on beat phase 0.25 ("e" of "1 e & a") — a
    // real, legitimate, consistently-used metrical position (weight 0.3),
    // not phase noise. A naive ratio-only gate would still find a shift to
    // the downbeat with a big ratio; the ported gate's baseline-mass
    // condition (a) must block it because 0.3 > baselineMassMax (0.2).
    const onsets: number[] = [];
    for (let k = 0; k < N; k++) onsets.push(k * MS_PER_BEAT + 125);

    const result = computePhaseAlignShiftMs(
      onsets,
      timedTempos,
      RESOLUTION,
      DEFAULT_PHASE_ALIGN_CONFIG,
    );

    expect(result.noshiftScore).toBeCloseTo(0.3, 6);
    expect(result.noshiftScore).toBeGreaterThan(
      DEFAULT_PHASE_ALIGN_CONFIG.baselineMassMax,
    );
    expect(result.applied).toBe(false);
    expect(result.shiftMs).toBe(0);
  });

  it('abstains (shiftMs=0, applied=false) with fewer than MIN_ONSETS_FOR_SEARCH onsets, even for an otherwise-decisive misalignment', () => {
    const onsets: number[] = [];
    for (let k = 1; k < MIN_ONSETS_FOR_SEARCH; k++) {
      onsets.push(k * MS_PER_BEAT - 62.5); // same Rooftops-class offset
    }
    expect(onsets.length).toBeLessThan(MIN_ONSETS_FOR_SEARCH);

    const result = computePhaseAlignShiftMs(
      onsets,
      timedTempos,
      RESOLUTION,
      DEFAULT_PHASE_ALIGN_CONFIG,
    );
    expect(result).toEqual({
      shiftMs: 0,
      applied: false,
      bestScore: 0,
      noshiftScore: 0,
    });
  });

  it('respects enabled=false regardless of how decisive the misalignment is', () => {
    const onsets: number[] = [];
    for (let k = 1; k <= N; k++) onsets.push(k * MS_PER_BEAT - 62.5);
    const disabled: PhaseAlignGateConfig = {
      ...DEFAULT_PHASE_ALIGN_CONFIG,
      enabled: false,
    };
    const result = computePhaseAlignShiftMs(
      onsets,
      timedTempos,
      RESOLUTION,
      disabled,
    );
    expect(result.applied).toBe(false);
    expect(result.shiftMs).toBe(0);
  });

  it('a stricter gate (System C exact: 0.15/6.0/0.4) blocks the Rooftops fixture at exactly its noshiftScore boundary', () => {
    // The Rooftops fixture's noshiftScore is exactly 0.15, the System-C
    // strict gate's baselineMassMax boundary — `<=` must include it.
    const onsets: number[] = [];
    for (let k = 1; k <= N; k++) onsets.push(k * MS_PER_BEAT - 62.5);
    const strict: PhaseAlignGateConfig = {
      enabled: true,
      baselineMassMax: 0.15,
      ratioMin: 6.0,
      postMassMin: 0.4,
    };
    const result = computePhaseAlignShiftMs(
      onsets,
      timedTempos,
      RESOLUTION,
      strict,
    );
    expect(result.applied).toBe(true);
  });
});
