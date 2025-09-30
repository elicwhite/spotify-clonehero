import {getLocalDb} from './client';
import type {DB} from './types';
import {Kysely} from 'kysely';

export async function recalculateTrackChartMatches(db?: Kysely<DB>) {
  if (!db) {
    db = await getLocalDb();
  }

  await db
    .insertInto('spotify_track_chart_matches')
    .columns(['spotify_id', 'chart_md5', 'matched_at'])
    .expression(eb =>
      eb
        .selectFrom('spotify_tracks as s')
        .innerJoin('chorus_charts as c', join =>
          join
            .onRef('c.artist_normalized', '=', 's.artist_normalized')
            .onRef('c.name_normalized', '=', 's.name_normalized'),
        )
        .select([
          's.id as spotify_id',
          'c.md5 as chart_md5',
          eb.fn('unixepoch').as('matched_at'),
        ]),
    )
    .onConflict(oc =>
      oc.columns(['spotify_id', 'chart_md5']).doUpdateSet(eb => ({
        matched_at: eb.fn('unixepoch'),
      })),
    )
    .execute();
}
