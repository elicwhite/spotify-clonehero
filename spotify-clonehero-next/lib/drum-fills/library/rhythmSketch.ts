/**
 * A lightweight rhythm "sketch" for a fill card.
 *
 * The library grid can contain thousands of fills, and the full chart note grid
 * is not persisted alongside each fill (only its taxonomy + numeric features).
 * Re-parsing every chart to render real sheet music per card is infeasible, so
 * the card shows a compact, taxonomy-derived rhythm sketch: a small set of
 * evenly-spaced cells across the fill's bars, sized to the subdivision, with the
 * dominant voicing lane(s) highlighted and a crash marker when the fill ends on
 * a crash. The real per-note sheet music (via `convertToVexFlow`) is rendered in
 * the Practice view, where the chart is loaded.
 *
 * Pure + deterministic so it can be unit-tested and rendered identically on
 * server and client.
 */

import type {Subdivision} from '@/lib/local-db/drum-fills';

/** A single lane row of the sketch grid. */
export interface SketchLane {
  /** Lane identity, drives row label + color. */
  voice: 'crash' | 'hat' | 'tom' | 'snare' | 'kick';
  /** One boolean per grid cell; true = a hit is drawn in that cell. */
  cells: boolean[];
}

export interface RhythmSketch {
  /** Number of grid columns (cells per row). */
  columns: number;
  /** Cells per bar (== columns / bars). */
  cellsPerBar: number;
  lanes: SketchLane[];
}

export interface SketchInput {
  subdivision: Subdivision;
  lengthBars: number;
  voicingTags: string[];
  /** Complexity 1..5; scales how densely cells are filled. */
  complexity: number;
}

/** Cells per bar for each subdivision (a 4/4-ish reading). */
function cellsPerBarFor(subdivision: Subdivision): number {
  switch (subdivision) {
    case '8ths':
      return 8;
    case '16ths':
      return 16;
    case 'triplets':
      return 12;
    case 'mixed':
      return 16;
  }
}

// Lanes are drawn top-to-bottom in this order when present.
const LANE_ORDER: SketchLane['voice'][] = [
  'crash',
  'hat',
  'tom',
  'snare',
  'kick',
];

/**
 * Decide which lanes are present from voicing tags. Toms and snare are the
 * workhorses of most fills, so they are shown unless the voicing clearly
 * excludes them; kick is shown when woven in; crash when the fill ends on one.
 */
function lanesFor(voicingTags: string[]): Set<SketchLane['voice']> {
  const tags = new Set(voicingTags);
  const lanes = new Set<SketchLane['voice']>();

  if (tags.has('crash-end')) lanes.add('crash');

  if (tags.has('snare-only')) {
    lanes.add('snare');
  } else {
    // Default fill voicing: toms + snare.
    if (tags.has('toms') || !tags.has('cymbal-work')) lanes.add('tom');
    lanes.add('snare');
  }

  if (tags.has('kick-woven')) lanes.add('kick');

  // Always have at least one melodic lane.
  if (lanes.size === 0 || (lanes.size === 1 && lanes.has('crash'))) {
    lanes.add('snare');
  }

  return lanes;
}

/**
 * Build a deterministic rhythm sketch from a fill's taxonomy. The pattern is a
 * stylized, readable approximation — not a transcription — alternating fills
 * across the melodic lanes with density scaled by complexity, ending on a crash
 * downbeat when tagged.
 */
export function buildRhythmSketch(input: SketchInput): RhythmSketch {
  const cellsPerBar = cellsPerBarFor(input.subdivision);
  // Cap displayed bars at 2 to keep the card compact (longest detected fill).
  const bars = Math.max(1, Math.min(2, Math.round(input.lengthBars) || 1));
  const columns = cellsPerBar * bars;

  const present = lanesFor(input.voicingTags);
  const melodic = LANE_ORDER.filter(v => present.has(v) && v !== 'crash');
  const hasCrash = present.has('crash');

  // Density: at complexity 1, fill ~ every 4th cell; at 5, ~ every cell.
  const clamped = Math.max(1, Math.min(5, Math.round(input.complexity) || 3));
  const step = [4, 3, 2, 2, 1][clamped - 1];

  const lanes: SketchLane[] = [];

  if (hasCrash) {
    const cells = new Array<boolean>(columns).fill(false);
    // Crash on the final downbeat (last bar's first cell), the typical resolve.
    cells[columns - cellsPerBar] = true;
    lanes.push({voice: 'crash', cells});
  }

  // Distribute hits across melodic lanes, round-robin, on the density grid.
  const melodicCells = melodic.map(() =>
    new Array<boolean>(columns).fill(false),
  );
  let laneIdx = 0;
  for (let col = 0; col < columns; col += step) {
    // Leave room for the crash resolve: stop melodic hits on the final downbeat.
    if (hasCrash && col === columns - cellsPerBar) break;
    melodicCells[laneIdx % melodic.length][col] = true;
    laneIdx += 1;
  }

  melodic.forEach((voice, i) => {
    lanes.push({voice, cells: melodicCells[i]});
  });

  // Sort lanes back into canonical top-to-bottom order.
  lanes.sort(
    (a, b) => LANE_ORDER.indexOf(a.voice) - LANE_ORDER.indexOf(b.voice),
  );

  return {columns, cellsPerBar, lanes};
}

// --- Groove sketch ----------------------------------------------------------

/**
 * Voice bitmask used by the canonical groove fingerprint
 * (`lib/drum-fills/detection/grooveFingerprint.ts`). Kept in sync with
 * `VOICE_BITS` there; a fingerprint onset is `slot:mask`.
 */
const GROOVE_VOICE_BITS = {
  kick: 1,
  snare: 2,
  hat: 4,
  tom: 8,
  crash: 16,
} as const;

/** The fine grid of the groove fingerprint (48 divisions per bar). */
const GROOVE_FINE_DIVISIONS = 48;
/** The coarser grid the groove sketch is drawn on (16th notes per bar). */
const GROOVE_SKETCH_CELLS_PER_BAR = 16;

/**
 * Build a rhythm sketch from a canonical groove fingerprint string.
 *
 * The fingerprint is the dominant groove bar serialized as `slot:voiceMask`
 * onsets (pipe-joined), where `slot` is on a 48/bar grid and `voiceMask` is the
 * `GROOVE_VOICE_BITS` bitmask of the voices on that onset (see
 * `canonicalGrooveFingerprint`). Onsets are folded onto a 16th-note grid for a
 * compact, readable single-bar sketch with one lane per voice present.
 *
 * Unlike `buildRhythmSketch` (a stylized, taxonomy-derived approximation of a
 * fill) this is a faithful rendering of the actual groove pattern. Returns an
 * empty sketch (no lanes) for an empty/unparseable fingerprint.
 *
 * Pure + deterministic.
 */
export function buildGrooveSketch(fingerprint: string): RhythmSketch {
  const cellsPerBar = GROOVE_SKETCH_CELLS_PER_BAR;
  const columns = cellsPerBar;
  const fold = GROOVE_FINE_DIVISIONS / cellsPerBar;

  // voice -> cells. Lazily created so absent voices produce no lane.
  const laneCells = new Map<SketchLane['voice'], boolean[]>();
  const cellFor = (voice: SketchLane['voice']): boolean[] => {
    let cells = laneCells.get(voice);
    if (!cells) {
      cells = new Array<boolean>(columns).fill(false);
      laneCells.set(voice, cells);
    }
    return cells;
  };

  for (const token of fingerprint.split('|')) {
    if (!token) continue;
    const [slotStr, maskStr] = token.split(':');
    const slot = Number(slotStr);
    const mask = Number(maskStr);
    if (!Number.isFinite(slot) || !Number.isFinite(mask)) continue;
    const col = Math.min(columns - 1, Math.round(slot / fold));
    for (const voice of LANE_ORDER) {
      const bit = GROOVE_VOICE_BITS[voice as keyof typeof GROOVE_VOICE_BITS];
      if (bit != null && (mask & bit) !== 0) {
        cellFor(voice)[col] = true;
      }
    }
  }

  const lanes: SketchLane[] = LANE_ORDER.filter(v => laneCells.has(v)).map(
    voice => ({voice, cells: cellFor(voice)}),
  );

  return {columns, cellsPerBar, lanes};
}
