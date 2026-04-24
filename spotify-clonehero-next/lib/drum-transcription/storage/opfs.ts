/**
 * OPFS (Origin Private File System) storage for drum transcription projects.
 *
 * All data is namespaced under `drum-transcription/` within the OPFS root
 * to avoid collisions with other features. Each project gets its own
 * subdirectory named by a unique ID.
 *
 * Directory structure:
 *   drum-transcription/
 *     {projectId}/
 *       metadata.json    - Project metadata (name, creation date, etc.)
 *       audio/
 *         full.pcm       - Decoded audio (Float32 interleaved stereo, 44100Hz)
 *         meta.json      - Audio metadata (sample rate, channels, duration)
 *       stems/
 *         drums.pcm      - Separated drum stem
 *         bass.pcm       - Separated bass stem
 *         other.pcm      - Separated other stem
 *         vocals.pcm     - Separated vocals stem
 *       chart/
 *         notes.chart     - ML-generated chart
 *         notes.edited.chart - Human-edited chart
 */

import {writeFile, readJsonFile, readTextFile} from '@/lib/fileSystemHelpers';
import type {AudioMetadata} from '@/lib/drum-transcription/audio/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NAMESPACE = 'drum-transcription';
const METADATA_FILE = 'metadata.json';
const AUDIO_DIR = 'audio';
const AUDIO_PCM_FILE = 'full.pcm';
const AUDIO_META_FILE = 'meta.json';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProjectMetadata {
  id: string;
  name: string;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  /** Duration of the original audio in seconds, set after decode */
  durationSeconds: number | null;
  /** Processing stage the project is currently in */
  stage: ProjectStage;
}

export type ProjectStage =
  | 'uploaded'
  | 'separating'
  | 'transcribing'
  | 'editing'
  | 'exported';

export interface ProjectSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  stage: ProjectStage;
}

/** Metadata stored alongside the PCM audio in OPFS. */
export interface AudioStorageMeta {
  sampleRate: number;
  channels: number;
  /** Number of samples per channel. */
  samples: number;
  /** Duration in milliseconds. */
  durationMs: number;
  /** Original file metadata. */
  audioMetadata: AudioMetadata;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns the OPFS root directory handle. */
async function getOPFSRoot(): Promise<FileSystemDirectoryHandle> {
  return navigator.storage.getDirectory();
}

/** Returns (creating if needed) the `drum-transcription/` namespace directory. */
async function getNamespaceDir(): Promise<FileSystemDirectoryHandle> {
  const root = await getOPFSRoot();
  return root.getDirectoryHandle(NAMESPACE, {create: true});
}

/** Returns (creating if needed) a project's directory within the namespace. */
async function getProjectDir(
  projectId: string,
  options: {create: boolean} = {create: false},
): Promise<FileSystemDirectoryHandle> {
  const ns = await getNamespaceDir();
  return ns.getDirectoryHandle(projectId, {create: options.create});
}

function generateId(): string {
  // Timestamp prefix for rough ordering + random suffix for uniqueness
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `${timestamp}-${random}`;
}

// ---------------------------------------------------------------------------
// Project CRUD
// ---------------------------------------------------------------------------

/**
 * Creates a new project directory in OPFS and writes initial metadata.
 * Returns the metadata for the newly created project.
 */
export async function createProject(name: string): Promise<ProjectMetadata> {
  const id = generateId();
  const now = new Date().toISOString();
  const metadata: ProjectMetadata = {
    id,
    name,
    createdAt: now,
    updatedAt: now,
    durationSeconds: null,
    stage: 'uploaded',
  };

  const dir = await getProjectDir(id, {create: true});
  const metaHandle = await dir.getFileHandle(METADATA_FILE, {create: true});
  await writeFile(metaHandle, JSON.stringify(metadata));

  return metadata;
}

/**
 * Lists all projects in the namespace directory.
 * Returns summaries sorted by updatedAt descending (most recent first).
 */
export async function listProjects(): Promise<ProjectSummary[]> {
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
        createdAt: metadata.createdAt,
        updatedAt: metadata.updatedAt,
        stage: metadata.stage,
      });
    } catch {
      // Skip directories without valid metadata (orphaned/corrupt)
      console.warn(
        `Skipping directory "${name}" — missing or invalid metadata`,
      );
    }
  }

  // Sort most recent first
  summaries.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );

  return summaries;
}

/**
 * Reads the full metadata for a project.
 * Throws if the project or its metadata file does not exist.
 */
export async function getProject(projectId: string): Promise<ProjectMetadata> {
  const dir = await getProjectDir(projectId);
  const metaHandle = await dir.getFileHandle(METADATA_FILE);
  return (await readJsonFile(metaHandle)) as ProjectMetadata;
}

/**
 * Updates metadata fields on an existing project.
 * Automatically sets `updatedAt` to the current time.
 */
export async function updateProject(
  projectId: string,
  updates: Partial<Pick<ProjectMetadata, 'name' | 'durationSeconds' | 'stage'>>,
): Promise<ProjectMetadata> {
  const dir = await getProjectDir(projectId);
  const metaHandle = await dir.getFileHandle(METADATA_FILE);
  const existing = (await readJsonFile(metaHandle)) as ProjectMetadata;

  const updated: ProjectMetadata = {
    ...existing,
    ...updates,
    updatedAt: new Date().toISOString(),
  };

  await writeFile(metaHandle, JSON.stringify(updated));
  return updated;
}

/**
 * Deletes a project and all its files from OPFS.
 */
export async function deleteProject(projectId: string): Promise<void> {
  const ns = await getNamespaceDir();
  await ns.removeEntry(projectId, {recursive: true});
}

// ---------------------------------------------------------------------------
// File I/O within a project
// ---------------------------------------------------------------------------

/**
 * Writes binary data (e.g. PCM audio) to a file within a project directory.
 */
export async function writeProjectBinary(
  projectId: string,
  fileName: string,
  data: ArrayBuffer,
): Promise<void> {
  const dir = await getProjectDir(projectId);
  const fileHandle = await dir.getFileHandle(fileName, {create: true});
  const writable = await fileHandle.createWritable();
  await writable.write(data);
  await writable.close();
}

/**
 * Reads binary data from a file within a project directory.
 * Returns the raw ArrayBuffer.
 */
export async function readProjectBinary(
  projectId: string,
  fileName: string,
): Promise<ArrayBuffer> {
  const dir = await getProjectDir(projectId);
  const fileHandle = await dir.getFileHandle(fileName);
  const file = await fileHandle.getFile();
  return file.arrayBuffer();
}

/**
 * Writes a JSON-serializable object to a file within a project directory.
 */
export async function writeProjectJSON(
  projectId: string,
  fileName: string,
  data: unknown,
): Promise<void> {
  const dir = await getProjectDir(projectId);
  const fileHandle = await dir.getFileHandle(fileName, {create: true});
  await writeFile(fileHandle, JSON.stringify(data));
}

/**
 * Reads and parses a JSON file from a project directory.
 */
export async function readProjectJSON<T = unknown>(
  projectId: string,
  fileName: string,
): Promise<T> {
  const dir = await getProjectDir(projectId);
  const fileHandle = await dir.getFileHandle(fileName);
  return (await readJsonFile(fileHandle)) as T;
}

/**
 * Writes a text string to a file within a project directory.
 */
export async function writeProjectText(
  projectId: string,
  fileName: string,
  text: string,
): Promise<void> {
  const dir = await getProjectDir(projectId);
  const fileHandle = await dir.getFileHandle(fileName, {create: true});
  await writeFile(fileHandle, text);
}

/**
 * Reads a text file from a project directory.
 */
export async function readProjectText(
  projectId: string,
  fileName: string,
): Promise<string> {
  const dir = await getProjectDir(projectId);
  const fileHandle = await dir.getFileHandle(fileName);
  return readTextFile(fileHandle);
}

/**
 * Checks if a file exists within a project directory.
 */
export async function projectFileExists(
  projectId: string,
  fileName: string,
): Promise<boolean> {
  try {
    const dir = await getProjectDir(projectId);
    await dir.getFileHandle(fileName);
    return true;
  } catch {
    return false;
  }
}

/**
 * Lists all file names in a project directory.
 */
export async function listProjectFiles(projectId: string): Promise<string[]> {
  const dir = await getProjectDir(projectId);
  const files: string[] = [];
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === 'file') {
      files.push(name);
    }
  }
  return files;
}

// ---------------------------------------------------------------------------
// Audio Storage
// ---------------------------------------------------------------------------

/**
 * Returns (creating if needed) the `audio/` subdirectory within a project.
 */
async function getAudioDir(
  projectId: string,
  options: {create: boolean} = {create: false},
): Promise<FileSystemDirectoryHandle> {
  const projectDir = await getProjectDir(projectId, options);
  return projectDir.getDirectoryHandle(AUDIO_DIR, {create: options.create});
}

/**
 * Stores decoded audio as interleaved Float32 PCM and metadata in OPFS.
 *
 * Writes to:
 *   drum-transcription/{projectId}/audio/full.pcm
 *   drum-transcription/{projectId}/audio/meta.json
 *
 * Also updates the project metadata with the audio duration.
 *
 * @param projectId - The project ID returned by createProject()
 * @param interleavedPcm - Interleaved stereo Float32 PCM data (from interleaveAudioBuffer)
 * @param audioMeta - Metadata about the audio (from createAudioMetadata)
 * @param samplesPerChannel - Number of samples per channel
 */
export async function storeAudio(
  projectId: string,
  interleavedPcm: Float32Array,
  audioMeta: AudioMetadata,
  samplesPerChannel: number,
): Promise<void> {
  const audioDir = await getAudioDir(projectId, {create: true});

  // Write PCM data
  const pcmHandle = await audioDir.getFileHandle(AUDIO_PCM_FILE, {
    create: true,
  });
  const pcmWritable = await pcmHandle.createWritable();
  await pcmWritable.write(interleavedPcm.buffer as ArrayBuffer);
  await pcmWritable.close();

  // Write audio metadata
  const storageMeta: AudioStorageMeta = {
    sampleRate: 44100,
    channels: 2,
    samples: samplesPerChannel,
    durationMs: audioMeta.durationMs,
    audioMetadata: audioMeta,
  };

  const metaHandle = await audioDir.getFileHandle(AUDIO_META_FILE, {
    create: true,
  });
  await writeFile(metaHandle, JSON.stringify(storageMeta));

  // Update project metadata with duration
  await updateProject(projectId, {
    durationSeconds: audioMeta.durationMs / 1000,
  });
}

/**
 * Loads audio PCM data from OPFS for the Demucs pipeline.
 *
 * Returns interleaved stereo Float32 PCM data.
 * Demucs expects channels-first [2, N] format — the caller is responsible
 * for reshaping the interleaved [N*2] data.
 *
 * @throws {Error} If no audio has been stored for this project.
 */
export async function loadAudioForDemucs(
  projectId: string,
): Promise<Float32Array> {
  const audioDir = await getAudioDir(projectId);
  const pcmHandle = await audioDir.getFileHandle(AUDIO_PCM_FILE);
  const file = await pcmHandle.getFile();
  return new Float32Array(await file.arrayBuffer());
}

/**
 * Reads the stored audio metadata for a project.
 *
 * @throws {Error} If no audio metadata has been stored for this project.
 */
export async function loadAudioMeta(
  projectId: string,
): Promise<AudioStorageMeta> {
  const audioDir = await getAudioDir(projectId);
  const metaHandle = await audioDir.getFileHandle(AUDIO_META_FILE);
  return (await readJsonFile(metaHandle)) as AudioStorageMeta;
}

/**
 * Checks whether audio has been stored for a project.
 */
export async function hasStoredAudio(projectId: string): Promise<boolean> {
  try {
    const audioDir = await getAudioDir(projectId);
    await audioDir.getFileHandle(AUDIO_PCM_FILE);
    return true;
  } catch {
    return false;
  }
}
