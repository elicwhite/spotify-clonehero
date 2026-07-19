/**
 * Lyrics-row scene derivation (plan 0063 Part D): syllable chips + phrase
 * bands built from `vocalTracks`, and the markup-stripping used for a chip's
 * display text.
 */

import {buildLyricsRowScene, cleanLyricChipText} from '../lyricsScene';
import type {NormalizedVocalTrack} from '@/lib/chart-edit';
import type {TimedTempo} from '@/lib/drum-transcription/chart-types';

const TIMED_TEMPOS: TimedTempo[] = [{tick: 0, beatsPerMinute: 120, msTime: 0}];
const RES = 480; // 480 ticks = 500ms @ 120 BPM

function vocalTracks(
  phrases: {
    tick: number;
    length: number;
    lyrics: {tick: number; text: string}[];
  }[],
): NormalizedVocalTrack {
  return {
    parts: {
      vocals: {
        notePhrases: phrases.map(p => ({
          tick: p.tick,
          msTime: 0,
          length: p.length,
          msLength: 0,
          isPercussion: false,
          notes: p.lyrics.map(l => ({
            tick: l.tick,
            msTime: 0,
            length: 0,
            msLength: 0,
          })),
          lyrics: p.lyrics.map(l => ({
            tick: l.tick,
            msTime: 0,
            text: l.text,
            flags: 0,
          })),
        })),
        staticLyricPhrases: [],
        starPowerSections: [],
        rangeShifts: [],
      },
    },
    rangeShifts: [],
    lyricShifts: [],
  } as unknown as NormalizedVocalTrack;
}

describe('cleanLyricChipText', () => {
  it('strips trailing flag characters', () => {
    expect(cleanLyricChipText('Hel-')).toBe('Hel');
    expect(cleanLyricChipText('lo=')).toBe('lo');
    expect(cleanLyricChipText('la#')).toBe('la');
  });

  it('strips a leading harmony-hidden $', () => {
    expect(cleanLyricChipText('$word')).toBe('word');
  });

  it('turns space-escapes into a literal space', () => {
    expect(cleanLyricChipText('a§b')).toBe('a b');
    expect(cleanLyricChipText('a_b')).toBe('a b');
  });

  it('returns empty for control events and bare pitch-slide markers', () => {
    expect(cleanLyricChipText('[section]')).toBe('');
    expect(cleanLyricChipText('+')).toBe('');
  });
});

describe('buildLyricsRowScene', () => {
  it('builds one chip per lyric and one band per lyric-bearing phrase', () => {
    const vt = vocalTracks([
      {
        tick: 0,
        length: 960,
        lyrics: [
          {tick: 0, text: 'Hel-'},
          {tick: 240, text: 'lo'},
        ],
      },
    ]);
    const scene = buildLyricsRowScene(vt, TIMED_TEMPOS, RES);
    expect(scene.chips.map(c => c.text)).toEqual(['Hel', 'lo']);
    expect(scene.chips.map(c => c.tick)).toEqual([0, 240]);
    expect(scene.chips[0].ms).toBeCloseTo(0, 5);
    expect(scene.chips[1].ms).toBeCloseTo(250, 5); // 240 ticks @ 120bpm/480res
    expect(scene.chips.every(c => c.phraseMinTick === 0)).toBe(true);
    expect(scene.chips.every(c => c.phraseMaxTick === 960)).toBe(true);
    expect(scene.bands).toEqual([{tick: 0, tickEnd: 960, ms: 0, msEnd: 1000}]);
  });

  it('sorts chips by tick across phrases', () => {
    const vt = vocalTracks([
      {tick: 960, length: 480, lyrics: [{tick: 1200, text: 'second'}]},
      {tick: 0, length: 480, lyrics: [{tick: 0, text: 'first'}]},
    ]);
    const scene = buildLyricsRowScene(vt, TIMED_TEMPOS, RES);
    expect(scene.chips.map(c => c.text)).toEqual(['first', 'second']);
  });

  it('skips lyric events with no visible text (e.g. a bare "+" marker)', () => {
    const vt = vocalTracks([
      {
        tick: 0,
        length: 480,
        lyrics: [
          {tick: 0, text: 'word'},
          {tick: 240, text: '+'},
        ],
      },
    ]);
    const scene = buildLyricsRowScene(vt, TIMED_TEMPOS, RES);
    expect(scene.chips).toHaveLength(1);
    expect(scene.chips[0].text).toBe('word');
  });

  it('omits a phrase with no lyrics from the bands (no false line structure)', () => {
    const vt = vocalTracks([
      {tick: 0, length: 480, lyrics: []},
      {tick: 480, length: 480, lyrics: [{tick: 480, text: 'word'}]},
    ]);
    const scene = buildLyricsRowScene(vt, TIMED_TEMPOS, RES);
    expect(scene.bands).toHaveLength(1);
    expect(scene.bands[0].tick).toBe(480);
  });

  it('returns empty when the part is missing (row hidden)', () => {
    const scene = buildLyricsRowScene(undefined, TIMED_TEMPOS, RES);
    expect(scene.chips).toEqual([]);
    expect(scene.bands).toEqual([]);
  });

  it('ids chips with the shared lyricId format ("part:tick")', () => {
    const vt = vocalTracks([
      {tick: 0, length: 480, lyrics: [{tick: 240, text: 'word'}]},
    ]);
    const scene = buildLyricsRowScene(vt, TIMED_TEMPOS, RES);
    expect(scene.chips[0].id).toBe('vocals:240');
  });
});
