import type {Kysely} from 'kysely';
import {normalizeStrForMatching} from '../normalize';
import type {DB} from '../types';

export type AppleMusicTrackInput = {
  artist: string;
  catalogId?: string | null;
  name: string;
};

export type AppleMusicScanToken = {
  connectionEpoch: number;
  scanGeneration: number;
};

export type AppleMusicLibraryStats = {
  activeScanId: string | null;
  catalogAssociatedCount: number;
  fetchedCount: number;
  reportedTotal: number;
  storefront: string | null;
  trackCount: number;
  updatedAt: string | null;
  usableCount: number;
};

const STATE_ID = 1;
const SQLITE_VARIABLE_LIMIT = 32_000;
const TRACK_COLUMNS = 7;

function now() {
  return new Date().toISOString();
}

export async function discardAppleMusicScan(db: Kysely<DB>, scanId: string) {
  const state = await db
    .selectFrom('apple_music_library_state')
    .select('active_scan_id')
    .where('id', '=', STATE_ID)
    .executeTakeFirst();
  if (state?.active_scan_id === scanId) {
    throw new Error('Cannot discard the active Apple Music scan');
  }
  await db
    .deleteFrom('apple_music_tracks')
    .where('scan_id', '=', scanId)
    .execute();
}

export async function beginAppleMusicScan(db: Kysely<DB>, scanId: string) {
  await discardAppleMusicScan(db, scanId);
  return db.transaction().execute(async trx => {
    const state = await trx
      .selectFrom('apple_music_library_state')
      .select(['active_scan_id', 'connection_epoch', 'scan_generation'])
      .where('id', '=', STATE_ID)
      .executeTakeFirst();
    const token: AppleMusicScanToken = {
      connectionEpoch: state?.connection_epoch ?? 0,
      scanGeneration: (state?.scan_generation ?? 0) + 1,
    };
    await trx
      .insertInto('apple_music_library_state')
      .values({
        id: STATE_ID,
        connection_epoch: token.connectionEpoch,
        scan_generation: token.scanGeneration,
        active_scan_id: null,
        storefront: null,
        reported_total: 0,
        fetched_count: 0,
        usable_count: 0,
        catalog_associated_count: 0,
        track_count: 0,
        updated_at: null,
      })
      .onConflict(oc =>
        oc.column('id').doUpdateSet({
          scan_generation: token.scanGeneration,
        }),
      )
      .execute();

    const staleBefore = new Date(
      Date.now() - 24 * 60 * 60 * 1000,
    ).toISOString();
    let stale = trx
      .deleteFrom('apple_music_tracks')
      .where('updated_at', '<', staleBefore);
    if (state?.active_scan_id) {
      stale = stale.where('scan_id', '!=', state.active_scan_id);
    }
    await stale.execute();
    return token;
  });
}

export async function stageAppleMusicTracks(
  db: Kysely<DB>,
  scanId: string,
  tracks: readonly AppleMusicTrackInput[],
) {
  const updatedAt = now();
  const rows = tracks.flatMap(track => {
    const artist = track.artist.trim();
    const name = track.name.trim();
    const artistNormalized = normalizeStrForMatching(artist);
    const nameNormalized = normalizeStrForMatching(name);
    if (!artist || !name || !artistNormalized || !nameNormalized) return [];
    return [
      {
        scan_id: scanId,
        catalog_id: track.catalogId ?? null,
        artist,
        name,
        artist_normalized: artistNormalized,
        name_normalized: nameNormalized,
        updated_at: updatedAt,
      },
    ];
  });
  const batchSize = Math.floor(SQLITE_VARIABLE_LIMIT / TRACK_COLUMNS);
  for (let index = 0; index < rows.length; index += batchSize) {
    await db
      .insertInto('apple_music_tracks')
      .values(rows.slice(index, index + batchSize))
      .execute();
  }
  return rows.length;
}

export async function activateAppleMusicScan(
  db: Kysely<DB>,
  scanId: string,
  {
    storefront,
    reportedTotal,
    fetchedCount,
    usableCount,
    catalogAssociatedCount,
    scanToken,
  }: {
    storefront: string | null;
    reportedTotal: number;
    fetchedCount: number;
    usableCount: number;
    catalogAssociatedCount: number;
    scanToken: AppleMusicScanToken;
  },
) {
  const counts = {
    reportedTotal: Math.max(0, Math.floor(reportedTotal)),
    fetchedCount: Math.max(0, Math.floor(fetchedCount)),
    usableCount: Math.max(0, Math.floor(usableCount)),
    catalogAssociatedCount: Math.max(0, Math.floor(catalogAssociatedCount)),
  };
  await db.transaction().execute(async trx => {
    const state = await trx
      .selectFrom('apple_music_library_state')
      .select(['active_scan_id', 'connection_epoch', 'scan_generation'])
      .where('id', '=', STATE_ID)
      .executeTakeFirst();
    if ((state?.connection_epoch ?? 0) !== scanToken.connectionEpoch) {
      throw new Error('Apple Music connection was cleared during scan');
    }
    if ((state?.scan_generation ?? 0) !== scanToken.scanGeneration) {
      throw new Error('Apple Music scan was superseded by a newer scan');
    }
    const count = await trx
      .selectFrom('apple_music_tracks')
      .select(trx.fn.count('id').as('count'))
      .where('scan_id', '=', scanId)
      .executeTakeFirstOrThrow();
    await trx
      .insertInto('apple_music_library_state')
      .values({
        id: STATE_ID,
        connection_epoch: state?.connection_epoch ?? 0,
        scan_generation: state?.scan_generation ?? 0,
        active_scan_id: scanId,
        storefront,
        reported_total: counts.reportedTotal,
        fetched_count: counts.fetchedCount,
        usable_count: counts.usableCount,
        catalog_associated_count: counts.catalogAssociatedCount,
        track_count: Number(count.count),
        updated_at: now(),
      })
      .onConflict(oc =>
        oc.column('id').doUpdateSet({
          active_scan_id: scanId,
          storefront,
          reported_total: counts.reportedTotal,
          fetched_count: counts.fetchedCount,
          usable_count: counts.usableCount,
          catalog_associated_count: counts.catalogAssociatedCount,
          track_count: Number(count.count),
          updated_at: now(),
        }),
      )
      .execute();
    if (state?.active_scan_id && state.active_scan_id !== scanId) {
      await trx
        .deleteFrom('apple_music_tracks')
        .where('scan_id', '=', state.active_scan_id)
        .execute();
    }
  });
}

export async function getAppleMusicLibraryStats(
  db: Kysely<DB>,
): Promise<AppleMusicLibraryStats> {
  const state = await db
    .selectFrom('apple_music_library_state')
    .selectAll()
    .where('id', '=', STATE_ID)
    .executeTakeFirst();
  return {
    activeScanId: state?.active_scan_id ?? null,
    storefront: state?.storefront ?? null,
    reportedTotal: state?.reported_total ?? 0,
    fetchedCount: state?.fetched_count ?? 0,
    usableCount: state?.usable_count ?? 0,
    catalogAssociatedCount: state?.catalog_associated_count ?? 0,
    trackCount: state?.track_count ?? 0,
    updatedAt: state?.updated_at ?? null,
  };
}

export async function clearAppleMusicLibrary(db: Kysely<DB>) {
  await db.transaction().execute(async trx => {
    await trx.deleteFrom('apple_music_tracks').execute();
    const state = await trx
      .selectFrom('apple_music_library_state')
      .select(['connection_epoch', 'scan_generation'])
      .where('id', '=', STATE_ID)
      .executeTakeFirst();
    await trx
      .insertInto('apple_music_library_state')
      .values({
        id: STATE_ID,
        connection_epoch: (state?.connection_epoch ?? 0) + 1,
        scan_generation: (state?.scan_generation ?? 0) + 1,
        active_scan_id: null,
        storefront: null,
        reported_total: 0,
        fetched_count: 0,
        usable_count: 0,
        catalog_associated_count: 0,
        track_count: 0,
        updated_at: null,
      })
      .onConflict(oc =>
        oc.column('id').doUpdateSet({
          connection_epoch: (state?.connection_epoch ?? 0) + 1,
          scan_generation: (state?.scan_generation ?? 0) + 1,
          active_scan_id: null,
          storefront: null,
          reported_total: 0,
          fetched_count: 0,
          usable_count: 0,
          catalog_associated_count: 0,
          track_count: 0,
          updated_at: null,
        }),
      )
      .execute();
  });
}
