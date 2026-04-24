import {describe, test, expect} from '@jest/globals';
import {SngStream} from '@eliwhite/parse-sng';
import type {SngHeader} from '@eliwhite/parse-sng';
import {exportAsSng} from '../sng';
import type {FileEntry} from '../types';

// ---------------------------------------------------------------------------
// Helper: parse SNG bytes back using parse-sng
// ---------------------------------------------------------------------------

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

describe('exportAsSng', () => {
  test('extracts song.ini into SNG header metadata', async () => {
    const songIni = '[song]\nname = Test Song\nartist = Test Artist\npro_drums = True';
    const files: FileEntry[] = [
      {filename: 'notes.chart', data: new TextEncoder().encode('[Song]\n{}')},
      {filename: 'song.ini', data: new TextEncoder().encode(songIni)},
      {filename: 'song.ogg', data: new Uint8Array([1, 2, 3])},
    ];

    const sngBytes = exportAsSng(files);
    const {header, files: parsedFiles} = await parseSngBuffer(sngBytes);

    // song.ini should be in header metadata, not as a file
    expect(header.metadata['name']).toBe('Test Song');
    expect(header.metadata['artist']).toBe('Test Artist');
    expect(header.metadata['pro_drums']).toBe('True');

    // Files should NOT include song.ini
    expect(parsedFiles.has('song.ini')).toBe(false);
    expect(parsedFiles.size).toBe(2);
    expect(parsedFiles.has('notes.chart')).toBe(true);
    expect(parsedFiles.has('song.ogg')).toBe(true);
  });

  test('file data round-trips correctly', async () => {
    const chartData = new TextEncoder().encode('[ExpertDrums]\n{\n  0 = N 0 0\n}');
    const audioData = new Uint8Array(256);
    for (let i = 0; i < 256; i++) audioData[i] = i;

    const files: FileEntry[] = [
      {filename: 'notes.chart', data: chartData},
      {filename: 'song.ini', data: new TextEncoder().encode('[song]\nname = RT')},
      {filename: 'drums.wav', data: audioData},
    ];

    const sngBytes = exportAsSng(files);
    const {files: parsedFiles} = await parseSngBuffer(sngBytes);

    expect(new TextDecoder().decode(parsedFiles.get('notes.chart')!)).toBe(
      '[ExpertDrums]\n{\n  0 = N 0 0\n}',
    );
    expect(parsedFiles.get('drums.wav')).toEqual(audioData);
  });

  test('works without song.ini (empty metadata)', async () => {
    const files: FileEntry[] = [
      {filename: 'notes.chart', data: new TextEncoder().encode('chart data')},
    ];

    const sngBytes = exportAsSng(files);
    const {header, files: parsedFiles} = await parseSngBuffer(sngBytes);

    expect(Object.keys(header.metadata)).toHaveLength(0);
    expect(parsedFiles.size).toBe(1);
    expect(parsedFiles.has('notes.chart')).toBe(true);
  });

  test('song.ini matching is case-insensitive', async () => {
    const files: FileEntry[] = [
      {filename: 'notes.chart', data: new TextEncoder().encode('data')},
      {filename: 'Song.INI', data: new TextEncoder().encode('[song]\nname = CaseTest')},
    ];

    const sngBytes = exportAsSng(files);
    const {header, files: parsedFiles} = await parseSngBuffer(sngBytes);

    expect(header.metadata['name']).toBe('CaseTest');
    expect(parsedFiles.has('Song.INI')).toBe(false);
    expect(parsedFiles.size).toBe(1);
  });

  test('SNG header has correct identifier and version', async () => {
    const files: FileEntry[] = [
      {filename: 'test.txt', data: new TextEncoder().encode('hello')},
    ];

    const sngBytes = exportAsSng(files);
    const {header} = await parseSngBuffer(sngBytes);

    expect(header.fileIdentifier).toBe('SNGPKG');
    expect(header.version).toBe(1);
    expect(header.xorMask).toHaveLength(16);
  });
});
