/**
 * How much room the user's own work takes: the chart projects, the audio
 * inside them, and the local databases.
 *
 * A storage readout that showed only the caches would leave the difference
 * between "used by this site" and everything named unaccounted for, and the
 * reading available to a user staring at that gap is that their charts are the
 * problem. They are the one thing on the page that must never be deleted to
 * make room, so they are worth naming.
 *
 * Every project namespace is counted, current and legacy, because a project in
 * a legacy namespace is still the user's work and still takes the disk.
 */

import {LOCAL_DB_PATH} from '@/lib/local-db/path';
import {
  CHART_EDITOR_LEGACY_NAMESPACES,
  CHART_EDITOR_NAMESPACE,
  DRUM_TRANSCRIPTION_NAMESPACE,
} from './namespaces';

const PROJECT_NAMESPACES = [
  CHART_EDITOR_NAMESPACE,
  ...CHART_EDITOR_LEGACY_NAMESPACES,
  DRUM_TRANSCRIPTION_NAMESPACE,
];

/** The `/drum-fills` scan and practice database. */
const DRUM_FILLS_DB_PATH = 'drum-fills.sqlite3';

/**
 * SQLite writes a write-ahead log and a shared-memory file beside the
 * database. They are the user's data too, and a `-wal` can reach tens of MB.
 */
const DB_SIDECARS = ['-wal', '-shm'];

/** Cache directories that live inside a project namespace. */
const CACHE_DIRS_IN_NAMESPACES = new Set(['stem-cache']);

/** What makes a directory a project rather than a leftover. */
const METADATA_FILE = 'metadata.json';

export interface ProjectStorage {
  projectCount: number;
  bytes: number;
}

/** Bytes in a directory and everything under it. */
async function directoryBytes(
  dir: FileSystemDirectoryHandle,
): Promise<number> {
  let total = 0;
  for await (const [, handle] of dir.entries()) {
    total +=
      handle.kind === 'file'
        ? (await handle.getFile()).size
        : await directoryBytes(handle);
  }
  return total;
}

/** A file's size, or 0 where it is not there. */
async function fileBytes(
  dir: FileSystemDirectoryHandle,
  name: string,
): Promise<number> {
  try {
    return (await (await dir.getFileHandle(name)).getFile()).size;
  } catch {
    return 0;
  }
}

async function has(
  dir: FileSystemDirectoryHandle,
  name: string,
): Promise<boolean> {
  try {
    await dir.getFileHandle(name);
    return true;
  } catch {
    return false;
  }
}

/**
 * Measures the user's projects and databases. Never throws: this feeds a
 * readout, and a reading that fails must not take the page down with it.
 *
 * Projects live in the default bucket, which is the one persistence protects,
 * so only that root is walked.
 *
 * A directory counts toward `bytes` whatever it holds, because the bytes are
 * on the disk either way, but toward `projectCount` only when it holds
 * `metadata.json` — the rule `opfsProjectStore` and the drum-transcription
 * store already use to decide what is a project. Creating the directory and
 * writing its metadata are two separate awaits, so a tab closed between them
 * leaves a directory that no project list will ever show; counting it here
 * would make this page disagree with every other one.
 */
export async function measureProjectStorage(): Promise<ProjectStorage> {
  let projectCount = 0;
  let bytes = 0;
  try {
    const root = await navigator.storage.getDirectory();

    for (const namespace of PROJECT_NAMESPACES) {
      let nsDir: FileSystemDirectoryHandle;
      try {
        nsDir = await root.getDirectoryHandle(namespace);
      } catch {
        continue; // Never written on this origin.
      }
      for await (const [name, handle] of nsDir.entries()) {
        if (handle.kind !== 'directory') continue;
        // The stem cache is measured, pruned and freed as cache. Counting it
        // here as well would make the rows add up to more than the origin
        // holds.
        if (CACHE_DIRS_IN_NAMESPACES.has(name)) continue;
        if (await has(handle, METADATA_FILE)) projectCount++;
        bytes += await directoryBytes(handle);
      }
    }

    for (const dbPath of [LOCAL_DB_PATH, DRUM_FILLS_DB_PATH]) {
      bytes += await fileBytes(root, dbPath);
      for (const sidecar of DB_SIDECARS) {
        bytes += await fileBytes(root, dbPath + sidecar);
      }
    }
  } catch {
    return {projectCount: 0, bytes: 0};
  }
  return {projectCount, bytes};
}
