'use client';

import {useCallback, useEffect, useState} from 'react';
import {useChorusChartDb} from '@/lib/chorusChartDb';
import {createClient} from '@/lib/supabase/client';
import {Button} from '@/components/ui/button';
import {Icons} from '@/components/icons';
import {getLocalDb} from '@/lib/local-db/client';
import {sql} from 'kysely';
import {SignInWithSpotifyCard} from '../spotify/app/SignInWithSpotifyCard';
import {useSpotifyLibraryUpdate} from '@/lib/spotify-sdk/SpotifyFetching';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/card';
import SpotifyLoaderCard from '../spotify/app/SpotifyLoaderCard';
import UpdateChorusLoaderCard from '../spotify/app/UpdateChorusLoaderCard';
import {User, Disc3, Music} from 'lucide-react';

type Falsy = false | 0 | '' | null | undefined;
const _Boolean = <T extends any>(v: T): v is Exclude<typeof v, Falsy> =>
  Boolean(v);

export default function Page() {
  const supabase = createClient();
  const [user, setUser] = useState<any>(null);
  const [hasSpotify, setHasSpotify] = useState(false);

  useEffect(() => {
    (async () => {
      const {data} = await supabase.auth.getUser();
      setUser(data?.user ?? null);
      const isLinked = data?.user?.identities?.some(
        (i: any) => i.provider === 'spotify',
      );
      setHasSpotify(!!isLinked);
    })();
  }, [supabase]);

  if (!user || !hasSpotify) {
    const needsToLink = user != null && !hasSpotify;
    return (
      <SignInWithSpotifyCard
        supabaseClient={supabase}
        needsToLink={needsToLink}
        redirectPath="/sheet-music-spotify"
      />
    );
  }

  return (
    <div className="w-full">
      <LoggedIn />
    </div>
  );
}

type Status = {
  status:
    | 'not-started'
    | 'fetching-spotify-data'
    | 'songs-from-encore'
    | 'done';
};

function LoggedIn() {
  const [status, setStatus] = useState<Status>({
    status: 'not-started',
  });

  const [spotifyLibraryProgress, updateSpotifyLibrary] =
    useSpotifyLibraryUpdate();
  const [chorusChartProgress, fetchChorusCharts] = useChorusChartDb();

  const [started, setStarted] = useState(false);

  const calculate = useCallback(async () => {
    const abortController = new AbortController();

    setStarted(true);

    const updateSpotifyLibraryPromise = updateSpotifyLibrary(abortController, {
      concurrency: 3,
    });

    setStatus({status: 'fetching-spotify-data'});

    const chorusChartsPromise = fetchChorusCharts(abortController);

    const [allChorusCharts, updateSpotifyLibraryResult] = await Promise.all([
      chorusChartsPromise,
      updateSpotifyLibraryPromise,
    ]);

    setStatus({status: 'done'});
    console.log(allChorusCharts, updateSpotifyLibraryResult);
  }, []);

  return (
    <>
      {!started && <ScanSpotifyCTACard onClick={calculate} />}
      {started &&
        !(
          spotifyLibraryProgress.updateStatus === 'complete' &&
          status.status === 'done'
        ) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <SpotifyLoaderCard progress={spotifyLibraryProgress} />
            <div className="space-y-4">
              <UpdateChorusLoaderCard progress={chorusChartProgress} />
            </div>
          </div>
        )}

      {status.status === 'done' && <RenderSpotifyLibrary />}
    </>
  );
}

type PlaylistAlbumData = {
  id: string;
  name: string;
  creator: string;
  total_tracks: number;
  matching_charts_count: number;
  type: 'playlist' | 'album';
};

async function getData(): Promise<PlaylistAlbumData[]> {
  const db = await getLocalDb();

  // Query for playlists with matching chart counts
  const playlistsQuery = db
    .selectFrom('spotify_playlists as sp')
    .leftJoin('spotify_playlist_tracks as spt', 'sp.id', 'spt.playlist_id')
    .leftJoin('spotify_tracks as st', 'spt.track_id', 'st.id')
    .leftJoin('chorus_charts as cc', j =>
      j
        .onRef('cc.artist_normalized', '=', 'st.artist_normalized')
        .onRef('cc.name_normalized', '=', 'st.name_normalized'),
    )
    .select([
      'sp.id',
      'sp.name',
      'sp.owner_display_name as creator',
      'sp.total_tracks',
      sql<number>`count(distinct cc.md5)`.as('matching_charts_count'),
    ])
    .groupBy(['sp.id', 'sp.name', 'sp.owner_display_name', 'sp.total_tracks'])
    .select(sql<string>`'playlist'`.as('type'));

  // Query for albums with matching chart counts
  const albumsQuery = db
    .selectFrom('spotify_albums as sa')
    .leftJoin('spotify_album_tracks as sat', 'sa.id', 'sat.album_id')
    .leftJoin('spotify_tracks as st', 'sat.track_id', 'st.id')
    .leftJoin('chorus_charts as cc', j =>
      j
        .onRef('cc.artist_normalized', '=', 'st.artist_normalized')
        .onRef('cc.name_normalized', '=', 'st.name_normalized'),
    )
    .select([
      'sa.id',
      'sa.name as name',
      'sa.artist_name as creator',
      'sa.total_tracks',
      sql<number>`count(distinct cc.md5)`.as('matching_charts_count'),
    ])
    .groupBy(['sa.id', 'sa.name', 'sa.artist_name', 'sa.total_tracks'])
    .select(sql<string>`'album'`.as('type'));

  // Union the queries and order by matching charts count (descending), then by name
  const results = await playlistsQuery
    .union(albumsQuery)
    // .orderBy('matching_charts_count', 'desc')
    .orderBy('name', 'asc')
    .execute();

  console.log(results);

  return results as PlaylistAlbumData[];
}

function RenderSpotifyLibrary() {
  const [data, setData] = useState<PlaylistAlbumData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function run() {
      try {
        const result = await getData();
        setData(result);
      } catch (error) {
        console.error('Error fetching data:', error);
      } finally {
        setLoading(false);
      }
    }

    run();
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center items-center p-8">
        <div className="text-lg">Loading playlists and albums...</div>
      </div>
    );
  }

  const totalItems = data.length;
  const totalMatchingCharts = data.reduce(
    (sum, item) => sum + item.matching_charts_count,
    0,
  );

  return (
    <div className="bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-2xl">
        <CardHeader className="pb-4">
          <CardTitle className="text-2xl font-bold text-center flex items-center justify-center gap-2">
            <Icons.spotify className="h-6 w-6" style={{color: '#1ED760'}} />
            Your Spotify Library
          </CardTitle>
          <p className="text-muted-foreground text-center text-sm">
            Found matching sheet music for your playlists and albums
          </p>

          <div className="flex items-center justify-center gap-6 mt-4 pt-4 border-t">
            <div className="text-center">
              <div className="text-lg font-semibold text-foreground">
                {totalItems}
              </div>
              <div className="text-xs text-muted-foreground">
                Playlists & Albums
              </div>
            </div>
            <div className="text-center">
              <div className="text-lg font-semibold text-foreground">
                {totalMatchingCharts}
              </div>
              <div className="text-xs text-muted-foreground">
                Matching Charts
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="h-96 overflow-y-auto px-6 pb-6">
            <div className="border rounded-lg bg-card overflow-hidden">
              {data.map(item => (
                <PlaylistRow key={`${item.type}-${item.id}`} item={item} />
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function PlaylistRow({item}: {item: PlaylistAlbumData}) {
  return (
    <div className="flex items-center gap-3 p-3 hover:bg-accent/5 transition-colors border-b">
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <h3 className="font-medium text-sm truncate text-foreground">
          {item.name}
        </h3>
        {item.creator && (
          <span className="text-xs text-muted-foreground flex items-center gap-1 flex-shrink-0">
            {item.type === 'album' ? (
              <Disc3 className="h-3 w-3" />
            ) : (
              <User className="h-3 w-3" />
            )}
            {item.creator}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        <span className="text-xs text-foreground">
          {item.matching_charts_count} charts for {item.total_tracks} tracks
        </span>
      </div>
    </div>
  );
}

function ScanSpotifyCTACard({onClick}: {onClick: () => void}) {
  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader className="text-center">
        <CardTitle>Scan Spotify Library</CardTitle>
        <CardDescription>
          Scan your Spotify library to find matching sheet music.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button onClick={onClick} className="w-full">
          Scan Spotify Library
        </Button>
      </CardContent>
    </Card>
  );
}
