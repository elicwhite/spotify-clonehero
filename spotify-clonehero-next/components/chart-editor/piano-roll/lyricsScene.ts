/**
 * Lyrics-row scene derivation for the piano-roll timeline (plan 0063 Part D).
 *
 * Builds syllable chips + phrase bands from the SAME `chartDoc.parsedChart.
 * vocalTracks` data the highway's karaoke overlay reads (`useHighwaySync`),
 * so the two views never disagree about lyric content or timing. Pure: no
 * React, no canvas.
 *
 * Scoped to a single vocal part (`'vocals'` by default) — the piano roll's
 * lyrics row only surfaces the primary part the Add Lyrics dialog writes
 * (plan 0063 Part C); harmony parts stay highway/inspector-only.
 */

import {tickToMs} from '@/lib/drum-transcription/timing';
import type {TimedTempo} from '@/lib/drum-transcription/chart-types';
import {lyricId, DEFAULT_VOCALS_PART} from '@/lib/chart-edit';
import type {NormalizedVocalTrack} from '@/lib/chart-edit';

/** One syllable, positioned in real time, with its owning phrase's tick
 *  bounds (the clamp range a drag must respect — mirrors `moveLyric`). */
export interface LyricChip {
  /** Shared selection/entity id (`lyricId`) — matches `state.selection`. */
  id: string;
  tick: number;
  ms: number;
  text: string;
  phraseMinTick: number;
  phraseMaxTick: number;
}

/** A vocal phrase's span, for the row's background band. `tick`/`tickEnd`
 *  are the phrase's own start/end ticks (`phrase.tick` /
 *  `phrase.tick + phrase.length`) — the same values `phraseStartId`/
 *  `phraseEndId` key off of, so a band-edge drag can identify its entity
 *  without re-deriving it from `ms`. */
export interface LyricBand {
  tick: number;
  tickEnd: number;
  ms: number;
  msEnd: number;
}

export interface LyricsRowScene {
  chips: LyricChip[];
  bands: LyricBand[];
}

/**
 * Strip Clone Hero/Rock Band lyric markup (see `lib/karaoke/parse-lyrics.ts`
 * for the full symbol legend) down to a chip's display text: drops control
 * events (`[...]`, `+`), the leading harmony-hidden `$`, and trailing flag
 * characters, and turns the `§`/`_` space-escapes into a literal space.
 * Returns `''` for a lyric event that carries no visible text (e.g. a bare
 * pitch-slide `+` marker) — the caller skips chips with empty text.
 */
export function cleanLyricChipText(raw: string): string {
  if (raw.startsWith('[') || raw === '+') return '';
  let t = raw;
  if (t.startsWith('$')) t = t.slice(1);
  while (t.length > 0 && '-=#^*%/+'.includes(t[t.length - 1])) {
    t = t.slice(0, -1);
  }
  return t.split('§').join(' ').split('_').join(' ');
}

/**
 * Build the lyrics row's chips + phrase bands for `partName` (default
 * `'vocals'`). Empty when the part has no lyrics — the caller uses that to
 * decide whether the row renders at all.
 */
export function buildLyricsRowScene(
  vocalTracks: NormalizedVocalTrack | undefined,
  timedTempos: TimedTempo[],
  resolution: number,
  partName: string = DEFAULT_VOCALS_PART,
): LyricsRowScene {
  const part = vocalTracks?.parts?.[partName];
  const chips: LyricChip[] = [];
  const bands: LyricBand[] = [];
  if (!part) return {chips, bands};

  for (const phrase of part.notePhrases) {
    if (phrase.lyrics.length === 0) continue;
    bands.push({
      tick: phrase.tick,
      tickEnd: phrase.tick + phrase.length,
      ms: tickToMs(phrase.tick, timedTempos, resolution),
      msEnd: tickToMs(phrase.tick + phrase.length, timedTempos, resolution),
    });
    for (const lyric of phrase.lyrics) {
      const text = cleanLyricChipText(lyric.text);
      if (!text) continue;
      chips.push({
        id: lyricId(lyric.tick, partName),
        tick: lyric.tick,
        ms: tickToMs(lyric.tick, timedTempos, resolution),
        text,
        phraseMinTick: phrase.tick,
        phraseMaxTick: phrase.tick + phrase.length,
      });
    }
  }
  chips.sort((a, b) => a.tick - b.tick);
  return {chips, bands};
}
