import {Kysely, sql} from 'kysely';
import {getLocalDb} from '../client';
import type {
  DB,
  SpotifyAlbums,
  SpotifyPlaylists,
  SpotifyTracks,
} from '../types';

export type DbPlaylistRow = SpotifyPlaylists;
export type DbAlbumRow = SpotifyAlbums;
export type DbTrackRow = SpotifyTracks;

export type TrackLike = {
  id: string;
  name: string;
  artists: string[];
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
  const rows = tracks.map(t => ({
    id: t.id,
    name: t.name,
    artist: t.artists.join(', '),
    updated_at: nowIso(),
  }));
  await db
    .insertInto('spotify_tracks')
    .values(rows)
    .onConflict(oc =>
      oc.column('id').doUpdateSet(eb => ({
        name: eb.ref('excluded.name'),
        artist: eb.ref('excluded.artist'),
        updated_at: eb.ref('excluded.updated_at'),
      })),
    )
    .execute();
}

export async function appendPlaylistTracks(
  playlistId: string,
  tracks: TrackLike[],
) {
  if (tracks.length === 0) return;
  const db = await getLocalDb();
  await upsertTracks(tracks);
  const linkRows = tracks.map(t => ({
    playlist_id: playlistId,
    track_id: t.id,
  }));
  await db
    .insertInto('spotify_playlist_tracks')
    .values(linkRows)
    .onConflict(oc => oc.columns(['playlist_id', 'track_id']).doNothing())
    .execute();
}

export async function replacePlaylistTracks(
  playlistId: string,
  tracks: TrackLike[],
) {
  const db = await getLocalDb();
  await db
    .deleteFrom('spotify_playlist_tracks')
    .where('playlist_id', '=', playlistId)
    .execute();
  await appendPlaylistTracks(playlistId, tracks);
}

export async function replaceAlbumTracks(albumId: string, tracks: TrackLike[]) {
  const db = await getLocalDb();
  await upsertTracks(tracks);
  await db
    .deleteFrom('spotify_album_tracks')
    .where('album_id', '=', albumId)
    .execute();
  const rows = tracks.map(t => ({
    album_id: albumId,
    track_id: t.id,
    updated_at: nowIso(),
  }));
  await db
    .insertInto('spotify_album_tracks')
    .values(rows)
    .onConflict(oc => oc.columns(['album_id', 'track_id']).doNothing())
    .execute();
}

// export async function getPlaylistMetadataMapBySnapshot(): Promise<{
//   [snapshotId: string]: {
//     id: string;
//     name: string;
//     externalUrl: string;
//     total: number;
//     owner: {displayName: string; externalUrl: string};
//     collaborative: boolean;
//   };
// }> {
//   const db = await getLocalDb();
//   const rows = await db.selectFrom('spotify_playlists').selectAll().execute();
//   return rows.reduce((acc, r) => {
//     acc[r.snapshot_id] = {
//       id: r.id,
//       name: r.name,
//       externalUrl: '',
//       total: r.total_tracks,
//       owner: {
//         displayName: r.owner_display_name,
//         externalUrl: r.owner_external_url,
//       },
//       collaborative: Boolean(r.collaborative),
//     };
//     return acc;
//   }, {} as any);
// }

// export async function getAlbumMetadataMap(): Promise<{
//   [albumId: string]: {
//     id: string;
//     name: string;
//     externalUrl?: string;
//     artistName?: string;
//     addedAt: string;
//     totalTracks?: number;
//   };
// }> {
//   const db = await getLocalDb();
//   const rows = await db.selectFrom('spotify_albums').selectAll().execute();
//   return rows.reduce((acc, r) => {
//     acc[r.id] = {
//       id: r.id,
//       name: r.name,
//       artistName: r.artist_name,
//       addedAt: r.updated_at,
//       totalTracks: r.total_tracks,
//     };
//     return acc;
//   }, {} as any);
// }

// export async function getPlaylistTracksBySnapshot(): Promise<{
//   [snapshotId: string]: TrackLike[];
// }> {
//   const db = await getLocalDb();
//   const rows = await db
//     .selectFrom('spotify_playlist_tracks as spt')
//     .innerJoin('spotify_playlists as sp', 'sp.id', 'spt.playlist_id')
//     .innerJoin('spotify_tracks as st', 'st.id', 'spt.track_id')
//     .select([
//       'sp.snapshot_id as snapshot_id',
//       'st.id as id',
//       'st.name as name',
//       'st.artist as artist',
//     ])
//     .execute();
//   const map: {[snapshot: string]: TrackLike[]} = {};
//   for (const r of rows) {
//     const artists =
//       (r as any).artist?.split(',').map((s: string) => s.trim()) || [];
//     const snapshot = (r as any).snapshot_id as string;
//     if (!map[snapshot]) map[snapshot] = [];
//     map[snapshot].push({id: (r as any).id, name: (r as any).name, artists});
//   }
//   return map;
// }

// export async function getAlbumTracksMap(): Promise<{
//   [albumId: string]: TrackLike[];
// }> {
//   const db = await getLocalDb();
//   const rows = await db
//     .selectFrom('spotify_album_tracks as sat')
//     .innerJoin('spotify_tracks as st', 'st.id', 'sat.track_id')
//     .select([
//       'sat.album_id as album_id',
//       'st.id as id',
//       'st.name as name',
//       'st.artist as artist',
//     ])
//     .execute();
//   const map: {[albumId: string]: TrackLike[]} = {};
//   for (const r of rows) {
//     const artists =
//       (r as any).artist?.split(',').map((s: string) => s.trim()) || [];
//     const albumId = (r as any).album_id as string;
//     if (!map[albumId]) map[albumId] = [];
//     map[albumId].push({id: (r as any).id, name: (r as any).name, artists});
//   }
//   return map;
// }

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
