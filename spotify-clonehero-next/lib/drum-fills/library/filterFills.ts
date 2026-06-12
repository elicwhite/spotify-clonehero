/**
 * Client-side filtering + searching of the loaded fill library.
 *
 * The DB layer (`queryFills`) already applies taxonomy filters at the SQL
 * level, but the Library UI keeps the full result set in memory and re-filters
 * interactively (text search, tempo range, mastery state) without a round-trip.
 * These pure functions back that UI; they are unit-tested independently.
 */

import type {
  FillWithSrs,
  Subdivision,
  SrsState,
} from '@/lib/local-db/drum-fills';

export type MasteryFilter = SrsState | 'unpracticed';

export interface LibraryFilters {
  /** Free-text query matched against song + artist (case-insensitive). */
  search: string;
  /** Empty array means "any". */
  subdivisions: Subdivision[];
  /** Length in bars; empty means "any". */
  lengthBars: number[];
  /** Voicing tags; a fill must contain ALL selected tags. */
  voicingTags: string[];
  /** Inclusive complexity bounds (1..5). */
  minComplexity: number;
  maxComplexity: number;
  /** Inclusive tempo (BPM) bounds. */
  minTempo: number;
  maxTempo: number;
  /**
   * Mastery states to include. A fill with no SRS row is treated as
   * 'unpracticed'. Empty means "any".
   */
  mastery: MasteryFilter[];
}

export const FULL_TEMPO_RANGE: readonly [number, number] = [40, 300];

export const DEFAULT_LIBRARY_FILTERS: LibraryFilters = {
  search: '',
  subdivisions: [],
  lengthBars: [],
  voicingTags: [],
  minComplexity: 1,
  maxComplexity: 5,
  minTempo: FULL_TEMPO_RANGE[0],
  maxTempo: FULL_TEMPO_RANGE[1],
  mastery: [],
};

/** The mastery bucket a fill falls into, used for filtering + badges. */
export function masteryOf(fill: FillWithSrs): MasteryFilter {
  return fill.srs ? fill.srs.state : 'unpracticed';
}

function matchesSearch(fill: FillWithSrs, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === '') return true;
  return (
    fill.song.toLowerCase().includes(q) || fill.artist.toLowerCase().includes(q)
  );
}

/** Apply the in-memory library filters to a list of fills. Pure. */
export function filterFills(
  fills: FillWithSrs[],
  filters: LibraryFilters,
): FillWithSrs[] {
  return fills.filter(fill => {
    if (!matchesSearch(fill, filters.search)) return false;

    if (
      filters.subdivisions.length > 0 &&
      !filters.subdivisions.includes(fill.subdivision)
    ) {
      return false;
    }

    if (
      filters.lengthBars.length > 0 &&
      !filters.lengthBars.includes(fill.lengthBars)
    ) {
      return false;
    }

    if (
      filters.voicingTags.length > 0 &&
      !filters.voicingTags.every(tag => fill.voicingTags.includes(tag))
    ) {
      return false;
    }

    if (
      fill.complexity < filters.minComplexity ||
      fill.complexity > filters.maxComplexity
    ) {
      return false;
    }

    if (fill.tempoBpm < filters.minTempo || fill.tempoBpm > filters.maxTempo) {
      return false;
    }

    if (
      filters.mastery.length > 0 &&
      !filters.mastery.includes(masteryOf(fill))
    ) {
      return false;
    }

    return true;
  });
}

/** True when the filters differ from the defaults (i.e. something is active). */
export function hasActiveFilters(filters: LibraryFilters): boolean {
  return (
    filters.search.trim() !== '' ||
    filters.subdivisions.length > 0 ||
    filters.lengthBars.length > 0 ||
    filters.voicingTags.length > 0 ||
    filters.minComplexity !== DEFAULT_LIBRARY_FILTERS.minComplexity ||
    filters.maxComplexity !== DEFAULT_LIBRARY_FILTERS.maxComplexity ||
    filters.minTempo !== DEFAULT_LIBRARY_FILTERS.minTempo ||
    filters.maxTempo !== DEFAULT_LIBRARY_FILTERS.maxTempo ||
    filters.mastery.length > 0
  );
}

/**
 * Distinct voicing tags present across a set of fills, sorted, so the filter UI
 * only offers tags that actually occur in the user's library.
 */
export function availableVoicingTags(fills: FillWithSrs[]): string[] {
  const set = new Set<string>();
  for (const fill of fills) {
    for (const tag of fill.voicingTags) set.add(tag);
  }
  return [...set].sort();
}
