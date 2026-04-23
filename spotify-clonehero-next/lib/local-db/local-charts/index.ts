import {SongAccumulator} from '@/lib/local-songs-folder/scanLocalCharts';
import {getLocalDb} from '../client';
import {normalizeStrForMatching} from '../normalize';

const UPSERT_BATCH_SIZE = 50;
const DELETE_CHUNK_SIZE = 500;

export async function upsertLocalCharts(charts: SongAccumulator[]) {
  if (charts.length === 0) return;

  const db = await getLocalDb();
  const updatedAt = new Date().toISOString();

  await db.transaction().execute(async trx => {
    // Snapshot existing keys + mtimes — no `data` blob, so this read is cheap
    // even for 50k rows. Used to diff against the incoming scan.
    const existing = await trx
      .selectFrom('local_charts')
      .select(['id', 'artist', 'song', 'charter', 'modified_time'])
      .execute();

    const incoming = new Map<string, SongAccumulator>();
    for (const chart of charts) {
      incoming.set(
        makeKey(chart.artist, chart.song, chart.charter || ''),
        chart,
      );
    }

    const removedIds: number[] = [];
    for (const row of existing) {
      const key = makeKey(row.artist, row.song, row.charter);
      const c = incoming.get(key);
      if (c == null) {
        if (row.id != null) removedIds.push(row.id);
      } else if (c.modifiedTime === row.modified_time) {
        // Unchanged — no need to rewrite the row.
        incoming.delete(key);
      }
      // else: changed — keep in `incoming` so it gets re-upserted.
    }

    const toUpsert = Array.from(incoming.values());

    if (toUpsert.length > 0) {
      const values = toUpsert.map(chart => ({
        artist: chart.artist,
        song: chart.song,
        charter: chart.charter || '',
        artist_normalized: normalizeStrForMatching(chart.artist),
        song_normalized: normalizeStrForMatching(chart.song),
        charter_normalized: normalizeStrForMatching(chart.charter),
        modified_time: chart.modifiedTime,
        data: JSON.stringify(chart.data),
        updated_at: updatedAt,
      }));

      values
        .filter(v => v.charter == null)
        .forEach(v => {
          console.error('Invalid chart', v);
        });

      for (let i = 0; i < values.length; i += UPSERT_BATCH_SIZE) {
        const batch = values.slice(i, i + UPSERT_BATCH_SIZE);

        await trx
          .insertInto('local_charts')
          .values(batch)
          .onConflict(oc =>
            oc.columns(['artist', 'song', 'charter']).doUpdateSet(eb => ({
              artist_normalized: eb.ref('excluded.artist_normalized'),
              song_normalized: eb.ref('excluded.song_normalized'),
              charter_normalized: eb.ref('excluded.charter_normalized'),
              modified_time: eb.ref('excluded.modified_time'),
              data: eb.ref('excluded.data'),
              updated_at: updatedAt,
            })),
          )
          .execute();
      }
    }

    for (let i = 0; i < removedIds.length; i += DELETE_CHUNK_SIZE) {
      const chunk = removedIds.slice(i, i + DELETE_CHUNK_SIZE);
      await trx.deleteFrom('local_charts').where('id', 'in', chunk).execute();
    }
  });
}

function makeKey(artist: string, song: string, charter: string): string {
  // JSON-encode the tuple so any field content is unambiguous (no separator
  // collisions possible, no control chars in source).
  return JSON.stringify([artist, song, charter]);
}
