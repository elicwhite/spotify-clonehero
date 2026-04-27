import {sql, type Kysely} from 'kysely';
import type {DB} from '../types';

export type MissingChartRow = {
  md5: string;
  name: string;
  artist: string;
  charter: string;
  has_video_background: number;
};

/**
 * Returns chorus charts that are not already installed locally — matching is
 * by normalized artist + song + charter. Used by the chart downloader to drive
 * the queue of files to fetch.
 */
export async function findMissingCharts(
  db: Kysely<DB>,
): Promise<MissingChartRow[]> {
  const result = await sql<MissingChartRow>`
    SELECT c.md5, c.name, c.artist, c.charter, c.has_video_background
    FROM chorus_charts c
    WHERE NOT EXISTS (
      SELECT 1 FROM local_charts lc
      WHERE lc.artist_normalized = c.artist_normalized
        AND lc.song_normalized = c.name_normalized
        AND lc.charter_normalized = c.charter_normalized
    )
    AND c.name IS NOT NULL
    AND c.artist IS NOT NULL
    ORDER BY c.modified_time DESC
  `.execute(db);

  return result.rows;
}
