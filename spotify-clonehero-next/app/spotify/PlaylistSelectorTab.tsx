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

import {useSpotifySdk} from '@/lib/spotify-sdk/ClientInstance';
import {SimplifiedPlaylist, SpotifyApi} from '@spotify/web-api-ts-sdk';
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

type TrackResult = {
  name: string;
  artists: string[];
  preview_url: string | null;
  spotify_url: string;
};

type Status = {
  status:
    | 'not-started'
    | 'loading-playlists'
    | 'selecting-playlist'
    | 'loading-tracks'
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

async function getAllPlaylists(sdk: SpotifyApi): Promise<SimplifiedPlaylist[]> {
  const playlists: SimplifiedPlaylist[] = [];
  const limit = 50;
  let offset = 0;
  let total = null;
  do {
    const lists = await sdk.currentUser.playlists.playlists(limit, offset);
    if (total == null) {
      total = lists.total;
    }
    playlists.push(...lists.items);
    offset += limit;
  } while (total == null || offset < total);

  return playlists;
}

async function getPlaylistTracks(
  sdk: SpotifyApi,
  playlistId: string,
): Promise<TrackResult[]> {
  const tracks: TrackResult[] = [];
  const limit = 50;
  let offset = 0;
  let total = null;

  do {
    try {
      const items = await sdk.playlists.getPlaylistItems(
        playlistId,
        undefined,
        'total,limit,items(track(type,artists(type,name),name,preview_url, external_urls(spotify)))',
        limit,
        offset,
      );

      if (total == null) {
        total = items.total;
      }
      const filteredTracks = items.items
        .filter(item => item.track?.type === 'track')
        .map((item: any): TrackResult => {
          return {
            name: item.track.name,
            artists: item.track.artists.map((artist: any) => artist.name),
            preview_url: item.track.preview_url,
            spotify_url: item.track.external_urls.spotify,
          };
        });

      tracks.push(...filteredTracks);
      offset += limit;
    } catch (error: any) {
      throw error;
    }
  } while (total == null || offset < total);

  return tracks;
}

export default function PlaylistSelectorTab() {
  const sdk = useSpotifySdk();
  const [playlists, setPlaylists] = useState<SimplifiedPlaylist[]>([]);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string>('');
  const [currentPlaylistTracks, setCurrentPlaylistTracks] = useState<TrackResult[]>([]);
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
  const [playlistSearchTerm, setPlaylistSearchTerm] = useState('');
  
  // Pagination states
  const [currentPage, setCurrentPage] = useState(1);
  const [playlistsPerPage] = useState(10);
  
  // UI states
  const [songFilterOpen, setSongFilterOpen] = useState(true);

  // Load playlists on component mount
  useEffect(() => {
    if (sdk && playlists.length === 0) {
      setStatus({ status: 'loading-playlists', songsCounted: 0 });
      getAllPlaylists(sdk)
        .then(loadedPlaylists => {
          setPlaylists(loadedPlaylists);
          setStatus({ status: 'selecting-playlist', songsCounted: 0 });
        })
        .catch(error => {
          console.error('Error loading playlists:', error);
          toast.error('Failed to load playlists');
          setStatus({ status: 'not-started', songsCounted: 0 });
        });
    }
  }, [sdk, playlists.length]);

  // Load tracks when playlist is selected
  const loadPlaylistTracks = useCallback(async (playlistId: string) => {
    if (!sdk || !playlistId) return;

    setStatus({ status: 'loading-tracks', songsCounted: 0 });
    try {
      const tracks = await getPlaylistTracks(sdk, playlistId);
      setCurrentPlaylistTracks(tracks);
      
      // In fallback mode, immediately show songs with chart matching
      if (capabilities.mode === 'fallback') {
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
              
              // Only include songs that have matching charts
              if (matchingCharts.length === 0) {
                return null;
              }
              
              return {
                artist,
                song: track.name,
                spotifyUrl: track.spotify_url,
                previewUrl: track.preview_url,
                matchingCharts, // Include all matching charts
              };
            })
            .filter(_Boolean); // Remove null values
          
          setSongs(allSongsWithCharts);
          setFilteredSongs(allSongsWithCharts);
          setStatus({ status: 'done', songsCounted: 0 });
          toast.success(`Loaded ${allSongsWithCharts.length} songs from playlist with chart matching (fallback mode)`);
        } catch (error) {
          console.error('Error loading chart data in fallback mode:', error);
          toast.error('Failed to load chart data in fallback mode');
          
          // Fallback to no charts if chart loading fails
          const allSongsForDownload = tracks.map(track => ({
            artist: track.artists[0] || 'Unknown Artist',
            song: track.name,
            spotifyUrl: track.spotify_url,
            previewUrl: track.preview_url,
            matchingCharts: [] as SpotifyChartData[],
          }));
          
          setSongs(allSongsForDownload);
          setFilteredSongs(allSongsForDownload);
          setStatus({ status: 'done', songsCounted: 0 });
          toast.success(`Loaded ${allSongsForDownload.length} songs from playlist (chart matching failed)`);
        }
      } else {
        setStatus({ status: 'not-started', songsCounted: 0 });
        toast.success(`Loaded ${tracks.length} tracks from playlist. Click "Select Clone Hero Songs Folder" to find matching charts.`);
      }
    } catch (error) {
      console.error('Error loading playlist tracks:', error);
      toast.error('Failed to load playlist tracks');
      setStatus({ status: 'not-started', songsCounted: 0 });
    }
  }, [sdk, capabilities.mode]);

  const calculate = useCallback(async () => {
    if (currentPlaylistTracks.length === 0) {
      toast.info('Please select a playlist first.');
      return;
    }

    // In fallback mode, show songs with chart matching
    if (capabilities.mode === 'fallback') {
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

        const allSongsWithCharts = currentPlaylistTracks
          .map(track => {
            const artist = track.artists[0] || 'Unknown Artist';
            const matchingCharts = findMatchingCharts(artist, track.name, artistSearcher);
            
            // Only include songs that have matching charts
            if (matchingCharts.length === 0) {
              return null;
            }
            
            return {
              artist,
              song: track.name,
              spotifyUrl: track.spotify_url,
              previewUrl: track.preview_url,
              matchingCharts, // Include all matching charts
            };
          })
          .filter(_Boolean); // Remove null values
        
        setSongs(allSongsWithCharts);
        setFilteredSongs(allSongsWithCharts);
        setStatus({ status: 'done', songsCounted: 0 });
        toast.success(`Loaded ${allSongsWithCharts.length} songs from selected playlist with chart matching (fallback mode)`);
      } catch (error) {
        console.error('Error loading chart data in fallback mode:', error);
        toast.error('Failed to load chart data in fallback mode');
        
        // Fallback to no charts if chart loading fails
        const allSongsForDownload = currentPlaylistTracks.map(track => ({
          artist: track.artists[0] || 'Unknown Artist',
          song: track.name,
          spotifyUrl: track.spotify_url,
          previewUrl: track.preview_url,
          matchingCharts: [] as SpotifyChartData[],
        }));
        
        setSongs(allSongsForDownload);
        setFilteredSongs(allSongsForDownload);
        setStatus({ status: 'done', songsCounted: 0 });
        toast.success(`Loaded ${allSongsForDownload.length} songs from selected playlist (chart matching failed)`);
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

    const recommendedCharts = currentPlaylistTracks
      .map(({name, artists, spotify_url, preview_url}) => {
        const artist = artists[0];

        const matchingCharts = findMatchingCharts(artist, name, artistSearcher);

        // Only include songs that have matching charts
        if (matchingCharts.length == 0) {
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
    } else {
      toast.info('No matching charts found for the selected playlist');
    }
  }, [currentPlaylistTracks, capabilities.mode]);

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

    setFilteredSongs(filtered);
  }, [songs, searchTerm, artistFilter, songFilter]);

  // Debounced filtering to improve performance
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      applyFilters();
    }, 150); // 150ms debounce

    return () => clearTimeout(timeoutId);
  }, [applyFilters]);

  // Skip handler for supported browsers - show songs with chart matching but no installed filtering
  const skipDirectorySelection = useCallback(async () => {
    if (currentPlaylistTracks.length === 0) {
      toast.info('Please select a playlist first.');
      return;
    }

    try {
      setStatus({ status: 'songs-from-encore', songsCounted: 0 });
      
      const fetchDb = chorusChartDb();
      const allChorusCharts = await fetchDb;
      
      // Mark all charts as not installed since we're skipping directory scan
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

      const allSongsWithCharts = currentPlaylistTracks
        .map(track => {
          const artist = track.artists[0] || 'Unknown Artist';
          const matchingCharts = findMatchingCharts(artist, track.name, artistSearcher);
          
          // Only include songs that have matching charts
          if (matchingCharts.length === 0) {
            return null;
          }
          
          return {
            artist,
            song: track.name,
            spotifyUrl: track.spotify_url,
            previewUrl: track.preview_url,
            matchingCharts, // Include all matching charts
          };
        })
        .filter(_Boolean); // Remove null values
      
      setSongs(allSongsWithCharts);
      setFilteredSongs(allSongsWithCharts);
      setStatus({ status: 'done', songsCounted: 0 });
      toast.success(`Loaded ${allSongsWithCharts.length} songs from playlist with chart matching (directory scan skipped)`);
      
    } catch (error) {
      console.error('Error loading chart data:', error);
      toast.error('Failed to load chart data');
      
      // Fallback to no charts if chart loading fails
      const allSongsForDownload = currentPlaylistTracks.map(track => ({
        artist: track.artists[0] || 'Unknown Artist',
        song: track.name,
        spotifyUrl: track.spotify_url,
        previewUrl: track.preview_url,
        matchingCharts: [] as SpotifyChartData[],
      }));
      
      setSongs(allSongsForDownload);
      setFilteredSongs(allSongsForDownload);
      setStatus({ status: 'done', songsCounted: 0 });
      toast.success(`Loaded ${allSongsForDownload.length} songs from playlist (chart matching failed)`);
    }
  }, [currentPlaylistTracks]);

  const selectedPlaylist = playlists.find(p => p.id === selectedPlaylistId);

  // Filter playlists based on search term
  const filteredPlaylists = useMemo(() => {
    if (!playlistSearchTerm) return playlists;
    
    const lowercaseSearch = playlistSearchTerm.toLowerCase();
    return playlists.filter(playlist =>
      playlist.name.toLowerCase().includes(lowercaseSearch) ||
      playlist.description?.toLowerCase().includes(lowercaseSearch) ||
      playlist.owner.display_name?.toLowerCase().includes(lowercaseSearch)
    );
  }, [playlists, playlistSearchTerm]);

  // Paginated playlists
  const paginatedPlaylists = useMemo(() => {
    const startIndex = (currentPage - 1) * playlistsPerPage;
    const endIndex = startIndex + playlistsPerPage;
    return filteredPlaylists.slice(startIndex, endIndex);
  }, [filteredPlaylists, currentPage, playlistsPerPage]);

  const totalPages = Math.ceil(filteredPlaylists.length / playlistsPerPage);

  // Reset to first page when search changes
  useEffect(() => {
    setCurrentPage(1);
  }, [playlistSearchTerm]);

  return (
    <div className="space-y-6">
      {/* Playlist Selection */}
      <Card>
        <CardHeader>
          <CardTitle>Select Playlist</CardTitle>
          <CardDescription>
            Choose a single playlist to view and download its songs
            {selectedPlaylist && (
              <span className="ml-2">({currentPlaylistTracks.length} tracks loaded)</span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {status.status === 'loading-playlists' ? (
            <p className="text-sm text-muted-foreground">Loading your playlists...</p>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="playlist-search">Search Playlists</Label>
                <Input
                  id="playlist-search"
                  placeholder="Search by playlist name, description, or owner..."
                  value={playlistSearchTerm}
                  onChange={(e) => setPlaylistSearchTerm(e.target.value)}
                />
              </div>

              {/* Results and pagination info */}
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>
                  {filteredPlaylists.length === 0 
                    ? 'No playlists found'
                    : `${filteredPlaylists.length} playlist${filteredPlaylists.length === 1 ? '' : 's'} found`
                  }
                </span>
                {totalPages > 1 && (
                  <span>
                    Page {currentPage} of {totalPages}
                  </span>
                )}
              </div>

              {/* Playlist List */}
              {filteredPlaylists.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  {playlistSearchTerm 
                    ? `No playlists found matching "${playlistSearchTerm}"`
                    : 'No playlists available'
                  }
                </div>
              ) : (
                <div className="space-y-2">
                  {paginatedPlaylists.map((playlist, index) => {
                    const isSelected = selectedPlaylistId === playlist.id;
                    return (
                      <Card 
                        key={`${playlist.id}-${index}`} 
                        className={`cursor-pointer transition-colors hover:bg-muted/50 ${
                          isSelected ? 'ring-2 ring-primary bg-muted/30' : ''
                        }`}
                        onClick={() => {
                          setSelectedPlaylistId(playlist.id);
                          loadPlaylistTracks(playlist.id);
                          // Reset songs when changing playlist
                          setSongs(null);
                          setFilteredSongs(null);
                        }}
                      >
                        <CardContent className="p-4">
                          <div className="flex items-center space-x-4">
                            {playlist.images?.[0] && (
                              <img 
                                src={playlist.images[0].url} 
                                alt={playlist.name}
                                className="w-16 h-16 rounded-lg object-cover flex-shrink-0"
                              />
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <h3 className="font-semibold text-lg truncate">{playlist.name}</h3>
                                {isSelected && (
                                  <span className="text-xs bg-primary text-primary-foreground px-2 py-1 rounded">
                                    Selected
                                  </span>
                                )}
                              </div>
                              {playlist.description && (
                                <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
                                  {playlist.description}
                                </p>
                              )}
                              <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
                                <span>{playlist.tracks.total} tracks</span>
                                <span>by {playlist.owner.display_name || 'Unknown'}</span>
                                {playlist.public !== undefined && (
                                  <span>{playlist.public ? 'Public' : 'Private'}</span>
                                )}
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}

              {/* Pagination Controls */}
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2 pt-4">
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
              
              {status.status === 'loading-tracks' && (
                <p className="text-sm text-muted-foreground text-center py-2">Loading playlist tracks...</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Scan Button */}
      {selectedPlaylistId && currentPlaylistTracks.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>
              {capabilities.mode === 'fallback' ? 'Download from Selected Playlist' : 'Scan Selected Playlist'}
            </CardTitle>
            <CardDescription>
              {capabilities.mode === 'fallback' 
                ? `Download songs from "${selectedPlaylist?.name}" with matching Clone Hero charts`
                : `Scan "${selectedPlaylist?.name}" (${currentPlaylistTracks.length} tracks) for matching Clone Hero charts`
              }
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex justify-center">
              {capabilities.mode === 'fallback' 
                ? (songs ? (
                    <p className="text-sm text-muted-foreground">
                      {songs.length} songs with matching charts loaded
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground">Loading songs with chart matching...</p>
                  ))
                : renderStatus(status, calculate, skipDirectorySelection)
              }
            </div>
          </CardContent>
        </Card>
      )}

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
                        <span className="ml-2">({filteredSongs.length} of {songs.length} songs)</span>
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
              </CardContent>
            </CollapsibleContent>
          </Collapsible>
        </Card>
      )}

      {filteredSongs && <SpotifyTableDownloader tracks={filteredSongs} showPreview={true} />}
    </div>
  );
}

function renderStatus(status: Status, scanHandler: () => void, skipHandler: () => void) {
  switch (status.status) {
    case 'not-started':
      return (
        <div className="flex flex-col gap-2">
          <Button onClick={scanHandler}>Select Clone Hero Songs Folder</Button>
          <Button variant="outline" onClick={skipHandler} size="sm">
            Skip - Show All Songs for Download
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
      return <Button onClick={scanHandler}>Rescan</Button>;
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