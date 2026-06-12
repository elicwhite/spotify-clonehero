/**
 * Pure song-matching for practice playback.
 *
 * Detection stores only taxonomy + tick spans per fill — not the chart — so the
 * practice screen must re-locate the source song in the user's library. A fill
 * row carries a `libraryPath` (`${parentDir.name}/${fileName}`) plus
 * song/artist/charter; {@link matchSong} picks the enumerated song that matches.
 *
 * No IO here so it stays unit-testable; the filesystem wrapper lives in
 * ./songLocator.ts.
 */

/** The fill fields needed to identify its source song. */
export interface SongRef {
  libraryPath: string;
  song: string;
  artist: string;
  charter: string;
}

/** A minimal structural view of an enumerated song. */
export interface EnumeratedSong {
  song: string;
  artist: string;
  charter: string;
  handleInfo: {parentDir: {name: string}; fileName: string};
}

export function libraryPathOf(s: EnumeratedSong): string {
  return `${s.handleInfo.parentDir.name}/${s.handleInfo.fileName}`;
}

/**
 * Find the enumerated song that matches a fill's {@link SongRef}.
 *
 * Prefers an exact `libraryPath` match (parentDir/fileName). Falls back to a
 * song+artist+charter match (the path can drift if the user reorganized folders
 * since the scan), then to song+artist. Returns null when nothing matches.
 */
export function matchSong<T extends EnumeratedSong>(
  songs: T[],
  ref: SongRef,
): T | null {
  const byPath = songs.find(s => libraryPathOf(s) === ref.libraryPath);
  if (byPath) return byPath;

  const exact = songs.find(
    s =>
      s.song === ref.song &&
      s.artist === ref.artist &&
      s.charter === ref.charter,
  );
  if (exact) return exact;

  const loose = songs.find(s => s.song === ref.song && s.artist === ref.artist);
  return loose ?? null;
}
