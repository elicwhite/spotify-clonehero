// @ts-expect-error - shipped without types in this version
import getOriginPrivateDirectory from 'native-file-system-adapter/src/getOriginPrivateDirectory.js';
// @ts-expect-error - shipped without types in this version
import nodeAdapter from 'native-file-system-adapter/src/adapters/node.js';

/**
 * Wrap a real on-disk directory (e.g. an os.tmpdir() path) as a
 * `FileSystemDirectoryHandle` so production code that takes one — like
 * `scanLocalCharts` — can be exercised in Node tests against real files.
 */
export async function dirHandleForPath(
  absPath: string,
): Promise<FileSystemDirectoryHandle> {
  const handle = await getOriginPrivateDirectory(nodeAdapter, absPath);
  return handle as FileSystemDirectoryHandle;
}
