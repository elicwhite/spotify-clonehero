/**
 * Pure rotation logic shared by the fill roulette and groove sessions.
 *
 * Both surfaces draw fills from a pool and advance through them — roulette over
 * the whole library, a groove session over the fills of one groove cluster. The
 * only knobs are sequential vs. shuffle order and a "one ahead" preview. Keeping
 * the index math here (rather than inline in the React component) makes it
 * unit-testable and keeps the two sessions in lockstep.
 */

export type RotationOrder = 'sequential' | 'shuffle';

/**
 * Pick the next index for a pool of `count` items.
 *
 * - sequential: wrap around from `current`.
 * - shuffle: a random index, avoiding an immediate repeat when possible.
 *
 * `rng` defaults to Math.random and is injectable for deterministic tests.
 */
export function nextRotationIndex(
  count: number,
  current: number,
  order: RotationOrder,
  rng: () => number = Math.random,
): number {
  if (count <= 1) return 0;
  if (order === 'sequential') {
    return (current + 1) % count;
  }
  let next = Math.floor(rng() * count) % count;
  if (next === current) next = (next + 1) % count;
  return next;
}

/**
 * The index shown "one ahead" of `current` as a preview. Deterministic for
 * sequential order; for shuffle we still preview the sequential successor so the
 * preview matches what pressing Next without re-rolling would show — the actual
 * shuffle draw happens on advance.
 */
export function previewRotationIndex(count: number, current: number): number {
  if (count <= 1) return 0;
  return (current + 1) % count;
}
