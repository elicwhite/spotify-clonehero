/**
 * A cheap, deterministic, non-cryptographic digest.
 *
 * Shared by the editor's staleness stamps
 * (`lib/chart-editor-core/content-stamps.ts`) and the analytics song key
 * (`lib/analytics/song-key.ts`). Neither needs collision resistance: a
 * collision costs a missed staleness prompt or two songs merged in a report,
 * never data loss. What both need is that the same input gives the same
 * digest on every machine and every run.
 */

/** 32-bit FNV-1a over a string, folded to an unsigned 32-bit int. */
function fnv1a(input: string, seed: number): number {
  let hash = seed;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Two independently-seeded FNV-1a passes, folded to a 16-hex-char digest. */
export function fnvDigest(serialized: string): string {
  const a = fnv1a(serialized, 0x811c9dc5);
  const b = fnv1a(serialized, 0x9e3779b9);
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}
