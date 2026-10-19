import {Difficulty, Instrument} from '@eliwhite/scan-chart';
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

/**
 * Anchor for the visible portion of the full-width open-note texture.
 *
 * The open texture has transparent padding below its bar, so a centered
 * sprite makes the bar sit below the kick/fret-note hit line. This normalized
 * anchor compensates for that asset padding and matches the kick bar's
 * visible center after each texture's scale is applied.
 */
export const OPEN_NOTE_ANCHOR_Y = 0.36;
/** How far ahead (in ms) to render notes beyond the strikeline. */
export const HIGHWAY_DURATION_MS = 1500;

/** The source flame sheets are presented at the highway's 60 fps cadence. */
export const HIGHWAY_FLAME_FRAME_DURATION_MS = 1000 / 60;

/** How long the fifteen-frame fretted hit flame remains active. */
export const HIGHWAY_FLAME_DURATION_MS = HIGHWAY_FLAME_FRAME_DURATION_MS * 15;

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
  /** Schema/editor lane index; unlike `lane`, this includes Open/Kick lanes. */
  editorLane: number;
}

// ---------------------------------------------------------------------------
// Hit test result
// ---------------------------------------------------------------------------

/**
 * Result of a hit-test raycast against the highway scene. The highway draws
 * and hit-tests notes only (`HIGHWAY_ELEMENT_KINDS` in `cell.ts`), so a hit
 * is either a note or the bare highway plane under the cursor; marker
 * hit-testing belongs to the piano roll.
 */
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
      type: 'highway';
      lane: number;
      tick: number;
      ms: number;
    }
  | null;
