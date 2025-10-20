'use client';

import {Suspense, use, useCallback, useEffect, useRef, useState} from 'react';
import {useChorusChartDb} from '@/lib/chorusChartDb';
import {createClient} from '@/lib/supabase/client';
import {Button} from '@/components/ui/button';
import {Icons} from '@/components/icons';
import {getLocalDb} from '@/lib/local-db/client';
import {sql} from 'kysely';
import {SignInWithSpotifyCard} from '../spotify/app/SignInWithSpotifyCard';
import {
  getSpotifyLibraryMetadata,
  useSpotifyLibraryUpdate,
} from '@/lib/spotify-sdk/SpotifyFetching';
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
import {getSpotifySdk} from '@/lib/spotify-sdk/ClientInstance';
import {SpotifyApi} from '@spotify/web-api-ts-sdk';
import {ErrorBoundary} from '@sentry/nextjs';

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
  // const [status, setStatus] = useState<Status>({
  //   status: 'not-started',
  // });

  // const [chorusChartProgress, fetchChorusCharts] = useChorusChartDb();

  // const calculate = useCallback(async () => {
  //   const abortController = new AbortController();

  //   setStatus({status: 'songs-from-encore'});

  //   const chorusChartsPromise = fetchChorusCharts(abortController);

  //   const [allChorusCharts] = await Promise.all([chorusChartsPromise]);

  //   setStatus({status: 'done'});
  //   console.log(allChorusCharts);
  // }, []);

  return (
    <ErrorBoundary fallback={<p>⚠️Something went wrong</p>}>
      <Suspense
        fallback={
          <div className="flex justify-center items-center p-8">
            <div className="text-lg">Loading playlists and albums...</div>
          </div>
        }>
        <RenderSpotifyLibrary />
      </Suspense>
    </ErrorBoundary>
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

const dataCache = new Map<string, Promise<any>>();

type UseDataResult<T> = {
  data: T;
};
function useData<T>({
  key,
  fn,
}: {
  key: string;
  fn: () => Promise<T>;
}): UseDataResult<T> {
  if (!dataCache.has(key)) {
    dataCache.set(key, fn());
  }

  const promise = dataCache.get(key) as Promise<T>;

  const data = use(promise);
  return {data: data};
}

async function getPlaylistAlbumData(): Promise<PlaylistAlbumData[]> {
  const sdk = await getSpotifySdk();
  if (sdk == null) {
    throw new Error('Spotify SDK not found');
  }

  const {playlistMetadata, albumMetadata} =
    await getSpotifyLibraryMetadata(sdk);

  const items: PlaylistAlbumData[] = [
    ...Object.entries(playlistMetadata).map(([id, metadata]) => {
      return {
        id,
        name: metadata.name,
        creator: metadata.owner.displayName,
        total_tracks: metadata.total,
        matching_charts_count: 0,
        type: 'playlist' as const,
      };
    }),
    ...Object.entries(albumMetadata).map(([id, metadata]) => {
      return {
        id,
        name: metadata.name,
        creator: metadata.artistName ?? '',
        total_tracks: metadata.totalTracks ?? 0,
        matching_charts_count: 0,
        type: 'album' as const,
      };
    }),
  ];

  return items;
}

function RenderSpotifyLibrary() {
  const {data} = useData({
    key: 'spotify-playlist-album-data',
    fn: getPlaylistAlbumData,
  });

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
                {data.length}
              </div>
              <div className="text-xs text-muted-foreground">
                Playlists & Albums
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
