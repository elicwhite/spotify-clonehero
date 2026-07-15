/**
 * Musical grid quantizer shared by the /tempo re-temping path
 * (swap-synctrack) and the drum-transcription chart build (chart-builder).
 *
 * Snaps a tick to the nearest musical subdivision: 16th notes
 * (resolution/4) or 16th-note triplets (resolution/6, which also covers
 * 8th-note triplets). On clean onsets with an accurate predicted tempo map,
 * naive nearest-position snapping is the validated-correct quantizer
 * (autoresearch-subdiv: acc1 = 1.000 on clean onsets). The vocabulary is
 * deliberately coarser than a 24-slot metric grid: a uniform fine grid
 * leaves notes one micro-slot off the beat (the predicted map's ~9 ms median
 * residual exceeds half a 1/24-beat slot at fast tempos) and notation
 * renders as tuplet soup. Ties prefer the straight (16th) position.
 *
 * The grid is anchored at absolute tick 0 (the game's origin), NOT re-anchored
 * at tempo or time-signature changes — this matches the /tempo re-ticking.
 *
 * Two structural affordances live here for the caller (swap-synctrack) to
 * build on without changing the snap decision itself:
 *
 *   - {@link gridCandidates} enumerates the candidate grid positions and a
 *     {@link CandidateScorer} chooses one. The default scorer reproduces the
 *     historical nearest-with-straight-tie rule exactly. A whole
 *     noteEventGroup (a simultaneous chord) is snapped by ONE scorer call
 *     ({@link snapGroupToGrid}), so a chord can never split across slots even
 *     under a future lane-dependent scorer.
 *   - The abstain band (leaving a note un-snapped when the nearest grid line
 *     is too far, in ms at the local tempo, to be trustworthy) lives in the
 *     caller, which owns the tempo segments needed to convert ticks↔ms.
 */

/** One candidate snapped position, tagged with the subdivision family it
 * belongs to. `straight` = 16th notes (resolution/4); `triplet` =
 * 16th-note triplets (resolution/6). */
export interface GridCandidate {
  tick: number;
  kind: "straight" | "triplet";
}

/**
 * Enumerate the grid candidates for a (fractional) tick: the nearest
 * straight-16th position and the nearest 16th-triplet position. The straight
 * candidate is always first so a scorer that breaks ties toward the earlier
 * entry reproduces the historical straight-preferring rule.
 */
export function gridCandidates(
  tick: number,
  resolution: number,
): GridCandidate[] {
  const straightTicks = resolution / 4; // 16th notes
  const tripletTicks = resolution / 6; // 16th-note triplets
  return [
    {
      tick: Math.round(tick / straightTicks) * straightTicks,
      kind: "straight",
    },
    { tick: Math.round(tick / tripletTicks) * tripletTicks, kind: "triplet" },
  ];
}

/**
 * Choose one winning candidate for a whole note group. `groupLanes` are the
 * lane/type ids of the notes sharing this onset (empty for a single note or a
 * lane-agnostic caller); a future scorer may weigh them. `fracTick` is the
 * group's shared un-snapped tick.
 */
export type CandidateScorer = (
  candidates: GridCandidate[],
  groupLanes: number[],
  fracTick: number,
) => GridCandidate;

/**
 * The historical rule: pick the candidate closest to the un-snapped tick,
 * ties going to the straight (16th) position. Lane-agnostic. Because
 * {@link gridCandidates} lists the straight candidate first and the
 * comparison is strict, an exact tie keeps the straight candidate.
 */
export const nearestStraightTieScorer: CandidateScorer = (
  candidates,
  _groupLanes,
  fracTick,
) => {
  let best = candidates[0];
  for (let i = 1; i < candidates.length; i++) {
    if (
      Math.abs(candidates[i].tick - fracTick) < Math.abs(best.tick - fracTick)
    )
      best = candidates[i];
  }
  return best;
};

/**
 * Snap a whole note group (all members share `fracTick`) to a single grid
 * tick via exactly one `scorer` call, guaranteeing the group never splits
 * across slots. Returns a non-negative integer tick.
 */
export function snapGroupToGrid(
  fracTick: number,
  resolution: number,
  groupLanes: number[] = [],
  scorer: CandidateScorer = nearestStraightTieScorer,
): number {
  const winner = scorer(
    gridCandidates(fracTick, resolution),
    groupLanes,
    fracTick,
  );
  return Math.max(0, Math.round(winner.tick));
}

/**
 * Snap `tick` to the nearest 16th-note or 16th-note-triplet grid line.
 * `tick` may be fractional (pre-round) or an already-rounded integer; the
 * result is a non-negative integer tick. Thin wrapper over
 * {@link snapGroupToGrid} with no lane context and the default scorer, kept
 * for callers (chart-builder) that snap one tick at a time.
 */
export function snapTickToGrid(tick: number, resolution: number): number {
  return snapGroupToGrid(tick, resolution);
}

// snapTickUniform / UNIFORM_SLOTS_PER_BEAT (the "naive" 1/24-beat cymbal
// carve-out) REMOVED (drum-to-chart plan §4 step 5, R5-3: dead in the app
// since the 2026-07-04 uniform-grid carve-out drop — see
// lib/drum-transcription/ml/class-mapping.ts's SnapMode, now 'candidate'
// only). All lanes have used candidate snapping exclusively since then.
