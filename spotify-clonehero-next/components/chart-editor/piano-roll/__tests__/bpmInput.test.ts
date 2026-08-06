/**
 * The BPM entry field's pure rules: what parses, what the bounds reject, and
 * how a marker's stored value is seeded back into the field.
 */

import {MAX_BPM, MIN_BPM, formatBpmSeed, parseBpmInput} from '../bpmInput';

describe('parseBpmInput', () => {
  it('accepts a decimal without rounding it', () => {
    expect(parseBpmInput('140.5')).toEqual({ok: true, bpm: 140.5});
    expect(parseBpmInput('  92.125  ')).toEqual({ok: true, bpm: 92.125});
  });

  it('accepts the bounds themselves', () => {
    expect(parseBpmInput(String(MIN_BPM))).toEqual({ok: true, bpm: MIN_BPM});
    expect(parseBpmInput(String(MAX_BPM))).toEqual({ok: true, bpm: MAX_BPM});
  });

  it('rejects a tempo of zero, which would stop chart time', () => {
    expect(parseBpmInput('0')).toEqual({
      ok: false,
      error: `BPM must be ${MIN_BPM}-${MAX_BPM}`,
    });
  });

  it('rejects negatives and out-of-range values', () => {
    expect(parseBpmInput('-120').ok).toBe(false);
    expect(parseBpmInput('0.5').ok).toBe(false);
    expect(parseBpmInput('1000').ok).toBe(false);
  });

  it('rejects empty and non-numeric input', () => {
    expect(parseBpmInput('')).toEqual({ok: false, error: 'Enter a BPM'});
    expect(parseBpmInput('   ')).toEqual({ok: false, error: 'Enter a BPM'});
    expect(parseBpmInput('fast')).toEqual({ok: false, error: 'Enter a number'});
    expect(parseBpmInput('12abc').ok).toBe(false);
    expect(parseBpmInput('Infinity').ok).toBe(false);
    expect(parseBpmInput('NaN').ok).toBe(false);
  });
});

describe('formatBpmSeed', () => {
  it('shows a whole tempo with one decimal', () => {
    expect(formatBpmSeed(120)).toBe('120.0');
  });

  it('keeps a stored value that carries more precision', () => {
    expect(formatBpmSeed(140.125)).toBe('140.125');
    expect(formatBpmSeed(92.5)).toBe('92.5');
    expect(formatBpmSeed(92.12)).toBe('92.12');
  });

  it('round-trips back through the parser unchanged', () => {
    for (const bpm of [120, 140.125, 92.5, 63.004]) {
      expect(parseBpmInput(formatBpmSeed(bpm))).toEqual({ok: true, bpm});
    }
  });
});
