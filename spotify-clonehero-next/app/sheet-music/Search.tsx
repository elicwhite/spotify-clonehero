'use client';

import {useMemo, useEffect, useState, useCallback} from 'react';
import {useInView} from 'react-intersection-observer';
import {useRouter} from 'next/navigation';
import {parseAsString, useQueryState} from 'nuqs';
import {Search as SearchIcon, Guitar, Drum, Radio, Piano} from 'lucide-react';
import {Input} from '@/components/ui/input';
import {Button} from '@/components/ui/button';
import Link from 'next/link';
import debounce from 'debounce';
import {
  ChartInstruments,
  preFilterInstruments,
} from '@/components/ChartInstruments';
import {EncoreResponse, searchEncore} from '@/lib/search-encore';
import {getSheetMusicUrl} from '@/app/buildSheetMusicUrl';

// const DifficultyBadge = ({
//   instrument,
//   difficulties,
//   count,
// }: {
//   instrument: string;
//   difficulties: string[];
//   count: number;
// }) => {
//   const getIcon = (name: string) => {
//     switch (name) {
//       case 'Guitar':
//         return <Guitar className="h-4 w-4 sm:h-5 sm:w-5" />;
//       case 'Drums':
//         return <Drum className="h-4 w-4 sm:h-5 sm:w-5" />;
//       case 'Bass':
//         return <Radio className="h-4 w-4 sm:h-5 sm:w-5" />;
//       case 'Piano':
//         return <Piano className="h-4 w-4 sm:h-5 sm:w-5" />;
//       default:
//         return null;
//     }
//   };

//   const getDifficultyLabel = (difficulties: string[]) => {
//     if (difficulties.length === 1) {
//       return difficulties[0];
//     }

//     return difficulties
//       .map(d => {
//         switch (d) {
//           case 'Easy':
//             return 'E';
//           case 'Medium':
//             return 'M';
//           case 'Hard':
//             return 'H';
//           case 'Expert':
//             return 'X';
//           default:
//             return '';
//         }
//       })
//       .join('');
//   };

//   return (
//     <div className="flex flex-col items-center gap-1">
//       <div className="relative">
//         <div className="bg-black rounded-full p-1.5 sm:p-2">
//           {getIcon(instrument)}
//         </div>
//         <div className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground text-[10px] sm:text-xs rounded-full w-3.5 h-3.5 sm:w-4 sm:h-4 flex items-center justify-center">
//           {count}
//         </div>
//       </div>
//       <span className="text-[10px] sm:text-xs font-medium">
//         {getDifficultyLabel(difficulties)}
//       </span>
//     </div>
//   );
// };

export default function Search({
  defaultResults,
  initialQuery,
}: {
  defaultResults: EncoreResponse;
  initialQuery?: string;
}) {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useQueryState(
    'q',
    parseAsString.withDefault(''),
  );
  // const [instrumentFilter, setInstrumentFilter] = useQueryState(
  //   'instrument',
  //   parseAsString,
  // );
  const instrumentFilter = 'drums';

  const toggleInstrumentFilter = (instrument: string) => {
    // if (instrumentFilter === instrument) {
    //   setInstrumentFilter(null);
    // } else {
    //   setInstrumentFilter(instrument);
    // }
  };

  const [filteredSongs, setFilteredSongs] =
    useState<EncoreResponse>(defaultResults);
  const [page, setPage] = useState<number>(1);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
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

  const loadMore = useCallback(async () => {
    if (isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const nextPage = page + 1;
      const results = await searchEncore(
        searchQuery,
        instrumentFilter,
        nextPage,
      );
      setFilteredSongs(prev => {
        const prevData = prev?.data ?? [];
        // Deduplicate across the combined list to be resilient to duplicate Appends or StrictMode
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
      setIsLoadingMore(false);
    }
  }, [page, searchQuery, instrumentFilter, isLoadingMore]);

  // Infinite scroll: observe sentinel and load next page when visible
  useEffect(() => {
    if (!filteredSongs) return;
    const hasMore = filteredSongs.data.length < filteredSongs.found;
    if (hasMore && inView && !isLoadingMore) {
      loadMore();
    }
  }, [filteredSongs, inView, isLoadingMore, loadMore]);

  return (
    <main className="min-h-screen bg-background w-full">
      <div className="container mx-auto px-4 py-8">
        <header className="mb-8">
          <h1 className="text-3xl sm:text-4xl font-bold mb-2">
            Sheet Music Search
          </h1>
          <p className="text-muted-foreground mb-6 text-sm sm:text-base">
            Convert Drum Charts to Sheet Music
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
          </div>
        </header>

        <section>
          <h2 className="text-2xl font-semibold mb-4">
            {searchQuery ? 'Search Results' : 'Recently Added Sheet Music'}{' '}
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
                    <Link
                      href="/sheet-music/[slug]"
                      as={getSheetMusicUrl(song.artist, song.name, song.md5)}
                      key={song.md5}
                      className="flex items-stretch bg-card rounded-lg border border-border hover:bg-accent transition-colors cursor-pointer overflow-hidden">
                      <div className="flex-shrink-0">
                        <img
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

                      <Button className="hidden">View Sheet</Button>
                    </Link>
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
