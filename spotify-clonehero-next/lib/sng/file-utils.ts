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
 * Merge `incoming` files into `existing` by name. A file whose name matches an
 * existing one replaces it in place (file names must be unique inside both a
 * zip and an sng index); a new name is appended. Within `incoming`, a later
 * entry replacing the same name wins.
 *
 * @returns `merged` — the resulting list — plus how many entries were `added`
 *   (new names) and `replaced` (existing names overwritten).
 */
export function mergeByName<T extends {fileName: string}>(
  existing: readonly T[],
  incoming: readonly T[],
): {merged: T[]; added: number; replaced: number} {
  const merged: T[] = [...existing];
  const indexByName = new Map<string, number>();
  merged.forEach((f, i) => indexByName.set(f.fileName.toLowerCase(), i));

  const replacedNames = new Set<string>();
  let added = 0;
  for (const entry of incoming) {
    const key = entry.fileName.toLowerCase();
    const existingIndex = indexByName.get(key);
    if (existingIndex !== undefined) {
      merged[existingIndex] = entry;
      // Only count overwrites of files that were already in the package.
      if (existingIndex < existing.length) replacedNames.add(key);
    } else {
      indexByName.set(key, merged.length);
      merged.push(entry);
      added++;
    }
  }
  return {merged, added, replaced: replacedNames.size};
}
