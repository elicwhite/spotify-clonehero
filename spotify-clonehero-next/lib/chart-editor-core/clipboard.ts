/**
 * Editor clipboard payload + the pure offset arithmetic paste is built on.
 *
 * The clipboard stores content in ANCHOR-RELATIVE form so it can be pasted
 * anywhere in the song:
 *
 *  - Notes carry tick offsets from the earliest copied note. Ticks are the
 *    right unit here because `resolution` (ticks per quarter note) is a
 *    chart-level constant: neither a tempo change nor a time-signature change
 *    alters how many ticks a beat is worth. A tick delta is therefore already
 *    a beat-relative delta, and replaying it verbatim at the destination
 *    reproduces the exact subdivision structure the notes were copied from (a
 *    sixteenth stays a sixteenth) no matter how the tempo map differs between
 *    source and destination. Routing the deltas through milliseconds would do
 *    the opposite: it would preserve wall-clock spacing and smear the notes
 *    off the grid the moment the destination tempo differs.
 *  - Lyrics carry millisecond offsets from the earliest copied lyric. Vocal
 *    syllables are sung against the clock, not the grid, so the wall-clock
 *    spacing is the thing worth keeping when they land in a region with a
 *    different tempo.
 */

import type {SchemaNote} from '@/components/chart-editor/commands';
import type {EditorScope} from '@/components/chart-editor/scope';
import type {TimedTempo} from '@/lib/drum-transcription/chart-types';
import {snapTickToGrid} from '@/lib/chart-edit';
import {msToTick, tickToMs} from '@/lib/drum-transcription/timing';

/** One copied syllable: its raw event text (markup intact, so a paste
 *  round-trips hyphenation and pitch-slide markers) and its offset in
 *  milliseconds from the earliest copied syllable. */
export interface ClipboardLyric {
  offsetMs: number;
  text: string;
}

/**
 * What a copy/cut put on the editor clipboard. `sourceScope` names the scope
 * the notes came from so paste can translate them lane-by-lane into the
 * target track's `InstrumentSchema` rather than reusing raw `NoteType`s.
 */
export interface EditorClipboard {
  /** Notes with ticks relative to the earliest copied note. */
  notes: SchemaNote[];
  /** Syllables with ms offsets relative to the earliest copied syllable. */
  lyrics: ClipboardLyric[];
  sourceScope: EditorScope;
}

/** True when a clipboard holds nothing paste can act on. */
export function isClipboardEmpty(
  clipboard: EditorClipboard | null,
): clipboard is null {
  return (
    clipboard === null ||
    (clipboard.notes.length === 0 && clipboard.lyrics.length === 0)
  );
}

/**
 * Rebase absolute-tick notes onto the earliest of them, producing the
 * clipboard's anchor-relative form. Returns an empty array for an empty
 * input.
 */
export function toClipboardNotes(notes: readonly SchemaNote[]): SchemaNote[] {
  if (notes.length === 0) return [];
  const minTick = Math.min(...notes.map(n => n.tick));
  return notes.map(n => ({...n, tick: n.tick - minTick}));
}

/**
 * Rebase absolute-tick syllables onto the earliest of them, converting the
 * spacing to milliseconds through the SOURCE tempo map.
 */
export function toClipboardLyrics(
  lyrics: readonly {tick: number; text: string}[],
  timedTempos: TimedTempo[],
  resolution: number,
): ClipboardLyric[] {
  if (lyrics.length === 0) return [];
  const sorted = [...lyrics].sort((a, b) => a.tick - b.tick);
  const baseMs = tickToMs(sorted[0].tick, timedTempos, resolution);
  return sorted.map(l => ({
    offsetMs: tickToMs(l.tick, timedTempos, resolution) - baseMs,
    text: l.text,
  }));
}

/**
 * Where a note paste starts: the playhead, snapped by the editor's current
 * grid division. `gridDivision` 0 means free placement, in which case the
 * playhead tick is used as-is (rounded to a whole tick). Never negative.
 *
 * Snapping goes through `lib/chart-edit`'s `snapTickToGrid`, the editor's one
 * lattice, so a pasted note lands where a note dropped by hand at the same
 * playhead would. `lib/drum-transcription/timing`'s `snapToGrid` counts
 * divisions per quarter note instead, which is the transcription pipeline's
 * convention and a factor of four away from the snap control's labels.
 */
export function pasteAnchorTick(
  playheadTick: number,
  resolution: number,
  gridDivision: number,
): number {
  if (playheadTick <= 0) return 0;
  if (gridDivision <= 0) return Math.round(playheadTick);
  return Math.max(0, snapTickToGrid(playheadTick, resolution, gridDivision));
}

/**
 * Place clipboard notes at `anchorTick`, preserving their tick deltas (and
 * therefore their subdivision structure) exactly. The first note lands on
 * the anchor.
 */
export function pasteNotesAt(
  notes: readonly SchemaNote[],
  anchorTick: number,
): SchemaNote[] {
  return notes.map(n => ({...n, tick: anchorTick + n.tick}));
}

/**
 * Place clipboard syllables so the first lands EXACTLY on `anchorTick` and
 * the rest keep their original spacing in real time, re-expressed through
 * the DESTINATION tempo map.
 */
export function pasteLyricsAt(
  lyrics: readonly ClipboardLyric[],
  anchorTick: number,
  timedTempos: TimedTempo[],
  resolution: number,
): {tick: number; text: string}[] {
  if (lyrics.length === 0) return [];
  const anchorMs = tickToMs(anchorTick, timedTempos, resolution);
  return lyrics.map(l => ({
    tick:
      l.offsetMs === 0
        ? anchorTick
        : Math.max(
            0,
            Math.round(
              msToTick(anchorMs + l.offsetMs, timedTempos, resolution),
            ),
          ),
    text: l.text,
  }));
}
