/**
 * The single module the app lists, resolves, renames, deletes and creates
 * projects through, across both on-disk layouts.
 *
 * It resolves an id by scanning the namespaces it knows, normalizes whichever
 * `metadata.json` it finds into a {@link ProjectRecord}, and dispatches
 * lifecycle writes back to the store that owns that layout. Nothing is copied
 * or moved between namespaces.
 *
 * It is deliberately not a proxy for per-field domain writes: `audioAnchor`,
 * `assistProvenance`, `stemFingerprint`, `stage` and `gridSource` are
 * layout-specific and their writers keep calling their own store directly.
 * This module is the authority on which projects exist and what they are.
 */

import {
  chartDocToFolderFiles,
  pickFolderFiles,
  readChart,
  readChartForEditing,
  writeChartFileAs,
  writeChartFolder,
  type ChartDocument,
} from '@/lib/chart-edit';
import {
  applySongIniMetadata,
  readSongIniMetadata,
  withSongIniFields,
  type SongMetadataValue,
} from '@/lib/chart-editor-core';
import * as drumTranscription from '@/lib/drum-transcription/storage/opfs';
import {editedVariant} from '@/lib/chart-files/chart-file-names';

import {
  createBlankChartDocument,
  DEFAULT_BLANK_SONG_LENGTH_MS,
} from './blankChart';
import {
  createOpfsProjectStore,
  type ProjectMetadata,
  type ProjectSummary,
} from './opfsProjectStore';
import type {ProjectRecord} from './types';

/** The namespace new chart-package projects are written to. */
export const CHART_EDITOR_NAMESPACE = 'chart-editor';

/**
 * Namespaces written by routes that have since been folded into
 * `/chart-editor`. Their projects stay listable and editable in place.
 */
export const CHART_EDITOR_LEGACY_NAMESPACES = [
  'drum-edit',
  'guitar-edit',
  'bass-edit',
] as const;

let store: ReturnType<typeof createOpfsProjectStore> | null = null;

/**
 * The chart-package store, with the legacy namespaces it adopts. Built on
 * first use rather than at import, so nothing constructs it before the
 * environment it reads from exists.
 */
export function chartPackageStore(): ReturnType<typeof createOpfsProjectStore> {
  store ??= createOpfsProjectStore(CHART_EDITOR_NAMESPACE, {
    legacyNamespaces: CHART_EDITOR_LEGACY_NAMESPACES,
  });
  return store;
}

/**
 * A drum-transcription project is openable in an editor only once its
 * pipeline has produced a chart. Before that, opening it resumes the
 * pipeline.
 */
function stageIsReady(stage: drumTranscription.ProjectStage): boolean {
  return stage === 'editing' || stage === 'exported';
}

function chartPackageRecord(
  summary: ProjectSummary | (ProjectMetadata & {namespace: string}),
): ProjectRecord {
  return {
    id: summary.id,
    namespace: summary.namespace,
    layout: 'chart-package',
    // A project written before `origin` existed lives in this layout because
    // the chart editor created it; that was the only way to get one.
    origin: summary.origin ?? 'chart-editor',
    name: summary.name,
    artist: summary.artist ?? '',
    charter: summary.charter ?? '',
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
    durationSeconds: summary.durationSeconds ?? null,
    // Absent means true: every project written before the field existed was
    // created from a package that had audio.
    hasAudio: summary.hasAudio ?? true,
    ready: true,
    pipelineStage: null,
  };
}

function drumTranscriptionRecord(
  summary: drumTranscription.ProjectSummary | drumTranscription.ProjectMetadata,
): ProjectRecord {
  return {
    id: summary.id,
    namespace: 'drum-transcription',
    layout: 'drum-transcription',
    origin: summary.origin ?? 'drum-transcription',
    name: summary.name,
    artist: summary.artist ?? '',
    charter: summary.charter ?? '',
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
    durationSeconds: summary.durationSeconds,
    // This layout's pipeline stores audio before it writes a chart, so a
    // project here always has some.
    hasAudio: true,
    ready: stageIsReady(summary.stage),
    pipelineStage: summary.stage,
  };
}

/**
 * Every project in every namespace, most recently updated first. An id that
 * somehow exists in both layouts resolves to the chart-package one, matching
 * the order {@link findProject} searches in.
 */
export async function listProjects(): Promise<ProjectRecord[]> {
  const [packageSummaries, transcriptionSummaries] = await Promise.all([
    chartPackageStore()
      .listProjects()
      .catch(err => {
        console.warn('Could not list chart-package projects:', err);
        return [] as ProjectSummary[];
      }),
    drumTranscription.listProjects().catch(err => {
      console.warn('Could not list drum-transcription projects:', err);
      return [] as drumTranscription.ProjectSummary[];
    }),
  ]);

  const records: ProjectRecord[] = [];
  const seen = new Set<string>();
  for (const summary of packageSummaries) {
    if (seen.has(summary.id)) continue;
    seen.add(summary.id);
    records.push(chartPackageRecord(summary));
  }
  for (const summary of transcriptionSummaries) {
    if (seen.has(summary.id)) continue;
    seen.add(summary.id);
    records.push(drumTranscriptionRecord(summary));
  }

  records.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
  return records;
}

/** The project `id` names, in whichever layout owns it, or null. */
export async function findProject(id: string): Promise<ProjectRecord | null> {
  try {
    // Both scan the same namespaces and both throw when the id is not in
    // any of them, so they run together rather than one after the other.
    const [meta, namespace] = await Promise.all([
      chartPackageStore().getProject(id),
      chartPackageStore().namespaceOf(id),
    ]);
    return chartPackageRecord({...meta, namespace});
  } catch {
    // Not a chart-package project; try the other layout.
  }
  try {
    return drumTranscriptionRecord(await drumTranscription.getProject(id));
  } catch {
    return null;
  }
}

export async function deleteProject(id: string): Promise<void> {
  const record = await findProject(id);
  if (!record) throw new Error(`Project "${id}" not found`);
  if (record.layout === 'chart-package') {
    await chartPackageStore().deleteProject(id);
  } else {
    await drumTranscription.deleteProject(id);
  }
}

/**
 * Renames a project: the record's identity fields AND the same fields inside
 * the project's own chart (and its `song.ini`, which wins over the chart on
 * load). Writing only the record would let the editor's next autosave mirror
 * the chart's stale name straight back over it.
 */
export async function renameProject(
  id: string,
  identity: SongMetadataValue,
): Promise<ProjectRecord> {
  const record = await findProject(id);
  if (!record) throw new Error(`Project "${id}" not found`);

  if (record.layout === 'chart-package') {
    await writeChartPackageIdentity(id, identity);
    await chartPackageStore().updateProject(id, identity);
  } else {
    await writeDrumTranscriptionIdentity(id, identity);
    await drumTranscription.updateProject(id, identity);
  }

  const updated = await findProject(id);
  if (!updated) throw new Error(`Project "${id}" not found`);
  return updated;
}

/** Applies `identity` to a `chart-package` project's chart file and ini. */
async function writeChartPackageIdentity(
  id: string,
  identity: SongMetadataValue,
): Promise<void> {
  const chartFile = await chartPackageStore().readChartFile(id);
  const songIni = await chartPackageStore().readSongIni(id);
  let doc = readChartForEditing([chartFile]);
  if (songIni) {
    doc = withSongIniFields(doc, {fileName: 'song.ini', data: songIni});
  }
  doc = applySongIniMetadata(doc, {
    ...readSongIniMetadata(doc, identity),
    ...identity,
  });
  await persistChartPackageDoc(id, doc);
}

/** Writes `doc` back as the project's edited chart plus its `song.ini`. */
async function persistChartPackageDoc(
  id: string,
  doc: ChartDocument,
): Promise<void> {
  const {chart, ini} = chartDocToFolderFiles(doc);
  await chartPackageStore().writeEditedChart(id, chart);
  await chartPackageStore().writeSongIni(id, ini.data);
}

/** Applies `identity` to a `drum-transcription` project's chart file. */
async function writeDrumTranscriptionIdentity(
  id: string,
  identity: SongMetadataValue,
): Promise<void> {
  const chartFileName = await drumTranscription.findProjectChartFile(id);
  if (!chartFileName) return;
  const bytes = new Uint8Array(
    await drumTranscription.readProjectBinary(id, chartFileName),
  );
  const doc = readChart([{fileName: chartFileName, data: bytes}], {
    pro_drums: true,
  });
  const updated = applySongIniMetadata(doc, {
    ...readSongIniMetadata(doc, identity),
    ...identity,
  });
  const written = writeChartFileAs(updated, updated.parsedChart.format);
  await drumTranscription.writeProjectBinary(
    id,
    editedVariant(written.fileName),
    written.data,
  );
}

export interface CreateBlankProjectOptions {
  name: string;
  artist?: string | undefined;
  charter?: string | undefined;
  songLengthMs?: number | undefined;
}

/**
 * A brand-new chart with no audio: a normal `chart-package` project whose
 * `audio/` directory is empty and whose `song.ini` carries the `song_length`
 * that stands in for an audio duration until a file is attached.
 */
export async function createBlankProject({
  name,
  artist = '',
  charter = '',
  songLengthMs = DEFAULT_BLANK_SONG_LENGTH_MS,
}: CreateBlankProjectOptions): Promise<ProjectRecord> {
  const doc = createBlankChartDocument({name, artist, charter, songLengthMs});
  const files = writeChartFolder(doc);
  const {chart} = pickFolderFiles(files);

  const meta = await chartPackageStore().createProject({
    name,
    artist,
    charter,
    durationSeconds: songLengthMs / 1000,
    sourceFormat: 'folder',
    originalName: name,
    chartFile: chart,
    audioFiles: [],
    allFiles: files,
    origin: 'chart-editor',
  });

  return chartPackageRecord({...meta, namespace: CHART_EDITOR_NAMESPACE});
}
