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

  it('classifies windows: perfect ≤35, good ≤75, miss otherwise', () => {
    const notes = [
      note('p', 1000, 'red'),
      note('g', 2000, 'red'),
      note('m', 3000, 'red'),
    ];
    const hits = [hit(1030, 'red'), hit(2070, 'red'), hit(3100, 'red')];
    const res = matchHits(notes, hits);
    expect(res.judgments[0].judgment).toBe('perfect'); // 30ms
    expect(res.judgments[1].judgment).toBe('good'); // 70ms
    expect(res.judgments[2].judgment).toBe('miss'); // 100ms out of window
    // The 3100 hit becomes an extra (no note in range).
    expect(res.counts.extra).toBe(1);
  });

  it('respects early hits (negative delta) symmetrically', () => {
    const res = matchHits([note('a', 1000, 'blue')], [hit(960, 'blue')]);
    expect(res.judgments[0].judgment).toBe('good'); // -40ms
    expect(res.judgments[0].deltaMs).toBe(-40);
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

  it('exposes default windows of 35 / 75', () => {
    expect(DEFAULT_WINDOWS.perfect).toBe(35);
    expect(DEFAULT_WINDOWS.good).toBe(75);
  });
});
