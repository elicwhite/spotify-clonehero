'use client';

import {useMemo} from 'react';
import {
  parseAsArrayOf,
  parseAsBoolean,
  parseAsInteger,
  parseAsFloat,
  parseAsString,
  parseAsStringLiteral,
  useQueryState,
  useQueryStates,
} from 'nuqs';
import type {Subdivision} from '@/lib/local-db/drum-fills';
import {
  DEFAULT_LIBRARY_FILTERS,
  FULL_TEMPO_RANGE,
  LIBRARY_SORTS,
  type LibraryFilters,
  type LibrarySort,
  type MasteryFilter,
} from '@/lib/drum-fills/library/filterFills';

const SUBDIVISIONS: Subdivision[] = ['8ths', '16ths', 'triplets', 'mixed'];
const MASTERIES: MasteryFilter[] = ['unpracticed', 'learning', 'mastered'];

/**
 * Library filter state persisted in the URL search params (shareable, survives
 * reload). nuqs serializes only non-default values, so a clean library has a
 * clean URL. The returned `filters` object is the same shape the existing pure
 * `filterFills` consumes; `setFilters` accepts a full `LibraryFilters` so the
 * FilterPanel keeps its `(next) => void` contract unchanged.
 */
export function useLibraryFilters(): {
  filters: LibraryFilters;
  setFilters: (next: LibraryFilters) => void;
  reset: () => void;
} {
  const [raw, setRaw] = useQueryStates(
    {
      q: parseAsString.withDefault(''),
      sub: parseAsArrayOf(parseAsStringLiteral(SUBDIVISIONS)).withDefault([]),
      len: parseAsArrayOf(parseAsFloat).withDefault([]),
      voice: parseAsArrayOf(parseAsString).withDefault([]),
      cxMin: parseAsInteger.withDefault(DEFAULT_LIBRARY_FILTERS.minComplexity),
      cxMax: parseAsInteger.withDefault(DEFAULT_LIBRARY_FILTERS.maxComplexity),
      tMin: parseAsInteger.withDefault(FULL_TEMPO_RANGE[0]),
      tMax: parseAsInteger.withDefault(FULL_TEMPO_RANGE[1]),
      mastery: parseAsArrayOf(parseAsStringLiteral(MASTERIES)).withDefault([]),
    },
    {history: 'replace', clearOnDefault: true},
  );

  const filters = useMemo<LibraryFilters>(
    () => ({
      search: raw.q,
      subdivisions: raw.sub,
      lengthBars: raw.len,
      voicingTags: raw.voice,
      minComplexity: raw.cxMin,
      maxComplexity: raw.cxMax,
      minTempo: raw.tMin,
      maxTempo: raw.tMax,
      mastery: raw.mastery,
    }),
    [raw],
  );

  const setFilters = (next: LibraryFilters) =>
    void setRaw({
      q: next.search,
      sub: next.subdivisions,
      len: next.lengthBars,
      voice: next.voicingTags,
      cxMin: next.minComplexity,
      cxMax: next.maxComplexity,
      tMin: next.minTempo,
      tMax: next.maxTempo,
      mastery: next.mastery,
    });

  const reset = () => void setRaw(null);

  return {filters, setFilters, reset};
}

/**
 * Library view options persisted in the URL alongside the filters: whether the
 * grid is grouped by unique fill pattern (cross-song dedupe, default on) and the
 * sort order. Kept separate from `useLibraryFilters` because they don't feed the
 * pure `filterFills` predicate. Defaults serialize to a clean URL.
 */
export function useLibraryView(): {
  grouped: boolean;
  setGrouped: (v: boolean) => void;
  sort: LibrarySort;
  setSort: (v: LibrarySort) => void;
} {
  const [grouped, setGroupedRaw] = useQueryState(
    'grouped',
    parseAsBoolean.withDefault(true),
  );
  const [sort, setSortRaw] = useQueryState(
    'sort',
    parseAsStringLiteral(LIBRARY_SORTS).withDefault('default'),
  );
  return {
    grouped,
    setGrouped: v => void setGroupedRaw(v),
    sort,
    setSort: v => void setSortRaw(v),
  };
}
