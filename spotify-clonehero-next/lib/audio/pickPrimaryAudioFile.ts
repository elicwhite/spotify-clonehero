/**
 * Which of several audio files is the song's full mix.
 *
 * Size, not order: a drop's file order is whatever the OS handed over, and a
 * chart package's file order is whatever the archive stored. Stems are
 * partial mixes and are therefore smaller than the mix they were separated
 * out of, so the largest file is the full mix in effectively every real
 * package.
 */

export interface SizedAudioFile {
  fileName: string;
  data: {length: number} | {byteLength: number};
}

function sizeOf(file: SizedAudioFile): number {
  const {data} = file;
  return 'length' in data ? data.length : data.byteLength;
}

/**
 * The largest file in `files`, or null when there are none. Ties keep the
 * first, so the caller's order still decides when sizes say nothing.
 */
export function pickPrimaryAudioFile<T extends SizedAudioFile>(
  files: readonly T[],
): T | null {
  if (files.length === 0) return null;
  return files.reduce((a, b) => (sizeOf(b) > sizeOf(a) ? b : a));
}
