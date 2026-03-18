/**
 * Tests for the SNG binary container export.
 *
 * Validates round-trip compatibility: we write with buildSngFile, then read
 * back with parse-sng's SngStream, and verify header, metadata, and file
 * contents match exactly.
 */

import {describe, test, expect} from '@jest/globals';
import {buildSngFile, maskFileData} from '../export/sng';
import type {SngMetadata, SngFileEntry} from '../export/sng';
import {SngStream} from 'parse-sng';
import type {SngHeader} from 'parse-sng';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse an SNG buffer using parse-sng and return header + files.
 * parse-sng uses ReadableStream, so we wrap the buffer in one.
 */
async function parseSngBuffer(
  sngBytes: Uint8Array,
): Promise<{header: SngHeader; files: Map<string, Uint8Array>}> {
  return new Promise((resolve, reject) => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(sngBytes);
        controller.close();
      },
    });

    const sngStream = new SngStream(stream);
    let header: SngHeader;
    const files = new Map<string, Uint8Array>();

    sngStream.on('header', h => {
      header = h;
    });

    sngStream.on('file', async (fileName, fileStream, nextFile) => {
      const reader = fileStream.getReader();
      const chunks: Uint8Array[] = [];
      while (true) {
        const {done, value} = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      const totalLen = chunks.reduce((sum, c) => sum + c.length, 0);
      const merged = new Uint8Array(totalLen);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }
      files.set(fileName, merged);

      if (nextFile) {
        nextFile();
      } else {
        resolve({header: header!, files});
      }
    });

    sngStream.on('error', reject);
    sngStream.start();
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SNG export', () => {
  test('minimal SNG round-trips through parse-sng', async () => {
    const metadata: SngMetadata = {name: 'Test Song', artist: 'Test Artist'};
    const chartContent = new TextEncoder().encode(
      '[Song]\n{\n  Name = "Test"\n}\n',
    );
    const files: SngFileEntry[] = [
      {filename: 'notes.chart', data: chartContent},
    ];

    const sngBytes = buildSngFile(metadata, files);
    const {header, files: parsedFiles} = await parseSngBuffer(sngBytes);

    // Verify header
    expect(header.fileIdentifier).toBe('SNGPKG');
    expect(header.version).toBe(1);
    expect(header.xorMask).toHaveLength(16);

    // Verify metadata
    expect(header.metadata['name']).toBe('Test Song');
    expect(header.metadata['artist']).toBe('Test Artist');

    // Verify files
    expect(parsedFiles.has('notes.chart')).toBe(true);
    const parsedChart = new TextDecoder().decode(
      parsedFiles.get('notes.chart')!,
    );
    expect(parsedChart).toBe('[Song]\n{\n  Name = "Test"\n}\n');
  });

  test('multiple files round-trip correctly', async () => {
    const metadata: SngMetadata = {name: 'Multi File Test'};
    const file1 = new TextEncoder().encode('file 1 contents');
    const file2 = new Uint8Array([0x00, 0xff, 0x80, 0x01, 0xfe]);
    const file3 = new TextEncoder().encode('third file with more data');

    const sngBytes = buildSngFile(metadata, [
      {filename: 'notes.chart', data: file1},
      {filename: 'drums.wav', data: file2},
      {filename: 'song.wav', data: file3},
    ]);

    const {files} = await parseSngBuffer(sngBytes);

    expect(files.size).toBe(3);
    expect(new TextDecoder().decode(files.get('notes.chart')!)).toBe(
      'file 1 contents',
    );
    expect(files.get('drums.wav')).toEqual(file2);
    expect(new TextDecoder().decode(files.get('song.wav')!)).toBe(
      'third file with more data',
    );
  });

  test('XOR masking produces different bytes than input', () => {
    const data = new Uint8Array(256).fill(0x42);
    const xorMask = new Uint8Array(16).fill(0xab);
    const masked = maskFileData(data, xorMask);

    // Masked data should differ from original (unless xorKey happens to be 0)
    let diffCount = 0;
    for (let i = 0; i < data.length; i++) {
      if (masked[i] !== data[i]) diffCount++;
    }
    expect(diffCount).toBeGreaterThan(200); // most bytes should differ
  });

  test('XOR masking is symmetric', () => {
    const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const xorMask = crypto.getRandomValues(new Uint8Array(16));
    const masked = maskFileData(data, xorMask);
    const unmasked = maskFileData(masked, xorMask);
    expect(unmasked).toEqual(data);
  });

  test('empty file round-trips', async () => {
    const metadata: SngMetadata = {name: 'Empty'};
    const sngBytes = buildSngFile(metadata, [
      {filename: 'empty.txt', data: new Uint8Array(0)},
    ]);

    const {files} = await parseSngBuffer(sngBytes);
    expect(files.get('empty.txt')!.length).toBe(0);
  });

  test('large file round-trips', async () => {
    // 1MB of pseudo-random data (crypto.getRandomValues has a 64KB limit
    // in some environments, so fill in chunks)
    const largeData = new Uint8Array(1024 * 1024);
    for (let offset = 0; offset < largeData.length; offset += 65536) {
      const chunk = Math.min(65536, largeData.length - offset);
      crypto.getRandomValues(largeData.subarray(offset, offset + chunk));
    }
    const metadata: SngMetadata = {name: 'Large File'};
    const sngBytes = buildSngFile(metadata, [
      {filename: 'big.bin', data: largeData},
    ]);

    const {files} = await parseSngBuffer(sngBytes);
    expect(files.get('big.bin')).toEqual(largeData);
  });

  test('metadata with all song.ini fields round-trips', async () => {
    const metadata: SngMetadata = {
      name: 'Full Metadata Song',
      artist: 'Test Artist',
      album: 'Test Album',
      genre: 'Rock',
      year: '2024',
      charter: 'AutoDrums',
      song_length: '240000',
      diff_drums: '-1',
      pro_drums: 'True',
      delay: '0',
      preview_start_time: '55000',
    };

    const sngBytes = buildSngFile(metadata, [
      {filename: 'notes.chart', data: new Uint8Array(0)},
    ]);

    const {header} = await parseSngBuffer(sngBytes);

    for (const [key, value] of Object.entries(metadata)) {
      expect(header.metadata[key]).toBe(value);
    }
  });

  test('unicode metadata round-trips', async () => {
    const metadata: SngMetadata = {
      name: 'Bohemian Rhapsody',
      artist: 'Freddie Mercury & Queen',
      loading_phrase: 'Scaramouche, scaramouche',
    };

    const sngBytes = buildSngFile(metadata, [
      {filename: 'notes.chart', data: new Uint8Array(0)},
    ]);

    const {header} = await parseSngBuffer(sngBytes);
    expect(header.metadata['loading_phrase']).toBe(
      'Scaramouche, scaramouche',
    );
  });

  test('filename longer than 255 bytes throws', () => {
    const longName = 'a'.repeat(256) + '.txt';
    expect(() =>
      buildSngFile({}, [{filename: longName, data: new Uint8Array(0)}]),
    ).toThrow(/exceeds 255 bytes/);
  });

  test('contentsIndex values are correct absolute offsets', async () => {
    const file1 = new Uint8Array([1, 2, 3]);
    const file2 = new Uint8Array([4, 5, 6, 7, 8]);
    const metadata: SngMetadata = {name: 'Offsets'};

    const sngBytes = buildSngFile(metadata, [
      {filename: 'a.txt', data: file1},
      {filename: 'b.txt', data: file2},
    ]);

    const {header} = await parseSngBuffer(sngBytes);

    // Verify contentsLen
    expect(header.fileMeta[0].contentsLen).toBe(BigInt(3));
    expect(header.fileMeta[1].contentsLen).toBe(BigInt(5));

    // Verify second file index = first file index + first file length
    const firstIndex = header.fileMeta[0].contentsIndex;
    const secondIndex = header.fileMeta[1].contentsIndex;
    expect(secondIndex).toBe(firstIndex + BigInt(3));
  });

  test('full integration: chart + audio round-trips', async () => {
    // Build a realistic SNG with chart text and fake WAV data
    const chartText = [
      '[Song]',
      '{',
      '  Name = "Integration Test"',
      '  Resolution = 480',
      '}',
      '[SyncTrack]',
      '{',
      '  0 = TS 4',
      '  0 = B 120000',
      '}',
      '[Events]',
      '{',
      '}',
      '[ExpertDrums]',
      '{',
      '  0 = N 0 0',
      '  480 = N 1 0',
      '}',
    ].join('\r\n') + '\r\n';

    // Fake WAV: RIFF header + silence
    const wavHeader = new Uint8Array(44);
    const wavView = new DataView(wavHeader.buffer);
    new TextEncoder().encodeInto('RIFF', wavHeader);
    wavView.setUint32(4, 36, true);
    new TextEncoder().encodeInto('WAVE', wavHeader.subarray(8));

    const metadata: SngMetadata = {
      name: 'Integration Test',
      artist: 'Bot',
      charter: 'AutoDrums',
      pro_drums: 'True',
      diff_drums: '-1',
      song_length: '5000',
    };

    const sngBytes = buildSngFile(metadata, [
      {filename: 'notes.chart', data: new TextEncoder().encode(chartText)},
      {filename: 'drums.wav', data: wavHeader},
      {filename: 'song.wav', data: wavHeader},
    ]);

    const {header, files} = await parseSngBuffer(sngBytes);

    // Metadata check
    expect(header.metadata['name']).toBe('Integration Test');
    expect(header.metadata['pro_drums']).toBe('True');

    // File count check
    expect(files.size).toBe(3);

    // Chart content check
    const parsedChart = new TextDecoder().decode(files.get('notes.chart')!);
    expect(parsedChart).toContain('[ExpertDrums]');
    expect(parsedChart).toContain('0 = N 0 0');
  });
});
