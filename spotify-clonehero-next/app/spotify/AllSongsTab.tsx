'use client';

import {useCallback, useState, useEffect, useMemo} from 'react';
import {Button} from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {ChevronDown, ChevronLeft, ChevronRight} from 'lucide-react';
import {toast} from 'sonner';
import {Searcher} from 'fast-fuzzy';

import {useSpotifyTracks} from '@/lib/spotify-sdk/SpotifyFetching';
import {
  SongAccumulator,
  createIsInstalledFilter,
} from '@/lib/local-songs-folder/scanLocalCharts';
import {scanForInstalledChartsCompat, canScanCharts} from '@/lib/local-songs-folder/index-compat';
import {detectBrowserCapabilities} from '@/lib/browser-compat/FileSystemCompat';
import chorusChartDb, {
  findMatchingCharts,
} from '@/lib/chorusChartDb';
import SpotifyTableDownloader, {
  SpotifyChartData,
  SpotifyPlaysRecommendations,
} from '../SpotifyTableDownloader';
import {ChartResponseEncore} from '@/lib/chartSelection';
import {RENDERED_INSTRUMENTS, AllowedInstrument, InstrumentImage, preFilterInstruments} from '@/components/ChartInstruments';

type Status = {
  status:
    | 'not-started'
    | 'scanning'
    | 'done-scanning'
    | 'fetching-spotify-data'
    | 'songs-from-encore'
    | 'finding-matches'
    | 'done';
  songsCounted: number;
};

type Falsy = false | 0 | '' | null | undefined;
const _Boolean = <T extends any>(v: T): v is Exclude<typeof v, Falsy> =>
  Boolean(v);

export default function AllSongsTab() {
  const [tracks, updateFromSpotify] = useSpotifyTracks();
  const [songs, setSongs] = useState<SpotifyPlaysRecommendations[] | null>(null);
  const [filteredSongs, setFilteredSongs] = useState<SpotifyPlaysRecommendations[] | null>(null);
  const capabilities = detectBrowserCapabilities();
  
  const [status, setStatus] = useState<Status>({
    status: 'not-started',
    songsCounted: 0,
  });

  // Search and filter states
  const [searchTerm, setSearchTerm] = useState('');
  const [artistFilter, setArtistFilter] = useState('');
  const [songFilter, setSongFilter] = useState('');
  
  // Instrument filter state
  const [instrumentFilters, setInstrumentFilters] = useState<AllowedInstrument[]>([]);
  
  // Sorting states
  const [sortBy, setSortBy] = useState<'artist' | 'song' | 'none'>('none');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  
  // Pagination states
  const [currentPage, setCurrentPage] = useState(1);
  const [songsPerPage, setSongsPerPage] = useState(100); // Show 100 songs per page for better performance
  
  // UI states
  const [songFilterOpen, setSongFilterOpen] = useState(true);

  // Auto-load all songs in fallback mode with efficient chart matching and ensure playlists are loaded
  useEffect(() => {
    // Always try to update from Spotify if we don't have tracks yet
    if (tracks.length === 0) {
      updateFromSpotify();
    }

    // Auto-run skip logic for fallback browsers
    const autoLoadForFallback = async () => {
      if (capabilities.mode === 'fallback' && tracks.length > 0 && !songs) {
        // Run the skip directory selection logic automatically
        try {
          setStatus({ status: 'songs-from-encore', songsCounted: 0 });
          
          const fetchDb = chorusChartDb();
          const allChorusCharts = await fetchDb;
          
          // Mark all charts as not installed since we're in fallback mode
          const markedCharts = allChorusCharts.map((chart): SpotifyChartData => ({
            ...chart,
            isInstalled: false, // All charts are not installed in fallback mode
          }));
          
          setStatus({ status: 'finding-matches', songsCounted: 0 });
          
          const artistSearcher = new Searcher(markedCharts, {
            keySelector: chart => chart.artist,
            threshold: 1,
            useDamerau: false,
            useSellers: false,
          });

          const allSongsWithCharts = tracks
            .map(track => {
              const artist = track.artists[0] || 'Unknown Artist';
              const matchingCharts = findMatchingCharts(artist, track.name, artistSearcher);
              
              return {
                artist,
                song: track.name,
                spotifyUrl: track.spotify_url,
                previewUrl: track.preview_url,
                playCount: track.playCount, // Preserve playCount if it exists
                matchingCharts, // Include all matching charts
              };
            })
            .filter(song => song.matchingCharts.length > 0); // Only show songs with matching charts
          
          setSongs(allSongsWithCharts);
          setFilteredSongs(allSongsWithCharts);
          setStatus({ status: 'done', songsCounted: 0 });
          toast.success(`Loaded ${allSongsWithCharts.length} songs with chart matching (fallback mode)`);
          
        } catch (error) {
          console.error('Error loading chart data in fallback mode:', error);
          toast.error('Failed to load chart data in fallback mode');
          
          // Fallback to no charts if chart loading fails
          const allSongsForDownload = tracks.map(track => ({
            artist: track.artists[0] || 'Unknown Artist',
            song: track.name,
            spotifyUrl: track.spotify_url,
            previewUrl: track.preview_url,
            playCount: track.playCount, // Preserve playCount if it exists
            matchingCharts: [] as SpotifyChartData[],
          }));
          
          setSongs(allSongsForDownload);
          setFilteredSongs(allSongsForDownload);
          setStatus({ status: 'done', songsCounted: 0 });
          toast.success(`Loaded ${allSongsForDownload.length} songs for download (chart matching failed)`);
        }
      }
    };

    autoLoadForFallback();
  }, [capabilities.mode, tracks, songs, updateFromSpotify]);

  const calculate = useCallback(async () => {
    if (tracks.length === 0) {
      toast.info('No tracks loaded from playlists. Loading all playlists may take a moment...');
      return;
    }

    // In fallback mode, skip chart scanning and show all songs for download
    if (capabilities.mode === 'fallback') {
      // Use the same logic as skipDirectorySelection but with a different message
      try {
        setStatus({ status: 'songs-from-encore', songsCounted: 0 });
        
        const fetchDb = chorusChartDb();
        const allChorusCharts = await fetchDb;
        
        // Mark all charts as not installed since we're in fallback mode
        const markedCharts = allChorusCharts.map((chart): SpotifyChartData => ({
          ...chart,
          isInstalled: false, // All charts are not installed in fallback mode
        }));
        
        setStatus({ status: 'finding-matches', songsCounted: 0 });
        
        const artistSearcher = new Searcher(markedCharts, {
          keySelector: chart => chart.artist,
          threshold: 1,
          useDamerau: false,
          useSellers: false,
        });

        const allSongsWithCharts = tracks
          .map(track => {
            const artist = track.artists[0] || 'Unknown Artist';
            const matchingCharts = findMatchingCharts(artist, track.name, artistSearcher);
            
            return {
              artist,
              song: track.name,
              spotifyUrl: track.spotify_url,
              previewUrl: track.preview_url,
              playCount: track.playCount, // Preserve playCount if it exists
              matchingCharts, // Include all matching charts
            };
          })
          .filter(song => song.matchingCharts.length > 0); // Only show songs with matching charts
        
        setSongs(allSongsWithCharts);
        setFilteredSongs(allSongsWithCharts);
        setStatus({ status: 'done', songsCounted: 0 });
        toast.success(`Loaded ${allSongsWithCharts.length} songs with chart matching (fallback mode)`);
        
      } catch (error) {
        console.error('Error loading chart data in fallback mode:', error);
        toast.error('Failed to load chart data in fallback mode');
        
        // Fallback to no charts if chart loading fails
        const allSongsForDownload = tracks.map(track => ({
          artist: track.artists[0] || 'Unknown Artist',
          song: track.name,
          spotifyUrl: track.spotify_url,
          previewUrl: track.preview_url,
          playCount: track.playCount, // Preserve playCount if it exists
          matchingCharts: [] as SpotifyChartData[],
        }));
        
        setSongs(allSongsForDownload);
        setFilteredSongs(allSongsForDownload);
        setStatus({ status: 'done', songsCounted: 0 });
        toast.success(`Loaded ${allSongsForDownload.length} songs for download (chart matching failed)`);
      }
      return;
    }

    if (!canScanCharts()) {
      toast.error('Chart scanning is not supported in your browser. Please use Chrome, Edge, or Opera for full functionality.');
      return;
    }

    const fetchDb = chorusChartDb();
    let installedCharts: SongAccumulator[] | undefined;

    try {
      setStatus({
        status: 'scanning',
        songsCounted: 0,
      });

      const scanResult = await scanForInstalledChartsCompat(() => {
        setStatus(prevStatus => ({
          ...prevStatus,
          songsCounted: prevStatus.songsCounted + 1,
        }));
      });
      installedCharts = scanResult.installedCharts;
      
      // Show different message based on scanning mode
      if (scanResult.mode === 'fallback') {
        toast.success(`Scanned ${installedCharts.length} charts using fallback mode`);
      } else {
        toast.success(`Scanned ${installedCharts.length} charts`);
      }
      
      setStatus(prevStatus => ({
        ...prevStatus,
        status: 'done-scanning',
      }));
      
      await pause();
    } catch (err) {
      if (err instanceof Error && err.message == 'User canceled picker') {
        toast.info('Directory picker canceled');
        setStatus({
          status: 'not-started',
          songsCounted: 0,
        });
        return;
      } else {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error';
        toast.error(`Error scanning local charts: ${errorMsg}`, {duration: 8000});
        setStatus({
          status: 'not-started',
          songsCounted: 0,
        });
        throw err;
      }
    }

    const isInstalled = await createIsInstalledFilter(installedCharts);
    setStatus(prevStatus => ({
      ...prevStatus,
      status: 'songs-from-encore',
    }));
    const allChorusCharts = await fetchDb;
    const markedCharts = markInstalledCharts(allChorusCharts, isInstalled);

    setStatus(prevStatus => ({
      ...prevStatus,
      status: 'finding-matches',
    }));
    
    const artistSearcher = new Searcher(markedCharts, {
      keySelector: chart => chart.artist,
      threshold: 1,
      useDamerau: false,
      useSellers: false,
    });

    const recommendedCharts = tracks
      .map(({name, artists, spotify_url, preview_url}) => {
        const artist = artists[0];

        const matchingCharts = findMatchingCharts(artist, name, artistSearcher);

        if (
          matchingCharts.length == 0 ||
          !matchingCharts.some(chart => !chart.isInstalled)
        ) {
          return null;
        }

        return {
          artist,
          song: name,
          spotifyUrl: spotify_url,
          previewUrl: preview_url,
          matchingCharts,
        };
      })
      .filter(_Boolean);

    setStatus(prevStatus => ({
      ...prevStatus,
      status: 'done',
    }));

    if (recommendedCharts.length > 0) {
      setSongs(recommendedCharts);
      setFilteredSongs(recommendedCharts);
      console.log(recommendedCharts);
    }
  }, [tracks, capabilities.mode]);

  // Apply filters with debouncing for performance
  const applyFilters = useCallback(() => {
    if (!songs) return;

    let filtered = songs;

    // General search term (searches both artist and song)
    if (searchTerm) {
      const lowercaseSearch = searchTerm.toLowerCase();
      filtered = filtered.filter(
        song =>
          song.artist.toLowerCase().includes(lowercaseSearch) ||
          song.song.toLowerCase().includes(lowercaseSearch)
      );
    }

    // Specific artist filter
    if (artistFilter) {
      const lowercaseArtist = artistFilter.toLowerCase();
      filtered = filtered.filter(song =>
        song.artist.toLowerCase().includes(lowercaseArtist)
      );
    }

    // Specific song filter
    if (songFilter) {
      const lowercaseSong = songFilter.toLowerCase();
      filtered = filtered.filter(song =>
        song.song.toLowerCase().includes(lowercaseSong)
      );
    }

    // Instrument filter - matches SpotifyTableDownloader logic
    if (instrumentFilters.length > 0) {
      filtered = filtered.filter(song => {
        // If no matching charts, don't show in instrument filter
        if (!song.matchingCharts || song.matchingCharts.length === 0) {
          return false;
        }
        
        // Check if any chart has ALL the required instruments (matches SpotifyTableDownloader)
        return song.matchingCharts.some(chart => {
          const chartInstruments = preFilterInstruments(chart)
          if (!chartInstruments) {
            return false;
          }
          return instrumentFilters.every(instrument => 
            Object.keys(chartInstruments).includes(instrument)
          );
        });
      });
    }

    // Apply sorting
    if (sortBy !== 'none') {
      filtered.sort((a, b) => {
        let comparison = 0;
        if (sortBy === 'artist') {
          comparison = a.artist.localeCompare(b.artist);
        } else if (sortBy === 'song') {
          comparison = a.song.localeCompare(b.song);
        }
        return sortOrder === 'desc' ? -comparison : comparison;
      });
    }

    setFilteredSongs(filtered);
    // Reset to first page when filters change
    setCurrentPage(1);
  }, [songs, searchTerm, artistFilter, songFilter, instrumentFilters, sortBy, sortOrder]);

  // Paginated songs for display
  const paginatedSongs = useMemo(() => {
    if (!filteredSongs) return null;
    
    const startIndex = (currentPage - 1) * songsPerPage;
    const endIndex = startIndex + songsPerPage;
    return filteredSongs.slice(startIndex, endIndex);
  }, [filteredSongs, currentPage, songsPerPage]);

  const totalPages = filteredSongs ? Math.ceil(filteredSongs.length / songsPerPage) : 0;

  // Debounced filtering to improve performance
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      applyFilters();
    }, 150); // 150ms debounce

    return () => clearTimeout(timeoutId);
  }, [applyFilters]);

  // Skip handler for supported browsers - show all songs with chart matching but no installed filtering
  const skipDirectorySelection = useCallback(async () => {
    if (tracks.length === 0) {
      toast.info('No tracks loaded from playlists. Loading all playlists may take a moment...');
      return;
    }

    try {
      setStatus({ status: 'songs-from-encore', songsCounted: 0 });
      
      const fetchDb = chorusChartDb();
      const allChorusCharts = await fetchDb;
      
      // In fallback mode, mark all charts as not installed
      // In supported mode, also mark as not installed since we're skipping directory scan
      const markedCharts = allChorusCharts.map((chart): SpotifyChartData => ({
        ...chart,
        isInstalled: false, // All charts are not installed when skipping
      }));
      
      setStatus({ status: 'finding-matches', songsCounted: 0 });
      
      const artistSearcher = new Searcher(markedCharts, {
        keySelector: chart => chart.artist,
        threshold: 1,
        useDamerau: false,
        useSellers: false,
      });

      const allSongsWithCharts = tracks
        .map(track => {
          const artist = track.artists[0] || 'Unknown Artist';
          const matchingCharts = findMatchingCharts(artist, track.name, artistSearcher);
          
          return {
            artist,
            song: track.name,
            spotifyUrl: track.spotify_url,
            previewUrl: track.preview_url,
            playCount: track.playCount, // Preserve playCount if it exists
            matchingCharts, // Include all matching charts
          };
        })
        .filter(song => song.matchingCharts.length > 0); // Only show songs with matching charts
      
      setSongs(allSongsWithCharts);
      setFilteredSongs(allSongsWithCharts);
      setStatus({ status: 'done', songsCounted: 0 });
      toast.success(`Loaded ${allSongsWithCharts.length} songs with chart matching`);
      
    } catch (error) {
      console.error('Error loading chart data:', error);
      toast.error('Failed to load chart data');
      
      // Fallback to no charts if chart loading fails
      const allSongsForDownload = tracks.map(track => ({
        artist: track.artists[0] || 'Unknown Artist',
        song: track.name,
        spotifyUrl: track.spotify_url,
        previewUrl: track.preview_url,
        playCount: track.playCount, // Preserve playCount if it exists
        matchingCharts: [] as SpotifyChartData[],
      }));
      
      setSongs(allSongsForDownload);
      setFilteredSongs(allSongsForDownload);
      setStatus({ status: 'done', songsCounted: 0 });
      toast.success(`Loaded ${allSongsForDownload.length} songs for download (chart matching failed)`);
    }
  }, [tracks]);

  // Instrument filter toggle function
  const toggleInstrumentFilter = useCallback((instrument: AllowedInstrument) => {
    setInstrumentFilters(prev => 
      prev.includes(instrument) 
        ? prev.filter(i => i !== instrument)
        : [...prev, instrument]
    );
  }, []);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>All Songs Search</CardTitle>
          <CardDescription>
            Search through all your Spotify playlists to find songs with matching Clone Hero charts
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex justify-center">
            {renderStatus(status, calculate, skipDirectorySelection)}
          </div>
        </CardContent>
      </Card>

      {/* Search and Filter Controls */}
      {songs && (
        <Card>
          <Collapsible open={songFilterOpen} onOpenChange={setSongFilterOpen}>
            <CardHeader>
              <CollapsibleTrigger asChild>
                <div className="flex items-center justify-between cursor-pointer hover:bg-muted/30 rounded p-2 -m-2">
                  <div>
                    <CardTitle>Search and Filter Songs</CardTitle>
                    <CardDescription>
                      Filter your results by artist, song name, or both
                      {filteredSongs && (
                        <span className="ml-2">
                          ({filteredSongs.length} of {songs.length} songs found)
                          {totalPages > 1 && (
                            <span> • Page {currentPage} of {totalPages}</span>
                          )}
                        </span>
                      )}
                    </CardDescription>
                  </div>
                  <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${songFilterOpen ? 'rotate-180' : ''}`} />
                </div>
              </CollapsibleTrigger>
            </CardHeader>
            <CollapsibleContent>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="search-all">Search All</Label>
                    <Input
                      id="search-all"
                      placeholder="Search artists and songs..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="artist-filter">Filter by Artist</Label>
                    <Input
                      id="artist-filter"
                      placeholder="Artist name..."
                      value={artistFilter}
                      onChange={(e) => setArtistFilter(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="song-filter">Filter by Song</Label>
                    <Input
                      id="song-filter"
                      placeholder="Song name..."
                      value={songFilter}
                      onChange={(e) => setSongFilter(e.target.value)}
                    />
                  </div>
                </div>
                
                {/* Instrument Filters */}
                <div className="pt-4 border-t">
                  <div className="space-y-3">
                    <Label>Filter by Instruments</Label>
                    <p className="text-sm text-muted-foreground">
                      Select instruments that must be available in charts (shows songs that have charts with ALL selected instruments)
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {RENDERED_INSTRUMENTS.map((instrument: AllowedInstrument) => (
                        <button
                          key={instrument}
                          onClick={() => toggleInstrumentFilter(instrument)}
                          className={`flex items-center gap-2 px-3 py-2 rounded-md border transition-colors ${
                            instrumentFilters.includes(instrument)
                              ? 'bg-primary text-primary-foreground border-primary'
                              : 'bg-background hover:bg-muted border-input'
                          }`}
                        >
                          <InstrumentImage 
                            instrument={instrument} 
                            size="sm" 
                            classNames="w-4 h-4"
                          />
                          <span className="text-sm capitalize">{instrument}</span>
                        </button>
                      ))}
                    </div>
                    {instrumentFilters.length > 0 && (
                      <div className="text-sm text-muted-foreground">
                        Filtering by: {instrumentFilters.map(i => i.charAt(0).toUpperCase() + i.slice(1)).join(', ')}
                      </div>
                    )}
                  </div>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t">
                  <div className="space-y-2">
                    <Label htmlFor="sort-by">Sort By</Label>
                    <Select value={sortBy} onValueChange={(value: 'artist' | 'song' | 'none') => setSortBy(value)}>
                      <SelectTrigger id="sort-by">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No Sorting</SelectItem>
                        <SelectItem value="artist">Artist</SelectItem>
                        <SelectItem value="song">Song</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="sort-order">Sort Order</Label>
                    <Select value={sortOrder} onValueChange={(value: 'asc' | 'desc') => setSortOrder(value)} disabled={sortBy === 'none'}>
                      <SelectTrigger id="sort-order">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="asc">Ascending (A-Z)</SelectItem>
                        <SelectItem value="desc">Descending (Z-A)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Quick filter buttons */}
                <div className="flex flex-wrap gap-2 pt-4 border-t">
                  <div className="text-sm font-medium">Quick Actions:</div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSearchTerm('');
                      setArtistFilter('');
                      setSongFilter('');
                      setInstrumentFilters([]);
                      setSortBy('none');
                      setSortOrder('asc');
                    }}
                  >
                    Clear All Filters
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSortBy('artist');
                      setSortOrder('asc');
                    }}
                  >
                    Sort by Artist A-Z
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSortBy('song');
                      setSortOrder('asc');
                    }}
                  >
                    Sort by Song A-Z
                  </Button>
                </div>
              </CardContent>
            </CollapsibleContent>
          </Collapsible>
        </Card>
      )}

      {paginatedSongs && (
        <>
          {/* Results info and per-page selector */}
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="text-sm text-muted-foreground">
                    Showing {((currentPage - 1) * songsPerPage) + 1} to {Math.min(currentPage * songsPerPage, filteredSongs?.length || 0)} of {filteredSongs?.length || 0} songs
                  </div>
                  <div className="flex items-center gap-2">
                    <Label htmlFor="per-page" className="text-sm">Per page:</Label>
                    <Select 
                      value={songsPerPage.toString()} 
                      onValueChange={(value) => {
                        setSongsPerPage(Number(value));
                        setCurrentPage(1); // Reset to first page
                      }}
                    >
                      <SelectTrigger id="per-page" className="w-20">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="25">25</SelectItem>
                        <SelectItem value="50">50</SelectItem>
                        <SelectItem value="100">100</SelectItem>
                        <SelectItem value="200">200</SelectItem>
                        <SelectItem value="500">500</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {totalPages > 1 && (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(currentPage - 1)}
                      disabled={currentPage === 1}
                    >
                      <ChevronLeft className="h-4 w-4 mr-1" />
                      Previous
                    </Button>
                    
                    <div className="flex items-center gap-1">
                      {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                        let pageNumber;
                        if (totalPages <= 5) {
                          pageNumber = i + 1;
                        } else if (currentPage <= 3) {
                          pageNumber = i + 1;
                        } else if (currentPage >= totalPages - 2) {
                          pageNumber = totalPages - 4 + i;
                        } else {
                          pageNumber = currentPage - 2 + i;
                        }
                        
                        return (
                          <Button
                            key={pageNumber}
                            variant={currentPage === pageNumber ? "default" : "outline"}
                            size="sm"
                            className="w-10"
                            onClick={() => setCurrentPage(pageNumber)}
                          >
                            {pageNumber}
                          </Button>
                        );
                      })}
                    </div>
                    
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(currentPage + 1)}
                      disabled={currentPage === totalPages}
                    >
                      Next
                      <ChevronRight className="h-4 w-4 ml-1" />
                    </Button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <SpotifyTableDownloader tracks={paginatedSongs} showPreview={true} />

          {/* Pagination Controls - Bottom */}
          {totalPages > 1 && (
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(currentPage - 1)}
                    disabled={currentPage === 1}
                  >
                    <ChevronLeft className="h-4 w-4 mr-1" />
                    Previous
                  </Button>
                  
                  <div className="flex items-center gap-1">
                    {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                      let pageNumber;
                      if (totalPages <= 7) {
                        pageNumber = i + 1;
                      } else if (currentPage <= 4) {
                        pageNumber = i + 1;
                      } else if (currentPage >= totalPages - 3) {
                        pageNumber = totalPages - 6 + i;
                      } else {
                        pageNumber = currentPage - 3 + i;
                      }
                      
                      return (
                        <Button
                          key={pageNumber}
                          variant={currentPage === pageNumber ? "default" : "outline"}
                          size="sm"
                          className="w-10"
                          onClick={() => setCurrentPage(pageNumber)}
                        >
                          {pageNumber}
                        </Button>
                      );
                    })}
                  </div>
                  
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(currentPage + 1)}
                    disabled={currentPage === totalPages}
                  >
                    Next
                    <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function renderStatus(status: Status, scanHandler: () => void, skipHandler: () => void) {
  const capabilities = detectBrowserCapabilities();
  
  switch (status.status) {
    case 'not-started':
      return (
        <div className="flex flex-col gap-2">
          {capabilities.mode !== 'fallback' && (
            <Button onClick={scanHandler}>Select Clone Hero Songs Folder</Button>
          )}
          <Button variant="outline" onClick={skipHandler} size="sm">
            Show All Songs for Download
          </Button>
        </div>
      );
    case 'scanning':
    case 'done-scanning':
      return `${status.songsCounted} songs scanned`;
    case 'fetching-spotify-data':
      return 'Scanning your Spotify Library';
    case 'songs-from-encore':
      return 'Downloading songs from Encore';
    case 'finding-matches':
      return 'Checking for song matches';
    case 'done':
      return capabilities.mode !== 'fallback' ? (
        <Button onClick={scanHandler}>Rescan</Button>
      ) : (
        <Button variant="outline" onClick={skipHandler} size="sm">
          Refresh Songs
        </Button>
      );
  }
}

function markInstalledCharts(
  allCharts: ChartResponseEncore[],
  isInstalled: (artist: string, song: string, charter: string) => boolean,
): SpotifyChartData[] {
  return allCharts.map(
    (chart): SpotifyChartData => ({
      ...chart,
      isInstalled: isInstalled(chart.artist, chart.name, chart.charter),
    }),
  );
}

async function pause() {
  await new Promise(resolve => {
    setTimeout(resolve, 10);
  });
}
