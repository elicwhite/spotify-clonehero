/**
 * Album art for a chart package: what Clone Hero and scan-chart expect, and
 * how an arbitrary image the user picked becomes that.
 *
 * scan-chart recognizes exactly three file names (`album.jpg`, `album.jpeg`,
 * `album.png`) and accepts exactly two pixel sizes (512×512 and 500×500);
 * anything else raises `albumArtSize`. Real-world art routinely misses that
 * — a 3000×3000 store-front JPEG is typical — so this module normalizes
 * rather than rejects: whatever the user drops is center-cropped to a square
 * and re-encoded at {@link ALBUM_ART_SIZE}, which is also what scan-chart
 * itself does to the art it hands back to a caller.
 */

/** The edge length scan-chart wants, and the one this project writes. */
export const ALBUM_ART_SIZE = 512;

/** JPEG quality for the normalized output. Matches scan-chart's own
 *  re-encode, and keeps a 512×512 cover around 50–120 KB. */
export const ALBUM_ART_JPEG_QUALITY = 0.75;

/** The file name this project writes. One of {@link ALBUM_ART_FILE_NAMES}. */
export const ALBUM_ART_FILE_NAME = 'album.jpg';

/** Every file name scan-chart will recognize as album art. A package with
 *  more than one of these raises `multipleAlbumArt`, so replacing the art
 *  means removing all of them, not just the one being overwritten. */
export const ALBUM_ART_FILE_NAMES: readonly string[] = [
  'album.jpg',
  'album.jpeg',
  'album.png',
];

/** `accept` for a file input, and the types a drop is allowed to carry. */
export const ALBUM_ART_ACCEPT = 'image/jpeg,image/png,image/webp';

/**
 * Largest source image accepted, in bytes. Not a chart-format limit — the
 * output is re-encoded and small regardless — but a guard so a dropped RAW
 * or multi-hundred-megabyte TIFF fails with a sentence instead of hanging
 * the tab in `createImageBitmap`.
 */
export const MAX_ALBUM_ART_INPUT_BYTES = 32 * 1024 * 1024;

/** True when `fileName` is one scan-chart reads as album art. */
export function isAlbumArtFileName(fileName: string): boolean {
  return ALBUM_ART_FILE_NAMES.includes(fileName.toLowerCase());
}

/** A normalized cover, ready to be written into a chart package. */
export interface AlbumArtFile {
  fileName: string;
  data: Uint8Array;
}

/**
 * The source rectangle to draw so a `srcWidth`×`srcHeight` image fills a
 * square without distortion: the largest centered square that fits.
 *
 * Cropping rather than letterboxing is deliberate. Covers are square by
 * convention, so the crop is usually a no-op; when it isn't, the image was
 * not a cover in the first place, and a filled frame reads better in-game
 * than one with bars baked into the pixels.
 */
export function coverCropRect(
  srcWidth: number,
  srcHeight: number,
): {sx: number; sy: number; size: number} {
  const size = Math.min(srcWidth, srcHeight);
  return {
    sx: Math.round((srcWidth - size) / 2),
    sy: Math.round((srcHeight - size) / 2),
    size,
  };
}

/** Why a picked file can't become album art, phrased for the user. */
export class AlbumArtError extends Error {}

/**
 * Check a picked file before any decoding work: the cheap rejections, so a
 * wrong drop is answered immediately rather than after a decode attempt.
 * Returns null when the file is worth trying.
 */
export function albumArtInputProblem(file: {
  type: string;
  size: number;
}): string | null {
  if (!ALBUM_ART_ACCEPT.split(',').includes(file.type)) {
    return 'Album art must be a JPEG, PNG or WebP image.';
  }
  if (file.size > MAX_ALBUM_ART_INPUT_BYTES) {
    const mb = Math.round(MAX_ALBUM_ART_INPUT_BYTES / (1024 * 1024));
    return `That image is too large. Pick one under ${mb} MB.`;
  }
  return null;
}

/**
 * Decode `file`, center-crop it square, and re-encode it as a
 * {@link ALBUM_ART_SIZE}-square JPEG named {@link ALBUM_ART_FILE_NAME}.
 *
 * Browser-only: uses `createImageBitmap` and a canvas. Throws
 * {@link AlbumArtError} with a user-facing sentence for anything a person
 * can act on (wrong type, too big, undecodable).
 */
export async function normalizeAlbumArt(file: File): Promise<AlbumArtFile> {
  const problem = albumArtInputProblem(file);
  if (problem) throw new AlbumArtError(problem);

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new AlbumArtError('That image could not be read.');
  }

  try {
    const {sx, sy, size} = coverCropRect(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = ALBUM_ART_SIZE;
    canvas.height = ALBUM_ART_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new AlbumArtError('That image could not be resized.');
    // Downscaling a 3000px cover to 512px in one step aliases badly without
    // this; the browser's smoothing is the cheap fix.
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(
      bitmap,
      sx,
      sy,
      size,
      size,
      0,
      0,
      ALBUM_ART_SIZE,
      ALBUM_ART_SIZE,
    );

    const blob = await new Promise<Blob | null>(resolve =>
      canvas.toBlob(resolve, 'image/jpeg', ALBUM_ART_JPEG_QUALITY),
    );
    if (!blob) throw new AlbumArtError('That image could not be resized.');
    return {
      fileName: ALBUM_ART_FILE_NAME,
      data: new Uint8Array(await blob.arrayBuffer()),
    };
  } finally {
    bitmap.close();
  }
}

/**
 * Replace the album art in a passthrough asset list: every recognized art
 * file is dropped, then `art` (when given) is appended.
 *
 * Returning the whole list is what callers need — the asset manifest is
 * rewritten wholesale — and dropping ALL recognized names is what keeps a
 * package that already had `album.png` from ending up with two covers and a
 * `multipleAlbumArt` issue.
 */
export function withAlbumArt<T extends {fileName: string}>(
  assets: readonly T[],
  art: T | null,
): T[] {
  const rest = assets.filter(a => !isAlbumArtFileName(a.fileName));
  return art ? [...rest, art] : rest;
}
