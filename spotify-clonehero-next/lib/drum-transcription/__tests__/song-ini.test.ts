/**
 * Tests for the song.ini serializer.
 *
 * Validates:
 * - Correct INI format with [song] section
 * - Required fields are always present
 * - Optional fields use correct defaults
 * - Windows line endings (\r\n)
 * - Special characters in metadata
 * - Round-trip through the INI parser
 */

import {describe, test, expect} from '@jest/globals';
import {serializeSongIni} from '../chart-io/song-ini';
import type {SongMetadata} from '../chart-io/song-ini';
import {parse as parseIni} from '@/lib/ini-parser';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal SongMetadata with sensible defaults. */
function makeMeta(overrides: Partial<SongMetadata> = {}): SongMetadata {
  return {
    name: 'Test Song',
    artist: 'Test Artist',
    durationMs: 180000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('song-ini serializer', () => {
  test('output starts with [song] section header', () => {
    const ini = serializeSongIni(makeMeta());
    expect(ini.startsWith('[song]\r\n')).toBe(true);
  });

  test('uses Windows line endings (\\r\\n)', () => {
    const ini = serializeSongIni(makeMeta());

    // Every line should end with \r\n
    const lines = ini.split('\r\n');
    // Last element should be empty (trailing \r\n)
    expect(lines[lines.length - 1]).toBe('');
    // No bare \n without \r
    expect(ini.replace(/\r\n/g, '')).not.toContain('\n');
  });

  test('contains all required fields', () => {
    const ini = serializeSongIni(makeMeta());

    expect(ini).toContain('name = Test Song');
    expect(ini).toContain('artist = Test Artist');
    expect(ini).toContain('charter = AutoDrums');
    expect(ini).toContain('diff_drums = -1');
    expect(ini).toContain('song_length = 180000');
    expect(ini).toContain('pro_drums = True');
    expect(ini).toContain('delay = 0');
    expect(ini).toContain('preview_start_time = 0');
  });

  test('includes optional fields when provided', () => {
    const ini = serializeSongIni(
      makeMeta({
        album: 'Test Album',
        genre: 'rock',
        year: '2024',
        charter: 'CustomCharter',
        diffDrums: 5,
        previewStartTime: 30000,
        delay: 100,
      }),
    );

    expect(ini).toContain('album = Test Album');
    expect(ini).toContain('genre = rock');
    expect(ini).toContain('year = 2024');
    expect(ini).toContain('charter = CustomCharter');
    expect(ini).toContain('diff_drums = 5');
    expect(ini).toContain('preview_start_time = 30000');
    expect(ini).toContain('delay = 100');
  });

  test('defaults optional fields when not provided', () => {
    const ini = serializeSongIni(makeMeta());

    expect(ini).toContain('album = ');
    expect(ini).toContain('genre = ');
    expect(ini).toContain('year = ');
    expect(ini).toContain('charter = AutoDrums');
    expect(ini).toContain('diff_drums = -1');
    expect(ini).toContain('preview_start_time = 0');
    expect(ini).toContain('delay = 0');
  });

  test('rounds durationMs to integer for song_length', () => {
    const ini = serializeSongIni(makeMeta({durationMs: 123456.789}));
    expect(ini).toContain('song_length = 123457');
  });

  test('handles special characters in song name', () => {
    const ini = serializeSongIni(
      makeMeta({name: 'Don\'t Stop Me Now (Queen)'}),
    );
    expect(ini).toContain('name = Don\'t Stop Me Now (Queen)');
  });

  test('handles unicode characters', () => {
    const ini = serializeSongIni(
      makeMeta({
        name: 'Cafe\u0301 del Mar',
        artist: 'Bj\u00f6rk',
      }),
    );
    expect(ini).toContain('name = Cafe\u0301 del Mar');
    expect(ini).toContain('artist = Bj\u00f6rk');
  });

  test('handles empty strings in required fields', () => {
    const ini = serializeSongIni(makeMeta({name: '', artist: ''}));
    expect(ini).toContain('name = \r\n');
    expect(ini).toContain('artist = \r\n');
  });

  test('round-trips through the INI parser', () => {
    const meta = makeMeta({
      album: 'Great Album',
      genre: 'metal',
      year: '2023',
      charter: 'DrumBot',
      diffDrums: 7,
      previewStartTime: 45000,
      delay: 50,
    });

    const iniText = serializeSongIni(meta);
    const {iniObject, iniErrors} = parseIni(iniText);

    expect(iniErrors).toHaveLength(0);

    const song = iniObject['song'];
    expect(song).toBeDefined();
    expect(song['name']).toBe('Test Song');
    expect(song['artist']).toBe('Test Artist');
    expect(song['album']).toBe('Great Album');
    expect(song['genre']).toBe('metal');
    expect(song['year']).toBe('2023');
    expect(song['charter']).toBe('DrumBot');
    expect(song['diff_drums']).toBe('7');
    expect(song['preview_start_time']).toBe('45000');
    expect(song['song_length']).toBe('180000');
    expect(song['delay']).toBe('50');
    expect(song['pro_drums']).toBe('True');
  });

  test('pro_drums is always True', () => {
    const ini = serializeSongIni(makeMeta());
    expect(ini).toContain('pro_drums = True');
  });

  test('handles very long song duration', () => {
    // 2 hours in ms
    const ini = serializeSongIni(makeMeta({durationMs: 7200000}));
    expect(ini).toContain('song_length = 7200000');
  });

  test('handles zero duration', () => {
    const ini = serializeSongIni(makeMeta({durationMs: 0}));
    expect(ini).toContain('song_length = 0');
  });
});
