'use client';

import {useMemo, useEffect, useState} from 'react';
import {useRouter} from 'next/navigation';
import {parseAsString, useQueryState} from 'nuqs';
import Image from 'next/image';
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
}: {
  defaultResults: EncoreResponse;
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

  const debouncedFilterSongs = useMemo(
    () =>
      debounce(async (query: string, instrument: undefined | null | string) => {
        const results = await searchEncore(query, instrument);
        setFilteredSongs(results);
      }, 500),
    [],
  );
  const searchSongs = (query: string) => {
    debouncedFilterSongs(query, instrumentFilter);
  };

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value;
    setSearchQuery(query);
    searchSongs(query);
  };

  const navigateToSong = (songId: string) => {
    // In a real app, this would navigate to the song's sheet music page
    console.log(`Navigating to song ${songId}`);
    router.push(`/songs/${songId}`);
  };

  useEffect(() => {
    searchSongs(searchQuery);
  }, [searchQuery, instrumentFilter]);

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

            {/* <div className="flex flex-wrap gap-2">
              <Button
                variant={instrumentFilter === 'guitar' ? 'default' : 'outline'}
                size="sm"
                onClick={() => {
                  toggleInstrumentFilter('guitar');
                }}
                className="flex items-center gap-2 text-xs sm:text-sm">
                <Guitar className="h-3 w-3 sm:h-4 sm:w-4" />
                Guitar
              </Button>
              <Button
                variant={instrumentFilter === 'drums' ? 'default' : 'outline'}
                size="sm"
                onClick={() => {
                  toggleInstrumentFilter('drums');
                }}
                className="flex items-center gap-2 text-xs sm:text-sm">
                <Drum className="h-3 w-3 sm:h-4 sm:w-4" />
                Drums
              </Button>
              <Button
                variant={instrumentFilter === 'bass' ? 'default' : 'outline'}
                size="sm"
                onClick={() => {
                  toggleInstrumentFilter('bass');
                }}
                className="flex items-center gap-2 text-xs sm:text-sm">
                <Radio className="h-3 w-3 sm:h-4 sm:w-4" />
                Bass
              </Button>
              <Button
                variant={instrumentFilter === 'piano' ? 'default' : 'outline'}
                size="sm"
                onClick={() => {
                  toggleInstrumentFilter('piano');
                }}
                className="flex items-center gap-2 text-xs sm:text-sm">
                <Piano className="h-3 w-3 sm:h-4 sm:w-4" />
                Piano
              </Button>
            </div> */}
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
            <div className="space-y-4">
              {filteredSongs &&
                filteredSongs.data.map(song => (
                  <Link
                    href="/sheet-music/[slug]"
                    as={`/sheet-music/${song.name}-${song.artist}-${song.md5}`}
                    key={song.md5}
                    className="flex items-stretch bg-card rounded-lg border border-border hover:bg-accent transition-colors cursor-pointer overflow-hidden">
                    <div className="flex-shrink-0">
                      <Image
                        src={`https://files.enchor.us/${song.albumArtMd5}.jpg`}
                        alt={`${song.name} album art`}
                        width={200}
                        height={200}
                        priority={true}
                        className="h-full w-[120px] sm:w-[160px] lg:w-[200px] object-cover"
                      />
                    </div>

                    <div className="flex flex-col flex-grow p-4">
                      <div className="flex-grow">
                        <h3 className="font-medium text-base sm:text-lg lg:text-xl">
                          {song.name}
                        </h3>
                        <p className="text-muted-foreground text-sm sm:text-base">
                          {song.artist}
                        </p>
                        <p className="text-sm text-muted-foreground hidden sm:block">
                          Charted by {song.charter}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2 sm:gap-3 mt-2 sm:mt-3">
                        <ChartInstruments
                          size="lg"
                          classNames="h-7 w-7 lg:h-10 lg:w-10 sm:h-8 sm:w-8"
                          instruments={preFilterInstruments(song)}
                        />
                      </div>
                    </div>

                    <Button
                      variant="secondary"
                      className="hidden sm:flex ml-4 mr-4 self-center">
                      View Sheet
                    </Button>
                  </Link>
                ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
