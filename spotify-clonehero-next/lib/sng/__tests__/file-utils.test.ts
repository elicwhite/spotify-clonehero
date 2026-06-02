import {describe, test, expect} from '@jest/globals';
import {audioMimeType, formatBytes, dedupeByName} from '../file-utils';

describe('audioMimeType', () => {
  test('maps opus and ogg to audio/ogg', () => {
    expect(audioMimeType('song.opus')).toBe('audio/ogg');
    expect(audioMimeType('guitar.ogg')).toBe('audio/ogg');
  });

  test('maps mp3 and wav', () => {
    expect(audioMimeType('song.mp3')).toBe('audio/mpeg');
    expect(audioMimeType('drums.wav')).toBe('audio/wav');
  });

  test('is case-insensitive and falls back to audio/ogg', () => {
    expect(audioMimeType('SONG.OPUS')).toBe('audio/ogg');
    expect(audioMimeType('mystery.bin')).toBe('audio/ogg');
  });
});

describe('formatBytes', () => {
  test('formats bytes, KB, MB', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(1024 * 1024)).toBe('1 MB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5 MB');
  });

  test('handles zero', () => {
    expect(formatBytes(0)).toBe('0 B');
  });
});

describe('dedupeByName', () => {
  test('drops entries colliding with existing names (case-insensitive)', () => {
    const existing = [{fileName: 'notes.chart'}, {fileName: 'song.opus'}];
    const incoming = [{fileName: 'Song.opus'}, {fileName: 'album.png'}];
    const {merged, skipped} = dedupeByName(existing, incoming);
    expect(merged.map(f => f.fileName)).toEqual(['album.png']);
    expect(skipped).toEqual(['Song.opus']);
  });

  test('drops duplicates within the incoming list', () => {
    const incoming = [{fileName: 'a.txt'}, {fileName: 'a.txt'}];
    const {merged, skipped} = dedupeByName([], incoming);
    expect(merged.map(f => f.fileName)).toEqual(['a.txt']);
    expect(skipped).toEqual(['a.txt']);
  });

  test('keeps everything when there are no collisions', () => {
    const incoming = [{fileName: 'a.txt'}, {fileName: 'b.txt'}];
    const {merged, skipped} = dedupeByName([], incoming);
    expect(merged).toHaveLength(2);
    expect(skipped).toHaveLength(0);
  });
});
