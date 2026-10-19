/**
 * Ogg container muxer for Opus packets.
 *
 * WebCodecs `AudioEncoder` (codec 'opus') emits *raw* Opus packets, not a
 * playable file. This module wraps those packets in an Ogg bitstream —
 * producing a standard `.opus` file that Clone Hero / YARG (and browsers)
 * can decode.
 *
 * References:
 *   - Ogg encapsulation:   RFC 3533
 *   - Ogg Opus mapping:    RFC 7845 (OpusHead / OpusTags, granule positions)
 *
 * Pure and browser-agnostic: takes packet bytes in, returns file bytes out.
 * No WebCodecs types are referenced here so it can be unit-tested in Node.
 */

// ---------------------------------------------------------------------------
// Ogg CRC (polynomial 0x04C11DB7, no reflection, init 0, no final XOR)
// ---------------------------------------------------------------------------

const OGG_CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let j = 0; j < 8; j++) {
      r = (r & 0x80000000) !== 0 ? (r << 1) ^ 0x04c11db7 : r << 1;
    }
    table[i] = r >>> 0;
  }
  return table;
})();

/** Compute the Ogg page CRC over a full page (with the CRC field zeroed). */
export function oggCrc32(data: Uint8Array): number {
  let crc = 0;
  for (let i = 0; i < data.length; i++) {
    crc = ((crc << 8) ^ OGG_CRC_TABLE[((crc >>> 24) ^ data[i]) & 0xff]) >>> 0;
  }
  return crc >>> 0;
}

// ---------------------------------------------------------------------------
// Page assembly
// ---------------------------------------------------------------------------

const CAPTURE_PATTERN = [0x4f, 0x67, 0x67, 0x53]; // "OggS"

/** Ogg header type flags. */
const enum HeaderType {
  Continued = 0x01,
  BeginningOfStream = 0x02,
  EndOfStream = 0x04,
}

/** Split a packet length into Ogg lacing segment values (bytes of 255 + rem). */
function lacingSegments(length: number): number[] {
  const segments: number[] = [];
  let remaining = length;
  while (remaining >= 255) {
    segments.push(255);
    remaining -= 255;
  }
  segments.push(remaining);
  return segments;
}

function writeUint32LE(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, true);
}

/**
 * Serialize one Ogg page. `packets` are the complete packets carried by this
 * page; their combined lacing must not exceed 255 segments (the caller batches
 * to satisfy this).
 */
function buildPage(params: {
  headerType: number;
  granulePosition: bigint;
  serialNumber: number;
  pageSequence: number;
  packets: Uint8Array[];
}): Uint8Array {
  const {headerType, granulePosition, serialNumber, pageSequence, packets} =
    params;

  const segmentTable: number[] = [];
  for (const packet of packets) {
    segmentTable.push(...lacingSegments(packet.length));
  }
  if (segmentTable.length > 255) {
    throw new Error(
      `Ogg page overflow: ${segmentTable.length} segments (max 255)`,
    );
  }

  const payloadLength = packets.reduce((sum, p) => sum + p.length, 0);
  const headerLength = 27 + segmentTable.length;
  const page = new Uint8Array(headerLength + payloadLength);
  const view = new DataView(page.buffer);

  page.set(CAPTURE_PATTERN, 0);
  page[4] = 0; // stream structure version
  page[5] = headerType;
  view.setBigUint64(6, granulePosition, true);
  writeUint32LE(view, 14, serialNumber);
  writeUint32LE(view, 18, pageSequence);
  writeUint32LE(view, 22, 0); // CRC placeholder
  page[26] = segmentTable.length;
  page.set(segmentTable, 27);

  let offset = headerLength;
  for (const packet of packets) {
    page.set(packet, offset);
    offset += packet.length;
  }

  writeUint32LE(view, 22, oggCrc32(page));
  return page;
}

// ---------------------------------------------------------------------------
// Opus headers (RFC 7845)
// ---------------------------------------------------------------------------

/** Build the OpusHead identification header packet. */
function buildOpusHead(
  channelCount: number,
  preSkip: number,
  inputSampleRate: number,
): Uint8Array {
  const head = new Uint8Array(19);
  const view = new DataView(head.buffer);
  head.set([0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64], 0); // "OpusHead"
  head[8] = 1; // version
  head[9] = channelCount;
  view.setUint16(10, preSkip, true);
  writeUint32LE(view, 12, inputSampleRate);
  view.setUint16(16, 0, true); // output gain
  head[18] = 0; // channel mapping family 0 (mono/stereo)
  return head;
}

/** Build the OpusTags comment header packet with a single vendor string. */
function buildOpusTags(vendor: string): Uint8Array {
  const vendorBytes = new TextEncoder().encode(vendor);
  const tags = new Uint8Array(8 + 4 + vendorBytes.length + 4);
  const view = new DataView(tags.buffer);
  tags.set([0x4f, 0x70, 0x75, 0x73, 0x54, 0x61, 0x67, 0x73], 0); // "OpusTags"
  writeUint32LE(view, 8, vendorBytes.length);
  tags.set(vendorBytes, 12);
  writeUint32LE(view, 12 + vendorBytes.length, 0); // user comment count
  return tags;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** One encoded Opus packet plus its end granule position (48 kHz samples). */
export interface OpusPacket {
  data: Uint8Array;
  /** Total samples decoded up to and including this packet, at 48 kHz. */
  granulePosition: number;
}

export interface MuxOggOpusParams {
  channelCount: number;
  /** Encoder pre-skip in 48 kHz samples (0 if unknown). */
  preSkip: number;
  /** Original input sample rate (informational per RFC 7845). */
  inputSampleRate: number;
  packets: OpusPacket[];
  /** Vendor string for OpusTags. */
  vendor?: string;
}

/** Maximum lacing segments per page; keeps well under the 255 cap per packet. */
const MAX_SEGMENTS_PER_PAGE = 250;

/**
 * Mux raw Opus packets into an Ogg Opus (`.opus`) file.
 *
 * Layout: page 0 = OpusHead (BOS), page 1 = OpusTags, then audio pages, with
 * the End-Of-Stream flag on the last page. Granule positions come from the
 * caller (cumulative 48 kHz sample counts).
 */
export function muxOggOpus({
  channelCount,
  preSkip,
  inputSampleRate,
  packets,
  vendor = 'spotify-clonehero',
}: MuxOggOpusParams): Uint8Array {
  // Fixed serial number: single-stream files don't need randomness, and a
  // constant keeps output deterministic (and testable).
  const serialNumber = 0x00000001;
  const pages: Uint8Array[] = [];
  let pageSequence = 0;

  // Page 0 — OpusHead (Beginning Of Stream).
  pages.push(
    buildPage({
      headerType: HeaderType.BeginningOfStream,
      granulePosition: BigInt(0),
      serialNumber,
      pageSequence: pageSequence++,
      packets: [buildOpusHead(channelCount, preSkip, inputSampleRate)],
    }),
  );

  // Page 1 — OpusTags.
  pages.push(
    buildPage({
      headerType: 0,
      granulePosition: BigInt(0),
      serialNumber,
      pageSequence: pageSequence++,
      packets: [buildOpusTags(vendor)],
    }),
  );

  // Audio pages — batch packets so total lacing stays within a page.
  let batch: Uint8Array[] = [];
  let batchSegments = 0;
  let batchGranule = 0;

  const flush = (isLast: boolean) => {
    if (batch.length === 0 && !isLast) return;
    pages.push(
      buildPage({
        headerType: isLast ? HeaderType.EndOfStream : 0,
        granulePosition: BigInt(batchGranule),
        serialNumber,
        pageSequence: pageSequence++,
        packets: batch,
      }),
    );
    batch = [];
    batchSegments = 0;
  };

  for (let i = 0; i < packets.length; i++) {
    const packet = packets[i];
    const segs = lacingSegments(packet.data.length).length;
    if (batchSegments + segs > MAX_SEGMENTS_PER_PAGE && batch.length > 0) {
      flush(false);
    }
    batch.push(packet.data);
    batchSegments += segs;
    batchGranule = packet.granulePosition;
  }
  // Final page carries EOS even if there were no audio packets.
  flush(true);

  const totalLength = pages.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(totalLength);
  let offset = 0;
  for (const page of pages) {
    out.set(page, offset);
    offset += page.length;
  }
  return out;
}
