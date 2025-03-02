'use client';

import EncoreAutocomplete from '@/components/EncoreAutocomplete';
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

const recentSongs = [
  {
    id: 1,
    title: 'Bohemian Rhapsody',
    artist: 'Queen',
    albumArt: '/placeholder.svg?height=80&width=80',
    uploader: 'MusicTeacher42',
    instruments: [
      {name: 'Piano', difficulties: ['Medium', 'Hard', 'Expert'], count: 3},
      {
        name: 'Guitar',
        difficulties: ['Easy', 'Medium', 'Hard', 'Expert'],
        count: 4,
      },
      {name: 'Vocals', difficulties: ['Expert'], count: 1},
    ],
    dateAdded: '2025-02-28',
  },
  {
    id: 2,
    title: 'Imagine',
    artist: 'John Lennon',
    albumArt: '/placeholder.svg?height=80&width=80',
    uploader: 'ClassicalFan',
    instruments: [
      {name: 'Piano', difficulties: ['Easy', 'Medium'], count: 2},
      {name: 'Vocals', difficulties: ['Easy', 'Medium', 'Hard'], count: 3},
    ],
    dateAdded: '2025-02-27',
  },
  {
    id: 3,
    title: 'Hotel California',
    artist: 'Eagles',
    albumArt: '/placeholder.svg?height=80&width=80',
    uploader: 'GuitarLover',
    instruments: [
      {name: 'Guitar', difficulties: ['Medium', 'Hard'], count: 2},
      {name: 'Bass', difficulties: ['Easy', 'Medium'], count: 2},
      {name: 'Drums', difficulties: ['Easy', 'Medium', 'Hard'], count: 3},
    ],
    dateAdded: '2025-02-26',
  },
  {
    id: 4,
    title: 'Billie Jean',
    artist: 'Michael Jackson',
    albumArt: '/placeholder.svg?height=80&width=80',
    uploader: 'PopMusicTeacher',
    instruments: [
      {name: 'Piano', difficulties: ['Hard', 'Expert'], count: 2},
      {name: 'Bass', difficulties: ['Medium', 'Hard'], count: 2},
      {name: 'Drums', difficulties: ['Medium', 'Hard'], count: 2},
      {name: 'Vocals', difficulties: ['Hard', 'Expert'], count: 2},
    ],
    dateAdded: '2025-02-25',
  },
  {
    id: 5,
    title: 'Stairway to Heaven',
    artist: 'Led Zeppelin',
    albumArt: '/placeholder.svg?height=80&width=80',
    uploader: 'RockFan99',
    instruments: [
      {name: 'Guitar', difficulties: ['Hard', 'Expert'], count: 2},
      {name: 'Vocals', difficulties: ['Medium', 'Hard'], count: 2},
      {name: 'Drums', difficulties: ['Easy', 'Medium'], count: 2},
    ],
    dateAdded: '2025-02-24',
  },
  {
    id: 6,
    title: 'Yesterday',
    artist: 'The Beatles',
    albumArt: '/placeholder.svg?height=80&width=80',
    uploader: 'ClassicRockTeacher',
    instruments: [
      {name: 'Guitar', difficulties: ['Easy', 'Medium'], count: 2},
      {name: 'Strings', difficulties: ['Medium', 'Hard'], count: 2},
      {name: 'Vocals', difficulties: ['Easy', 'Medium'], count: 2},
    ],
    dateAdded: '2025-02-23',
  },
  {
    id: 7,
    title: 'Smells Like Teen Spirit',
    artist: 'Nirvana',
    albumArt: '/placeholder.svg?height=80&width=80',
    uploader: 'GrungeMusician',
    instruments: [
      {name: 'Guitar', difficulties: ['Medium', 'Hard', 'Expert'], count: 3},
      {name: 'Bass', difficulties: ['Easy', 'Medium'], count: 2},
      {name: 'Drums', difficulties: ['Easy', 'Medium', 'Hard'], count: 3},
      {name: 'Vocals', difficulties: ['Medium', 'Hard'], count: 2},
    ],
    dateAdded: '2025-02-22',
  },
  {
    id: 8,
    title: "Sweet Child O' Mine",
    artist: "Guns N' Roses",
    albumArt: '/placeholder.svg?height=80&width=80',
    uploader: 'GuitarTeacher',
    instruments: [
      {name: 'Guitar', difficulties: ['Hard', 'Expert'], count: 2},
      {name: 'Bass', difficulties: ['Easy', 'Medium'], count: 2},
      {name: 'Drums', difficulties: ['Medium', 'Hard'], count: 2},
      {name: 'Vocals', difficulties: ['Medium', 'Hard'], count: 2},
    ],
    dateAdded: '2025-02-21',
  },
  {
    id: 9,
    title: 'Wonderwall',
    artist: 'Oasis',
    albumArt: '/placeholder.svg?height=80&width=80',
    uploader: 'BritpopFan',
    instruments: [
      {name: 'Guitar', difficulties: ['Easy', 'Medium'], count: 2},
      {name: 'Vocals', difficulties: ['Easy', 'Medium'], count: 2},
      {name: 'Percussion', difficulties: ['Easy'], count: 1},
    ],
    dateAdded: '2025-02-20',
  },
  {
    id: 10,
    title: 'Let It Be',
    artist: 'The Beatles',
    albumArt: '/placeholder.svg?height=80&width=80',
    uploader: 'PianoTeacher',
    instruments: [
      {name: 'Piano', difficulties: ['Easy', 'Medium', 'Hard'], count: 3},
      {name: 'Guitar', difficulties: ['Easy', 'Medium'], count: 2},
      {name: 'Vocals', difficulties: ['Easy', 'Medium'], count: 2},
    ],
    dateAdded: '2025-02-19',
  },
];

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
  const [filteredSongs, setFilteredSongs] = useState(recentSongs);
  const [activeInstruments, setActiveInstruments] = useState<string[]>([]);

  const chorusDbPromise = useMemo(() => getChorusChartDb(), []);
  const chorusDb = use(chorusDbPromise);
  const latest10 = useMemo(() => {
    return chorusDb
      .slice()
      .sort(
        (a, b) =>
          new Date(b.modifiedTime).getTime() -
          new Date(a.modifiedTime).getTime(),
      )
      .slice(0, 10);
  }, [chorusDb]);

  const filterSongs = (query: string) => {
    let filtered = recentSongs;

    // First filter by search query if it exists
    if (query.trim()) {
      const lowercaseQuery = query.toLowerCase();
      filtered = filtered.filter(
        song =>
          song.title.toLowerCase().includes(lowercaseQuery) ||
          song.artist.toLowerCase().includes(lowercaseQuery) ||
          song.instruments.some(instrument =>
            instrument.name.toLowerCase().includes(lowercaseQuery),
          ),
      );
    }

    // Then filter by selected instruments if any are active
    if (activeInstruments.length > 0) {
      filtered = filtered.filter(song =>
        activeInstruments.every(instrument =>
          song.instruments.some(i => i.name === instrument),
        ),
      );
    }

    setFilteredSongs(filtered);
  };

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value;
    setSearchQuery(query);
    filterSongs(query);
  };

  const navigateToSong = (songId: number) => {
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
                  filterSongs(searchQuery);
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
                  filterSongs(searchQuery);
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
                  filterSongs(searchQuery);
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
                  filterSongs(searchQuery);
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
            {searchQuery ? 'Search Results' : 'Recently Added Sheet Music'}
          </h2>

          {filteredSongs.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground">
                No songs found matching your search.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {filteredSongs.map(song => (
                <Link
                  href="/songs/[id]"
                  as={`/songs/${song.id}`}
                  key={song.id}
                  className="flex items-stretch bg-card rounded-lg border border-border hover:bg-accent transition-colors cursor-pointer overflow-hidden">
                  <div className="flex-shrink-0">
                    <Image
                      src={
                        'https://files.enchor.us/132c9a0eabbe4b87525962c6560d35fc.jpg'
                      } //song.albumArt || '/placeholder.svg'}
                      alt={`${song.title} album art`}
                      width={200}
                      height={200}
                      className="h-full w-[120px] sm:w-[160px] lg:w-[200px] object-cover"
                    />
                  </div>

                  <div className="flex flex-col flex-grow p-4">
                    <div className="flex-grow">
                      <h3 className="font-medium text-base sm:text-lg lg:text-xl">
                        {song.title}
                      </h3>
                      <p className="text-muted-foreground text-sm sm:text-base">
                        {song.artist}
                      </p>
                      <p className="text-sm text-muted-foreground hidden sm:block">
                        Uploaded by {song.uploader}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2 sm:gap-3 mt-2 sm:mt-3">
                      {song.instruments.map(inst => (
                        <DifficultyBadge
                          key={inst.name}
                          instrument={inst.name}
                          difficulties={inst.difficulties}
                          count={inst.count}
                        />
                      ))}
                    </div>
                  </div>

                  <Button
                    variant="secondary"
                    className="hidden sm:flex ml-4 mr-4 self-center"
                    onClick={e => {
                      e.stopPropagation();
                      navigateToSong(song.id);
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
