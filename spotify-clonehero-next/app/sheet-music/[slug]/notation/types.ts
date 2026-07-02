/**
 * Data model shared by the notation engine (notation/engine.ts) and the chart
 * parser (../convertToVexflow.ts).
 */

/** One notehead: staff key plus our fill-note identity and dynamics. */
export interface Head {
  /** VexFlow staff key, e.g. 'c/5' or 'g/5/x2'. */
  key: string;
  /**
   * Stable fill-note id (see lib/drum-fills/midi/noteId.ts), or null when the
   * note has no drum-lane identity.
   */
  id: string | null;
  accent: boolean;
  ghost: boolean;
}

export interface TupletMeta {
  id: number;
  numNotes: number;
  notesOccupied: number;
}

/** A written note or rest, in the parallel-array shape VexFlow consumes. */
export interface Note {
  notes: string[];
  /**
   * Stable fill-note id per notehead (parallel to `notes`), or null for
   * noteheads with no drum-lane identity (e.g. rests). Lets the drum-fills
   * practice overlay correlate a rendered notehead with a scoring judgment.
   */
  noteIds: (string | null)[];
  /** Base written value ('w'|'h'|'q'|'8'|...); no 'd'/'r' suffixes. */
  duration: string;
  dots: number;
  isRest: boolean;
  /** Notated tick (grid position within the measure). */
  tick: number;
  /**
   * The hit's original chart tick, before any grid regularization moved its
   * written position. Only present on hits; drives the audio time (`ms`).
   */
  sourceTick?: number | undefined;
  /**
   * Audio time of the hit, from `sourceTick`, so the playhead reaches the
   * notehead exactly when it sounds. 0 for rests (rests have no playhead
   * entry).
   */
  ms: number;
  tupletId?: number | undefined;
  /** Flam grace-note chords (staff keys), earliest first. */
  graceNotes?: string[][] | undefined;
  /** Fill-note ids parallel to `graceNotes` chords. */
  graceNoteIds?: (string | null)[][] | undefined;
  /** Staff keys of accented noteheads. */
  accents?: string[] | undefined;
  /** Staff keys of ghost noteheads. */
  ghosts?: string[] | undefined;
}
