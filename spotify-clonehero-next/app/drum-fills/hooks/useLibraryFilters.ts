'use client';

import {
  DEFAULT_LIBRARY_FILTERS,
  type LibraryFilters,
  type LibrarySort,
} from '@/lib/drum-fills/library/filterFills';
import {useLocalStorageState} from './useLocalStorageState';

/**
 * Library filter state persisted in localStorage (survives reload). The
 * returned `filters` is the shape the pure `filterFills` consumes; `setFilters`
 * takes a full `LibraryFilters` so the FilterPanel keeps its contract.
 */
export function useLibraryFilters(): {
  filters: LibraryFilters;
  setFilters: (next: LibraryFilters) => void;
  reset: () => void;
} {
  const [filters, setFilters] = useLocalStorageState<LibraryFilters>(
    'drum-fills:library-filters',
    DEFAULT_LIBRARY_FILTERS,
  );
  return {
    filters,
    setFilters,
    reset: () => setFilters(DEFAULT_LIBRARY_FILTERS),
  };
}

interface LibraryView {
  grouped: boolean;
  sort: LibrarySort;
}

const DEFAULT_LIBRARY_VIEW: LibraryView = {grouped: true, sort: 'default'};

/**
 * Library view options persisted in localStorage: whether the grid is grouped
 * by unique fill pattern (cross-song dedupe, default on) and the sort order.
 * Kept separate from `useLibraryFilters` because they don't feed the pure
 * `filterFills` predicate.
 */
export function useLibraryView(): {
  grouped: boolean;
  setGrouped: (v: boolean) => void;
  sort: LibrarySort;
  setSort: (v: LibrarySort) => void;
} {
  const [view, setView] = useLocalStorageState<LibraryView>(
    'drum-fills:library-view',
    DEFAULT_LIBRARY_VIEW,
  );
  return {
    grouped: view.grouped,
    setGrouped: grouped => setView(prev => ({...prev, grouped})),
    sort: view.sort,
    setSort: sort => setView(prev => ({...prev, sort})),
  };
}
