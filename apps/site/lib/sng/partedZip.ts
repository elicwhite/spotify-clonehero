import {Zip, ZipPassThrough} from 'fflate';

/**
 * A part ends at the first file that would take it past this size. It must
 * stay well under 4 GiB: fflate writes no ZIP64 records, so a larger archive
 * cannot address its own entries.
 */
export const ZIP_PART_BYTES = 1024 ** 3;

/**
 * A `.zip` built as files arrive and cut into parts at a size limit, for
 * converted `.sng` files that a browser with no folder picker can only hand
 * over as downloads.
 *
 * Files are stored, not compressed: a `.sng` is mostly audio that is already
 * compressed, so deflating it costs time and saves nothing. Each file's bytes
 * become a `Blob` as soon as they are written, and a finished part is a `Blob`
 * of those `Blob`s, which the browser joins without copying. A part always
 * holds at least one file, so a single file larger than the limit is a part
 * of its own.
 */
export class PartedZip {
  private zip: Zip | null = null;
  /** The zip's output since the last file ended: never more than one file. */
  private chunks: Uint8Array[] = [];
  private written: Blob[] = [];
  private partSize = 0;

  constructor(
    private readonly onPart: (part: Blob) => void,
    private readonly partBytes = ZIP_PART_BYTES,
  ) {}

  add(path: string, data: Uint8Array) {
    if (this.zip && this.partSize + data.length > this.partBytes) {
      this.endPart();
    }
    const zip = this.zip ?? this.startPart();
    const file = new ZipPassThrough(path);
    zip.add(file);
    file.push(data, true);
    this.partSize += data.length;
    // fflate passes `data` through without copying it. Moving it into a Blob
    // now lets the array go as soon as the caller is done with it, so a part
    // is held only as Blobs, which a browser may keep on disk.
    this.flushChunks();
  }

  /** Ends the last part. Adds nothing if no file was added since the last part. */
  finish() {
    if (this.zip) this.endPart();
  }

  private startPart(): Zip {
    const zip = new Zip((error, chunk, final) => {
      if (error) throw error;
      this.chunks.push(chunk);
      if (final) {
        this.flushChunks();
        const part = new Blob(this.written, {type: 'application/zip'});
        this.written = [];
        this.onPart(part);
      }
    });
    this.zip = zip;
    return zip;
  }

  private flushChunks() {
    if (this.chunks.length === 0) return;
    this.written.push(new Blob(this.chunks as Uint8Array<ArrayBuffer>[]));
    this.chunks = [];
  }

  private endPart() {
    this.zip?.end();
    this.zip = null;
    this.partSize = 0;
  }
}
