import {Difficulty, Instrument} from '@eliwhite/scan-chart';
import {type DrumPad} from '../../drum-mapping/noteToInstrument';
import type {ParsedChart} from '../chorus-chart-processing';

export type Track = ParsedChart['trackData'][0];
export type NoteGroup = ParsedChart['trackData'][0]['noteEventGroups'][0];
export type Note = NoteGroup[0];
export type NoteType = Note['type'];

export type SelectedTrack = {
  instrument: Instrument;
  difficulty: Difficulty;
};

export type Song = {};

export const SCALE = 0.105;
export const NOTE_SPAN_WIDTH = 0.95;
/** How far ahead (in ms) to render notes beyond the strikeline. */
export const HIGHWAY_DURATION_MS = 1500;

/** DrumPad -> highway lane index (0-3). Kick is handled separately. */
export const PAD_TO_HIGHWAY_LANE: Partial<Record<DrumPad, number>> = {
  red: 0,
  yellow: 1,
  blue: 2,
  green: 3,
};

export const NOTE_COLORS = {
  green: '#01B11A',
  red: '#DD2214',
  yellow: '#DEEB52',
  blue: '#006CAF',
  orange: '#F8B272',
};

export const GUITAR_LANE_COLORS = [
  NOTE_COLORS.green,
  NOTE_COLORS.red,
  NOTE_COLORS.yellow,
  NOTE_COLORS.blue,
  NOTE_COLORS.orange,
];

/**
 * Internal flag for star power notes. Uses a high bit that doesn't collide
 * with any noteFlags value from scan-chart.  Matches chart-preview's SP_FLAG.
 */
export const SP_FLAG = 2147483648;

/** Base path for drum textures in local assets. */
export const DRUM_TEXTURE_PATH = '/assets/preview/assets2/';

/** Flattened, pre-computed data for a single note. */
export interface PreparedNote {
  /** Original note object (needed for getTextureForNote) */
  note: Note;
  /** Time in ms */
  msTime: number;
  /** Sustain length in ms */
  msLength: number;
  /** Pre-computed X position in world space */
  xPosition: number;
  /** Whether this note falls inside a star power section */
  inStarPower: boolean;
  /** True if this is a kick drum note (different scale/center) */
  isKick: boolean;
  /** True if this is an open guitar note (different scale) */
  isOpen: boolean;
  /** Lane index (for sustain colour lookup) -- -1 for kick/open */
  lane: number;
}

// ---------------------------------------------------------------------------
// Hit test result
// ---------------------------------------------------------------------------

/** Result of a hit-test raycast against the highway scene. */
export type HitResult =
  | {
      type: 'note';
      /** Composite key (`tick:type`) matching `noteId()` from commands.ts. */
      noteId: string;
      note: PreparedNote;
      lane: number;
      tick: number;
    }
  | {
      type: 'section';
      tick: number;
      name: string;
    }
  | {
      type: 'lyric';
      tick: number;
      text: string;
    }
  | {
      type: 'phrase-start';
      tick: number;
    }
  | {
      type: 'phrase-end';
      /** Phrase end tick (== phrase.tick + phrase.length). */
      endTick: number;
    }
  | {
      type: 'highway';
      lane: number;
      tick: number;
      ms: number;
    }
  | null;

export function calculateNoteXOffset(instrument: Instrument, lane: number) {
  const leftOffset = instrument == 'drums' ? 0.135 : 0.035;

  return (
    leftOffset +
    -(NOTE_SPAN_WIDTH / 2) +
    SCALE +
    ((NOTE_SPAN_WIDTH - SCALE) / 5) * lane
  );
}
