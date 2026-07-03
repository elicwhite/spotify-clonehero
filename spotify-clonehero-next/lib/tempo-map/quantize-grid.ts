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
 * There is no distance tolerance: every tick snaps to its nearest grid line.
 */

/**
 * Snap `tick` to the nearest 16th-note or 16th-note-triplet grid line.
 * `tick` may be fractional (pre-round) or an already-rounded integer; the
 * result is a non-negative integer tick.
 */
export function snapTickToGrid(tick: number, resolution: number): number {
  const straightTicks = resolution / 4; // 16th notes
  const tripletTicks = resolution / 6; // 16th-note triplets
  const straight = Math.round(tick / straightTicks) * straightTicks;
  const triplet = Math.round(tick / tripletTicks) * tripletTicks;
  // Tie goes to the straight position.
  const snapped =
    Math.abs(straight - tick) <= Math.abs(triplet - tick) ? straight : triplet;
  return Math.max(0, Math.round(snapped));
}
