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
 *       metadata.json         - Project metadata
 *       notes.{chart|mid}     - The chart as loaded, in its own format
 *       notes.edited.{chart|mid} - The chart as edited, same format
 *       audio/
 *         {stem}.{ext}        - Original audio files from the loaded package
 *       original-files.json   - Manifest of original files for re-export
 */

import {writeFile, readJsonFile} from '@/lib/fileSystemHelpers';
import {isAlbumArtFileName} from '@/lib/album-art';
import type {SourceFormat} from '@/lib/chart-files/chart-package';
import {
  CHART_FILE_BASENAMES,
  chartFileFormatOf,
  editedVariant,
  isCanonicalChartFileName,
  type ChartFileFormat,
} from '@/lib/chart-files/chart-file-names';
import type {AssistProvenance} from '@/lib/chart-editor-core/content-stamps';
import type {ProjectOrigin} from './types';

const METADATA_FILE = 'metadata.json';

/** A project written before the store recorded a format holds a `.chart`. */
function formatOfMetadata(metadata: ProjectMetadata): ChartFileFormat {
  return metadata.chartFileFormat ?? 'chart';
}
const AUDIO_DIR = 'audio';
const ORIGINAL_FILES_MANIFEST = 'original-files.json';

export interface ProjectMetadata {
  id: string;
  name: string;
  artist: string;
  charter: string;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  /** Length of the project's audio. Null until something has decoded it —
   *  an import doesn't, because the editor it hands off to is about to. */
  durationSeconds: number | null;
  sourceFormat: SourceFormat;
  originalName: string;
  sngMetadata?: Record<string, string> | undefined;
  /**
   * Which format the project's chart file is stored in. The chart belongs to
   * the user, so the store keeps the format it arrived in rather than
   * converting: a `.chart` file carries vocals as bare lyric text events, so
   * converting a `.mid` chart would drop vocal note pitches, phrase lengths
   * and harmony parts.
   *
   * Absent on a project that predates the field. Those projects are all
   * `.chart`.
   */
  chartFileFormat?: ChartFileFormat | undefined;
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
  /**
   * Which entrypoint created this project. Absent on projects written before
   * the field existed; a reader treats that as `'chart-editor'`, which is
   * what every project in this layout was until now.
   */
  origin?: ProjectOrigin | undefined;
  /**
   * Whether the project's `audio/` directory holds anything. False only for a
   * chart created with no audio that has not been given any yet. Absent means
   * true: every project written before the field existed was created from a
   * package that had audio.
   */
  hasAudio?: boolean | undefined;
}

export interface ProjectSummary {
  id: string;
  name: string;
  artist: string;
  charter: string;
  createdAt: string;
  updatedAt: string;
  durationSeconds: number | null;
  /** The namespace whose directory this project was found in. */
  namespace: string;
  origin?: ProjectOrigin | undefined;
  hasAudio?: boolean | undefined;
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
    /** Omitted by a caller that hasn't decoded the audio; whoever does
     *  decodes it writes the real figure back. */
    durationSeconds?: number | undefined;
    sourceFormat: SourceFormat;
    originalName: string;
    sngMetadata?: Record<string, string> | undefined;
    /** The chart file `writeChartFolder` produced — `notes.chart` or
     *  `notes.mid`. Stored under that name, in that format. */
    chartFile: {fileName: string; data: Uint8Array};
    /** Audio files to store (fileName + raw bytes). */
    audioFiles: {fileName: string; data: Uint8Array}[];
    /** All original files from the package (for re-export manifest). */
    allFiles: {fileName: string; data: Uint8Array}[];
    /** Which entrypoint is creating this project. Defaults to the editor's own. */
    origin?: ProjectOrigin | undefined;
    /** Existing separated-stem cache entry to attach to the new project. */
    stemFingerprint?: string | undefined;
  }): Promise<ProjectMetadata> {
    const id = generateId();
    const now = new Date().toISOString();
    const chartFileFormat = chartFileFormatOf(opts.chartFile.fileName);
    if (!chartFileFormat) {
      throw new Error(
        `"${opts.chartFile.fileName}" is not a chart file; expected .chart or .mid`,
      );
    }
    const metadata: ProjectMetadata = {
      id,
      name: opts.name,
      artist: opts.artist,
      charter: opts.charter,
      createdAt: now,
      updatedAt: now,
      durationSeconds: opts.durationSeconds ?? null,
      sourceFormat: opts.sourceFormat,
      originalName: opts.originalName,
      sngMetadata: opts.sngMetadata,
      chartFileFormat,
      origin: opts.origin ?? 'chart-editor',
      hasAudio: opts.audioFiles.length > 0,
      stemFingerprint: opts.stemFingerprint,
    };

    const dir = await getProjectDir(id, {create: true});

    // Write metadata
    const metaHandle = await dir.getFileHandle(METADATA_FILE, {create: true});
    await writeFile(metaHandle, JSON.stringify(metadata));

    // Write the chart file under the canonical name for its format
    const chartHandle = await dir.getFileHandle(
      CHART_FILE_BASENAMES[chartFileFormat],
      {create: true},
    );
    await writeFile(chartHandle, opts.chartFile.data);

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
      if (isCanonicalChartFileName(lowerName)) {
        // Written above, under the canonical name for its format.
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
              charter: metadata.charter,
              createdAt: metadata.createdAt,
              updatedAt: metadata.updatedAt,
              durationSeconds: metadata.durationSeconds,
              namespace: nsName,
              origin: metadata.origin,
              hasAudio: metadata.hasAudio,
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
   * The namespace whose directory actually holds `projectId` — this store's
   * own, or one of the legacy ones it adopts. Throws when no namespace has
   * it, the same as every other read here.
   */
  async function namespaceOf(projectId: string): Promise<string> {
    for (const {name, dir} of await getReadableNamespaceDirs()) {
      try {
        await openProjectDir(dir, projectId);
        return name;
      } catch {
        // Not in this namespace.
      }
    }
    throw new Error(`Project "${projectId}" not found`);
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

  async function readMetadata(
    dir: FileSystemDirectoryHandle,
  ): Promise<ProjectMetadata> {
    return (await readJsonFile(
      await dir.getFileHandle(METADATA_FILE),
    )) as ProjectMetadata;
  }

  /**
   * Reads a project's chart file, in whatever format it is stored in.
   * Prefers the edited (autosaved) sibling, falls back to the original.
   *
   * Returns the bytes and the name they are stored under, so a caller can
   * parse the chart without knowing its format. Never assume `notes.chart`
   * exists — a MIDI-sourced project only ever has `notes.mid`.
   */
  async function readChartFile(
    projectId: string,
  ): Promise<{fileName: string; data: Uint8Array}> {
    const dir = await getProjectDir(projectId);
    const format = formatOfMetadata(await readMetadata(dir));
    // The recorded format first, then the other one. `createProject` writes
    // metadata before the chart bytes, so a torn create can leave a project
    // whose metadata names a file that is not there; the second candidate
    // pair finds the chart instead of failing the open.
    const other: ChartFileFormat = format === 'chart' ? 'mid' : 'chart';
    for (const base of [
      CHART_FILE_BASENAMES[format],
      CHART_FILE_BASENAMES[other],
    ]) {
      for (const fileName of [editedVariant(base), base]) {
        try {
          const handle = await dir.getFileHandle(fileName);
          const file = await handle.getFile();
          return {fileName, data: new Uint8Array(await file.arrayBuffer())};
        } catch {
          continue;
        }
      }
    }
    throw new Error(`Project "${projectId}" has no chart file`);
  }

  /**
   * The format a project's chart is stored in. A project written before the
   * store recorded a format is `.chart`.
   */
  async function chartFormatOf(projectId: string): Promise<ChartFileFormat> {
    return formatOfMetadata(await getProject(projectId));
  }

  /**
   * Reads the project's `song.ini` bytes, or `null` when the imported package
   * carried none.
   *
   * Neither chart format can carry most of `song.ini` (the per-instrument
   * `diff_*` fields, `icon`, `loading_phrase`, custom keys), so a host that
   * wants the chart's real metadata reads this alongside the chart file. The file is stored under
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
   * Writes the edited chart to OPFS, beside the original and in the same
   * format.
   *
   * Takes the named file `writeChartFolder` produced, not bare bytes: the
   * caller knows what it serialized, and a `.chart` body written into
   * `notes.edited.mid` would fail to parse on the next open. A file whose
   * format is not the project's is a caller bug, so it throws.
   */
  async function writeEditedChart(
    projectId: string,
    chartFile: {fileName: string; data: Uint8Array},
  ): Promise<void> {
    const dir = await getProjectDir(projectId);
    const metaHandle = await dir.getFileHandle(METADATA_FILE);
    const metadata = (await readJsonFile(metaHandle)) as ProjectMetadata;
    const format = formatOfMetadata(metadata);
    const written = chartFileFormatOf(chartFile.fileName);
    if (written !== format) {
      throw new Error(
        `Project "${projectId}" stores a .${format} chart, but "${chartFile.fileName}" is not one`,
      );
    }
    const handle = await dir.getFileHandle(
      editedVariant(CHART_FILE_BASENAMES[format]),
      {create: true},
    );
    await writeFile(handle, chartFile.data);

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
   * The package files that are neither the chart nor audio — album art,
   * video, background images, anything else that shipped with the folder.
   *
   * These are export passthroughs: the chart is re-serialized from the live
   * document and `song.ini` is rebuilt from the metadata form, so both are
   * excluded here rather than round-tripped stale. Audio has its own path
   * (`loadAudioFiles`).
   */
  async function loadPassthroughAssets(
    projectId: string,
  ): Promise<{fileName: string; data: Uint8Array}[]> {
    const dir = await getProjectDir(projectId);
    const files: {fileName: string; data: Uint8Array}[] = [];
    for (const entry of await readManifest(dir)) {
      if (entry.storedIn !== 'root') continue;
      const lower = entry.fileName.toLowerCase();
      if (isCanonicalChartFileName(lower)) continue;
      if (lower === 'song.ini') continue;
      try {
        const handle = await dir.getFileHandle(entry.fileName);
        const file = await handle.getFile();
        files.push({
          fileName: entry.fileName,
          data: new Uint8Array(await file.arrayBuffer()),
        });
      } catch {
        console.warn(
          `${namespace} export: could not read asset "${entry.fileName}"`,
        );
      }
    }
    return files;
  }

  /** The project's original-files manifest, or `[]` when it has none. */
  async function readManifest(
    dir: FileSystemDirectoryHandle,
  ): Promise<OriginalFileEntry[]> {
    try {
      const handle = await dir.getFileHandle(ORIGINAL_FILES_MANIFEST);
      return (await readJsonFile(handle)) as OriginalFileEntry[];
    } catch {
      return [];
    }
  }

  /**
   * The project's album art, or null when it ships none.
   *
   * Read through the manifest rather than by probing for `album.jpg`: the
   * manifest is what the export path walks, so a cover it doesn't list
   * wouldn't reach the package anyway.
   */
  async function readAlbumArt(
    projectId: string,
  ): Promise<{fileName: string; data: Uint8Array} | null> {
    const dir = await getProjectDir(projectId);
    const entry = (await readManifest(dir)).find(e =>
      isAlbumArtFileName(e.fileName),
    );
    if (!entry) return null;
    try {
      const handle = await dir.getFileHandle(entry.fileName);
      const file = await handle.getFile();
      return {
        fileName: entry.fileName,
        data: new Uint8Array(await file.arrayBuffer()),
      };
    } catch {
      return null;
    }
  }

  /**
   * Replace the project's album art, or remove it when `art` is null.
   *
   * Every file name scan-chart reads as album art is dropped first, so a
   * project that already carried `album.png` can't end up exporting two
   * covers (`multipleAlbumArt`).
   */
  async function writeAlbumArt(
    projectId: string,
    art: {fileName: string; data: Uint8Array} | null,
  ): Promise<void> {
    const dir = await getProjectDir(projectId);
    const manifest = await readManifest(dir);

    for (const entry of manifest) {
      if (!isAlbumArtFileName(entry.fileName)) continue;
      try {
        await dir.removeEntry(entry.fileName);
      } catch {
        // Listed but already gone; dropping it from the manifest is enough.
      }
    }
    const next = manifest.filter(e => !isAlbumArtFileName(e.fileName));

    if (art) {
      const handle = await dir.getFileHandle(art.fileName, {create: true});
      await writeFile(handle, art.data);
      next.push({fileName: art.fileName, storedIn: 'root'});
    }

    const manifestHandle = await dir.getFileHandle(ORIGINAL_FILES_MANIFEST, {
      create: true,
    });
    await writeFile(manifestHandle, JSON.stringify(next));
  }

  return {
    createProject,
    listProjects,
    namespaceOf,
    getProject,
    updateProject,
    deleteProject,
    readChartFile,
    chartFormatOf,
    readSongIni,
    writeSongIni,
    writeAudioFiles,
    writeEditedChart,
    loadAudioFiles,
    loadPassthroughAssets,
    readAlbumArt,
    writeAlbumArt,
  };
}

export type OpfsProjectStore = ReturnType<typeof createOpfsProjectStore>;
