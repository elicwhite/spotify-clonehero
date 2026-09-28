/**
 * Stagger order: which item of a group moves first.
 */
import {rand} from './random';

export type StaggerFrom = 'start' | 'end' | 'center' | 'edges' | 'random';

/** Slot of each item in a seeded shuffle, by `${seed}|${n}`. */
const shuffles = new Map<string, readonly number[]>();

const shuffleSlots = (n: number, seed: string): readonly number[] => {
  const key = `${seed}|${n}`;
  const hit = shuffles.get(key);
  if (hit) return hit;
  const order = Array.from({length: n}, (_, k) => k).sort(
    (a, b) => rand(seed, a) - rand(seed, b),
  );
  const slots = new Array<number>(n);
  order.forEach((item, slot) => {
    slots[item] = slot;
  });
  shuffles.set(key, slots);
  return slots;
};

/**
 * Order index for item `i` of `n` (0 moves first). Multiply by a per-item
 * delay: `start + staggerIndex(i, n, 'center') * 2`. 'random' is a seeded
 * shuffle, so every item still gets a distinct slot; it is computed once per
 * seed and count.
 */
export const staggerIndex = (
  i: number,
  n: number,
  from: StaggerFrom = 'start',
  seed = 'stagger',
): number => {
  switch (from) {
    case 'start':
      return i;
    case 'end':
      return n - 1 - i;
    case 'center':
      return Math.abs(i - (n - 1) / 2);
    case 'edges':
      return (n - 1) / 2 - Math.abs(i - (n - 1) / 2);
    case 'random':
      return shuffleSlots(n, seed)[i] ?? i;
  }
};
