/**
 * OPFS (Origin Private File System) storage for drum-edit projects.
 *
 * All data is namespaced under `drum-edit/` within the OPFS root
 * to avoid collisions with other features (e.g. drum-transcription/).
 *
 * Directory structure:
 *   drum-edit/
 *     {projectId}/
 *       metadata.json        - Project metadata
 *       notes.chart           - Original chart text (as loaded)
 *       notes.edited.chart    - User-edited chart text (written on save)
 *       audio/
 *         {stem}.{ext}        - Original audio files from the loaded chart package
 *       original-files.json   - Manifest of original files for re-export
 */

import {writeFile, readJsonFile, readTextFile} from '@/lib/fileSystemHelpers';
import type {SourceFormat} from '@/components/chart-picker/chart-file-readers';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NAMESPACE = 'drum-edit';
const METADATA_FILE = 'metadata.json';
const AUDIO_DIR = 'audio';
const ORIGINAL_FILES_MANIFEST = 'original-files.json';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProjectMetadata {
  id: string;
  name: string;
  artist: string;
  charter: string;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  durationSeconds: number;
  sourceFormat: SourceFormat;
  originalName: string;
  sngMetadata?: Record<string, string>;
}

export interface ProjectSummary {
  id: string;
  name: string;
  artist: string;
  createdAt: string;
  updatedAt: string;
}

/** Entry in the original-files manifest for re-export. */
export interface OriginalFileEntry {
  fileName: string;
  /** Whether this file is stored in the audio/ subdirectory (audio files) or at the project root. */
  storedIn: 'audio' | 'root';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getOPFSRoot(): Promise<FileSystemDirectoryHandle> {
  return navigator.storage.getDirectory();
}

async function getNamespaceDir(): Promise<FileSystemDirectoryHandle> {
  const root = await getOPFSRoot();
  return root.getDirectoryHandle(NAMESPACE, {create: true});
}

async function getProjectDir(
  projectId: string,
  options: {create: boolean} = {create: false},
): Promise<FileSystemDirectoryHandle> {
  const ns = await getNamespaceDir();
  return ns.getDirectoryHandle(projectId, {create: options.create});
}

function generateId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `${timestamp}-${random}`;
}

// ---------------------------------------------------------------------------
// Project CRUD
// ---------------------------------------------------------------------------

/**
 * Creates a new drum-edit project in OPFS and stores all files from the
 * loaded chart package. Returns the project metadata.
 */
export async function createProject(opts: {
  name: string;
  artist: string;
  charter: string;
  durationSeconds: number;
  sourceFormat: SourceFormat;
  originalName: string;
  sngMetadata?: Record<string, string>;
  /** The .chart text content. */
  chartText: string;
  /** Audio files to store (fileName + raw bytes). */
  audioFiles: {fileName: string; data: Uint8Array}[];
  /** All original files from the package (for re-export manifest). */
  allFiles: {fileName: string; data: Uint8Array}[];
}): Promise<ProjectMetadata> {
  const id = generateId();
  const now = new Date().toISOString();
  const metadata: ProjectMetadata = {
    id,
    name: opts.name,
    artist: opts.artist,
    charter: opts.charter,
    createdAt: now,
    updatedAt: now,
    durationSeconds: opts.durationSeconds,
    sourceFormat: opts.sourceFormat,
    originalName: opts.originalName,
    sngMetadata: opts.sngMetadata,
  };

  const dir = await getProjectDir(id, {create: true});

  // Write metadata
  const metaHandle = await dir.getFileHandle(METADATA_FILE, {create: true});
  await writeFile(metaHandle, JSON.stringify(metadata));

  // Write chart text
  const chartHandle = await dir.getFileHandle('notes.chart', {create: true});
  await writeFile(chartHandle, opts.chartText);

  // Write audio files into audio/ subdirectory
  const audioDir = await dir.getDirectoryHandle(AUDIO_DIR, {create: true});
  for (const audio of opts.audioFiles) {
    const handle = await audioDir.getFileHandle(audio.fileName, {create: true});
    const writable = await handle.createWritable();
    await writable.write(audio.data as Uint8Array<ArrayBuffer>);
    await writable.close();
  }

  // Write all non-audio, non-chart files at the project root (e.g. album art, song.ini)
  const audioFileNames = new Set(
    opts.audioFiles.map(f => f.fileName.toLowerCase()),
  );
  const manifest: OriginalFileEntry[] = [];

  for (const file of opts.allFiles) {
    const lowerName = file.fileName.toLowerCase();
    if (lowerName === 'notes.chart' || lowerName === 'notes.mid') {
      // Chart file already stored as notes.chart
      manifest.push({fileName: file.fileName, storedIn: 'root'});
      continue;
    }
    if (audioFileNames.has(lowerName)) {
      manifest.push({fileName: file.fileName, storedIn: 'audio'});
      continue;
    }
    // Store non-audio files at the project root
    const handle = await dir.getFileHandle(file.fileName, {create: true});
    const writable = await handle.createWritable();
    await writable.write(file.data as Uint8Array<ArrayBuffer>);
    await writable.close();
    manifest.push({fileName: file.fileName, storedIn: 'root'});
  }

  // Write manifest
  const manifestHandle = await dir.getFileHandle(ORIGINAL_FILES_MANIFEST, {
    create: true,
  });
  await writeFile(manifestHandle, JSON.stringify(manifest));

  return metadata;
}

/**
 * Lists all drum-edit projects, sorted most recent first.
 */
export async function listProjects(): Promise<ProjectSummary[]> {
  try {
    const ns = await getNamespaceDir();
    const summaries: ProjectSummary[] = [];

    for await (const [name, handle] of ns.entries()) {
      if (handle.kind !== 'directory') continue;
      try {
        const metaHandle = await handle.getFileHandle(METADATA_FILE);
        const metadata = (await readJsonFile(metaHandle)) as ProjectMetadata;
        summaries.push({
          id: metadata.id,
          name: metadata.name,
          artist: metadata.artist,
          createdAt: metadata.createdAt,
          updatedAt: metadata.updatedAt,
        });
      } catch {
        console.warn(
          `drum-edit: Skipping directory "${name}" — missing or invalid metadata`,
        );
      }
    }

    summaries.sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );

    return summaries;
  } catch {
    // Namespace directory doesn't exist yet — no projects
    return [];
  }
}

/**
 * Reads full metadata for a project.
 */
export async function getProject(projectId: string): Promise<ProjectMetadata> {
  const dir = await getProjectDir(projectId);
  const metaHandle = await dir.getFileHandle(METADATA_FILE);
  return (await readJsonFile(metaHandle)) as ProjectMetadata;
}

/**
 * Deletes a project and all its files from OPFS.
 */
export async function deleteProject(projectId: string): Promise<void> {
  const ns = await getNamespaceDir();
  await ns.removeEntry(projectId, {recursive: true});
}

/**
 * Reads the chart text from a project. Prefers edited version, falls back to original.
 */
export async function readChartText(projectId: string): Promise<string> {
  const dir = await getProjectDir(projectId);
  try {
    const editedHandle = await dir.getFileHandle('notes.edited.chart');
    return readTextFile(editedHandle);
  } catch {
    const originalHandle = await dir.getFileHandle('notes.chart');
    return readTextFile(originalHandle);
  }
}

/**
 * Writes the edited chart text to OPFS.
 */
export async function writeEditedChart(
  projectId: string,
  chartText: string,
): Promise<void> {
  const dir = await getProjectDir(projectId);
  const handle = await dir.getFileHandle('notes.edited.chart', {create: true});
  await writeFile(handle, chartText);

  // Update the updatedAt timestamp
  const metaHandle = await dir.getFileHandle(METADATA_FILE);
  const metadata = (await readJsonFile(metaHandle)) as ProjectMetadata;
  metadata.updatedAt = new Date().toISOString();
  await writeFile(metaHandle, JSON.stringify(metadata));
}

/**
 * Loads all audio files from a project's audio/ subdirectory.
 * Returns them in the format AudioManager expects.
 */
export async function loadAudioFiles(
  projectId: string,
): Promise<{fileName: string; data: Uint8Array}[]> {
  const dir = await getProjectDir(projectId);
  const audioDir = await dir.getDirectoryHandle(AUDIO_DIR);
  const files: {fileName: string; data: Uint8Array}[] = [];

  for await (const [name, handle] of audioDir.entries()) {
    if (handle.kind !== 'file') continue;
    const file = await (handle as FileSystemFileHandle).getFile();
    files.push({
      fileName: name,
      data: new Uint8Array(await file.arrayBuffer()),
    });
  }

  return files;
}

/**
 * Loads all files needed for re-export: chart + audio + other assets.
 * Reads the edited chart (or original) and all files from the manifest.
 */
export async function loadFilesForExport(
  projectId: string,
): Promise<{fileName: string; data: Uint8Array}[]> {
  const dir = await getProjectDir(projectId);
  const files: {fileName: string; data: Uint8Array}[] = [];

  // Read chart (edited or original)
  const chartText = await readChartText(projectId);
  files.push({
    fileName: 'notes.chart',
    data: new TextEncoder().encode(chartText),
  });

  // Read manifest to know what other files exist
  try {
    const manifestHandle = await dir.getFileHandle(ORIGINAL_FILES_MANIFEST);
    const manifest = (await readJsonFile(
      manifestHandle,
    )) as OriginalFileEntry[];

    for (const entry of manifest) {
      const lowerName = entry.fileName.toLowerCase();
      // Skip chart files (already added above)
      if (lowerName === 'notes.chart' || lowerName === 'notes.mid') continue;

      try {
        if (entry.storedIn === 'audio') {
          const audioDir = await dir.getDirectoryHandle(AUDIO_DIR);
          const handle = await audioDir.getFileHandle(entry.fileName);
          const file = await handle.getFile();
          files.push({
            fileName: entry.fileName,
            data: new Uint8Array(await file.arrayBuffer()),
          });
        } else {
          const handle = await dir.getFileHandle(entry.fileName);
          const file = await handle.getFile();
          files.push({
            fileName: entry.fileName,
            data: new Uint8Array(await file.arrayBuffer()),
          });
        }
      } catch {
        console.warn(
          `drum-edit export: Could not read file "${entry.fileName}"`,
        );
      }
    }
  } catch {
    // No manifest — just return chart + audio files
    const audioFiles = await loadAudioFiles(projectId);
    files.push(...audioFiles);
  }

  return files;
}
