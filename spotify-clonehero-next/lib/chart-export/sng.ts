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

import {parse as parseIni, $NoSection} from '@/lib/ini-parser';
import type {FileEntry} from './types';

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/** Key-value metadata stored in the SNG header (replaces song.ini). */
interface SngMetadata {
  [key: string]: string;
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
function maskFileData(data: Uint8Array, xorMask: Uint8Array): Uint8Array {
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
  fileDataStartOffset: number;
  filteredEntries: [string, string][];
}

function calculateSizes(
  metadata: SngMetadata,
  files: FileEntry[],
): SectionSizes {
  const encoder = new TextEncoder();

  // Header: 6 (identifier) + 4 (version) + 16 (xorMask) = 26
  const headerSize = 26;

  // Metadata section: 8 (metadataLen) + 8 (metadataCount) + sum of pairs
  let metadataPayloadSize = 8; // metadataCount
  const entries = Object.entries(metadata).filter(([k, v]) => k && v);
  for (const [key, value] of entries) {
    metadataPayloadSize += 4 + encoder.encode(key).length;
    metadataPayloadSize += 4 + encoder.encode(value).length;
  }
  const metadataSectionSize = 8 + metadataPayloadSize;

  // FileIndex section: 8 (fileMetaLen) + 8 (fileCount) + sum of file metas
  let fileIndexPayloadSize = 8; // fileCount
  for (const file of files) {
    fileIndexPayloadSize += 1 + encoder.encode(file.filename).length;
    fileIndexPayloadSize += 8 + 8; // contentsLen + contentsIndex
  }
  const fileIndexSectionSize = 8 + fileIndexPayloadSize;

  // FileData section: 8 (fileDataLen) + sum of file contents
  const totalFileDataSize = files.reduce((sum, f) => sum + f.data.length, 0);
  const fileDataSectionSize = 8 + totalFileDataSize;

  const totalSize =
    headerSize + metadataSectionSize + fileIndexSectionSize + fileDataSectionSize;

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
// Core SNG builder
// ---------------------------------------------------------------------------

/**
 * Serialize files and metadata into an SNG binary container.
 *
 * @param metadata - Key-value metadata for the SNG header.
 * @param files - File entries to include. Filenames must be <= 255 UTF-8 bytes.
 * @returns The complete .sng file as a Uint8Array.
 */
function buildSngFile(metadata: SngMetadata, files: FileEntry[]): Uint8Array {
  const sizes = calculateSizes(metadata, files);
  const buffer = new ArrayBuffer(sizes.totalSize);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const encoder = new TextEncoder();
  let offset = 0;

  // --- Header (26 bytes) ---
  const identifier = encoder.encode('SNGPKG');
  bytes.set(identifier, offset);
  offset += 6;

  view.setUint32(offset, 1, true); // version = 1
  offset += 4;

  const xorMask = crypto.getRandomValues(new Uint8Array(16));
  bytes.set(xorMask, offset);
  offset += 16;

  // --- Metadata Section ---
  setBigUint64LE(view, offset, BigInt(sizes.metadataPayloadSize));
  offset += 8;

  setBigUint64LE(view, offset, BigInt(sizes.metadataEntryCount));
  offset += 8;

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
  setBigUint64LE(view, offset, BigInt(sizes.fileIndexPayloadSize));
  offset += 8;

  setBigUint64LE(view, offset, BigInt(files.length));
  offset += 8;

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
  setBigUint64LE(view, offset, BigInt(sizes.totalFileDataSize));
  offset += 8;

  for (const file of files) {
    const masked = maskFileData(file.data, xorMask);
    bytes.set(masked, offset);
    offset += masked.length;
  }

  return bytes;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Package file entries into an SNG binary container.
 *
 * If a `song.ini` file is found among the entries, it is parsed into
 * key-value metadata for the SNG header (the SNG format stores metadata
 * in the header, not as a separate file). The song.ini is then excluded
 * from the packaged files.
 *
 * @param files - Array of {filename, data} entries to include.
 * @returns The complete .sng file as a Uint8Array.
 */
export function exportAsSng(files: FileEntry[]): Uint8Array {
  // Find and extract song.ini for SNG header metadata
  const songIniEntry = files.find(
    f => f.filename.toLowerCase() === 'song.ini',
  );

  let metadata: SngMetadata = {};
  let filteredFiles = files;

  if (songIniEntry) {
    const iniText = new TextDecoder().decode(songIniEntry.data);
    const {iniObject} = parseIni(iniText);

    // Flatten all sections into a single key-value map.
    // song.ini typically has a [song] or [Song] section.
    for (const section of Object.keys(iniObject)) {
      const entries = iniObject[section];
      if (entries) {
        for (const [key, value] of Object.entries(entries)) {
          metadata[key] = value;
        }
      }
    }
    // Also include $NoSection entries if any
    const noSection = iniObject[$NoSection];
    if (noSection) {
      for (const [key, value] of Object.entries(noSection)) {
        metadata[key] = value;
      }
    }

    filteredFiles = files.filter(f => f.filename.toLowerCase() !== 'song.ini');
  }

  return buildSngFile(metadata, filteredFiles);
}
