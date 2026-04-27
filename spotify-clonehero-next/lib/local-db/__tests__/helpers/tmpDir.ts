import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * Create a fresh empty directory under os.tmpdir() and return its absolute
 * path along with a cleanup hook. Use in beforeEach/afterEach.
 */
export async function makeTmpDir(): Promise<{
  path: string;
  cleanup: () => Promise<void>;
}> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sch-test-'));
  return {
    path: dir,
    cleanup: async () => {
      await fs.rm(dir, {recursive: true, force: true});
    },
  };
}
