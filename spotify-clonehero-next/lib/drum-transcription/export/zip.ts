/**
 * ZIP packaging for chart export.
 *
 * Produces a .zip file containing the chart, song.ini metadata, and
 * audio stems — the standard distribution format that Clone Hero and
 * scan-chart can read.
 *
 * Uses fflate for fast, synchronous, browser-native ZIP compression.
 */

import {zipSync, strToU8} from 'fflate';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Package chart text, song.ini, and audio files into a ZIP blob.
 *
 * The resulting ZIP contains:
 *   - notes.chart   (the drum chart)
 *   - song.ini      (Clone Hero metadata)
 *   - Any audio files from the audioFiles map (e.g. "drums.wav", "song.wav")
 *
 * @param chartText  - The serialized .chart file content.
 * @param songIni    - The serialized song.ini content.
 * @param audioFiles - Map of filename to WAV ArrayBuffer (e.g. "drums.wav" -> ArrayBuffer).
 * @returns A Blob with MIME type application/zip.
 */
export function exportAsZip(
  chartText: string,
  songIni: string,
  audioFiles: Map<string, ArrayBuffer>,
): Blob {
  const files: Record<string, Uint8Array> = {
    'notes.chart': strToU8(chartText),
    'song.ini': strToU8(songIni),
  };

  for (const [name, data] of audioFiles) {
    files[name] = new Uint8Array(data);
  }

  const zipData = zipSync(files);
  return new Blob([zipData], {type: 'application/zip'});
}
