import {createEmptyChart} from '@eliwhite/scan-chart';
import type {ParsedChart} from '@eliwhite/scan-chart';
import {swapSynctrack} from '../swap-synctrack';
import {
  gridCandidates,
  snapGroupToGrid,
  snapTickToGrid,
  nearestStraightTieScorer,
  type CandidateScorer,
} from '../quantize-grid';
import type {Synctrack} from '../types';

const RES = 480;

/** Build a drums chart whose expert track has the given note groups. Each
 * note is (msTime, type, msLength); its `tick` is irrelevant to swapSynctrack
 * (recomputed from msTime under the new synctrack). */
function chartWithGroups(
  groups: Array<Array<{ms: number; type?: number; msLen?: number}>>,
): ParsedChart {
  const chart = createEmptyChart({
    format: 'chart',
    resolution: RES,
    bpm: 120,
  });
  return {
    ...chart,
    trackData: [
      {
        instrument: 'drums',
        difficulty: 'expert',
        starPowerSections: [],
        rejectedStarPowerSections: [],
        soloSections: [],
        flexLanes: [],
        drumFreestyleSections: [],
        textEvents: [],
        versusPhrases: [],
        animations: [],
        noteEventGroups: groups.map(g =>
          g.map(n => ({
            tick: 0,
            msTime: n.ms,
            length: 0,
            msLength: n.msLen ?? 0,
            type: n.type ?? 0,
            flags: 0,
          })),
        ),
      },
    ],
  } as unknown as ParsedChart;
}

function steadySync(bpm: number): Synctrack {
  return {
    origin_ms: 0,
    tempos: [{ms: 0, bpm}],
    timeSignatures: [{ms: 0, numerator: 4, denominator: 4}],
  };
}

const startTicks = (out: ParsedChart) =>
  out.trackData[0].noteEventGroups.map(g => g[0].tick);

describe('quantize abstain band', () => {
  // At 120 BPM / res 480, 1 tick = 1.04166̅ ms. The un-snapped tick 200 sits
  // at the widest gap in the 16th ∪ 16th-triplet grid (equidistant from the
  // straight and triplet lines at tick 240): snapping it moves the note 40
  // ticks = 41.67 ms, past the default 40 ms band, so it stays un-snapped.
  test('a note past the tolerance from every grid line stays at the raw tick', () => {
    const msPerTick = 60000 / (120 * RES);
    const out = swapSynctrack(
      chartWithGroups([[{ms: 200 * msPerTick}]]),
      steadySync(120),
      {
        quantizeNotes: true,
      },
    );
    expect(startTicks(out)).toEqual([200]); // abstained: raw Math.round, not 240
  });

  // A note ~10 ms off a 16th (un-snapped tick ~110.4, msTime 115) is well
  // within the band and snaps to the beat-adjacent 16th at tick 120.
  test('a note within the tolerance snaps to the nearest grid line', () => {
    const out = swapSynctrack(chartWithGroups([[{ms: 115}]]), steadySync(120), {
      quantizeNotes: true,
    });
    expect(startTicks(out)).toEqual([120]);
  });

  test('quantizeNotes=false never abstains and never snaps (raw re-tick)', () => {
    const msPerTick = 60000 / (120 * RES);
    const out = swapSynctrack(
      chartWithGroups([[{ms: 200 * msPerTick}], [{ms: 115}]]),
      steadySync(120),
    );
    expect(startTicks(out)).toEqual([200, 110]);
  });
});

describe('abstain band is measured in ms at the local tempo', () => {
  // The SAME 40-tick snap distance (un-snapped tick 200 -> grid tick 240) is
  // 20.8 ms at 240 BPM but 83.3 ms at 60 BPM. With a 30 ms band it snaps at
  // the fast tempo and abstains at the slow one — proving the band converts
  // through the tempo segments, not a fixed tick count.
  for (const [bpm, expectedTick] of [
    [240, 240],
    [60, 200],
  ] as const) {
    test(`${bpm} BPM: same tick offset -> ${expectedTick}`, () => {
      const msPerTick = 60000 / (bpm * RES);
      const out = swapSynctrack(
        chartWithGroups([[{ms: 200 * msPerTick}]]),
        steadySync(bpm),
        {quantizeNotes: true, snapToleranceMs: 30},
      );
      expect(startTicks(out)).toEqual([expectedTick]);
    });
  }
});

describe('group-joint snap', () => {
  // A chord (all members share msTime) must land on ONE start tick.
  test('a chord snaps to a single slot for every lane', () => {
    const chord = [
      {ms: 115, type: 0},
      {ms: 115, type: 1},
      {ms: 115, type: 2},
    ];
    const out = swapSynctrack(chartWithGroups([chord]), steadySync(120), {
      quantizeNotes: true,
    });
    const ticks = out.trackData[0].noteEventGroups[0].map(n => n.tick);
    expect(ticks).toEqual([120, 120, 120]);
  });

  // snapGroupToGrid consults the scorer exactly once per group. A
  // lane-dependent scorer would pick DIFFERENT subdivisions per lane if run
  // per note (a split chord); driven once for the whole group it yields a
  // single tick applied to all members.
  test('one scorer call per group cannot split a chord', () => {
    // Lane 0 -> straight (candidates[0]); any other lane -> triplet.
    const laneScorer: CandidateScorer = (cands, lanes) =>
      lanes.every(l => l === 0) ? cands[0] : cands[1];
    const frac = 300; // straight -> 360, triplet -> 320
    const perNoteStraight = snapGroupToGrid(frac, RES, [0], laneScorer);
    const perNoteTriplet = snapGroupToGrid(frac, RES, [2], laneScorer);
    expect(perNoteStraight).toBe(360);
    expect(perNoteTriplet).toBe(320);
    // The chord [0, 2] gets ONE decision, not one per lane.
    const groupTick = snapGroupToGrid(frac, RES, [0, 2], laneScorer);
    expect([perNoteStraight, perNoteTriplet]).toContain(groupTick);
    expect(groupTick).toBe(320); // scorer sees a non-all-zero lane set
  });
});

describe('quantize-grid primitives', () => {
  test('gridCandidates lists straight first, then triplet', () => {
    expect(gridCandidates(300, RES)).toEqual([
      {tick: 360, kind: 'straight'},
      {tick: 320, kind: 'triplet'},
    ]);
  });

  test('nearestStraightTieScorer breaks ties toward straight', () => {
    // Tick 240 is on both grids (straight 240, triplet 240) — an exact tie.
    const cands = gridCandidates(240, RES);
    expect(nearestStraightTieScorer(cands, [], 240).kind).toBe('straight');
  });

  test('snapTickToGrid still matches the historical nearest-with-straight-tie rule', () => {
    // Regression fixtures for the drum-transcription chart-builder caller.
    const straight = RES / 4; // 120
    const triplet = RES / 6; // 80
    for (const t of [0, 55, 100, 130, 200, 486.7, 566.4, 1152]) {
      const s = Math.round(t / straight) * straight;
      const tr = Math.round(t / triplet) * triplet;
      const expected = Math.max(
        0,
        Math.round(Math.abs(s - t) <= Math.abs(tr - t) ? s : tr),
      );
      expect(snapTickToGrid(t, RES)).toBe(expected);
    }
  });

  // snapTickUniform / UNIFORM_SLOTS_PER_BEAT tests REMOVED along with the
  // implementation (drum-to-chart plan §4 step 5, R5-3: dead in the app
  // since the 2026-07-04 uniform-grid carve-out drop).
});
