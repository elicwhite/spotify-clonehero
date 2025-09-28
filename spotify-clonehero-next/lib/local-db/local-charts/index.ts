import {SongAccumulator} from '@/lib/local-songs-folder/scanLocalCharts';
import {getLocalDb} from '../client';
import {normalizeStrForMatching} from '../normalize';

const BATCH_SIZE = 50;

export async function upsertLocalCharts(charts: SongAccumulator[]) {
  if (charts.length === 0) return;

  const db = await getLocalDb();
  const updatedAt = new Date().toISOString();

  await db.transaction().execute(async trx => {
    const values = charts.map(chart => ({
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

    for (let i = 0; i < values.length; i += BATCH_SIZE) {
      const batch = values.slice(i, i + BATCH_SIZE);

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

    await trx
      .deleteFrom('local_charts')
      .where('updated_at', '!=', updatedAt)
      .execute();
  });
}
