'use client';

import {useMemo, useEffect, useState} from 'react';
import {parseAsString, useQueryState} from 'nuqs';
import {Search as SearchIcon} from 'lucide-react';
import {Input} from '@/components/ui/input';
import Link from 'next/link';
import debounce from 'debounce';
import {
  ChartInstruments,
  preFilterInstruments,
} from '@/components/ChartInstruments';
import {EncoreResponse} from '@/lib/search-encore';
import {getKaraokeUrl} from './buildKaraokeUrl';
import {searchKaraoke} from './searchKaraoke';

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
  const [filteredSongs, setFilteredSongs] =
    useState<EncoreResponse>(defaultResults);
  const [isLoading, setIsLoading] = useState(false);

  const debouncedSearch = useMemo(
    () =>
      debounce(async (query: string) => {
        setIsLoading(true);
        try {
          const results = await searchKaraoke(query);
          setFilteredSongs(results);
        } finally {
          setIsLoading(false);
        }
      }, 500),
    [],
  );

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value;
    setSearchQuery(query);
    debouncedSearch(query);
  };

  useEffect(() => {
    if (initialQuery && initialQuery !== searchQuery) {
      setSearchQuery(initialQuery);
      debouncedSearch(initialQuery);
    }
  }, []);

  return (
    <main className="min-h-screen bg-background w-full">
      <div className="container mx-auto px-4 py-8">
        <header className="mb-8">
          <h1 className="text-3xl sm:text-4xl font-bold mb-2">
            Karaoke Video Generator
          </h1>
          <p className="text-muted-foreground mb-6 text-sm sm:text-base">
            Search for a song with lyrics to generate a karaoke video
          </p>

          <div className="relative">
            <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
              <SearchIcon className="h-4 w-4 sm:h-5 sm:w-5 text-muted-foreground" />
            </div>
            <Input
              type="search"
              placeholder="Search for songs with lyrics..."
              className="pl-9 sm:pl-10 w-full"
              value={searchQuery}
              onChange={handleSearch}
            />
          </div>
        </header>

        <section>
          <h2 className="text-2xl font-semibold mb-4">
            {searchQuery ? 'Search Results' : 'Charts with Lyrics'}{' '}
            {filteredSongs != null ? `(${filteredSongs.found} charts)` : ''}
          </h2>

          {filteredSongs?.data.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground">
                No songs found matching your search.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredSongs?.data.map(song => (
                <Link
                  href="/karaoke/[slug]"
                  as={getKaraokeUrl(song.artist, song.name, song.md5)}
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
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
