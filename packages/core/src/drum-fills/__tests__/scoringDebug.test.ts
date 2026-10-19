import {
  buildAttemptDebug,
  describeLane,
  diagnoseExtra,
  type DebugHit,
} from '../practice/scoringDebug';
import {matchHits, type ExpectedNote} from '../midi/hitMatcher';

const notes: ExpectedNote[] = [
  {id: 'n0', msTime: 0, lane: 'red', isCymbal: false},
  {id: 'n1', msTime: 250, lane: 'yellow', isCymbal: true},
  {id: 'n2', msTime: 500, lane: 'green', isCymbal: false},
];

function hit(partial: Partial<DebugHit>): DebugHit {
  return {
    noteNumber: 38,
    velocity: 100,
    lane: 'red',
    isCymbal: false,
    loopRelMs: 0,
    ...partial,
  };
}

describe('describeLane', () => {
  it('labels kick and red without a voicing', () => {
    expect(describeLane('kick', false)).toBe('kick');
    expect(describeLane('red', false)).toBe('red');
  });

  it('labels cymbal vs tom for the colored lanes', () => {
    expect(describeLane('yellow', true)).toBe('yellow cymbal');
    expect(describeLane('blue', false)).toBe('blue tom');
  });
});

describe('diagnoseExtra', () => {
  it('flags a wrong-pad hit near an expected note on another lane', () => {
    // Hit blue tom right where the yellow cymbal note sits.
    const d = diagnoseExtra(
      hit({lane: 'blue', isCymbal: false, loopRelMs: 250}),
      notes,
    );
    expect(d.reason).toContain('wrong pad');
    expect(d.reason).toContain('blue tom');
    expect(d.reason).toContain('yellow cymbal');
    expect(d.nearestSameClassDeltaMs).toBeNull();
    expect(d.nearestAny).toEqual({lane: 'yellow', isCymbal: true, deltaMs: 0});
  });

  it('flags a correct-pad hit that is outside the timing window', () => {
    // Right lane/voicing but 120ms late on n0 (> ±70ms).
    const d = diagnoseExtra(
      hit({lane: 'red', isCymbal: false, loopRelMs: 120}),
      notes,
    );
    expect(d.reason).toContain('correct pad');
    expect(d.reason).toContain('outside');
    expect(d.nearestSameClassDeltaMs).toBe(120);
  });

  it('flags a likely double hit when the same-pad note is in window', () => {
    // n0 (red @0) is in window; if it was already matched, a second red hit
    // near it is a collision.
    const d = diagnoseExtra(
      hit({lane: 'red', isCymbal: false, loopRelMs: 10}),
      notes,
    );
    expect(d.reason).toContain('double');
    expect(d.nearestSameClassDeltaMs).toBe(10);
  });

  it('reports no nearby note when no same-pad note exists and the hit is far', () => {
    // No kick note exists in the pattern, and 5000ms is far from any note.
    const d = diagnoseExtra(
      hit({lane: 'kick', isCymbal: false, loopRelMs: 5000}),
      notes,
    );
    expect(d.reason).toContain('no expected note near this time');
    expect(d.nearestSameClassDeltaMs).toBeNull();
  });
});

describe('buildAttemptDebug', () => {
  it('captures counts, per-note judgments, and diagnosed extras', () => {
    const debugHits: DebugHit[] = [
      hit({lane: 'red', isCymbal: false, loopRelMs: 5, noteNumber: 38}), // matches n0
      hit({lane: 'blue', isCymbal: false, loopRelMs: 250, noteNumber: 48}), // extra: wrong pad
    ];
    const match = matchHits(
      notes,
      debugHits.map(h => ({
        msTime: h.loopRelMs,
        lane: h.lane,
        isCymbal: h.isCymbal,
      })),
    );
    const debug = buildAttemptDebug({
      attempt: 3,
      calibrationOffsetMs: 12,
      tempoPct: 90,
      notes,
      hits: debugHits,
      match,
      score: match.counts.perfect * 10,
    });

    expect(debug.attempt).toBe(3);
    expect(debug.calibrationOffsetMs).toBe(12);
    expect(debug.tempoPct).toBe(90);
    expect(debug.counts).toEqual(match.counts);
    expect(debug.notes).toHaveLength(3);
    expect(debug.notes[0].judgment).toBe('perfect');
    expect(debug.extras).toHaveLength(1);
    // The extra carries the raw MIDI note number it came from.
    expect(debug.extras[0].hit.noteNumber).toBe(48);
    expect(debug.extras[0].reason).toContain('wrong pad');
  });
});
