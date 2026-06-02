/**
 * Small helpers for the SNG file manager page.
 *
 * Audio detection itself lives in `lib/src-shared/utils` (`hasAudioExtension`);
 * these helpers only cover what that doesn't: picking a playback MIME type,
 * formatting sizes, and de-duplicating files by name when adding to a package.
 */

import {getExtension} from '@/lib/src-shared/utils';

/**
 * Best-effort MIME type for playing an audio file in an `<audio>` element.
 * Opus is Ogg-wrapped in Clone Hero packages, so it maps to `audio/ogg`.
 */
export function audioMimeType(fileName: string): string {
  switch (getExtension(fileName).toLowerCase()) {
    case 'opus':
    case 'ogg':
      return 'audio/ogg';
    case 'mp3':
      return 'audio/mpeg';
    case 'wav':
      return 'audio/wav';
    default:
      return 'audio/ogg';
  }
}

/** Human-readable byte size (e.g. 1536 -> "1.5 KB"). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  // One decimal place, dropping a trailing ".0".
  const rounded = Math.round(value * 10) / 10;
  return `${rounded} ${units[unitIndex]}`;
}

/**
 * Filter `incoming` down to entries whose names don't already exist in
 * `existing` (file names must be unique inside both a zip and an sng index).
 * Collisions within `incoming` itself are also dropped after the first.
 *
 * @returns `merged` — the entries safe to append — and `skipped` — the names
 *   that were dropped because of a collision.
 */
export function dedupeByName<T extends {fileName: string}>(
  existing: readonly T[],
  incoming: readonly T[],
): {merged: T[]; skipped: string[]} {
  const seen = new Set(existing.map(f => f.fileName.toLowerCase()));
  const merged: T[] = [];
  const skipped: string[] = [];
  for (const entry of incoming) {
    const key = entry.fileName.toLowerCase();
    if (seen.has(key)) {
      skipped.push(entry.fileName);
    } else {
      seen.add(key);
      merged.push(entry);
    }
  }
  return {merged, skipped};
}
