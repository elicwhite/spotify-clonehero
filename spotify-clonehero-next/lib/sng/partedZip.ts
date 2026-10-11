import {Zip, ZipPassThrough} from 'fflate';

/** A part ends at the first file that would take it past this size. */
export const ZIP_PART_BYTES = 1024 ** 3;

/**
 * A `.zip` built as files arrive and cut into parts at a size limit, for
 * converted `.sng` files that a browser with no folder picker can only hand
 * over as downloads.
 *
 * Files are stored, not compressed: a `.sng` is mostly audio that is already
 * compressed, so deflating it costs time and saves nothing. A part's bytes
 * become one `Blob` when the part ends, and nothing else of it is kept here.
 * A part always holds at least one file, so a single file larger than the
 * limit is a part of its own.
 */
export class PartedZip {
  private zip: Zip | null = null;
  private chunks: Uint8Array[] = [];
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
        const part = new Blob(this.chunks as Uint8Array<ArrayBuffer>[], {
          type: 'application/zip',
        });
        this.chunks = [];
        this.onPart(part);
      }
    });
    this.zip = zip;
    return zip;
  }

  private endPart() {
    this.zip?.end();
    this.zip = null;
    this.partSize = 0;
  }
}
