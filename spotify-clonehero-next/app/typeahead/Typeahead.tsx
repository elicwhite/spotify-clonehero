'use client';

import EncoreAutocomplete, {
  EncoreResponse,
  searchEncore,
} from '@/components/EncoreAutocomplete';
import getChorusChartDb from '@/lib/chorusChartDb';
import chorusChartDb from '@/lib/chorusChartDb';
import {use, useMemo, useEffect, useState} from 'react';
import {useRouter, useSearchParams} from 'next/navigation';
import {parseAsString, useQueryState} from 'nuqs';
import Image from 'next/image';
import {Search, Guitar, Drum, Radio, Piano} from 'lucide-react';
import {Input} from '@/components/ui/input';
import {Button} from '@/components/ui/button';
import Link from 'next/link';
import debounce from 'debounce';
import {
  ChartInstruments,
  preFilterInstruments,
} from '@/components/ChartInstruments';
import {Icons} from '@/components/icons';

const DifficultyBadge = ({
  instrument,
  difficulties,
  count,
}: {
  instrument: string;
  difficulties: string[];
  count: number;
}) => {
  const getIcon = (name: string) => {
    switch (name) {
      case 'Guitar':
        return <Guitar className="h-4 w-4 sm:h-5 sm:w-5" />;
      case 'Drums':
        return <Drum className="h-4 w-4 sm:h-5 sm:w-5" />;
      case 'Bass':
        return <Radio className="h-4 w-4 sm:h-5 sm:w-5" />;
      case 'Piano':
        return <Piano className="h-4 w-4 sm:h-5 sm:w-5" />;
      default:
        return null;
    }
  };

  const getDifficultyLabel = (difficulties: string[]) => {
    if (difficulties.length === 1) {
      return difficulties[0];
    }

    return difficulties
      .map(d => {
        switch (d) {
          case 'Easy':
            return 'E';
          case 'Medium':
            return 'M';
          case 'Hard':
            return 'H';
          case 'Expert':
            return 'X';
          default:
            return '';
        }
      })
      .join('');
  };

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative">
        <div className="bg-black rounded-full p-1.5 sm:p-2">
          {getIcon(instrument)}
        </div>
        <div className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground text-[10px] sm:text-xs rounded-full w-3.5 h-3.5 sm:w-4 sm:h-4 flex items-center justify-center">
          {count}
        </div>
      </div>
      <span className="text-[10px] sm:text-xs font-medium">
        {getDifficultyLabel(difficulties)}
      </span>
    </div>
  );
};

// export default function Typeahead() {
//   const fetchChorusDb = chorusChartDb();

//   const chorusDbPromise = useMemo(() => getChorusChartDb(), []);
//   const chorusDb = use(chorusDbPromise);
//   const latest10 = useMemo(() => {
//     return chorusDb
//       .slice()
//       .sort(
//         (a, b) =>
//           new Date(b.modifiedTime).getTime() -
//           new Date(a.modifiedTime).getTime(),
//       )
//       .slice(0, 10);
//   }, [chorusDb]);
//   console.log(latest10);

//   return (
//     <>
//       <img
//         src="https://files.enchor.us/132c9a0eabbe4b87525962c6560d35fc.jpg"
//         width={100}
//         height={100}
//       />
//       <EncoreAutocomplete onChartSelected={r => console.log(r)} />
//     </>
//   );
// }

export default function Home() {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useQueryState(
    'q',
    parseAsString.withDefault(''),
  );
  const [activeInstruments, setActiveInstruments] = useState<string[]>([]);

  // const chorusDbPromise = useMemo(() => getChorusChartDb(), []);
  // const chorusDb = use(chorusDbPromise);
  // const latest10 = useMemo(() => {
  //   return chorusDb
  //     .slice()
  //     .sort(
  //       (a, b) =>
  //         new Date(b.modifiedTime).getTime() -
  //         new Date(a.modifiedTime).getTime(),
  //     )
  //     .slice(0, 10);
  // }, [chorusDb]);
  const [filteredSongs, setFilteredSongs] = useState<EncoreResponse | null>(
    null,
  );

  const filterSongs = async (query: string) => {
    const results = await searchEncore(query);
    console.log(results);
    setFilteredSongs(results);
  };

  const debouncedFilterSongs = useMemo(() => debounce(filterSongs, 2000), []);
  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value;
    setSearchQuery(query);
    debouncedFilterSongs(query);
  };

  const navigateToSong = (songId: string) => {
    // In a real app, this would navigate to the song's sheet music page
    console.log(`Navigating to song ${songId}`);
    router.push(`/songs/${songId}`);
  };

  const toggleInstrument = (instrument: string) => {
    setActiveInstruments(prev =>
      prev.includes(instrument)
        ? prev.filter(i => i !== instrument)
        : [...prev, instrument],
    );
  };

  useEffect(() => {
    filterSongs(searchQuery);
  }, [searchQuery, activeInstruments]); // Re-filter when instruments or searchQuery change

  return (
    <main className="min-h-screen bg-background w-full">
      <div className="container mx-auto px-4 py-8">
        <header className="mb-8">
          <h1 className="text-3xl sm:text-4xl font-bold mb-2">
            Sheet Music Search
          </h1>
          <p className="text-muted-foreground mb-6 text-sm sm:text-base">
            Find sheet music for your favorite songs and instruments
          </p>

          <div className="flex flex-col gap-4">
            <div className="relative">
              <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                <Search className="h-4 w-4 sm:h-5 sm:w-5 text-muted-foreground" />
              </div>
              <Input
                type="search"
                placeholder="Search for songs, artists, or instruments..."
                className="pl-9 sm:pl-10 w-full"
                value={searchQuery}
                onChange={handleSearch}
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                variant={
                  activeInstruments.includes('Guitar') ? 'default' : 'outline'
                }
                size="sm"
                onClick={() => {
                  toggleInstrument('Guitar');
                  // filterSongs(searchQuery);
                }}
                className="flex items-center gap-2 text-xs sm:text-sm">
                <Guitar className="h-3 w-3 sm:h-4 sm:w-4" />
                Guitar
              </Button>
              <Button
                variant={
                  activeInstruments.includes('Drums') ? 'default' : 'outline'
                }
                size="sm"
                onClick={() => {
                  toggleInstrument('Drums');
                  // filterSongs(searchQuery);
                }}
                className="flex items-center gap-2 text-xs sm:text-sm">
                <Drum className="h-3 w-3 sm:h-4 sm:w-4" />
                Drums
              </Button>
              <Button
                variant={
                  activeInstruments.includes('Bass') ? 'default' : 'outline'
                }
                size="sm"
                onClick={() => {
                  toggleInstrument('Bass');
                  // filterSongs(searchQuery);
                }}
                className="flex items-center gap-2 text-xs sm:text-sm">
                <Radio className="h-3 w-3 sm:h-4 sm:w-4" />
                Bass
              </Button>
              <Button
                variant={
                  activeInstruments.includes('Piano') ? 'default' : 'outline'
                }
                size="sm"
                onClick={() => {
                  toggleInstrument('Piano');
                  // filterSongs(searchQuery);
                }}
                className="flex items-center gap-2 text-xs sm:text-sm">
                <Piano className="h-3 w-3 sm:h-4 sm:w-4" />
                Piano
              </Button>
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
            <div className="space-y-4">
              {filteredSongs &&
                filteredSongs.data.map(song => (
                  <Link
                    href="/songs/[id]"
                    as={`/songs/${song.md5}`}
                    key={song.md5}
                    className="flex items-stretch bg-card rounded-lg border border-border hover:bg-accent transition-colors cursor-pointer overflow-hidden">
                    <div className="flex-shrink-0">
                      <Image
                        src={
                          'https://files.enchor.us/132c9a0eabbe4b87525962c6560d35fc.jpg'
                        } //song.albumArt || '/placeholder.svg'}
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
                      className="hidden sm:flex ml-4 mr-4 self-center"
                      onClick={e => {
                        e.stopPropagation();
                        navigateToSong(song.md5);
                      }}>
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
