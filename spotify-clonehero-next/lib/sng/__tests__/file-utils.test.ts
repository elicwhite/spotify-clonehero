import {describe, test, expect} from '@jest/globals';
import {audioMimeType, formatBytes, mergeByName} from '../file-utils';

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

describe('mergeByName', () => {
  test('replaces a same-name file in place (case-insensitive) and appends new ones', () => {
    const existing = [
      {fileName: 'notes.chart', v: 1},
      {fileName: 'song.opus', v: 1},
    ];
    const incoming = [
      {fileName: 'Song.opus', v: 2},
      {fileName: 'album.png', v: 2},
    ];
    const {merged, added, replaced} = mergeByName(existing, incoming);

    // notes.chart untouched; song.opus overwritten in place; album.png appended.
    expect(merged.map(f => f.fileName)).toEqual([
      'notes.chart',
      'Song.opus',
      'album.png',
    ]);
    expect(merged[1].v).toBe(2);
    expect(added).toBe(1);
    expect(replaced).toBe(1);
  });

  test('within incoming, the later same-name entry wins', () => {
    const incoming = [
      {fileName: 'a.txt', v: 1},
      {fileName: 'a.txt', v: 2},
    ];
    const {merged, added, replaced} = mergeByName([], incoming);
    expect(merged).toHaveLength(1);
    expect(merged[0].v).toBe(2);
    expect(added).toBe(1);
    expect(replaced).toBe(0);
  });

  test('appends everything when there are no collisions', () => {
    const incoming = [{fileName: 'a.txt'}, {fileName: 'b.txt'}];
    const {merged, added, replaced} = mergeByName([], incoming);
    expect(merged).toHaveLength(2);
    expect(added).toBe(2);
    expect(replaced).toBe(0);
  });
});
