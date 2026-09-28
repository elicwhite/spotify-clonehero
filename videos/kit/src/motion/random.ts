/**
 * Seeded randomness. Every value is a pure function of its seed and keys, so
 * a frame renders the same on every run and in any order. Never Math.random.
 */

/**
 * 32-bit hash of a string: FNV-1a, then the murmur3 avalanche finalizer.
 * Without the finalizer, keys that differ in one character ("s|1", "s|2")
 * hash to near-arithmetic sequences and seeded values come out in runs.
 */
const hashString = (s: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
};

/** Mulberry32: a tiny seeded generator of values in [0, 1) from a 32-bit seed. */
export const mulberry32 = (seed: number) => (): number => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** A deterministic value in [0, 1) for a seed and any number of keys. */
export const rand = (
  seed: string | number,
  ...keys: (string | number)[]
): number => mulberry32(hashString(`${seed}|${keys.join('|')}`))();

export interface Rng {
  /** [0, 1) */
  next(): number;
  range(min: number, max: number): number;
  int(min: number, maxInclusive: number): number;
  sign(): 1 | -1;
  pick<T>(items: readonly T[]): T;
  /** Standard normal (Box-Muller). */
  gauss(): number;
}

/** A seeded random stream, for generating many values (particles, debris). */
export const rng = (seed: string | number): Rng => {
  const next = mulberry32(hashString(String(seed)));
  return {
    next,
    range: (min, max) => min + (max - min) * next(),
    int: (min, maxInclusive) =>
      min + Math.floor(next() * (maxInclusive - min + 1)),
    sign: () => (next() < 0.5 ? -1 : 1),
    pick: <T>(items: readonly T[]): T => {
      if (items.length === 0) throw new Error('[motion] pick from no items');
      return items[Math.floor(next() * items.length)] as T;
    },
    gauss: () => {
      const u = Math.max(1e-9, next());
      const v = next();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
  };
};
