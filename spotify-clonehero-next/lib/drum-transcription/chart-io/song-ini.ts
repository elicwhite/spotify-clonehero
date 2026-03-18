/**
 * song.ini serializer for Clone Hero chart packages.
 *
 * Produces an INI file with the [song] section containing metadata
 * fields that Clone Hero reads for display and playback.
 *
 * Output uses Windows line endings (\r\n) to match the .chart file
 * convention and ensure maximum compatibility.
 *
 * See: lib/ini-parser.ts for the corresponding reader.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Metadata for the song.ini file.
 *
 * Required fields: name, artist, durationMs.
 * Optional fields default to sensible values for auto-charted drums.
 */
export interface SongMetadata {
  /** Song title. */
  name: string;
  /** Artist name. */
  artist: string;
  /** Album name. */
  album?: string;
  /** Genre (e.g. "rock", "metal"). */
  genre?: string;
  /** Year of release (e.g. "2024"). */
  year?: string;
  /** Who charted it. Defaults to "AutoDrums". */
  charter?: string;
  /** Drum difficulty rating. -1 = unrated. */
  diffDrums?: number;
  /** Where preview playback starts (milliseconds). */
  previewStartTime?: number;
  /** Duration of the song in milliseconds. */
  durationMs: number;
  /** Audio offset / delay in milliseconds. */
  delay?: number;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Serialize song metadata to the Clone Hero song.ini format.
 *
 * @param metadata - Song metadata fields.
 * @returns The song.ini file content as a string with \r\n line endings.
 */
export function serializeSongIni(metadata: SongMetadata): string {
  const lines = ['[song]'];
  lines.push(`name = ${metadata.name}`);
  lines.push(`artist = ${metadata.artist}`);
  lines.push(`album = ${metadata.album ?? ''}`);
  lines.push(`genre = ${metadata.genre ?? ''}`);
  lines.push(`year = ${metadata.year ?? ''}`);
  lines.push(`charter = ${metadata.charter ?? 'AutoDrums'}`);
  lines.push(`diff_drums = ${metadata.diffDrums ?? -1}`);
  lines.push(`preview_start_time = ${metadata.previewStartTime ?? 0}`);
  lines.push(`song_length = ${Math.round(metadata.durationMs)}`);
  lines.push(`delay = ${metadata.delay ?? 0}`);
  lines.push(`pro_drums = True`);
  return lines.join('\r\n') + '\r\n';
}
