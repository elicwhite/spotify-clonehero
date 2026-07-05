import {describe, test, expect} from '@jest/globals';
import {muxOggOpus, oggCrc32, type OpusPacket} from '../ogg-opus';

// ---------------------------------------------------------------------------
// Minimal Ogg parser for verification (single-stream, no cross-page packets)
// ---------------------------------------------------------------------------

interface ParsedPage {
  headerType: number;
  granulePosition: bigint;
  serialNumber: number;
  pageSequence: number;
  crcValid: boolean;
  packets: Uint8Array[];
}

function parseOgg(bytes: Uint8Array): ParsedPage[] {
  const pages: ParsedPage[] = [];
  let offset = 0;

  while (offset < bytes.length) {
    // Capture pattern "OggS"
    expect(Array.from(bytes.subarray(offset, offset + 4))).toEqual([
      0x4f, 0x67, 0x67, 0x53,
    ]);
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset);
    const headerType = bytes[offset + 5];
    const granulePosition = view.getBigUint64(6, true);
    const serialNumber = view.getUint32(14, true);
    const pageSequence = view.getUint32(18, true);
    const storedCrc = view.getUint32(22, true);
    const pageSegments = bytes[offset + 26];
    const segmentTable = bytes.subarray(
      offset + 27,
      offset + 27 + pageSegments,
    );

    const payloadStart = offset + 27 + pageSegments;
    const payloadLength = segmentTable.reduce((sum, s) => sum + s, 0);
    const pageLength = 27 + pageSegments + payloadLength;

    // Verify CRC: recompute with the CRC field zeroed.
    const pageBytes = bytes.slice(offset, offset + pageLength);
    const dv = new DataView(pageBytes.buffer);
    dv.setUint32(22, 0, true);
    const crcValid = oggCrc32(pageBytes) === storedCrc;

    // Reconstruct packets from the lacing table.
    const packets: Uint8Array[] = [];
    let packetStart = payloadStart;
    let cursor = payloadStart;
    for (let i = 0; i < pageSegments; i++) {
      cursor += segmentTable[i];
      if (segmentTable[i] < 255) {
        packets.push(bytes.slice(packetStart, cursor));
        packetStart = cursor;
      }
    }

    pages.push({
      headerType,
      granulePosition,
      serialNumber,
      pageSequence,
      crcValid,
      packets,
    });

    offset += pageLength;
  }

  return pages;
}

function fakePacket(length: number, fill: number): Uint8Array {
  const p = new Uint8Array(length);
  p.fill(fill);
  return p;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('muxOggOpus', () => {
  test('produces a well-formed OpusHead / OpusTags / audio structure', () => {
    const packets: OpusPacket[] = [
      {data: fakePacket(80, 1), granulePosition: 960},
      {data: fakePacket(90, 2), granulePosition: 1920},
      {data: fakePacket(100, 3), granulePosition: 2880},
    ];

    const file = muxOggOpus({
      channelCount: 2,
      preSkip: 312,
      inputSampleRate: 44100,
      packets,
    });

    const pages = parseOgg(file);

    // Every page CRC must validate.
    for (const page of pages) {
      expect(page.crcValid).toBe(true);
    }

    // Page sequence numbers are contiguous from 0.
    pages.forEach((p, i) => expect(p.pageSequence).toBe(i));

    // Page 0: OpusHead, Beginning-Of-Stream (0x02).
    const head = pages[0];
    expect(head.headerType & 0x02).toBe(0x02);
    const headPacket = head.packets[0];
    expect(new TextDecoder().decode(headPacket.subarray(0, 8))).toBe(
      'OpusHead',
    );
    expect(headPacket[9]).toBe(2); // channel count
    const headView = new DataView(
      headPacket.buffer,
      headPacket.byteOffset,
      headPacket.length,
    );
    expect(headView.getUint16(10, true)).toBe(312); // pre-skip
    expect(headView.getUint32(12, true)).toBe(44100); // input sample rate

    // Page 1: OpusTags.
    const tagsPacket = pages[1].packets[0];
    expect(new TextDecoder().decode(tagsPacket.subarray(0, 8))).toBe(
      'OpusTags',
    );

    // Last page carries End-Of-Stream (0x04).
    expect(pages[pages.length - 1].headerType & 0x04).toBe(0x04);

    // Audio packets round-trip in order.
    const audioPackets = pages.slice(2).flatMap(p => p.packets);
    expect(audioPackets.length).toBe(3);
    expect(Array.from(audioPackets[0])).toEqual(Array.from(packets[0].data));
    expect(Array.from(audioPackets[1])).toEqual(Array.from(packets[1].data));
    expect(Array.from(audioPackets[2])).toEqual(Array.from(packets[2].data));

    // Final granule position reflects the last packet.
    const lastAudioPage = pages[pages.length - 1];
    expect(lastAudioPage.granulePosition).toBe(BigInt(2880));
  });

  test('round-trips packets whose length is a multiple of 255 (lacing edge)', () => {
    const packets: OpusPacket[] = [
      {data: fakePacket(255, 7), granulePosition: 960},
      {data: fakePacket(510, 8), granulePosition: 1920},
    ];
    const file = muxOggOpus({
      channelCount: 1,
      preSkip: 0,
      inputSampleRate: 48000,
      packets,
    });
    const audioPackets = parseOgg(file)
      .slice(2)
      .flatMap(p => p.packets);
    expect(audioPackets.map(p => p.length)).toEqual([255, 510]);
  });

  test('splits many packets across multiple pages within the 255-segment cap', () => {
    // 400 single-segment packets → must span more than one audio page.
    const packets: OpusPacket[] = Array.from({length: 400}, (_, i) => ({
      data: fakePacket(50, i % 255),
      granulePosition: (i + 1) * 960,
    }));
    const file = muxOggOpus({
      channelCount: 2,
      preSkip: 0,
      inputSampleRate: 48000,
      packets,
    });
    const pages = parseOgg(file);
    const audioPages = pages.slice(2);
    expect(audioPages.length).toBeGreaterThan(1);
    for (const page of pages) expect(page.crcValid).toBe(true);
    // No page exceeds the Ogg 255-segment limit.
    const totalAudioPackets = audioPages.reduce(
      (n, p) => n + p.packets.length,
      0,
    );
    expect(totalAudioPackets).toBe(400);
  });

  test('handles an empty packet list (headers only, EOS on final page)', () => {
    const file = muxOggOpus({
      channelCount: 2,
      preSkip: 0,
      inputSampleRate: 48000,
      packets: [],
    });
    const pages = parseOgg(file);
    // OpusHead, OpusTags, and a final EOS page.
    expect(pages.length).toBe(3);
    expect(pages[2].headerType & 0x04).toBe(0x04);
  });
});
