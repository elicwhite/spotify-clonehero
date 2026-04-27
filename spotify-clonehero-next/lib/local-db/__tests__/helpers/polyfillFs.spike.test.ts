/** @jest-environment node */

import {describe, expect, test, afterEach, beforeEach} from '@jest/globals';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import scanLocalCharts, {
  type SongAccumulator,
} from '@/lib/local-songs-folder/scanLocalCharts';
import {dirHandleForPath} from './polyfillFs';
import {makeTmpDir} from './tmpDir';

describe('native-file-system-adapter polyfill drives scanLocalCharts', () => {
  let tmp: {path: string; cleanup: () => Promise<void>};

  beforeEach(async () => {
    tmp = await makeTmpDir();
  });

  afterEach(async () => {
    await tmp.cleanup();
  });

  test('scans a folder chart written via raw fs and returns its metadata', async () => {
    const chartDir = path.join(tmp.path, 'Beyonce - Halo (TestCharter)');
    await fs.mkdir(chartDir, {recursive: true});
    await fs.writeFile(
      path.join(chartDir, 'song.ini'),
      `[song]
name = Halo
artist = Beyoncé
charter = TestCharter
genre = Pop
song_length = 240000
diff_drums = 4
`,
      'utf8',
    );

    const handle = await dirHandleForPath(tmp.path);
    const acc: SongAccumulator[] = [];
    await scanLocalCharts(handle, acc, () => {});

    expect(acc).toHaveLength(1);
    expect(acc[0].artist).toBe('Beyoncé');
    expect(acc[0].song).toBe('Halo');
    expect(acc[0].charter).toBe('TestCharter');
    expect(acc[0].genre).toBe('Pop');
    // modifiedTime is an ISO string; should not be epoch zero
    expect(new Date(acc[0].modifiedTime).getTime()).toBeGreaterThan(0);
  });
});
