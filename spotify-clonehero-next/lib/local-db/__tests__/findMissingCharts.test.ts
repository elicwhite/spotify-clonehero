/** @jest-environment node */

import {afterEach, beforeEach, describe, expect, test} from '@jest/globals';
import type {Kysely} from 'kysely';
import scanLocalCharts, {
  type SongAccumulator,
} from '@/lib/local-songs-folder/scanLocalCharts';
import {findMissingCharts} from '../chorus/missing';
import {upsertLocalCharts} from '../local-charts';
import {installTestDb, teardownTestDb} from './helpers/testDb';
import {seedChorusCharts} from './helpers/spotifySeeders';
import {writeChartLibrary} from './helpers/chartFixtures';
import {makeTmpDir} from './helpers/tmpDir';
import {dirHandleForPath} from './helpers/polyfillFs';
import type {DB} from '../types';

describe('findMissingCharts', () => {
  let db: Kysely<DB>;
  let tmp: {path: string; cleanup: () => Promise<void>};

  beforeEach(async () => {
    db = await installTestDb();
    tmp = await makeTmpDir();
  });

  afterEach(async () => {
    await teardownTestDb(db);
    await tmp.cleanup();
  });

  test('excludes chorus charts that have a matching local chart', async () => {
    await writeChartLibrary(tmp.path, [
      {
        artist: 'Beyoncé',
        song: 'Halo',
        charter: 'TestCharter',
        format: 'folder',
      },
    ]);
    const accumulator: SongAccumulator[] = [];
    await scanLocalCharts(
      await dirHandleForPath(tmp.path),
      accumulator,
      () => {},
    );
    await upsertLocalCharts(accumulator);

    await seedChorusCharts(db, [
      {
        md5: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        name: 'Halo',
        artist: 'Beyoncé',
        charter: 'TestCharter',
      },
      {
        md5: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        name: 'Single Ladies',
        artist: 'Beyoncé',
        charter: 'TestCharter',
      },
    ]);

    const missing = await findMissingCharts(db);
    expect(missing).toHaveLength(1);
    expect(missing[0].md5).toBe('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
    expect(missing[0].name).toBe('Single Ladies');
  });

  test('matches across diacritic differences (local Beyoncé vs chorus Beyonce)', async () => {
    await writeChartLibrary(tmp.path, [
      {
        artist: 'Beyoncé',
        song: 'Halo',
        charter: 'TestCharter',
        format: 'folder',
      },
    ]);
    const accumulator: SongAccumulator[] = [];
    await scanLocalCharts(
      await dirHandleForPath(tmp.path),
      accumulator,
      () => {},
    );
    await upsertLocalCharts(accumulator);

    await seedChorusCharts(db, [
      {
        md5: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        name: 'Halo',
        artist: 'Beyonce', // No accent
        charter: 'TestCharter',
      },
    ]);

    const missing = await findMissingCharts(db);
    expect(missing).toHaveLength(0);
  });

  test('matches across leading-article differences (chorus "The Beatles" vs local "Beatles")', async () => {
    await writeChartLibrary(tmp.path, [
      {
        artist: 'Beatles',
        song: 'Help',
        charter: 'TestCharter',
        format: 'folder',
      },
    ]);
    const accumulator: SongAccumulator[] = [];
    await scanLocalCharts(
      await dirHandleForPath(tmp.path),
      accumulator,
      () => {},
    );
    await upsertLocalCharts(accumulator);

    await seedChorusCharts(db, [
      {
        md5: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        name: 'Help',
        artist: 'The Beatles',
        charter: 'TestCharter',
      },
    ]);

    const missing = await findMissingCharts(db);
    expect(missing).toHaveLength(0);
  });
});
