/**
 * OPFS (Origin Private File System) storage for drum transcription projects.
 *
 * All data is namespaced under `drum-transcription/` within the OPFS root
 * to avoid collisions with other features. Each project gets its own
 * subdirectory named by a unique ID.
 *
 * Directory structure:
 *   drum-transcription/
 *     stem-cache/        - Separated stems keyed by input fingerprint, shared
 *       {fingerprint}/     across projects (see storage/stem-cache.ts).
 *         drums.pcm
 *         vocals.opus
 *     {projectId}/
 *       metadata.json    - Project metadata (name, creation date, etc.)
 *       audio/
 *         song.opus      - The audio at rest, Opus-encoded (current projects).
 *                            Uploads that are already .opus are stored
 *                            verbatim; everything else is transcoded on
 *                            upload. Decoded to PCM in memory on project open
 *                            (never written back out as PCM).
 *         full.pcm       - Decoded audio (Float32 interleaved stereo, 44100Hz)
 *                            — legacy projects only (predates song.opus).
 *         original.<ext> - The user's uploaded file, byte-for-byte — legacy
 *                            projects only.
 *         meta.json      - Audio metadata (sample rate, channels, duration)
 *       stems/
 *         drums.pcm      - Legacy per-project drum stem (projects created
 *                            before the fingerprint-keyed stem cache)
 *       chart/
 *         notes.chart     - ML-generated chart
 *         notes.edited.chart - Human-edited chart
 *       package-info.json - Set only for the "existing chart" flow (chart-flow
 *                            feature): sourceFormat/originalName/sngMetadata of
 *                            the package the user supplied, for re-export in
 *                            the same shape.
 *       assets/            - Set only for the "existing chart" flow: every
 *                            file from the original package other than the
 *                            chart/ini/primary-audio (album art, video,
 *                            secondary audio, etc.), stored verbatim so
 *                            export can round-trip them.
 *       assets-manifest.json - File names stored under assets/.
 */

import {writeFile, readJsonFile, readTextFile} from '@/lib/fileSystemHelpers';
import {
  decodeAudio,
  interleaveAudioBuffer,
} from '@/lib/drum-transcription/audio/decoder';
import type {AudioMetadata} from '@/lib/drum-transcription/audio/types';
import type {SourceFormat} from '@/components/chart-picker/chart-file-readers';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NAMESPACE = 'drum-transcription';
const METADATA_FILE = 'metadata.json';
const AUDIO_DIR = 'audio';
const AUDIO_PCM_FILE = 'full.pcm';
/** Opus-at-rest storage for current projects (see storeAudioOpus). */
const AUDIO_OPUS_FILE = 'song.opus';
const AUDIO_META_FILE = 'meta.json';
/** Basename of the untouched original upload; the extension is preserved.
 * Legacy projects only — current projects store `song.opus` instead. */
const ORIGINAL_AUDIO_BASENAME = 'original';
const PACKAGE_INFO_FILE = 'package-info.json';
const ASSETS_DIR = 'assets';
const ASSETS_MANIFEST_FILE = 'assets-manifest.json';

/** Lowercase file extension (without dot), or '' if none. */
function extensionOf(fileName: string): string {
  const lastDot = fileName.lastIndexOf('.');
  if (lastDot <= 0) return '';
  return fileName.slice(lastDot + 1).toLowerCase();
}

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
  /**
   * Fingerprint key of the project's entry in the shared stem cache —
   * SHA-256 over the uploaded audio bytes + separator identity (see
   * storage/stem-cache.ts). Computed lazily on first separation for
   * projects created before this field existed.
   */
  stemFingerprint?: string | undefined;
  /**
   * Which SyncTrack the chart's notes were placed against (chart-flow
   * feature). `'provided'` — the user supplied an existing chart and its own
   * tempo map was used (predicted tempo/beat detection was skipped
   * entirely). `'predicted'` — the ML-predicted tempo map was used (the
   * original audio-only flow). Undefined for projects created before this
   * field existed; treat as `'predicted'`.
   */
  gridSource?: GridSource | undefined;
  /**
   * Chart-time position of original (unpadded) audio sample 0 (0064 addendum
   * §1) — mirrors the in-memory `ChartDocument`'s `audioAnchor`
   * (`lib/chart-edit/leading-silence.ts`). Presence (non-null) means
   * leading-silence padding is active: the stored audio (`song.opus`) is
   * still the original, un-padded file, and the chart's notes were shifted
   * forward by `audioAnchor.ms`. `undefined`/`null` ⇒ no padding, current
   * behavior. Cleared (set to `null`) whenever the chart is rebuilt from
   * audio wholesale (`regenerateProject`), since a fresh chart has no anchor.
   */
  audioAnchor?: {tick: number; ms: number} | null | undefined;
}

export type GridSource = 'provided' | 'predicted';

/**
 * Set only when the project was created from an existing chart package
 * (chart-flow feature) — captures enough of the original package's identity
 * to re-export in the same shape (folder/.zip/.sng) with its original ini
 * fields and non-audio assets intact.
 */
export interface PackageInfo {
  sourceFormat: SourceFormat;
  originalName: string;
  sngMetadata?: Record<string, string> | undefined;
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
    // The shared stem cache lives alongside project directories but is not
    // a project (see storage/stem-cache.ts).
    if (name === 'stem-cache') continue;

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
  updates: Partial<
    Pick<
      ProjectMetadata,
      | 'name'
      | 'durationSeconds'
      | 'stage'
      | 'gridSource'
      | 'stemFingerprint'
      | 'audioAnchor'
    >
  >,
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
 * Writes binary data (e.g. PCM audio, or a chart file in either format) to a
 * file within a project directory. Accepts a typed array view too, so chart
 * bytes from `writeChartFolder` (`Uint8Array` for both `.chart` and `.mid`
 * output) can be written verbatim without an extra copy.
 */
export async function writeProjectBinary(
  projectId: string,
  fileName: string,
  data: ArrayBuffer | Uint8Array,
): Promise<void> {
  const dir = await getProjectDir(projectId);
  const fileHandle = await dir.getFileHandle(fileName, {create: true});
  const writable = await fileHandle.createWritable();
  // FileSystemWritableFileStream.write() types its BufferSource param as
  // ArrayBufferView<ArrayBuffer> specifically (excluding the
  // SharedArrayBuffer-backed case) — our data is always a plain-ArrayBuffer
  // view (TextEncoder/binary chart serializers never use SharedArrayBuffer).
  await writable.write(data as ArrayBuffer | Uint8Array<ArrayBuffer>);
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
 * Deletes a file within a project directory. A missing file is a no-op.
 */
export async function deleteProjectFile(
  projectId: string,
  fileName: string,
): Promise<void> {
  try {
    const dir = await getProjectDir(projectId);
    await dir.removeEntry(fileName);
  } catch {
    // Already absent (or the project dir doesn't exist) — nothing to delete.
  }
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
 * The two basenames `writeChartFolder` (scan-chart) can produce for a
 * project's chart, keyed by `ParsedChart.format`. A project's persisted
 * chart is ALWAYS exactly one of these — never both — since format is
 * fixed at chart-flow ingest (or 'chart' for freshly-predicted, audio-only
 * projects) and never converted.
 */
export const CHART_FILE_BASENAMES = {
  chart: 'notes.chart',
  mid: 'notes.mid',
} as const;

/**
 * Basename -> its "edited" (post-autosave) sibling, same extension —
 * `notes.chart` -> `notes.edited.chart`, `notes.mid` -> `notes.edited.mid`.
 * Exported so the editor's autosave path can derive the right sibling name
 * from whichever chart file `writeChartFolder` actually produced, instead
 * of hardcoding `.chart`.
 */
export function editedVariant(baseName: string): string {
  const dot = baseName.lastIndexOf('.');
  return `${baseName.slice(0, dot)}.edited${baseName.slice(dot)}`;
}

/**
 * Finds the project's persisted chart file — `notes.chart`/`notes.mid` (or
 * their `.edited.` siblings, preferred if present) — whichever format the
 * source chart used. Returns `null` if neither exists yet.
 *
 * Format-agnostic by construction: callers should never hardcode
 * `notes.chart` and assume it exists (a MIDI-sourced chart-flow project
 * only ever has `notes.mid`).
 */
export async function findProjectChartFile(
  projectId: string,
): Promise<string | null> {
  const candidates = [
    editedVariant(CHART_FILE_BASENAMES.chart),
    editedVariant(CHART_FILE_BASENAMES.mid),
    CHART_FILE_BASENAMES.chart,
    CHART_FILE_BASENAMES.mid,
  ];
  for (const name of candidates) {
    if (await projectFileExists(projectId, name)) return name;
  }
  return null;
}

/** Whether the project has a persisted chart file yet, in EITHER format. */
export async function hasProjectChartFile(projectId: string): Promise<boolean> {
  return (await findProjectChartFile(projectId)) !== null;
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
 * Writes `audio/meta.json` and updates the project's duration. Shared by
 * every audio storage format ({@link storeAudioOpus},
 * {@link storeAudioOriginal}) — the metadata shape doesn't depend on how the
 * audio bytes themselves are stored.
 */
async function writeAudioStorageMeta(
  projectId: string,
  audioDir: FileSystemDirectoryHandle,
  audioMeta: AudioMetadata,
  samplesPerChannel: number,
): Promise<void> {
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

  await updateProject(projectId, {
    durationSeconds: audioMeta.durationMs / 1000,
  });
}

/**
 * Stores audio as Opus at rest — the legacy storage format for projects
 * created before original-audio-at-rest. Writes only `audio/song.opus` and
 * `audio/meta.json` (no `full.pcm`, no `original.<ext>`); the project's
 * audio is decoded back to PCM in memory on open ({@link loadFullMixPcm})
 * rather than kept as a second copy on disk.
 *
 * Writes to:
 *   drum-transcription/{projectId}/audio/song.opus
 *   drum-transcription/{projectId}/audio/meta.json
 *
 * Also updates the project metadata with the audio duration.
 *
 * @param projectId - The project ID returned by createProject()
 * @param opusBytes - Encoded Opus file bytes (already-.opus uploads are
 *   stored verbatim; anything else is Opus-encoded by the caller first)
 * @param audioMeta - Metadata about the audio (from createAudioMetadata)
 * @param samplesPerChannel - Number of samples per channel in the decoded PCM
 */
export async function storeAudioOpus(
  projectId: string,
  opusBytes: Uint8Array,
  audioMeta: AudioMetadata,
  samplesPerChannel: number,
): Promise<void> {
  const audioDir = await getAudioDir(projectId, {create: true});

  const opusHandle = await audioDir.getFileHandle(AUDIO_OPUS_FILE, {
    create: true,
  });
  const opusWritable = await opusHandle.createWritable();
  await opusWritable.write(opusBytes as Uint8Array<ArrayBuffer>);
  await opusWritable.close();

  await writeAudioStorageMeta(
    projectId,
    audioDir,
    audioMeta,
    samplesPerChannel,
  );
}

/**
 * Stores the user's original uploaded audio file verbatim, plus
 * `audio/meta.json` — the current storage format. No Opus re-encode happens
 * at rest; conversion to Opus, if needed, happens only at export time. The
 * fingerprint used to key the shared stem cache is computed over these same
 * verbatim bytes.
 *
 * Writes to:
 *   drum-transcription/{projectId}/audio/original.<ext>
 *   drum-transcription/{projectId}/audio/meta.json
 *
 * Also updates the project metadata with the audio duration.
 *
 * @param projectId - The project ID returned by createProject()
 * @param originalBytes - The uploaded file's bytes, unmodified
 * @param audioMeta - Metadata about the audio (from createAudioMetadata)
 * @param samplesPerChannel - Number of samples per channel in the decoded PCM
 */
export async function storeAudioOriginal(
  projectId: string,
  originalBytes: ArrayBuffer,
  audioMeta: AudioMetadata,
  samplesPerChannel: number,
): Promise<void> {
  await storeOriginalAudio(
    projectId,
    originalBytes,
    audioMeta.originalFileName,
  );

  const audioDir = await getAudioDir(projectId, {create: true});
  await writeAudioStorageMeta(
    projectId,
    audioDir,
    audioMeta,
    samplesPerChannel,
  );
}

/**
 * Reads the raw stored Opus bytes for a project, or `null` if the project
 * predates Opus-at-rest storage (legacy `full.pcm`/`original.<ext>` project).
 */
export async function readSongOpus(
  projectId: string,
): Promise<ArrayBuffer | null> {
  try {
    const audioDir = await getAudioDir(projectId);
    const handle = await audioDir.getFileHandle(AUDIO_OPUS_FILE);
    const file = await handle.getFile();
    return await file.arrayBuffer();
  } catch {
    return null;
  }
}

/** Whether a project has been stored in the current Opus-at-rest format. */
export async function hasSongOpus(projectId: string): Promise<boolean> {
  try {
    const audioDir = await getAudioDir(projectId);
    await audioDir.getFileHandle(AUDIO_OPUS_FILE);
    return true;
  } catch {
    return false;
  }
}

/**
 * Stores the user's original uploaded audio file, byte-for-byte, so it can be
 * exported unmodified. The extension is taken from `originalFileName`.
 *
 * Called by {@link storeAudioOriginal}, which also writes `meta.json`; use
 * that instead unless only the raw file (no metadata) needs to be written.
 *
 * Writes to: drum-transcription/{projectId}/audio/original.<ext>
 */
export async function storeOriginalAudio(
  projectId: string,
  data: ArrayBuffer,
  originalFileName: string,
): Promise<void> {
  const audioDir = await getAudioDir(projectId, {create: true});
  const ext = extensionOf(originalFileName);
  const fileName = ext
    ? `${ORIGINAL_AUDIO_BASENAME}.${ext}`
    : ORIGINAL_AUDIO_BASENAME;
  const handle = await audioDir.getFileHandle(fileName, {create: true});
  const writable = await handle.createWritable();
  await writable.write(data);
  await writable.close();
}

/**
 * Reads the original uploaded audio file for a project.
 *
 * @returns The raw bytes and the extension (e.g. 'mp3'), or `null` if no
 *   original file was stored (e.g. projects created before this was added).
 */
export async function readOriginalAudio(
  projectId: string,
): Promise<{data: ArrayBuffer; extension: string} | null> {
  let extension = '';
  try {
    const meta = await loadAudioMeta(projectId);
    extension = extensionOf(meta.audioMetadata.originalFileName);
  } catch {
    // Fall through and try to locate the file by scanning below.
  }

  try {
    const audioDir = await getAudioDir(projectId);
    if (extension) {
      const handle = await audioDir.getFileHandle(
        `${ORIGINAL_AUDIO_BASENAME}.${extension}`,
      );
      const file = await handle.getFile();
      return {data: await file.arrayBuffer(), extension};
    }
    // Unknown extension: scan for any `original.*` entry.
    for await (const [name, handle] of audioDir.entries()) {
      if (
        handle.kind === 'file' &&
        name.startsWith(`${ORIGINAL_AUDIO_BASENAME}.`)
      ) {
        const file = await (handle as FileSystemFileHandle).getFile();
        return {data: await file.arrayBuffer(), extension: extensionOf(name)};
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Loads the project's full audio mix as interleaved stereo Float32 PCM
 * (44.1 kHz) — for the separation/tempo/transcription pipeline, and for the
 * editor's waveform + AudioManager source.
 *
 * Generation-aware, tried in order: legacy projects read the stored
 * `full.pcm` directly; opus-at-rest projects decode `song.opus` to PCM in
 * memory; current (original-at-rest) projects decode the stored
 * `original.<ext>` to PCM. Whichever source is used, the decoded PCM is
 * never written back to disk. Demucs expects channels-first [2, N] format —
 * the caller is responsible for reshaping the interleaved [N*2] data.
 *
 * @throws {Error} If no audio has been stored for this project.
 */
export async function loadFullMixPcm(projectId: string): Promise<Float32Array> {
  const audioDir = await getAudioDir(projectId);
  try {
    const pcmHandle = await audioDir.getFileHandle(AUDIO_PCM_FILE);
    const file = await pcmHandle.getFile();
    return new Float32Array(await file.arrayBuffer());
  } catch {
    // Not a legacy project — try the stored Opus next.
  }
  try {
    const opusHandle = await audioDir.getFileHandle(AUDIO_OPUS_FILE);
    const file = await opusHandle.getFile();
    const audioBuffer = await decodeAudio(await file.arrayBuffer());
    return interleaveAudioBuffer(audioBuffer);
  } catch {
    // Not an opus-at-rest project — fall back to the stored original.
  }
  const original = await readOriginalAudio(projectId);
  if (!original) {
    throw new Error(`No audio stored for project ${projectId}`);
  }
  const audioBuffer = await decodeAudio(original.data);
  return interleaveAudioBuffer(audioBuffer);
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
 * Checks whether audio has been stored for a project, in either the legacy
 * (`full.pcm`) or current (`song.opus`) format.
 */
export async function hasStoredAudio(projectId: string): Promise<boolean> {
  try {
    const audioDir = await getAudioDir(projectId);
    try {
      await audioDir.getFileHandle(AUDIO_PCM_FILE);
      return true;
    } catch {
      await audioDir.getFileHandle(AUDIO_OPUS_FILE);
      return true;
    }
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Existing-chart package info + passthrough assets (chart-flow feature)
// ---------------------------------------------------------------------------

/**
 * Persists which package (folder/.zip/.sng) and identity the project's chart
 * came from, when created via the "existing chart" flow. Absent for
 * audio-only projects.
 */
export async function writePackageInfo(
  projectId: string,
  info: PackageInfo,
): Promise<void> {
  await writeProjectJSON(projectId, PACKAGE_INFO_FILE, info);
}

/** Reads package info, or `null` for audio-only projects (no such file). */
export async function readPackageInfo(
  projectId: string,
): Promise<PackageInfo | null> {
  try {
    return await readProjectJSON<PackageInfo>(projectId, PACKAGE_INFO_FILE);
  } catch {
    return null;
  }
}

/** Returns (creating if needed) the `assets/` subdirectory within a project. */
async function getAssetsDir(
  projectId: string,
  options: {create: boolean} = {create: false},
): Promise<FileSystemDirectoryHandle> {
  const projectDir = await getProjectDir(projectId, options);
  return projectDir.getDirectoryHandle(ASSETS_DIR, {create: options.create});
}

/**
 * Stores passthrough files from an existing chart package verbatim (e.g.
 * album art, video, secondary audio) — everything besides the chart/ini
 * files and the single primary audio file used for transcription, which are
 * stored via their own dedicated paths. A no-op when `files` is empty.
 */
export async function writeProjectAssets(
  projectId: string,
  files: {fileName: string; data: Uint8Array}[],
): Promise<void> {
  if (files.length === 0) return;
  const assetsDir = await getAssetsDir(projectId, {create: true});
  for (const file of files) {
    const handle = await assetsDir.getFileHandle(file.fileName, {
      create: true,
    });
    const writable = await handle.createWritable();
    await writable.write(file.data as Uint8Array<ArrayBuffer>);
    await writable.close();
  }
  await writeProjectJSON(
    projectId,
    ASSETS_MANIFEST_FILE,
    files.map(f => f.fileName),
  );
}

/**
 * Reads back the passthrough asset files stored by {@link writeProjectAssets}.
 * Returns an empty array for audio-only projects (no manifest).
 */
export async function readProjectAssets(
  projectId: string,
): Promise<{fileName: string; data: Uint8Array}[]> {
  let manifest: string[];
  try {
    manifest = await readProjectJSON<string[]>(projectId, ASSETS_MANIFEST_FILE);
  } catch {
    return [];
  }

  const assetsDir = await getAssetsDir(projectId);
  const files: {fileName: string; data: Uint8Array}[] = [];
  for (const fileName of manifest) {
    try {
      const handle = await assetsDir.getFileHandle(fileName);
      const file = await handle.getFile();
      files.push({fileName, data: new Uint8Array(await file.arrayBuffer())});
    } catch {
      console.warn(
        `drum-transcription export: could not read asset "${fileName}"`,
      );
    }
  }
  return files;
}
