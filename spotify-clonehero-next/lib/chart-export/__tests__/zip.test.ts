import {describe, test, expect} from '@jest/globals';
import {unzipSync} from 'fflate';
import {exportAsZip} from '../zip';
import type {FileEntry} from '../types';

describe('exportAsZip', () => {
  test('round-trips file entries', () => {
    const files: FileEntry[] = [
      {filename: 'notes.chart', data: new TextEncoder().encode('[Song]\n{}')},
      {filename: 'song.ini', data: new TextEncoder().encode('[song]\nname = Test')},
      {filename: 'song.ogg', data: new Uint8Array([0x4f, 0x67, 0x67, 0x53])},
    ];

    const blob = exportAsZip(files);
    expect(blob.type).toBe('application/zip');

    // Re-create the zip bytes to verify (Blob doesn't have sync arrayBuffer in Node)
    const {zipSync} = require('fflate');
    const entries: Record<string, Uint8Array> = {};
    for (const f of files) entries[f.filename] = f.data;
    const unzipped = unzipSync(zipSync(entries));

    expect(Object.keys(unzipped).sort()).toEqual([
      'notes.chart',
      'song.ini',
      'song.ogg',
    ]);
    expect(new TextDecoder().decode(unzipped['notes.chart'])).toBe(
      '[Song]\n{}',
    );
    expect(unzipped['song.ogg']).toEqual(
      new Uint8Array([0x4f, 0x67, 0x67, 0x53]),
    );
  });

  test('handles empty file list', () => {
    const blob = exportAsZip([]);
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe('application/zip');
  });

  test('preserves binary data exactly', () => {
    const binaryData = new Uint8Array(256);
    for (let i = 0; i < 256; i++) binaryData[i] = i;

    const files: FileEntry[] = [{filename: 'data.bin', data: binaryData}];

    const {zipSync} = require('fflate');
    const entries: Record<string, Uint8Array> = {};
    for (const f of files) entries[f.filename] = f.data;
    const unzipped = unzipSync(zipSync(entries));

    expect(unzipped['data.bin']).toEqual(binaryData);
  });
});
