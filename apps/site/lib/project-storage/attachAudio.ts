/**
 * The one writer of a project's `audio/` directory from a file the user
 * dropped on the editor.
 *
 * Two things have to agree afterwards: what is on disk, and what the project
 * record says about it (`hasAudio`, and the duration the list row shows). So
 * the naming decision, the write and the record update all live here.
 */

import {pickPrimaryAudioFile} from '@/lib/audio/pickPrimaryAudioFile';

import type {OpfsProjectStore} from './opfsProjectStore';

export interface AttachableAudioFile {
  fileName: string;
  data: Uint8Array;
}

/** Lowercase extension including the dot, or '' when the name has none. */
function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? fileName.slice(dot).toLowerCase() : '';
}

/**
 * The names `files` are stored under.
 *
 * On a project that has no audio yet, the largest file becomes `song.<ext>`:
 * the editor's decode step promotes the file named `song` to the full-mix
 * slot, and every other file plays beside it as a stem. On a project that
 * already has audio, every file keeps its own name — the full mix is
 * already decided.
 *
 * A name that would collide with a file already in `audio/` (or with another
 * file in the same batch) gets a `-2`, `-3`, ... suffix rather than
 * overwriting it.
 */
export function planAttachedAudioNames(
  files: readonly AttachableAudioFile[],
  {
    hadAudio,
    existingFileNames = [],
  }: {hadAudio: boolean; existingFileNames?: readonly string[]},
): AttachableAudioFile[] {
  const primary = hadAudio ? null : pickPrimaryAudioFile(files);
  const taken = new Set(existingFileNames.map(n => n.toLowerCase()));

  return files.map(file => {
    const wanted =
      file === primary ? `song${extensionOf(file.fileName)}` : file.fileName;
    const ext = extensionOf(wanted);
    const base = ext ? wanted.slice(0, -ext.length) : wanted;
    let fileName = wanted;
    for (let n = 2; taken.has(fileName.toLowerCase()); n++) {
      fileName = `${base}-${n}${ext}`;
    }
    taken.add(fileName.toLowerCase());
    return {fileName, data: file.data};
  });
}

export interface AttachAudioOptions {
  store: OpfsProjectStore;
  projectId: string;
  files: readonly AttachableAudioFile[];
  /** Length of the project's audio after this attach, for the record's
   *  display duration. Omitted, the stored duration is left alone. */
  durationSeconds?: number | undefined;
}

/**
 * Writes `files` into the project's `audio/` directory and marks the record
 * as having audio. Returns the names they were stored under.
 *
 * "Does this project already have a full mix" is read from the directory
 * rather than taken from the caller: it is a fact about disk, it changes on
 * the first attach, and a caller holding it in React state would still be
 * reporting `false` for the second of two files dropped together.
 */
export async function attachAudioToProject({
  store,
  projectId,
  files,
  durationSeconds,
}: AttachAudioOptions): Promise<AttachableAudioFile[]> {
  const existing = (await store.loadAudioFiles(projectId)).map(f => f.fileName);
  const planned = planAttachedAudioNames(files, {
    hadAudio: existing.length > 0,
    existingFileNames: existing,
  });
  await store.writeAudioFiles(projectId, planned);
  await store.updateProject(projectId, {
    hasAudio: true,
    ...(durationSeconds != null ? {durationSeconds} : {}),
  });
  return planned;
}
