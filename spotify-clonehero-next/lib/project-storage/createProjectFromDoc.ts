/**
 * The one way a tool page turns a finished chart document into a project the
 * chart editor can open.
 *
 * A tool page runs its task, then hands the result over: `/tempo`,
 * `/add-lyrics` and the difficulty pages all end here, and then push
 * `/chart-editor?project=<id>`. Doing it in one place keeps three things
 * consistent that were previously per-page: the chart file keeps its own
 * format, the whole `writeChartFolder` output becomes the re-export
 * manifest, and the stem fingerprint is the one `/chart-editor` derives.
 *
 * It does not navigate. The push stays at the call site, where the page's
 * own error handling and cancel path already live.
 */

import {chartDocToFolderFiles, writeChartFolder} from '@/lib/chart-edit';
import type {ChartDocument} from '@/lib/chart-edit';
import {
  documentIdentityFields,
  getAssistProvenance,
} from '@/lib/chart-editor-core';
import {getAudioAnchor} from '@/lib/chart-edit';
import type {SourceFormat} from '@/lib/chart-files/chart-package';

import {chartPackageStore} from './projects';
import type {ProjectOrigin} from './types';

export interface CreateProjectFromDocOptions {
  /** The finished document. Its own format decides the stored chart's. */
  chartDoc: ChartDocument;
  /** The package's audio, verbatim. Empty for a chart with none. */
  audioFiles: {fileName: string; data: Uint8Array}[];
  /** Which tool page is creating this. */
  origin: ProjectOrigin;
  /** The package shape the chart arrived in. Defaults to a plain folder. */
  sourceFormat?: SourceFormat | undefined;
  /** The name the user's upload had, for an export that round-trips it. */
  originalName?: string | undefined;
  /** `.sng` metadata to carry through, when the source was one. */
  sngMetadata?: Record<string, string> | undefined;
  /** Nominal chart length. Omitted, whoever decodes the audio writes it. */
  durationSeconds?: number | undefined;
  /**
   * The key this chart's separated stems are already cached under. Pass it
   * whenever the page has run a task that separated stems, so the editor
   * reuses them instead of separating the same audio again.
   */
  stemFingerprint?: string | undefined;
}

/** Creates the project and returns its id. Does not navigate. */
export async function createProjectFromDoc(
  opts: CreateProjectFromDocOptions,
): Promise<string> {
  const {chartDoc, audioFiles, origin} = opts;

  // One serialization: `allFiles` is the re-export manifest, so it has to be
  // the whole output — album art, video and background art included, not the
  // chart and ini alone.
  const allFiles = writeChartFolder(chartDoc);
  const {chart} = chartDocToFolderFiles(chartDoc);
  const identity = documentIdentityFields(chartDoc);

  const meta = await chartPackageStore().createProject({
    name: identity.name || opts.originalName || 'Untitled',
    artist: identity.artist ?? '',
    charter: identity.charter ?? '',
    sourceFormat: opts.sourceFormat ?? 'folder',
    originalName: opts.originalName ?? identity.name ?? 'Untitled',
    sngMetadata: opts.sngMetadata,
    chartFile: chart,
    audioFiles,
    allFiles,
    origin,
    durationSeconds: opts.durationSeconds,
    stemFingerprint: opts.stemFingerprint,
    audioAnchor: getAudioAnchor(chartDoc),
    assistProvenance: getAssistProvenance(chartDoc),
  });

  return meta.id;
}
