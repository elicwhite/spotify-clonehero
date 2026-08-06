/**
 * OPFS (Origin Private File System) storage for chart-edit projects. Each
 * caller gets an isolated store keyed by its own namespace so features never
 * collide in OPFS. A store may also declare read-only legacy namespaces it
 * adopts, so projects written by a route that has since been folded into
 * another one stay listable, loadable, saveable, and deletable in place.
 *
 * Directory structure (per namespace):
 *   {namespace}/
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
import type {AssistProvenance} from '@/lib/chart-editor-core/content-stamps';

const METADATA_FILE = 'metadata.json';
const AUDIO_DIR = 'audio';
const ORIGINAL_FILES_MANIFEST = 'original-files.json';

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
  sngMetadata?: Record<string, string> | undefined;
  /**
   * Chart-time position of the audio's true start when leading silence has
   * been added (plan 0064 addendum §1) — mirrors the in-memory
   * `ChartDocument`'s `audioAnchor`, which a `.chart` file has nowhere to
   * carry. A host re-attaches it on load and pads the audio it plays and
   * exports by `audioAnchor.ms`. Absent/null means no padding.
   */
  audioAnchor?: {tick: number; ms: number} | null | undefined;
  /**
   * The key this project's audio is cached under in the fingerprint-keyed
   * stem cache — a hash of the audio bytes plus the separator's identity.
   * Written once, the first time something separates this project's audio.
   * Present, a stem lookup is a direct cache read; absent, nothing has ever
   * been separated here, so there is nothing to look up and no reason to pay
   * for the hash (a multi-file package has to be mixed down to compute one).
   */
  stemFingerprint?: string | undefined;
  /**
   * Assist-generation provenance mirrored out of the in-memory
   * `ChartDocument`. A `.chart`/`.mid` file has nowhere to carry doc-level
   * metadata, so this is what makes a staleness prompt, a "Keep as-is"
   * dismissal, or a chosen `song.ini` drum intensity's provenance survive a
   * reload. Absent on projects saved before anything recorded provenance.
   */
  assistProvenance?: AssistProvenance | null | undefined;
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

async function getOPFSRoot(): Promise<FileSystemDirectoryHandle> {
  return navigator.storage.getDirectory();
}

function generateId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `${timestamp}-${random}`;
}

export interface OpfsProjectStoreOptions {
  /**
   * Namespaces this store adopts in addition to its own. New projects are
   * always written to `namespace`; a project found in a legacy namespace is
   * read and written where it already lives, so no bulk copy is needed.
   */
  legacyNamespaces?: readonly string[];
}

/**
 * Builds a set of project CRUD functions namespaced under `{namespace}/` in
 * OPFS. Each caller instantiates its own store so projects from different
 * editors never collide.
 */
export function createOpfsProjectStore(
  namespace: string,
  options: OpfsProjectStoreOptions = {},
) {
  const legacyNamespaces = options.legacyNamespaces ?? [];

  async function getNamespaceDir(): Promise<FileSystemDirectoryHandle> {
    const root = await getOPFSRoot();
    return root.getDirectoryHandle(namespace, {create: true});
  }

  /** Every namespace this store reads, primary first. Missing legacy
   *  directories are skipped rather than created. */
  async function getReadableNamespaceDirs(): Promise<
    {name: string; dir: FileSystemDirectoryHandle}[]
  > {
    const root = await getOPFSRoot();
    const dirs: {name: string; dir: FileSystemDirectoryHandle}[] = [
      {
        name: namespace,
        dir: await root.getDirectoryHandle(namespace, {
          create: true,
        }),
      },
    ];
    for (const legacy of legacyNamespaces) {
      try {
        dirs.push({
          name: legacy,
          dir: await root.getDirectoryHandle(legacy),
        });
      } catch {
        // Legacy namespace was never written on this origin.
      }
    }
    return dirs;
  }

  async function getProjectDir(
    projectId: string,
    options: {create: boolean} = {create: false},
  ): Promise<FileSystemDirectoryHandle> {
    if (options.create) {
      const ns = await getNamespaceDir();
      return ns.getDirectoryHandle(projectId, {create: true});
    }
    let firstError: unknown = null;
    for (const {dir} of await getReadableNamespaceDirs()) {
      try {
        return await openProjectDir(dir, projectId);
      } catch (err) {
        firstError ??= err;
      }
    }
    throw firstError ?? new Error(`Project "${projectId}" not found`);
  }

  /** Resolves `projectId` inside one namespace. Presence of `metadata.json`
   *  is what makes a directory a project, and it's what distinguishes the
   *  namespace that owns the project from the ones that merely could. */
  async function openProjectDir(
    ns: FileSystemDirectoryHandle,
    projectId: string,
  ): Promise<FileSystemDirectoryHandle> {
    const dir = await ns.getDirectoryHandle(projectId);
    await dir.getFileHandle(METADATA_FILE);
    return dir;
  }

  /**
   * Creates a new project in OPFS and stores all files from the loaded
   * chart package. Returns the project metadata.
   */
  async function createProject(opts: {
    name: string;
    artist: string;
    charter: string;
    durationSeconds: number;
    sourceFormat: SourceFormat;
    originalName: string;
    sngMetadata?: Record<string, string> | undefined;
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
      const handle = await audioDir.getFileHandle(audio.fileName, {
        create: true,
      });
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
   * Lists all projects this store reads (its own namespace plus any legacy
   * ones), sorted most recent first.
   */
  async function listProjects(): Promise<ProjectSummary[]> {
    try {
      const summaries: ProjectSummary[] = [];
      const seen = new Set<string>();

      for (const {name: nsName, dir: ns} of await getReadableNamespaceDirs()) {
        for await (const [name, handle] of ns.entries()) {
          if (handle.kind !== 'directory') continue;
          try {
            const metaHandle = await handle.getFileHandle(METADATA_FILE);
            const metadata = (await readJsonFile(
              metaHandle,
            )) as ProjectMetadata;
            // A legacy namespace that happens to reuse an id already listed
            // is shadowed by the primary namespace, matching which one
            // `getProjectDir` resolves.
            if (seen.has(metadata.id)) continue;
            seen.add(metadata.id);
            summaries.push({
              id: metadata.id,
              name: metadata.name,
              artist: metadata.artist,
              createdAt: metadata.createdAt,
              updatedAt: metadata.updatedAt,
            });
          } catch {
            console.warn(
              `${nsName}: Skipping directory "${name}" — missing or invalid metadata`,
            );
          }
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
  async function getProject(projectId: string): Promise<ProjectMetadata> {
    const dir = await getProjectDir(projectId);
    const metaHandle = await dir.getFileHandle(METADATA_FILE);
    return (await readJsonFile(metaHandle)) as ProjectMetadata;
  }

  /**
   * Patches a project's metadata, leaving every field the patch doesn't
   * name untouched, and returns the stored result. `id`, `createdAt` and
   * `updatedAt` are not patchable: identity is fixed, and `updatedAt` is
   * stamped here.
   */
  async function updateProject(
    projectId: string,
    patch: Partial<Omit<ProjectMetadata, 'id' | 'createdAt' | 'updatedAt'>>,
  ): Promise<ProjectMetadata> {
    const dir = await getProjectDir(projectId);
    const metaHandle = await dir.getFileHandle(METADATA_FILE);
    const metadata = (await readJsonFile(metaHandle)) as ProjectMetadata;
    const updated: ProjectMetadata = {
      ...metadata,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    await writeFile(metaHandle, JSON.stringify(updated));
    return updated;
  }

  /**
   * Deletes a project and all its files from OPFS.
   */
  async function deleteProject(projectId: string): Promise<void> {
    let firstError: unknown = null;
    for (const {dir} of await getReadableNamespaceDirs()) {
      try {
        await openProjectDir(dir, projectId);
      } catch {
        continue;
      }
      try {
        await dir.removeEntry(projectId, {recursive: true});
        return;
      } catch (err) {
        firstError ??= err;
      }
    }
    throw firstError ?? new Error(`Project "${projectId}" not found`);
  }

  /**
   * Reads the chart text from a project. Prefers edited version, falls back to original.
   */
  async function readChartText(projectId: string): Promise<string> {
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
   * Reads the project's `song.ini` bytes, or `null` when the imported package
   * carried none.
   *
   * The editable chart is stored as `.chart` text, which has nowhere to carry
   * most of `song.ini` (the per-instrument `diff_*` fields, `icon`,
   * `loading_phrase`, custom keys), so a host that wants the chart's real
   * metadata reads this alongside the chart text. The file is stored under
   * whatever name the package used, so the match is case-insensitive.
   */
  async function readSongIni(projectId: string): Promise<Uint8Array | null> {
    const dir = await getProjectDir(projectId);
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind !== 'file') continue;
      if (name.toLowerCase() !== 'song.ini') continue;
      const file = await (handle as FileSystemFileHandle).getFile();
      return new Uint8Array(await file.arrayBuffer());
    }
    return null;
  }

  /**
   * Writes the project's `song.ini`, reusing whatever casing the stored file
   * already uses so a package that shipped `Song.ini` keeps one ini rather
   * than gaining a second.
   */
  async function writeSongIni(
    projectId: string,
    data: Uint8Array,
  ): Promise<void> {
    const dir = await getProjectDir(projectId);
    let fileName = 'song.ini';
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind !== 'file') continue;
      if (name.toLowerCase() !== 'song.ini') continue;
      fileName = name;
      break;
    }
    const handle = await dir.getFileHandle(fileName, {create: true});
    await writeFile(handle, data);
  }

  /**
   * Adds audio files to a project's `audio/` directory, overwriting any file
   * of the same name. This is how a project created with no audio is given
   * some; the caller is responsible for flipping `hasAudio` afterwards.
   */
  async function writeAudioFiles(
    projectId: string,
    files: ReadonlyArray<{fileName: string; data: Uint8Array}>,
  ): Promise<void> {
    const dir = await getProjectDir(projectId);
    const audioDir = await dir.getDirectoryHandle(AUDIO_DIR, {create: true});
    for (const file of files) {
      const handle = await audioDir.getFileHandle(file.fileName, {
        create: true,
      });
      await writeFile(handle, file.data);
    }
  }

  /**
   * Writes the edited chart text to OPFS.
   */
  async function writeEditedChart(
    projectId: string,
    chartText: string,
  ): Promise<void> {
    const dir = await getProjectDir(projectId);
    const handle = await dir.getFileHandle('notes.edited.chart', {
      create: true,
    });
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
  async function loadAudioFiles(
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
  async function loadFilesForExport(
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
            `${namespace} export: Could not read file "${entry.fileName}"`,
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

  return {
    createProject,
    listProjects,
    getProject,
    updateProject,
    deleteProject,
    readChartText,
    readSongIni,
    writeSongIni,
    writeEditedChart,
    loadAudioFiles,
    loadFilesForExport,
  };
}

export type OpfsProjectStore = ReturnType<typeof createOpfsProjectStore>;
