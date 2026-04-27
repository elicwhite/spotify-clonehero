/** @jest-environment node */

import {describe, expect, test, afterEach, beforeEach} from '@jest/globals';
import type {Kysely} from 'kysely';
import {sql} from 'kysely';
import {createTestDb, installTestDb, teardownTestDb} from './testDb';
import {getLocalDb} from '../../client';
import type {DB} from '../../types';

describe('test DB factory', () => {
  let db: Kysely<DB>;

  beforeEach(async () => {
    db = await installTestDb();
  });

  afterEach(async () => {
    await teardownTestDb(db);
  });

  test('createTestDb runs all migrations and exposes the schema', async () => {
    const fresh = await createTestDb();
    try {
      // Tables created by 001
      await fresh.selectFrom('spotify_playlists').selectAll().execute();
      await fresh.selectFrom('spotify_albums').selectAll().execute();
      await fresh.selectFrom('spotify_tracks').selectAll().execute();
      // Tables created by 002 / 003
      await fresh.selectFrom('chorus_charts').selectAll().execute();
      await fresh.selectFrom('local_charts').selectAll().execute();
      // 007
      await fresh
        .selectFrom('spotify_track_chart_matches')
        .selectAll()
        .execute();
      // 008
      await fresh.selectFrom('spotify_history').selectAll().execute();
    } finally {
      await fresh.destroy();
    }
  });

  test('normalize scalar is registered and reachable from SQL', async () => {
    const result = await sql<{
      n: string;
    }>`SELECT normalize(${'The Beatles'}) AS n`.execute(db);
    expect(result.rows[0].n).toBe('beatles');
  });

  test('generated artist_bucket column on chorus_charts derives from normalized', async () => {
    await db
      .insertInto('chorus_charts')
      .values({
        md5: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        name: 'Halo',
        artist: 'Beyoncé',
        charter: 'TestCharter',
        artist_normalized: 'beyonce',
        name_normalized: 'halo',
        charter_normalized: 'testcharter',
        modified_time: '2024-01-01T00:00:00Z',
        group_id: 1,
        has_video_background: 0,
      })
      .execute();

    // artist_bucket is a virtual generated column added by migration 005;
    // it isn't in the kysely-codegen types, so query it via raw SQL.
    const result = await sql<{
      artist_bucket: string;
    }>`SELECT artist_bucket FROM chorus_charts LIMIT 1`.execute(db);
    expect(result.rows[0].artist_bucket).toBe('b');
  });

  test('getLocalDb() returns the installed override', async () => {
    const got = await getLocalDb();
    expect(got).toBe(db);
  });
});
