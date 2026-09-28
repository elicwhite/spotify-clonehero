/**
 * Files the tools write. Outputs are written to a temporary name in the
 * destination folder and renamed into place, so a reader (Remotion Studio, a
 * later step) never sees a half-written file, and a failed or interrupted
 * run leaves the previous output intact and no temporary files behind.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {onInterrupt} from './cleanup';

/** A sibling temporary path for `file`, unique to this process. */
const tempSibling = (file: string): string =>
  path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`,
  );

/** Writes `data` to `file` through a temporary file and a rename. */
export function writeFileAtomic(
  file: string,
  data: string | NodeJS.ArrayBufferView,
): void {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  const tmp = tempSibling(file);
  try {
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, {force: true});
    throw err;
  }
}

/** JSON written atomically: compact (the generated data files) unless `indent` is given. */
export const writeJsonAtomic = (
  file: string,
  data: unknown,
  indent?: number,
): void => writeFileAtomic(file, JSON.stringify(data, null, indent));

/**
 * Runs `produce(tmp)` to create `file` under a temporary name (for tools such
 * as ffmpeg that write the file themselves), then renames it into place. The
 * temporary name keeps the extension, so ffmpeg still picks the format.
 */
export async function produceAtomic<T>(
  file: string,
  produce: (tmp: string) => T | Promise<T>,
): Promise<T> {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  const ext = path.extname(file);
  const tmp = path.join(
    path.dirname(file),
    `.${path.basename(file, ext)}.${process.pid}.${Date.now()}.tmp${ext}`,
  );
  const release = onInterrupt(() => fs.rmSync(tmp, {force: true}));
  try {
    const result = await produce(tmp);
    fs.renameSync(tmp, file);
    return result;
  } catch (err) {
    fs.rmSync(tmp, {force: true});
    throw err;
  } finally {
    release();
  }
}

/** A fresh scratch folder under the system temp dir (honours $TMPDIR). */
const makeScratchDir = (label: string): string =>
  fs.mkdtempSync(path.join(os.tmpdir(), `${label}-`));

/** Runs `fn` with a scratch folder that is deleted afterwards. */
export async function withScratchDir<T>(
  label: string,
  fn: (dir: string) => T | Promise<T>,
): Promise<T> {
  const dir = makeScratchDir(label);
  const remove = () => fs.rmSync(dir, {recursive: true, force: true});
  const release = onInterrupt(remove);
  try {
    return await fn(dir);
  } finally {
    release();
    remove();
  }
}
