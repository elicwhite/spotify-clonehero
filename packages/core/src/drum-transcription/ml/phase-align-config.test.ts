/**
 * @jest-environment jsdom
 */
import {
  DEFAULT_PHASE_ALIGN_CONFIG,
  PHASE_ALIGN_GATE_STORAGE_KEY,
  loadPhaseAlignConfig,
} from './phase-align-config';

describe('loadPhaseAlignConfig', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns the ruled default (7.1%-coverage point) when no override is stored', () => {
    expect(loadPhaseAlignConfig()).toEqual({
      enabled: true,
      baselineMassMax: 0.2,
      ratioMin: 4.0,
      postMassMin: 0.4,
    });
    expect(loadPhaseAlignConfig()).toEqual(DEFAULT_PHASE_ALIGN_CONFIG);
  });

  it('applies a full valid override', () => {
    localStorage.setItem(
      PHASE_ALIGN_GATE_STORAGE_KEY,
      JSON.stringify({
        enabled: true,
        baselineMassMax: 0.3,
        ratioMin: 2.0,
        postMassMin: 0.4,
      }),
    );
    expect(loadPhaseAlignConfig()).toEqual({
      enabled: true,
      baselineMassMax: 0.3,
      ratioMin: 2.0,
      postMassMin: 0.4,
    });
  });

  it('applies a partial override, falling back to defaults per-field', () => {
    localStorage.setItem(
      PHASE_ALIGN_GATE_STORAGE_KEY,
      JSON.stringify({enabled: false}),
    );
    expect(loadPhaseAlignConfig()).toEqual({
      ...DEFAULT_PHASE_ALIGN_CONFIG,
      enabled: false,
    });
  });

  it('falls back to defaults for a field with the wrong type, without invalidating the rest', () => {
    localStorage.setItem(
      PHASE_ALIGN_GATE_STORAGE_KEY,
      JSON.stringify({ratioMin: 'not-a-number', postMassMin: 0.5}),
    );
    expect(loadPhaseAlignConfig()).toEqual({
      ...DEFAULT_PHASE_ALIGN_CONFIG,
      postMassMin: 0.5,
    });
  });

  it('falls back to defaults for NaN/Infinity numeric fields', () => {
    localStorage.setItem(
      PHASE_ALIGN_GATE_STORAGE_KEY,
      JSON.stringify({baselineMassMax: null}),
    );
    expect(loadPhaseAlignConfig().baselineMassMax).toBe(
      DEFAULT_PHASE_ALIGN_CONFIG.baselineMassMax,
    );
  });

  it('falls back to defaults entirely on malformed JSON', () => {
    localStorage.setItem(PHASE_ALIGN_GATE_STORAGE_KEY, '{not valid json');
    expect(loadPhaseAlignConfig()).toEqual(DEFAULT_PHASE_ALIGN_CONFIG);
  });

  it('falls back to defaults on a non-object JSON value (e.g. a bare number or array)', () => {
    localStorage.setItem(PHASE_ALIGN_GATE_STORAGE_KEY, '42');
    expect(loadPhaseAlignConfig()).toEqual(DEFAULT_PHASE_ALIGN_CONFIG);

    localStorage.setItem(PHASE_ALIGN_GATE_STORAGE_KEY, '[1,2,3]');
    // An array is typeof 'object' and not null, so it passes the object
    // guard; every field lookup on it is undefined and falls back to
    // defaults just like any other object missing all known keys.
    expect(loadPhaseAlignConfig()).toEqual(DEFAULT_PHASE_ALIGN_CONFIG);
  });
});
