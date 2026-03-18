/**
 * SNG binary container format writer.
 *
 * Produces a .sng file — an uncompressed container with XOR-masked file data,
 * used by Clone Hero and YARG as an alternative to .zip packaging.
 *
 * Format specification: https://github.com/mdsitton/SngFileFormat
 *
 * Browser-only: uses DataView/Uint8Array/ArrayBuffer. No Node.js Buffer.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Key-value metadata stored in the SNG header (replaces song.ini). */
export interface SngMetadata {
  [key: string]: string;
}

/** A file entry to include in the SNG container. */
export interface SngFileEntry {
  /** Relative filename (e.g. "notes.chart"). Must be <= 255 UTF-8 bytes. */
  filename: string;
  /** Raw file contents as Uint8Array. */
  data: Uint8Array;
}

// ---------------------------------------------------------------------------
// XOR masking
// ---------------------------------------------------------------------------

/**
 * Apply XOR masking to file data. The algorithm from the SNG spec:
 *
 * ```
 * for i = 0 to len(fileBytes) - 1:
 *     xorKey = xorMask[i % 16] XOR (i AND 0xFF)
 *     maskedBytes[i] = fileBytes[i] XOR xorKey
 * ```
 *
 * Masking is symmetric: applying the same operation to masked data
 * produces the original. The `i` counter resets to 0 for each file.
 */
export function maskFileData(
  data: Uint8Array,
  xorMask: Uint8Array,
): Uint8Array {
  const masked = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const xorKey = xorMask[i % 16] ^ (i & 0xff);
    masked[i] = data[i] ^ xorKey;
  }
  return masked;
}

// ---------------------------------------------------------------------------
// Size calculation
// ---------------------------------------------------------------------------

interface SectionSizes {
  headerSize: number;
  metadataPayloadSize: number;
  metadataEntryCount: number;
  fileIndexPayloadSize: number;
  totalFileDataSize: number;
  totalSize: number;
  /** Absolute byte offset where the first file's data begins. */
  fileDataStartOffset: number;
  /** Filtered metadata entries (empty keys/values removed). */
  filteredEntries: [string, string][];
}

function calculateSizes(
  metadata: SngMetadata,
  files: SngFileEntry[],
): SectionSizes {
  const encoder = new TextEncoder();

  // Header: 6 (identifier) + 4 (version) + 16 (xorMask) = 26
  const headerSize = 26;

  // Metadata section: 8 (metadataLen) + 8 (metadataCount) + sum of pairs
  let metadataPayloadSize = 8; // metadataCount
  const entries = Object.entries(metadata).filter(([k, v]) => k && v);
  for (const [key, value] of entries) {
    metadataPayloadSize += 4 + encoder.encode(key).length; // keyLen + key
    metadataPayloadSize += 4 + encoder.encode(value).length; // valueLen + value
  }
  const metadataSectionSize = 8 + metadataPayloadSize; // sectionLen + payload

  // FileIndex section: 8 (fileMetaLen) + 8 (fileCount) + sum of file metas
  let fileIndexPayloadSize = 8; // fileCount
  for (const file of files) {
    fileIndexPayloadSize += 1 + encoder.encode(file.filename).length; // filenameLen + filename
    fileIndexPayloadSize += 8 + 8; // contentsLen + contentsIndex
  }
  const fileIndexSectionSize = 8 + fileIndexPayloadSize; // sectionLen + payload

  // FileData section: 8 (fileDataLen) + sum of file contents
  const totalFileDataSize = files.reduce((sum, f) => sum + f.data.length, 0);
  const fileDataSectionSize = 8 + totalFileDataSize;

  // Total
  const totalSize =
    headerSize + metadataSectionSize + fileIndexSectionSize + fileDataSectionSize;

  // The absolute offset where file data starts (right after the fileDataLen field)
  const fileDataStartOffset =
    headerSize + metadataSectionSize + fileIndexSectionSize + 8;

  return {
    headerSize,
    metadataPayloadSize,
    metadataEntryCount: entries.length,
    fileIndexPayloadSize,
    totalFileDataSize,
    totalSize,
    fileDataStartOffset,
    filteredEntries: entries,
  };
}

// ---------------------------------------------------------------------------
// BigInt helper
// ---------------------------------------------------------------------------

function setBigUint64LE(
  view: DataView,
  offset: number,
  value: bigint,
): void {
  view.setBigUint64(offset, value, true);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Serialize files and metadata into an SNG binary container.
 * Returns the complete .sng file as a Uint8Array.
 *
 * Browser-only: uses DataView/Uint8Array, no Node.js dependencies.
 *
 * @param metadata - Key-value metadata (replaces song.ini in the SNG format).
 * @param files - File entries to include. Filenames must be <= 255 UTF-8 bytes.
 * @returns The complete .sng file as a Uint8Array.
 * @throws If any filename exceeds 255 UTF-8 bytes.
 */
export function buildSngFile(
  metadata: SngMetadata,
  files: SngFileEntry[],
): Uint8Array {
  const sizes = calculateSizes(metadata, files);
  const buffer = new ArrayBuffer(sizes.totalSize);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const encoder = new TextEncoder();
  let offset = 0;

  // --- Header (26 bytes) ---

  // "SNGPKG" identifier
  const identifier = encoder.encode('SNGPKG');
  bytes.set(identifier, offset);
  offset += 6;

  // version = 1
  view.setUint32(offset, 1, true);
  offset += 4;

  // xorMask: 16 random bytes
  const xorMask = crypto.getRandomValues(new Uint8Array(16));
  bytes.set(xorMask, offset);
  offset += 16;

  // --- Metadata Section ---

  // metadataLen (uint64) — byte length of everything after this field
  setBigUint64LE(view, offset, BigInt(sizes.metadataPayloadSize));
  offset += 8;

  // metadataCount (uint64)
  setBigUint64LE(view, offset, BigInt(sizes.metadataEntryCount));
  offset += 8;

  // metadata pairs
  for (const [key, value] of sizes.filteredEntries) {
    const keyBytes = encoder.encode(key);
    view.setInt32(offset, keyBytes.length, true);
    offset += 4;
    bytes.set(keyBytes, offset);
    offset += keyBytes.length;

    const valueBytes = encoder.encode(value);
    view.setInt32(offset, valueBytes.length, true);
    offset += 4;
    bytes.set(valueBytes, offset);
    offset += valueBytes.length;
  }

  // --- FileIndex Section ---

  // fileMetaLen (uint64)
  setBigUint64LE(view, offset, BigInt(sizes.fileIndexPayloadSize));
  offset += 8;

  // fileCount (uint64)
  setBigUint64LE(view, offset, BigInt(files.length));
  offset += 8;

  // file metas — contentsIndex is absolute from start of file
  let fileOffset = sizes.fileDataStartOffset;
  for (const file of files) {
    const filenameBytes = encoder.encode(file.filename);
    if (filenameBytes.length > 255) {
      throw new Error(
        `Filename "${file.filename}" exceeds 255 bytes (got ${filenameBytes.length})`,
      );
    }
    view.setUint8(offset, filenameBytes.length);
    offset += 1;
    bytes.set(filenameBytes, offset);
    offset += filenameBytes.length;
    setBigUint64LE(view, offset, BigInt(file.data.length));
    offset += 8;
    setBigUint64LE(view, offset, BigInt(fileOffset));
    offset += 8;
    fileOffset += file.data.length;
  }

  // --- FileData Section ---

  // fileDataLen (uint64)
  setBigUint64LE(view, offset, BigInt(sizes.totalFileDataSize));
  offset += 8;

  // masked file contents
  for (const file of files) {
    const masked = maskFileData(file.data, xorMask);
    bytes.set(masked, offset);
    offset += masked.length;
  }

  return bytes;
}
