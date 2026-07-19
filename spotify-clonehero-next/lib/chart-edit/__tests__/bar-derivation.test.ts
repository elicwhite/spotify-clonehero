import {
  audioExtendedEndTick,
  beatUnitTicks,
  deriveBeatGrid,
  deriveDownbeatFlags,
  deriveTimeSignatures,
  DownbeatFlags,
  TimeSignatureInput,
} from '../bar-derivation';

const RES = 192;

describe('audioExtendedEndTick', () => {
  test('is one bar past the furthest of the anchor and audio-duration ticks', () => {
    // Audio extends past the last anchor.
    expect(audioExtendedEndTick(1000, 5000, RES)).toBe(5000 + RES * 4);
    // Anchor extends past the audio.
    expect(audioExtendedEndTick(9000, 5000, RES)).toBe(9000 + RES * 4);
  });
});

/** Round-trip: TS list → flags → TS list, using the last region's numerator
 * as the trailing numerator (what a caller holding the original chart has). */
function roundTrip(
  timeSignatures: TimeSignatureInput[],
  endTick: number,
): TimeSignatureInput[] {
  const flags = deriveDownbeatFlags(timeSignatures, RES, endTick);
  const trailing = timeSignatures[timeSignatures.length - 1]?.numerator;
  return deriveTimeSignatures(flags, RES, trailing);
}

describe('beatUnitTicks', () => {
  test('is resolution*4/denominator', () => {
    expect(beatUnitTicks(RES, 4)).toBe(192);
    expect(beatUnitTicks(RES, 8)).toBe(96);
    expect(beatUnitTicks(RES, 16)).toBe(48);
    expect(beatUnitTicks(480, 8)).toBe(240);
  });
});

describe('deriveBeatGrid', () => {
  test('4/4: quarter-note beats, downbeat every 4', () => {
    const beats = deriveBeatGrid(
      [{tick: 0, numerator: 4, denominator: 4}],
      RES,
      8 * RES,
    );
    expect(beats.map(b => b.tick)).toEqual([
      0, 192, 384, 576, 768, 960, 1152, 1344, 1536,
    ]);
    expect(beats.filter(b => b.isDownbeat).map(b => b.tick)).toEqual([
      0, 768, 1536,
    ]);
    expect(beats.every(b => b.denominator === 4)).toBe(true);
  });

  test('6/8: eighth-note beats, downbeat every 6 beats (not 3/4)', () => {
    const beats = deriveBeatGrid(
      [{tick: 0, numerator: 6, denominator: 8}],
      RES,
      2 * 576,
    );
    expect(beats[1].tick).toBe(96); // eighth note, not quarter
    expect(beats.filter(b => b.isDownbeat).map(b => b.tick)).toEqual([
      0, 576, 1152,
    ]);
    expect(beats.every(b => b.denominator === 8)).toBe(true);
  });

  test('7/8: downbeat every 672 ticks', () => {
    const beats = deriveBeatGrid(
      [{tick: 0, numerator: 7, denominator: 8}],
      RES,
      2 * 672,
    );
    expect(beats.filter(b => b.isDownbeat).map(b => b.tick)).toEqual([
      0, 672, 1344,
    ]);
  });

  test('17/16 region re-anchors the following region at its own tick', () => {
    const oddStart = 2 * 4 * RES; // 1536
    const oddEnd = oddStart + 17 * (RES / 4); // 2352 — not a beat multiple
    const beats = deriveBeatGrid(
      [
        {tick: 0, numerator: 4, denominator: 4},
        {tick: oddStart, numerator: 17, denominator: 16},
        {tick: oddEnd, numerator: 4, denominator: 4},
      ],
      RES,
      oddEnd + 8 * RES,
    );

    const odd = beats.filter(b => b.tick >= oddStart && b.tick < oddEnd);
    expect(odd).toHaveLength(17);
    expect(odd[0]).toMatchObject({tick: oddStart, isDownbeat: true});
    expect(odd.slice(1).every(b => !b.isDownbeat)).toBe(true);

    const after = beats.filter(b => b.tick >= oddEnd);
    expect(after[0]).toMatchObject({tick: oddEnd, isDownbeat: true});
    expect(after[1].tick).toBe(oddEnd + RES);
  });

  test('empty TS list defaults to 4/4 from tick 0', () => {
    const beats = deriveBeatGrid([], RES, 4 * RES);
    expect(beats.map(b => b.tick)).toEqual([0, 192, 384, 576, 768]);
    expect(beats[0].isDownbeat).toBe(true);
  });

  test('late first TS: implicit 4/4 covers the gap from tick 0', () => {
    const beats = deriveBeatGrid(
      [{tick: 768, numerator: 3, denominator: 4}],
      RES,
      1536,
    );
    expect(beats.filter(b => b.isDownbeat).map(b => b.tick)).toEqual([
      0, 768, 1344,
    ]);
  });

  test('invalid region (numerator 0) is skipped', () => {
    const beats = deriveBeatGrid(
      [
        {tick: 0, numerator: 4, denominator: 4},
        {tick: 768, numerator: 0, denominator: 4},
        {tick: 1536, numerator: 4, denominator: 4},
      ],
      RES,
      2304,
    );
    expect(beats.some(b => b.tick >= 768 && b.tick < 1536)).toBe(false);
    expect(beats.filter(b => b.isDownbeat).map(b => b.tick)).toEqual([
      0, 1536, 2304,
    ]);
  });
});

describe('deriveDownbeatFlags', () => {
  test('records denominator-scaled downbeats with denominators', () => {
    const flags = deriveDownbeatFlags(
      [
        {tick: 0, numerator: 4, denominator: 4},
        {tick: 1536, numerator: 6, denominator: 8},
      ],
      RES,
      1536 + 2 * 576,
    );
    expect(flags.downbeats).toEqual([
      {tick: 0, denominator: 4},
      {tick: 768, denominator: 4},
      {tick: 1536, denominator: 8},
      {tick: 2112, denominator: 8},
      {tick: 2688, denominator: 8},
    ]);
  });

  test('tick 0 is always present, even when every region is invalid', () => {
    const flags = deriveDownbeatFlags(
      [{tick: 0, numerator: 0, denominator: 4}],
      RES,
      1536,
    );
    expect(flags.downbeats[0]).toEqual({tick: 0, denominator: 4});
  });
});

describe('deriveTimeSignatures', () => {
  test('constant 4/4 collapses to a single event', () => {
    const flags: DownbeatFlags = {
      downbeats: [0, 768, 1536, 2304].map(tick => ({tick, denominator: 4})),
    };
    expect(deriveTimeSignatures(flags, RES)).toEqual([
      {tick: 0, numerator: 4, denominator: 4},
    ]);
  });

  test('a marked downbeat mid-bar emits a derived meter change', () => {
    // 4/4 downbeats plus one inserted at 1152 (0062 §8's mark op result)
    const flags: DownbeatFlags = {
      downbeats: [0, 768, 1152, 1536].map(tick => ({tick, denominator: 4})),
    };
    expect(deriveTimeSignatures(flags, RES)).toEqual([
      {tick: 0, numerator: 4, denominator: 4},
      {tick: 768, numerator: 2, denominator: 4},
    ]);
  });

  test('trailing numerator applies to a final-downbeat meter change', () => {
    const flags: DownbeatFlags = {
      downbeats: [
        {tick: 0, denominator: 4},
        {tick: 768, denominator: 8},
      ],
    };
    expect(deriveTimeSignatures(flags, RES, 6)).toEqual([
      {tick: 0, numerator: 4, denominator: 4},
      {tick: 768, numerator: 6, denominator: 8},
    ]);
  });

  test('single downbeat with no trailing numerator defaults to 4/4', () => {
    expect(
      deriveTimeSignatures({downbeats: [{tick: 0, denominator: 4}]}, RES),
    ).toEqual([{tick: 0, numerator: 4, denominator: 4}]);
  });

  test('unsorted and duplicate entries are normalized', () => {
    const flags: DownbeatFlags = {
      downbeats: [
        {tick: 768, denominator: 4},
        {tick: 0, denominator: 4},
        {tick: 768, denominator: 4},
        {tick: 1536, denominator: 4},
      ],
    };
    expect(deriveTimeSignatures(flags, RES)).toEqual([
      {tick: 0, numerator: 4, denominator: 4},
    ]);
  });

  test('fractional gap (non-beat-aligned source TS) rounds to whole beats', () => {
    const flags: DownbeatFlags = {
      downbeats: [
        {tick: 0, denominator: 4},
        {tick: 242, denominator: 4}, // 1.26 beats away
      ],
    };
    expect(deriveTimeSignatures(flags, RES, 4)).toEqual([
      {tick: 0, numerator: 1, denominator: 4},
      {tick: 242, numerator: 4, denominator: 4},
    ]);
  });

  test('empty flags derive no events', () => {
    expect(deriveTimeSignatures({downbeats: []}, RES)).toEqual([]);
  });
});

describe('round trip (load → save)', () => {
  test('6/8 chart round-trips exactly (never rewritten as 3/4)', () => {
    const ts = [{tick: 0, numerator: 6, denominator: 8}];
    expect(roundTrip(ts, 4 * 576)).toEqual(ts);
  });

  test('7/8 chart round-trips exactly', () => {
    const ts = [{tick: 0, numerator: 7, denominator: 8}];
    expect(roundTrip(ts, 4 * 672)).toEqual(ts);
  });

  test('mixed meter 4/4 → 6/8 → 7/8 round-trips exactly', () => {
    const ts = [
      {tick: 0, numerator: 4, denominator: 4},
      {tick: 1536, numerator: 6, denominator: 8},
      {tick: 1536 + 2 * 576, numerator: 7, denominator: 8},
    ];
    expect(roundTrip(ts, 1536 + 2 * 576 + 3 * 672)).toEqual(ts);
  });

  test('mixed meter with /16 (17/16 bar) round-trips exactly', () => {
    const oddStart = 1536;
    const oddEnd = oddStart + 17 * 48;
    const ts = [
      {tick: 0, numerator: 4, denominator: 4},
      {tick: oddStart, numerator: 17, denominator: 16},
      {tick: oddEnd, numerator: 4, denominator: 4},
    ];
    expect(roundTrip(ts, oddEnd + 8 * RES)).toEqual(ts);
  });

  test('3/4 vs 6/8 stay distinct through the round trip', () => {
    const threeFour = [{tick: 0, numerator: 3, denominator: 4}];
    const sixEight = [{tick: 0, numerator: 6, denominator: 8}];
    expect(roundTrip(threeFour, 4 * 576)).toEqual(threeFour);
    expect(roundTrip(sixEight, 4 * 576)).toEqual(sixEight);
  });
});
