import {Kysely, sql} from 'kysely';
import {getLocalDb} from '../client';
import {normalizeStrForMatching} from '../normalize';
import type {
  DB,
  SpotifyAlbums,
  SpotifyPlaylists,
  SpotifyTracks,
} from '../types';
import {recalculateTrackChartMatches} from '../queries';

export type DbPlaylistRow = SpotifyPlaylists;
export type DbAlbumRow = SpotifyAlbums;
export type DbTrackRow = SpotifyTracks;

export type TrackLike = {
  id: string;
  name: string;
  artists: string[];
};

export type TrackResult = {
  id: string;
  name: string;
  artists: string[];
  preview_url: string | null; // Fetched on-demand when user wants to preview
  spotify_url: string; // Always https://open.spotify.com/track/{id}
};

export type PlaylistLike = {
  id: string;
  snapshot_id: string;
  name: string;
  collaborative: boolean;
  owner_display_name: string;
  owner_external_url: string;
  total_tracks: number;
};

export type AlbumLike = {
  id: string;
  name: string;
  artist_name: string;
  total_tracks: number;
};

function nowIso(): string {
  return new Date().toISOString();
}

export async function upsertPlaylists(playlists: PlaylistLike[]) {
  if (playlists.length === 0) return;
  const db = await getLocalDb();
  const rows = playlists.map(p => ({
    id: p.id,
    snapshot_id: p.snapshot_id,
    name: p.name,
    collaborative: p.collaborative ? 1 : 0,
    owner_display_name: p.owner_display_name,
    owner_external_url: p.owner_external_url,
    total_tracks: p.total_tracks,
    updated_at: nowIso(),
  }));
  await db
    .insertInto('spotify_playlists')
    .values(rows)
    .onConflict(oc =>
      oc.column('id').doUpdateSet(eb => ({
        snapshot_id: eb.ref('excluded.snapshot_id'),
        name: eb.ref('excluded.name'),
        collaborative: eb.ref('excluded.collaborative'),
        owner_display_name: eb.ref('excluded.owner_display_name'),
        owner_external_url: eb.ref('excluded.owner_external_url'),
        total_tracks: eb.ref('excluded.total_tracks'),
        updated_at: eb.ref('excluded.updated_at'),
      })),
    )
    .execute();
}

export async function upsertAlbums(albums: AlbumLike[]) {
  if (albums.length === 0) return;
  const db = await getLocalDb();
  const rows = albums.map(a => ({
    id: a.id,
    name: a.name,
    artist_name: a.artist_name,
    total_tracks: a.total_tracks,
    updated_at: nowIso(),
  }));
  await db
    .insertInto('spotify_albums')
    .values(rows)
    .onConflict(oc =>
      oc.column('id').doUpdateSet(eb => ({
        name: eb.ref('excluded.name'),
        artist_name: eb.ref('excluded.artist_name'),
        total_tracks: eb.ref('excluded.total_tracks'),
        updated_at: eb.ref('excluded.updated_at'),
      })),
    )
    .execute();
}

export async function upsertTracks(tracks: TrackLike[]) {
  if (tracks.length === 0) return;
  const db = await getLocalDb();

  upsertTracksPrivate(
    db,
    tracks.filter(t => t.id != null),
  );
}

async function upsertTracksPrivate(db: Kysely<DB>, tracks: TrackLike[]) {
  if (tracks.length === 0) return;

  const rows = tracks.map(t => ({
    id: t.id,
    name: t.name,
    artist: t.artists[0],
    artist_normalized: normalizeStrForMatching(t.artists[0]),
    name_normalized: normalizeStrForMatching(t.name),
    updated_at: nowIso(),
  }));
  await db
    .insertInto('spotify_tracks')
    .values(rows)
    .onConflict(oc =>
      oc.column('id').doUpdateSet(eb => ({
        name: eb.ref('excluded.name'),
        artist: eb.ref('excluded.artist'),
        artist_normalized: eb.ref('excluded.artist_normalized'),
        name_normalized: eb.ref('excluded.name_normalized'),
        updated_at: eb.ref('excluded.updated_at'),
      })),
    )
    .execute();

  await recalculateTrackChartMatches(db);
}

export async function appendPlaylistTracks(
  playlistId: string,
  tracks: TrackLike[],
) {
  if (tracks.length === 0) return;
  const db = await getLocalDb();

  await db.transaction().execute(async trx => {
    // Upsert tracks first
    const filteredTracks = tracks.filter(t => t.id != null);
    await upsertTracksPrivate(trx, filteredTracks);

    // Then link tracks to playlist
    const linkRows = filteredTracks.map(t => ({
      playlist_id: playlistId,
      track_id: t.id,
    }));
    await trx
      .insertInto('spotify_playlist_tracks')
      .values(linkRows)
      .onConflict(oc => oc.columns(['playlist_id', 'track_id']).doNothing())
      .execute();
  });
}

export async function replacePlaylistTracks(
  playlistId: string,
  tracks: TrackLike[],
) {
  const db = await getLocalDb();

  await db.transaction().execute(async trx => {
    // Delete existing playlist tracks
    await trx
      .deleteFrom('spotify_playlist_tracks')
      .where('playlist_id', '=', playlistId)
      .execute();

    // Upsert tracks and link them to playlist
    const filteredTracks = tracks.filter(t => t.id != null);
    if (filteredTracks.length > 0) {
      await upsertTracksPrivate(trx, filteredTracks);

      // Link tracks to playlist
      const linkRows = filteredTracks.map(t => ({
        playlist_id: playlistId,
        track_id: t.id,
      }));
      await trx
        .insertInto('spotify_playlist_tracks')
        .values(linkRows)
        .onConflict(oc => oc.columns(['playlist_id', 'track_id']).doNothing())
        .execute();
    }
  });
}

export async function replaceAlbumTracks(albumId: string, tracks: TrackLike[]) {
  const db = await getLocalDb();

  await db.transaction().execute(async trx => {
    // Upsert tracks first
    const filteredTracks = tracks.filter(t => t.id != null);
    await upsertTracksPrivate(trx, filteredTracks);

    // Delete existing album tracks
    await trx
      .deleteFrom('spotify_album_tracks')
      .where('album_id', '=', albumId)
      .execute();

    // Link tracks to album
    const rows = filteredTracks.map(t => ({
      album_id: albumId,
      track_id: t.id,
      updated_at: nowIso(),
    }));
    await trx
      .insertInto('spotify_album_tracks')
      .values(rows)
      .onConflict(oc => oc.columns(['album_id', 'track_id']).doNothing())
      .execute();
  });
}

export async function getPlaylistMetadataMapBySnapshot(): Promise<{
  [snapshotId: string]: {
    id: string;
    name: string;
    externalUrl: string;
    total: number;
    owner: {displayName: string; externalUrl: string};
    collaborative: boolean;
  };
}> {
  const db = await getLocalDb();
  const rows = await db.selectFrom('spotify_playlists').selectAll().execute();
  return rows.reduce((acc, r) => {
    acc[r.snapshot_id] = {
      id: r.id,
      name: r.name,
      externalUrl: '',
      total: r.total_tracks,
      owner: {
        displayName: r.owner_display_name,
        externalUrl: r.owner_external_url,
      },
      collaborative: Boolean(r.collaborative),
    };
    return acc;
  }, {} as any);
}

export async function getAlbumMetadataMap(): Promise<{
  [albumId: string]: {
    id: string;
    name: string;
    externalUrl?: string;
    artistName?: string;
    addedAt: string;
    totalTracks?: number;
  };
}> {
  const db = await getLocalDb();
  const rows = await db.selectFrom('spotify_albums').selectAll().execute();
  return rows.reduce((acc, r) => {
    acc[r.id] = {
      id: r.id,
      name: r.name,
      artistName: r.artist_name,
      addedAt: r.updated_at,
      totalTracks: r.total_tracks,
    };
    return acc;
  }, {} as any);
}

export async function getPlaylistTracksBySnapshot(): Promise<{
  [snapshotId: string]: TrackResult[];
}> {
  const db = await getLocalDb();
  const rows = await db
    .selectFrom('spotify_playlist_tracks as spt')
    .innerJoin('spotify_playlists as sp', 'sp.id', 'spt.playlist_id')
    .innerJoin('spotify_tracks as st', 'st.id', 'spt.track_id')
    .select([
      'sp.snapshot_id as snapshot_id',
      'st.id as id',
      'st.name as name',
      'st.artist as artist',
    ])
    .execute();
  const map: {[snapshot: string]: TrackResult[]} = {};
  for (const r of rows) {
    const artists =
      (r as any).artist?.split(',').map((s: string) => s.trim()) || [];
    const snapshot = (r as any).snapshot_id as string;
    if (!map[snapshot]) map[snapshot] = [];
    map[snapshot].push({
      id: (r as any).id,
      name: (r as any).name,
      artists,
      preview_url: null, // Will be fetched on-demand when user wants to preview
      spotify_url: `https://open.spotify.com/track/${(r as any).id}`,
    });
  }
  return map;
}

export async function getAlbumTracksMap(): Promise<{
  [albumId: string]: TrackResult[];
}> {
  const db = await getLocalDb();
  const rows = await db
    .selectFrom('spotify_album_tracks as sat')
    .innerJoin('spotify_tracks as st', 'st.id', 'sat.track_id')
    .select([
      'sat.album_id as album_id',
      'st.id as id',
      'st.name as name',
      'st.artist as artist',
    ])
    .execute();
  const map: {[albumId: string]: TrackResult[]} = {};
  for (const r of rows) {
    const artists =
      (r as any).artist?.split(',').map((s: string) => s.trim()) || [];
    const albumId = (r as any).album_id as string;
    if (!map[albumId]) map[albumId] = [];
    map[albumId].push({
      id: (r as any).id,
      name: (r as any).name,
      artists,
      preview_url: null, // Will be fetched on-demand when user wants to preview
      spotify_url: `https://open.spotify.com/track/${(r as any).id}`,
    });
  }
  return map;
}

export async function deleteMissingPlaylistsBySnapshot(
  existingSnapshots: string[],
) {
  const db = await getLocalDb();
  const rows = await db
    .selectFrom('spotify_playlists')
    .select(['id', 'snapshot_id'])
    .execute();
  const toDelete = rows
    .filter(r => !existingSnapshots.includes(r.snapshot_id))
    .map(r => r.id);
  if (toDelete.length === 0) return;
  await db
    .deleteFrom('spotify_playlists')
    .where('id', 'in', toDelete)
    .execute();
}

export async function deleteMissingAlbums(existingAlbumIds: string[]) {
  const db = await getLocalDb();
  const rows = await db.selectFrom('spotify_albums').select('id').execute();
  const toDelete = rows
    .map(r => r.id)
    .filter(id => !existingAlbumIds.includes(id));
  if (toDelete.length === 0) return;
  await db.deleteFrom('spotify_albums').where('id', 'in', toDelete).execute();
}

export async function deleteOrphanedTracks() {
  const db = await getLocalDb();

  await db.transaction().execute(async trx => {
    // Find tracks that are not referenced in any playlist or album
    const orphanedTracks = await trx
      .selectFrom('spotify_tracks as st')
      .leftJoin('spotify_playlist_tracks as spt', 'spt.track_id', 'st.id')
      .leftJoin('spotify_album_tracks as sat', 'sat.track_id', 'st.id')
      .where('spt.track_id', 'is', null)
      .where('sat.track_id', 'is', null)
      .select('st.id')
      .execute();

    if (orphanedTracks.length > 0) {
      const trackIds = orphanedTracks.map(t => t.id);

      // Delete from tracks table
      await trx
        .deleteFrom('spotify_tracks')
        .where('id', 'in', trackIds)
        .execute();

      console.log(`Deleted ${trackIds.length} orphaned tracks`);
    }
  });
}

export async function analyzeDataConsistency() {
  const db = await getLocalDb();

  // Get total counts
  const trackCount = await db
    .selectFrom('spotify_tracks')
    .select(db.fn.count('id').as('count'))
    .executeTakeFirst();

  const playlistTrackCount = await db
    .selectFrom('spotify_playlist_tracks')
    .select(db.fn.count('track_id').as('count'))
    .executeTakeFirst();

  // Get unique track IDs in playlist_tracks
  const uniquePlaylistTrackIds = await db
    .selectFrom('spotify_playlist_tracks')
    .select('track_id')
    .distinct()
    .execute();

  // Get track IDs that exist in playlist_tracks but not in tracks
  const orphanedTracks = await db
    .selectFrom('spotify_playlist_tracks as spt')
    .leftJoin('spotify_tracks as st', 'st.id', 'spt.track_id')
    .where('st.id', 'is', null)
    .select(['spt.track_id', 'spt.playlist_id'])
    .execute();

  // Get tracks that exist in tracks but not referenced in any playlist
  const unreferencedTracks = await db
    .selectFrom('spotify_tracks as st')
    .leftJoin('spotify_playlist_tracks as spt', 'spt.track_id', 'st.id')
    .where('spt.track_id', 'is', null)
    .select('st.id')
    .execute();

  // Get tracks that are truly orphaned (not in playlists AND not in albums)
  const trulyOrphanedTracks = await db
    .selectFrom('spotify_tracks as st')
    .leftJoin('spotify_playlist_tracks as spt', 'spt.track_id', 'st.id')
    .leftJoin('spotify_album_tracks as sat', 'sat.track_id', 'st.id')
    .where('spt.track_id', 'is', null)
    .where('sat.track_id', 'is', null)
    .select('st.id')
    .execute();

  // Calculate average tracks per playlist
  const playlistCount = await db
    .selectFrom('spotify_playlists')
    .select(db.fn.count('id').as('count'))
    .executeTakeFirst();

  const totalTracks = Number(trackCount?.count || 0);
  const totalPlaylistTracks = Number(playlistTrackCount?.count || 0);
  const uniquePlaylistTrackCount = uniquePlaylistTrackIds.length;
  const orphanedCount = orphanedTracks.length;
  const unreferencedCount = unreferencedTracks.length;
  const trulyOrphanedCount = trulyOrphanedTracks.length;
  const totalPlaylists = Number(playlistCount?.count || 0);

  const avgTracksPerPlaylist =
    totalPlaylists > 0 ? totalPlaylistTracks / totalPlaylists : 0;
  const duplicateRatio =
    totalPlaylistTracks > 0
      ? (totalPlaylistTracks - uniquePlaylistTrackCount) / totalPlaylistTracks
      : 0;

  return {
    summary: {
      totalTracks,
      totalPlaylistTracks,
      uniquePlaylistTracks: uniquePlaylistTrackCount,
      totalPlaylists,
      avgTracksPerPlaylist: Math.round(avgTracksPerPlaylist * 100) / 100,
      duplicateRatio: Math.round(duplicateRatio * 100) / 100,
    },
    issues: {
      orphanedTracks: {
        count: orphanedCount,
        examples: orphanedTracks.slice(0, 5).map(t => ({
          trackId: t.track_id,
          playlistId: t.playlist_id,
        })),
      },
      unreferencedTracks: {
        count: unreferencedCount,
        examples: unreferencedTracks.slice(0, 5).map(t => t.id),
      },
      trulyOrphanedTracks: {
        count: trulyOrphanedCount,
        examples: trulyOrphanedTracks.slice(0, 5).map(t => t.id),
      },
    },
    analysis: {
      isConsistent: orphanedCount === 0 && trulyOrphanedCount === 0,
      hasOrphanedData: orphanedCount > 0,
      hasUnreferencedData: unreferencedCount > 0,
      hasTrulyOrphanedData: trulyOrphanedCount > 0,
      expectedDifference: totalPlaylistTracks - uniquePlaylistTrackCount,
      actualDifference: totalPlaylistTracks - totalTracks,
      isDifferenceExpected:
        Math.abs(
          totalPlaylistTracks -
            uniquePlaylistTrackCount -
            (totalPlaylistTracks - totalTracks),
        ) <= 1,
    },
  };
}
