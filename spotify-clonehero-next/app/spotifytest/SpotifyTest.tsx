'use client';

import {Suspense, useEffect, useState} from 'react';
import SpotifyTableDownloader, {
  SpotifyChartData,
  SpotifyPlaysRecommendations,
} from '../SpotifyTableDownloader';
import {createClient} from '@/lib/supabase/client';
import {Button} from '@/components/ui/button';
import {RxExternalLink} from 'react-icons/rx';
import SupportedBrowserWarning from '../SupportedBrowserWarning';
import {Icons} from '@/components/icons';
import {getLocalDb} from '@/lib/local-db/client';
import {sql} from 'kysely';
import {useData} from '@/lib/suspense-data';
import {SignInWithSpotifyCard} from '../spotify/app/SignInWithSpotifyCard';

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
        redirectPath="/spotifytest"
      />
    );
  }

  return (
    <>
      <p className="mb-4 text-center">
        This tool scans your Spotify{' '}
        <a
          href="https://www.spotify.com/us/account/privacy/"
          className="text-accent-foreground">
          Extended Streaming History <RxExternalLink className="inline" />
        </a>
        <br />
        and finds all the available charts on Encore for any song you&apos;ve
        ever listened to.
      </p>
      <Suspense fallback={<div>Loading...</div>}>
        <SupportedBrowserWarning>
          <SpotifyHistory authenticated={!!user && hasSpotify} />
        </SupportedBrowserWarning>
      </Suspense>
    </>
  );
}

type Status = {
  status:
    | 'not-started'
    | 'scanning'
    | 'done-scanning'
    | 'processing-spotify-dump'
    | 'songs-from-encore'
    | 'finding-matches'
    | 'done';
  songsCounted: number;
};

async function getData() {
  const db = await getLocalDb();

  console.log('db', db);

  const base = db
    .selectFrom('spotify_tracks as spot')
    .innerJoin('spotify_track_chart_matches as sc', 'spot.id', 'sc.spotify_id')
    .innerJoin('chorus_charts as cc', 'sc.chart_md5', 'cc.md5')
    .select([
      'spot.id as spotify_id',
      'spot.name as spotify_name',
      'spot.artist as spotify_artist',
      'cc.artist_normalized as an',
      'cc.name_normalized as tn',
      'cc.charter_normalized as cn',
    ])
    .where('cc.artist_normalized', '!=', '')
    .where('cc.name_normalized', '!=', '')
    .where('cc.charter_normalized', '!=', '')
    .as('b');

  const rows = await db
    .selectFrom(base)
    .innerJoin('chorus_charts as cc2', j =>
      j
        .onRef('cc2.artist_normalized', '=', 'b.an')
        .onRef('cc2.name_normalized', '=', 'b.tn')
        .onRef('cc2.charter_normalized', '=', 'b.cn'),
    )
    .leftJoin('local_charts as lc', j =>
      j
        .onRef('lc.artist_normalized', '=', 'cc2.artist_normalized')
        .onRef('lc.song_normalized', '=', 'cc2.name_normalized')
        .onRef('lc.charter_normalized', '=', 'cc2.charter_normalized'),
    )
    .select(eb => [
      'b.spotify_id',
      'b.spotify_name',
      'b.spotify_artist',
      // is_any_installed: 1 if any matching chart is present in local_charts
      sql<number>`coalesce(max(case when lc.artist_normalized is not null then 1 else 0 end), 0)`.as(
        'is_any_installed',
      ),
      sql<
        {
          md5: string;
          name: string;
          artist: string;
          charter: string;
          diff_drums: number;
          diff_guitar: number;
          diff_bass: number;
          diff_keys: number;
          diff_drums_real: number;
          modified_time: string;
          song_length: number;
          hasVideoBackground: boolean;
          albumArtMd5: string;
          group_id: string;
          isInstalled: number;
        }[]
      >`
      json_group_array(
        json_object(
          'md5', cc2.md5,
          'name', cc2.name,
          'artist', cc2.artist,
          'charter', cc2.charter,
          'diff_drums', cc2.diff_drums,
          'diff_guitar', cc2.diff_guitar,
          'diff_bass', cc2.diff_bass,
          'diff_keys', cc2.diff_keys,
          'diff_drums_real', cc2.diff_drums_real,
          'modified_time', cc2.modified_time,
          'song_length', cc2.song_length,
          'hasVideoBackground', cc2.has_video_background,
          'albumArtMd5', cc2.album_art_md5,
          'group_id', cc2.group_id,
          'isInstalled', case when lc.charter_normalized is not null then 1 else 0 end
        )
      )
      `.as('matching_charts'),
    ])
    .where('spotify_name', '!=', '')
    .where('spotify_artist', '!=', '')
    .groupBy(['b.spotify_id', 'b.spotify_name', 'b.spotify_artist'])
    .orderBy('b.spotify_artist')
    .orderBy('b.spotify_name')
    .execute();

  return rows;
}

function SpotifyHistory({authenticated}: {authenticated: boolean}) {
  const {data} = useData({
    key: 'spotify-history-tracks-data',
    fn: getData,
  });

  const songs: SpotifyPlaysRecommendations[] = data.map(item => {
    return {
      artist: item.spotify_artist,
      song: item.spotify_name,
      matchingCharts: item.matching_charts.map((chart): SpotifyChartData => {
        return {
          ...chart,
          isInstalled: chart.isInstalled === 1,
          modifiedTime: chart.modified_time,
          file: `https://files.enchor.us/${chart.md5}.sng`,
        };
      }),
    };
  });

  return (
    <>
      <SpotifyTableDownloader tracks={songs} showPreview={authenticated} />
    </>
  );
}
