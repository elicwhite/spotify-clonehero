'use client';

import {useMemo, useEffect, useRef, useState, useCallback} from 'react';
import {useInView} from 'react-intersection-observer';
import {parseAsString, useQueryState} from 'nuqs';
import {ArrowLeft, Loader2, Search as SearchIcon} from 'lucide-react';
import {toast} from 'sonner';
import {Input} from '@/components/ui/input';
import {Button} from '@/components/ui/button';
import Image from 'next/image';
import debounce from 'debounce';

import LocalChartLoader, {
  type LocalChart,
} from '@/components/chart-picker/LocalChartLoader';
import PreviewViewer, {type PreviewChart} from './PreviewViewer';
import {
  ChartInstruments,
  preFilterInstruments,
} from '@/components/ChartInstruments';
import {
  EncoreResponse,
  searchEncore,
  searchAdvanced,
} from '@/lib/search-encore';
import type {ChartResponseEncore} from '@/lib/chartSelection';
import {
  findAudioFiles,
  getChartFiles,
} from '@/lib/preview/chorus-chart-processing';
import {readChart} from '@/lib/chart-edit';

const instrumentFilter = 'drums';

export default function Search({
  defaultResults,
  initialQuery,
}: {
  defaultResults: EncoreResponse;
  initialQuery?: string;
}) {
  const [searchQuery, setSearchQuery] = useQueryState(
    'q',
    parseAsString.withDefault(''),
  );
  // Deep-linkable selected chart. Cleared on "Back to search".
  const [md5Param, setMd5Param] = useQueryState('md5', parseAsString);

  const [preview, setPreview] = useState<PreviewChart | null>(null);
  const [loadingChart, setLoadingChart] = useState(false);

  const [filteredSongs, setFilteredSongs] =
    useState<EncoreResponse>(defaultResults);
  const [page, setPage] = useState<number>(1);
  const [, setIsLoadingMore] = useState<boolean>(false);
  // In-flight gate for the infinite-scroll fetch — a ref, not state, so
  // flipping the loading flag doesn't loop the effect through its own
  // cleanup (see app/sheet-music/Search.tsx for the full story).
  const fetchInFlightRef = useRef(false);
  const {ref: sentinelRef, inView} = useInView({
    root: null,
    rootMargin: '200px',
    threshold: 0,
  });

  const debouncedFilterSongs = useMemo(
    () =>
      debounce(async (query: string, instrument: undefined | null | string) => {
        const results = await searchEncore(query, instrument, 1);
        setFilteredSongs(results);
        setPage(1);
      }, 500),
    [],
  );
  const searchSongs = useCallback(
    (query: string) => {
      debouncedFilterSongs(query, instrumentFilter);
    },
    [debouncedFilterSongs],
  );

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value;
    setSearchQuery(query);
    searchSongs(query);
  };

  useEffect(() => {
    // initialize query from server if provided
    if (initialQuery && initialQuery !== searchQuery) {
      setSearchQuery(initialQuery);
      searchSongs(initialQuery);
    } else {
      searchSongs(searchQuery);
    }
  }, [searchQuery, searchSongs, initialQuery, setSearchQuery]);

  // Load an Encore chart: download the .sng, parse to a ChartDocument
  // (readChart applies the song.ini overlay incl. delay), pick out audio.
  const loadEncoreChart = useCallback(
    async (track: ChartResponseEncore) => {
      setLoadingChart(true);
      try {
        const files = await getChartFiles(track);
        const chartDoc = readChart(files);
        const audioFiles = findAudioFiles(files);
        if (audioFiles.length === 0) {
          throw new Error('No audio files found in this chart');
        }
        setPreview({metadata: track, chartDoc, audioFiles});
        setMd5Param(track.md5);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Failed to load chart');
      } finally {
        setLoadingChart(false);
      }
    },
    [setMd5Param],
  );

  const handleLocalChart = useCallback(
    (local: LocalChart) => {
      setMd5Param(null);
      setPreview({
        metadata: local.metadata,
        chartDoc: local.chartDoc,
        audioFiles: local.audioFiles,
      });
    },
    [setMd5Param],
  );

  const handleBack = useCallback(() => {
    setPreview(null);
    setMd5Param(null);
  }, [setMd5Param]);

  // Deep link: ?md5= present without a loaded preview (fresh page load) —
  // look the chart up on Encore and load it. Guarded by a ref so
  // StrictMode double-invocation doesn't fetch twice.
  const md5LoadRequestedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!md5Param || preview || loadingChart) return;
    if (md5LoadRequestedRef.current === md5Param) return;
    md5LoadRequestedRef.current = md5Param;
    (async () => {
      const response = await searchAdvanced({hash: md5Param});
      const track = response.data[0];
      if (track) {
        await loadEncoreChart(track);
      } else {
        toast.error('Chart not found');
        setMd5Param(null);
      }
    })().catch(() => toast.error('Failed to load chart'));
  }, [md5Param, preview, loadingChart, loadEncoreChart, setMd5Param]);

  // Infinite scroll — same shape as app/sheet-music/Search.tsx.
  useEffect(() => {
    if (!filteredSongs) return;
    const hasMore = filteredSongs.data.length < filteredSongs.found;
    if (!hasMore || !inView || fetchInFlightRef.current) return;

    fetchInFlightRef.current = true;
    let cancelled = false;
    (async () => {
      setIsLoadingMore(true);
      try {
        const nextPage = page + 1;
        const results = await searchEncore(
          searchQuery,
          instrumentFilter,
          nextPage,
        );
        if (cancelled) return;
        setFilteredSongs(prev => {
          const prevData = prev?.data ?? [];
          const combined = [...prevData, ...results.data];
          const deduped = Array.from(
            new Map(combined.map(chart => [chart.md5, chart])).values(),
          );
          return {
            ...results,
            data: deduped,
            found: results.found,
            out_of: results.out_of,
          };
        });
        setPage(nextPage);
      } finally {
        fetchInFlightRef.current = false;
        if (!cancelled) setIsLoadingMore(false);
      }
    })();

    return () => {
      cancelled = true;
      fetchInFlightRef.current = false;
    };
  }, [filteredSongs, inView, page, searchQuery]);

  if (preview) {
    // Preserve the body's flex column height chain so ChartEditor can
    // fill the viewport below the back-button strip.
    return (
      <div className="flex flex-col flex-1 min-h-0 w-full">
        <div className="px-4 py-1 border-b border-border/60">
          <Button variant="ghost" size="sm" onClick={handleBack}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to search
          </Button>
        </div>
        <div className="flex flex-col flex-1 min-h-0">
          <PreviewViewer
            key={preview.metadata.md5 || preview.metadata.name}
            chart={preview}
          />
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-background w-full">
      <div className="container mx-auto px-4 py-8">
        <header className="mb-8">
          <h1 className="text-3xl sm:text-4xl font-bold mb-2">Chart Preview</h1>
          <p className="text-muted-foreground mb-6 text-sm sm:text-base">
            Preview drum charts on the highway with waveform and sections
          </p>

          <div className="flex flex-col gap-4">
            <div className="relative">
              <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                <SearchIcon className="h-4 w-4 sm:h-5 sm:w-5 text-muted-foreground" />
              </div>
              <Input
                type="search"
                placeholder="Search for songs, artists, charters and more..."
                className="pl-9 sm:pl-10 w-full"
                value={searchQuery}
                onChange={handleSearch}
              />
            </div>

            <details className="group">
              <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground transition-colors list-none [&::-webkit-details-marker]:hidden">
                <span className="group-open:hidden">
                  ▸ Or preview a local chart (folder, .zip, or .sng)
                </span>
                <span className="hidden group-open:inline">
                  ▾ Preview a local chart (folder, .zip, or .sng)
                </span>
              </summary>
              <div className="mt-3 max-w-xl">
                <LocalChartLoader
                  onLoaded={handleLocalChart}
                  id="preview-local-chart"
                  requireDrums={false}
                />
              </div>
            </details>
          </div>
        </header>

        {loadingChart && (
          <div className="flex items-center justify-center gap-3 py-8">
            <Loader2 className="h-6 w-6 animate-spin" />
            <span className="text-muted-foreground">Loading chart...</span>
          </div>
        )}

        <section>
          <h2 className="text-2xl font-semibold mb-4">
            {searchQuery ? 'Search Results' : 'Recently Added Charts'}{' '}
            {filteredSongs != null ? `(${filteredSongs?.found} charts)` : ''}
          </h2>

          {filteredSongs?.data.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground">
                No songs found matching your search.
              </p>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                {filteredSongs &&
                  filteredSongs.data.map(song => (
                    <button
                      type="button"
                      onClick={() => loadEncoreChart(song)}
                      disabled={loadingChart}
                      key={song.md5}
                      className="flex items-stretch w-full text-left bg-card rounded-lg border border-border hover:bg-accent transition-colors cursor-pointer overflow-hidden disabled:opacity-60 disabled:cursor-wait">
                      <div className="flex-shrink-0">
                        <Image
                          src={`https://files.enchor.us/${song.albumArtMd5}.jpg`}
                          alt={`${song.name} album art`}
                          width={160}
                          height={160}
                          className="h-full w-[96px] sm:w-[120px] lg:w-[160px] object-cover"
                        />
                      </div>

                      <div className="flex flex-col flex-grow p-3">
                        <div className="flex-grow">
                          <h3 className="text-sm sm:text-base lg:text-lg font-bold">
                            {song.name}{' '}
                            <span className="text-muted-foreground">by</span>{' '}
                            {song.artist}
                          </h3>
                          <p className="text-sm text-muted-foreground">
                            charted by {song.charter}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-1 sm:gap-2 mt-1 sm:mt-2">
                          <ChartInstruments
                            size="md"
                            classNames="h-5 w-5 sm:h-6 sm:w-6 lg:h-7 lg:w-7"
                            instruments={preFilterInstruments(song)}
                          />
                        </div>
                      </div>
                    </button>
                  ))}
              </div>
              <div ref={sentinelRef} className="h-8" />
            </>
          )}
        </section>
      </div>
    </main>
  );
}
