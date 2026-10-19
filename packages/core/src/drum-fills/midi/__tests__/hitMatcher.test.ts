import {
  matchHits,
  DEFAULT_WINDOWS,
  type ExpectedNote,
  type TimedHit,
} from '../hitMatcher';

function note(
  id: string | number,
  msTime: number,
  lane: ExpectedNote['lane'],
  isCymbal = false,
): ExpectedNote {
  return {id, msTime, lane, isCymbal};
}

function hit(
  msTime: number,
  lane: TimedHit['lane'],
  isCymbal = false,
): TimedHit {
  return {msTime, lane, isCymbal};
}

describe('matchHits', () => {
  it('judges an exact hit as perfect', () => {
    const res = matchHits([note('a', 1000, 'red')], [hit(1000, 'red')]);
    expect(res.judgments[0].judgment).toBe('perfect');
    expect(res.judgments[0].deltaMs).toBe(0);
    expect(res.counts).toEqual({perfect: 1, good: 0, miss: 0, extra: 0});
  });

  it('classifies windows: perfect ≤50, good ≤70, miss otherwise', () => {
    const notes = [
      note('p', 1000, 'red'),
      note('g', 2000, 'red'),
      note('m', 3000, 'red'),
    ];
    const hits = [hit(1025, 'red'), hit(2065, 'red'), hit(3100, 'red')];
    const res = matchHits(notes, hits);
    expect(res.judgments[0].judgment).toBe('perfect'); // 25ms
    expect(res.judgments[1].judgment).toBe('good'); // 65ms
    expect(res.judgments[2].judgment).toBe('miss'); // 100ms out of window
    // The 3100 hit becomes an extra (no note in range).
    expect(res.counts.extra).toBe(1);
  });

  it('perfect/good boundary at ±50ms (late and early)', () => {
    // 49ms inside, 51ms outside the perfect window — both still hits.
    expect(
      matchHits([note('a', 1000, 'red')], [hit(1049, 'red')]).judgments[0]
        .judgment,
    ).toBe('perfect');
    expect(
      matchHits([note('a', 1000, 'red')], [hit(1051, 'red')]).judgments[0]
        .judgment,
    ).toBe('good');
    // Symmetric early side.
    expect(
      matchHits([note('a', 1000, 'red')], [hit(951, 'red')]).judgments[0]
        .judgment,
    ).toBe('perfect');
    expect(
      matchHits([note('a', 1000, 'red')], [hit(949, 'red')]).judgments[0]
        .judgment,
    ).toBe('good');
  });

  it('good/miss boundary at ±70ms (late and early)', () => {
    // 69ms inside (good), 71ms outside (miss + extra), both directions.
    const late69 = matchHits([note('a', 1000, 'red')], [hit(1069, 'red')]);
    expect(late69.judgments[0].judgment).toBe('good');
    const late71 = matchHits([note('a', 1000, 'red')], [hit(1071, 'red')]);
    expect(late71.judgments[0].judgment).toBe('miss');
    expect(late71.counts.extra).toBe(1);

    const early69 = matchHits([note('a', 1000, 'red')], [hit(931, 'red')]);
    expect(early69.judgments[0].judgment).toBe('good'); // -69ms
    const early71 = matchHits([note('a', 1000, 'red')], [hit(929, 'red')]);
    expect(early71.judgments[0].judgment).toBe('miss'); // -71ms
    expect(early71.counts.extra).toBe(1);
  });

  it('respects early hits (negative delta) symmetrically', () => {
    const res = matchHits([note('a', 1000, 'blue')], [hit(940, 'blue')]);
    expect(res.judgments[0].judgment).toBe('good'); // -60ms (inside good, outside perfect)
    expect(res.judgments[0].deltaMs).toBe(-60);
  });

  it('an overhit (no in-window note) is an extra, not a match', () => {
    // A lone snare hit nowhere near the one expected note → miss + extra.
    const res = matchHits(
      [note('a', 1000, 'red')],
      [hit(1000, 'red'), hit(1500, 'red')],
    );
    expect(res.counts.perfect).toBe(1);
    expect(res.counts.miss).toBe(0);
    expect(res.counts.extra).toBe(1);
    expect(res.extras[0].hit.msTime).toBe(1500);
  });

  it('a cymbal hit never matches a tom note on the same lane', () => {
    const res = matchHits(
      [note('a', 1000, 'blue', false)],
      [hit(1000, 'blue', true)],
    );
    expect(res.judgments[0].judgment).toBe('miss');
    expect(res.counts.extra).toBe(1);
  });

  it('requires lane to match', () => {
    const res = matchHits([note('a', 1000, 'red')], [hit(1000, 'yellow')]);
    expect(res.judgments[0].judgment).toBe('miss');
    expect(res.extras).toHaveLength(1);
  });

  it('requires cymbal/tom class to match on the same lane', () => {
    const res = matchHits(
      [note('a', 1000, 'yellow', false)],
      [hit(1000, 'yellow', true)],
    );
    expect(res.judgments[0].judgment).toBe('miss');
    expect(res.extras).toHaveLength(1);
  });

  it('matches yellow cymbal to yellow cymbal', () => {
    const res = matchHits(
      [note('a', 1000, 'yellow', true)],
      [hit(1005, 'yellow', true)],
    );
    expect(res.judgments[0].judgment).toBe('perfect');
  });

  it('handles simultaneous notes in one group (flam-like) by nearest assignment', () => {
    // Two notes at the same instant on different lanes, two hits slightly off.
    const notes = [note('k', 1000, 'kick'), note('s', 1000, 'red')];
    const hits = [hit(1005, 'red'), hit(1010, 'kick')];
    const res = matchHits(notes, hits);
    const byId = Object.fromEntries(res.judgments.map(j => [j.note.id, j]));
    expect(byId['s'].hit!.msTime).toBe(1005);
    expect(byId['k'].hit!.msTime).toBe(1010);
    expect(res.counts.miss).toBe(0);
    expect(res.counts.extra).toBe(0);
  });

  it('two same-lane notes close together each claim their nearest hit', () => {
    // A 16th-note pair on the snare.
    const notes = [note('1', 1000, 'red'), note('2', 1062, 'red')];
    const hits = [hit(1003, 'red'), hit(1060, 'red')];
    const res = matchHits(notes, hits);
    expect(res.judgments[0].hit!.msTime).toBe(1003);
    expect(res.judgments[1].hit!.msTime).toBe(1060);
    expect(res.counts.miss).toBe(0);
  });

  it('a doubled hit on a single note produces one match and one extra', () => {
    const res = matchHits(
      [note('a', 1000, 'red')],
      [hit(1000, 'red'), hit(1008, 'red')],
    );
    expect(res.counts.perfect).toBe(1);
    expect(res.counts.extra).toBe(1);
    expect(res.extras[0].hit.msTime).toBe(1008);
  });

  it('assigns closest-first when greedy: nearer hit wins the contested note', () => {
    // One note, two compatible hits; the closer one should be the match.
    const res = matchHits(
      [note('a', 1000, 'red')],
      [hit(1030, 'red'), hit(1005, 'red')],
    );
    expect(res.judgments[0].hit!.msTime).toBe(1005);
    expect(res.judgments[0].judgment).toBe('perfect');
    expect(res.extras[0].hit.msTime).toBe(1030);
  });

  it('tracks fully missed notes and fully extra hits', () => {
    const res = matchHits(
      [note('a', 1000, 'red'), note('b', 5000, 'blue')],
      [hit(9000, 'green')],
    );
    expect(res.counts.miss).toBe(2);
    expect(res.counts.extra).toBe(1);
    expect(res.judgments.every(j => j.judgment === 'miss')).toBe(true);
  });

  it('handles empty inputs', () => {
    expect(matchHits([], []).counts).toEqual({
      perfect: 0,
      good: 0,
      miss: 0,
      extra: 0,
    });
    expect(matchHits([], [hit(1, 'red')]).counts.extra).toBe(1);
    expect(matchHits([note('a', 1, 'red')], []).counts.miss).toBe(1);
  });

  it('honours custom timing windows', () => {
    const tight = {perfect: 10, good: 20};
    const res = matchHits([note('a', 1000, 'red')], [hit(1015, 'red')], tight);
    expect(res.judgments[0].judgment).toBe('good');
    const res2 = matchHits([note('a', 1000, 'red')], [hit(1025, 'red')], tight);
    expect(res2.judgments[0].judgment).toBe('miss');
  });

  it('exposes default windows of 50 (perfect) / 70 (good, YARG-aligned)', () => {
    expect(DEFAULT_WINDOWS.perfect).toBe(50);
    expect(DEFAULT_WINDOWS.good).toBe(70);
  });
});
