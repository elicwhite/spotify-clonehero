/**
 * The user's own work as it sits on the disk: one entry per project, plus the
 * databases, plus the ability to remove one.
 *
 * Deliberately light. This is read by the page a user opens when their device
 * is out of room, so it reads `metadata.json` itself rather than going through
 * `projects.ts`, which would pull the chart parser, the .sng reader and the
 * editor core in behind it. Taking a copy of a chart is the editor's export
 * dialog, loaded only when someone asks for one.
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

export interface StoredProject {
  id: string;
  /** Which namespace directory it was found in, needed to delete it. */
  namespace: string;
  /** From `metadata.json`; the id for a directory that has none. */
  name: string;
  artist: string;
  sizeBytes: number;
  /** ISO 8601, or null for a directory with no readable metadata. */
  updatedAt: string | null;
  /** Links this project to its entry in the stem cache, where it has one. */
  stemFingerprint: string | null;
  /**
   * False for a directory holding no `metadata.json`. Creating the directory
   * and writing the metadata are two separate awaits, so a tab closed between
   * them leaves one behind. Its bytes are real and it can be deleted, but no
   * project list will ever show it, and this page must not disagree with them
   * about what a project is.
   */
  isProject: boolean;
}

export interface ProjectStorage {
  projects: StoredProject[];
  /** The local databases and their SQLite sidecars. */
  databaseBytes: number;
  /** Everything above: the user's work in total. */
  bytes: number;
}

/** Bytes in a directory and everything under it. */
async function directoryBytes(dir: FileSystemDirectoryHandle): Promise<number> {
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

/** A project's metadata, or null where there is none to read. */
async function readMetadata(
  dir: FileSystemDirectoryHandle,
): Promise<Record<string, unknown> | null> {
  try {
    const text = await (await dir.getFileHandle(METADATA_FILE))
      .getFile()
      .then(file => file.text());
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'object' && parsed != null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Lists the user's projects and measures the databases. Never throws: this
 * feeds a readout, and a reading that fails must not take the page down.
 *
 * Projects live in the default bucket, which is the one persistence protects,
 * so only that root is walked.
 */
export async function measureProjectStorage(): Promise<ProjectStorage> {
  const projects: StoredProject[] = [];
  let databaseBytes = 0;
  try {
    const root = await navigator.storage.getDirectory();

    for (const namespace of PROJECT_NAMESPACES) {
      let nsDir: FileSystemDirectoryHandle;
      try {
        nsDir = await root.getDirectoryHandle(namespace);
      } catch {
        continue; // Never written on this origin.
      }
      for await (const [id, handle] of nsDir.entries()) {
        if (handle.kind !== 'directory') continue;
        // The stem cache is measured, pruned and freed as cache. Counting it
        // here as well would make the parts add up to more than the whole.
        if (CACHE_DIRS_IN_NAMESPACES.has(id)) continue;
        const metadata = await readMetadata(handle);
        projects.push({
          id,
          namespace,
          name: str(metadata?.['name']) ?? id,
          artist: str(metadata?.['artist']) ?? '',
          sizeBytes: await directoryBytes(handle),
          updatedAt: str(metadata?.['updatedAt']),
          stemFingerprint: str(metadata?.['stemFingerprint']),
          isProject: metadata != null,
        });
      }
    }

    for (const dbPath of [LOCAL_DB_PATH, DRUM_FILLS_DB_PATH]) {
      databaseBytes += await fileBytes(root, dbPath);
      for (const sidecar of DB_SIDECARS) {
        databaseBytes += await fileBytes(root, dbPath + sidecar);
      }
    }
  } catch {
    return {projects: [], databaseBytes: 0, bytes: 0};
  }

  return {
    projects,
    databaseBytes,
    bytes:
      databaseBytes +
      projects.reduce((sum, project) => sum + project.sizeBytes, 0),
  };
}

/** Removes one project and everything in it. True when it is gone. */
export async function deleteStoredProject(
  namespace: string,
  id: string,
): Promise<boolean> {
  try {
    const root = await navigator.storage.getDirectory();
    const nsDir = await root.getDirectoryHandle(namespace);
    await nsDir.removeEntry(id, {recursive: true});
    return true;
  } catch {
    return false;
  }
}
