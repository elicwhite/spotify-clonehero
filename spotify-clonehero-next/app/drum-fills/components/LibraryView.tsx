'use client';

import {useCallback, useEffect, useMemo, useState} from 'react';
import {toast} from 'sonner';
import {Button} from '@/components/ui/button';
import {
  getAttemptStats,
  getGroupedLibrary,
  hasFillsNeedingRescan,
  queryFills,
  type FillWithSrs,
  type GroupedFill,
} from '@/lib/drum-fills/db';
import {useDrumFillsChrome} from '../contexts/DrumFillsChromeContext';
import {useLibraryFilters, useLibraryView} from '../hooks/useLibraryFilters';
import {
  filterFills,
  hasActiveFilters,
  sortFills,
  availableVoicingTags,
  type LibrarySort,
} from '@/lib/drum-fills/library/filterFills';
import FilterPanel from './FilterPanel';
import FillGrid from './FillGrid';
import GroupedFillGrid from './GroupedFillGrid';
import {FillGridSkeleton} from './FillGridSkeleton';

type LoadState = 'loading' | 'ready';

const SORT_LABELS: Record<LibrarySort, string> = {
  default: 'Default',
  'difficulty-asc': 'Difficulty ↑',
  'difficulty-desc': 'Difficulty ↓',
  'tempo-asc': 'Tempo ↑',
  'tempo-desc': 'Tempo ↓',
};

export default function LibraryView({
  onPracticeFill,
}: {
  onPracticeFill: (fillId: string) => void;
}) {
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [fills, setFills] = useState<FillWithSrs[]>([]);
  const [groups, setGroups] = useState<GroupedFill[]>([]);
  const [needsRescan, setNeedsRescan] = useState(false);
  const [attemptStats, setAttemptStats] = useState<
    Map<string, {count: number; lastTs: number}>
  >(new Map());
  const {filters, setFilters, reset} = useLibraryFilters();
  const {grouped, setGrouped, sort, setSort} = useLibraryView();

  const loadFills = useCallback((): Promise<number> => {
    return Promise.all([
      queryFills({}),
      getGroupedLibrary({}),
      getAttemptStats(),
      hasFillsNeedingRescan(),
    ])
      .then(([rows, grouped, stats, stale]) => {
        setFills(rows);
        setGroups(grouped);
        setAttemptStats(stats);
        setNeedsRescan(stale);
        return rows.length;
      })
      .catch(err => {
        console.error('Failed to load fills', err);
        toast.error('Could not load saved fills.');
        return 0;
      })
      .finally(() => {
        setLoadState('ready');
      });
  }, []);

  useEffect(() => {
    void loadFills();
  }, [loadFills]);

  // The scan/rescan control lives in the shared header `[H]`; the Library reads
  // the shared scan state (for the rescan banner) and triggers the same scan.
  // LibraryRoute re-keys this view on scan completion, so a finished scan
  // reloads the grid.
  const {scanning, runScan} = useDrumFillsChrome();

  const voicingTags = useMemo(() => availableVoicingTags(fills), [fills]);

  // Ungrouped: in-memory filter + sort.
  const visibleFills = useMemo(
    () => sortFills(filterFills(fills, filters), sort),
    [fills, filters, sort],
  );

  // Grouped: getGroupedLibrary applied DB-level taxonomy filters; apply the
  // remaining in-memory predicates (search/tempo/mastery) against each group's
  // representative, then sort.
  const visibleGroups = useMemo(() => {
    const reps = groups.map(g => g.representative);
    const kept = new Set(filterFills(reps, filters).map(f => f.id));
    const filtered = groups.filter(g => kept.has(g.representative.id));
    return sortFills(
      filtered.map(g => ({
        ...g,
        // sortFills reads difficultyScore + tempoBpm; expose group-level values.
        tempoBpm: g.tempoMedian,
      })),
      sort,
    );
  }, [groups, filters, sort]);

  const active = hasActiveFilters(filters);
  const hasData = fills.length > 0;
  const resultCount = grouped ? visibleGroups.length : visibleFills.length;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {needsRescan && hasData && !scanning && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
          <p className="text-sm text-amber-900">
            Some fills predate cross-song grouping and the difficulty score.
            Rescan to dedupe duplicates across songs and enable difficulty
            sorting + ladders.
          </p>
          <Button onClick={runScan} disabled={scanning} size="sm">
            Rescan Library
          </Button>
        </div>
      )}

      {loadState === 'loading' ? (
        <FillGridSkeleton />
      ) : !hasData && !scanning ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <h2 className="text-xl font-semibold">No fills yet</h2>
          <p className="max-w-md text-muted-foreground">
            Scan your Clone Hero Songs folder to detect drum fills across your
            library. Everything runs in your browser.
          </p>
          <Button onClick={runScan} disabled={scanning}>
            {scanning ? 'Scanning…' : 'Scan Library'}
          </Button>
        </div>
      ) : (
        <>
          {hasData && (
            <FilterPanel
              filters={filters}
              onChange={setFilters}
              voicingTags={voicingTags}
              onReset={reset}
              hasActive={active}
              resultCount={resultCount}
              extras={
                <div className="flex items-center gap-3">
                  <div className="flex overflow-hidden rounded-md border text-xs">
                    <button
                      onClick={() => setGrouped(true)}
                      className={
                        'px-2.5 py-1 font-medium transition-colors ' +
                        (grouped
                          ? 'bg-primary text-primary-foreground'
                          : 'hover:bg-muted')
                      }>
                      Grouped
                    </button>
                    <button
                      onClick={() => setGrouped(false)}
                      className={
                        'px-2.5 py-1 font-medium transition-colors ' +
                        (!grouped
                          ? 'bg-primary text-primary-foreground'
                          : 'hover:bg-muted')
                      }>
                      All instances
                    </button>
                  </div>
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    Sort
                    <select
                      name="library-sort"
                      value={sort}
                      onChange={e => setSort(e.target.value as LibrarySort)}
                      className="rounded border bg-background px-2 py-1 text-xs">
                      {(Object.keys(SORT_LABELS) as LibrarySort[]).map(s => (
                        <option key={s} value={s}>
                          {SORT_LABELS[s]}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              }
            />
          )}

          {hasData && resultCount === 0 ? (
            <p className="py-10 text-center text-muted-foreground">
              No fills match the current filters.
            </p>
          ) : grouped ? (
            <GroupedFillGrid
              groups={visibleGroups}
              onPracticeFill={onPracticeFill}
            />
          ) : (
            <FillGrid
              fills={visibleFills}
              attemptStats={attemptStats}
              onPracticeFill={onPracticeFill}
            />
          )}
        </>
      )}
    </div>
  );
}
