import {
  parseGrooveFingerprint,
  scoreGrooveDifficulty,
} from '../detection/grooveDifficulty';

// Canonical fingerprints (slot:mask over a 48/bar grid). kick=1 snare=2 hat=4.
// Straight-8ths backbeat: hat every 8th, kick on beats 1&3, snare on 2&4.
const BACKBEAT_8THS = '0:5|6:4|12:6|18:4|24:5|30:4|36:6|42:4';
// Same shape but a 16th-note hi-hat (twice the cymbal density).
const BACKBEAT_16THS =
  '0:5|3:4|6:4|9:4|12:6|15:4|18:4|21:4|24:5|27:4|30:4|33:4|36:6|39:4|42:4|45:4';
// 16th hat + syncopated/extra kicks and a double-kick (hardest).
const SYNCOPATED =
  '0:5|3:1|6:4|9:5|12:6|15:4|18:5|21:4|24:5|27:1|30:4|33:5|36:6|39:4|42:5|45:4';

describe('parseGrooveFingerprint', () => {
  it('parses slot:mask onsets and sorts by slot', () => {
    expect(parseGrooveFingerprint('12:6|0:5')).toEqual([
      {slot: 0, mask: 5},
      {slot: 12, mask: 6},
    ]);
  });

  it('returns [] for empty or malformed input', () => {
    expect(parseGrooveFingerprint('')).toEqual([]);
    expect(parseGrooveFingerprint('gfp')).toEqual([]);
  });
});

describe('scoreGrooveDifficulty', () => {
  it('returns 0 for an empty fingerprint', () => {
    expect(scoreGrooveDifficulty('', 120)).toBe(0);
  });

  it('ranks 8ths < 16ths < syncopated at the same tempo', () => {
    const easy = scoreGrooveDifficulty(BACKBEAT_8THS, 120);
    const mid = scoreGrooveDifficulty(BACKBEAT_16THS, 120);
    const hard = scoreGrooveDifficulty(SYNCOPATED, 120);
    expect(easy).toBeLessThan(mid);
    expect(mid).toBeLessThan(hard);
  });

  it('scores the same pattern higher at a faster tempo', () => {
    const slow = scoreGrooveDifficulty(BACKBEAT_16THS, 100);
    const fast = scoreGrooveDifficulty(BACKBEAT_16THS, 190);
    expect(fast).toBeGreaterThan(slow);
  });

  it('stays within 0-100', () => {
    for (const fp of [BACKBEAT_8THS, BACKBEAT_16THS, SYNCOPATED]) {
      for (const bpm of [60, 120, 240]) {
        const s = scoreGrooveDifficulty(fp, bpm);
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(100);
      }
    }
  });
});
