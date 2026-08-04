/**
 * The difficulty-generation contracts that more than one layer has to agree
 * on (plan 0074 Design D), in a module with no worker or client code so a
 * test — or `components/chart-editor/commands.ts` — can import them without
 * pulling in the worker's `self`-scoped code or the client's worker-spawning
 * code:
 *
 * - the `postMessage` protocol between `difficulty-worker.ts` and
 *   `difficulty-client.ts`;
 * - the tier payload the task produces and `GenerateDifficultiesCommand`
 *   installs. One declaration, so a field added or renamed on the producing
 *   side is a type error on the consuming side rather than silent data loss.
 */

import type {NoteType} from '@eliwhite/scan-chart';
import type {OursOutNote} from '@/lib/drum-difficulty/ours/reduce';
import type {OursSongInput} from '@/lib/drum-difficulty/ours/featurize';
import type {ParsedChart} from '@/lib/preview/chorus-chart-processing';
import type {Track} from '@/lib/preview/highway/types';

/** The instrument a generation run reduces. Bass reuses the guitar reducer
 * (owner-validated 2026-08-03: "the guitar lower difficulty generation
 * algorithms work great for Bass too"), so a worker request for bass carries
 * the same shape as guitar's. */
export type DifficultyInstrument = 'drums' | 'guitar' | 'bass';

export interface DrumDifficultyTiers {
  kind: 'drums';
  hard: OursOutNote[];
  medium: OursOutNote[];
  easy: OursOutNote[];
}

export interface GuitarDifficultyTiers {
  kind: 'guitar';
  hard: Track;
  medium: Track;
  easy: Track;
}

export type DifficultyTiers = DrumDifficultyTiers | GuitarDifficultyTiers;

export type DifficultyWorkerRequest =
  | {type: 'run'; instrument: 'drums'; input: OursSongInput}
  | {
      type: 'run';
      instrument: 'guitar' | 'bass';
      chart: ParsedChart;
      expertTrack: Track;
    };

export type DifficultyWorkerMessage =
  | {type: 'progress'; percent: number; detail?: string | undefined}
  | {type: 'result'; tiers: DifficultyTiers}
  | {type: 'error'; message: string};

// ---------------------------------------------------------------------------
// Tier payload — produced by `difficulty-tiers.ts`, consumed by
// `GenerateDifficultiesCommand`
// ---------------------------------------------------------------------------

/** One reduced note, in scan-chart's own terms (raw `NoteType` + flag
 *  bitmask), so it works for any `InstrumentSchema`'s lanes. Structurally a
 *  `SchemaNote` with its optional fields filled in, which is what
 *  `GenerateDifficultiesCommand` hands to `addNote`. */
export interface DifficultyTierNote {
  tick: number;
  type: NoteType;
  length: number;
  flags: number;
}

/** A tick range on a generated tier (star power, rejected star power, solo).
 *  Ticks only: `GenerateDifficultiesCommand` derives `msTime`/`msLength` from
 *  the target doc's own tempo map, same as it does for notes. */
export interface DifficultyTierRange {
  tick: number;
  length: number;
}

/** A generated tier's flex (drum roll / trill) lane range. */
export interface DifficultyTierLane extends DifficultyTierRange {
  isDouble: boolean;
}

/** Everything a reducer authors for one generated difficulty. The reducers
 *  predict phrase ranges as well as notes (`reduceGuitarDifficulties`'s
 *  `decodeTier` returns star power, rejected star power, solos and flex lanes
 *  per tier), so the payload carries them through to the command that
 *  installs the track. Every list is required: a producer that stops filling
 *  one must say so here, rather than silently installing a track without it. */
export interface DifficultyTierContent {
  notes: readonly DifficultyTierNote[];
  starPowerSections: readonly DifficultyTierRange[];
  rejectedStarPowerSections: readonly DifficultyTierRange[];
  soloSections: readonly DifficultyTierRange[];
  flexLanes: readonly DifficultyTierLane[];
}

/** The three generated difficulty tiers, keyed by `Difficulty` name. */
export interface DifficultyTierSet {
  hard: DifficultyTierContent;
  medium: DifficultyTierContent;
  easy: DifficultyTierContent;
}
