'use client';

import dynamic from 'next/dynamic';
import {useEffect, useState} from 'react';

import type {ChartDocument} from '@/lib/chart-edit';
import type {AssistTaskKey} from '@/lib/assist/tasks/types';
import type {ChartFileFormat} from '@/lib/chart-files/chart-file-names';
import {DRUM_TRANSCRIPTION_NAMESPACE} from '@/lib/project-storage/namespaces';
import type {ChartOrigin} from '@/lib/project-storage/types';
import type {StoredProject} from '@/lib/project-storage/storedProjects';

/**
 * The editor's export dialog, loaded only when a chart is chosen.
 *
 * It brings the chart parser, the .sng writer and the packager with it, and
 * this is the page someone opens because their device is out of room. Nobody
 * pays for that until they ask for a copy of something.
 */
const ExportDialog = dynamic(
  () => import('@/components/chart-editor/ExportDialog'),
  {ssr: false},
);

interface ExportInputs {
  songName: string;
  artistName: string;
  charterName: string;
  origin: ChartOrigin;
  toolsApplied: readonly AssistTaskKey[];
  /** The format the stored chart is in, so the export does not convert it. */
  sourceChartFormat: ChartFileFormat;
  /**
   * The whole chart, assembled from the stored chart file and `song.ini`.
   *
   * The dialog prefers this over the file callbacks, and it has to: a chart
   * file alone carries no `song.ini` surface, so album, year, genre and the
   * per-instrument intensities would be dropped from a copy taken here. This
   * page's whole argument is "take a copy before you delete", so the copy has
   * to be the whole thing.
   */
  chartDoc: ChartDocument;
  getAudioSources: () => Promise<{fileName: string; data: ArrayBuffer}[]>;
  getExtraAssets: () => Promise<{fileName: string; data: Uint8Array}[]>;
}

/** Rebuilds a project's document the way the chart-package store does. */
async function documentOf(
  chartFile: {fileName: string; data: Uint8Array},
  songIni: Uint8Array | null,
): Promise<ChartDocument> {
  const [{readChartForEditing}, {withSongIniFields}] = await Promise.all([
    import('@/lib/chart-edit'),
    import('@/lib/chart-editor-core'),
  ]);
  const doc = readChartForEditing([chartFile]);
  return songIni
    ? withSongIniFields(doc, {fileName: 'song.ini', data: songIni})
    : doc;
}

/** A chart-package project: the `/chart-editor` layout and its legacy names. */
async function loadChartPackage(project: StoredProject): Promise<ExportInputs> {
  const {chartPackageStore} = await import('@/lib/project-storage/projects');
  const store = chartPackageStore();
  const [metadata, chartFile, songIni] = await Promise.all([
    store.getProject(project.id),
    store.readChartFile(project.id),
    store.readSongIni(project.id),
  ]);

  return {
    songName: metadata.name,
    artistName: metadata.artist,
    charterName: metadata.charter,
    origin: metadata.origin ?? 'chart-editor',
    toolsApplied: metadata.toolsApplied ?? [],
    // Without this the dialog defaults to .mid, and converting a .chart drops
    // vocal note pitches, phrase lengths and harmony parts. A project from
    // before the field existed is a .chart.
    sourceChartFormat: metadata.chartFileFormat ?? 'chart',
    chartDoc: await documentOf(chartFile, songIni),
    getAudioSources: async () =>
      (await store.loadAudioFiles(project.id)).map(file => ({
        fileName: file.fileName,
        // The store already returns an exactly-sized buffer per file, so this
        // hands the same bytes on rather than copying the audio again.
        data: file.data.buffer as ArrayBuffer,
      })),
    getExtraAssets: () => store.loadPassthroughAssets(project.id),
  };
}

/** A `/drum-transcription` project, which has its own layout on disk. */
async function loadTranscription(
  project: StoredProject,
): Promise<ExportInputs> {
  const opfs = await import('@/lib/drum-transcription/storage/opfs');
  const metadata = await opfs.getProject(project.id);
  const chartName = await opfs.findProjectChartFile(project.id);
  if (chartName == null) {
    throw new Error('this project has no chart yet');
  }
  const chartData = new Uint8Array(
    await opfs.readProjectBinary(project.id, chartName),
  );
  const songIni = await opfs
    .readProjectBinary(project.id, 'song.ini')
    .then(buffer => new Uint8Array(buffer))
    .catch(() => null);
  const audio = await opfs.readSongOpus(project.id);

  return {
    songName: metadata.name,
    artistName: metadata.artist ?? '',
    charterName: metadata.charter ?? '',
    origin: metadata.origin ?? DRUM_TRANSCRIPTION_NAMESPACE,
    toolsApplied: metadata.toolsApplied ?? [],
    sourceChartFormat: chartName.endsWith('.mid') ? 'mid' : 'chart',
    chartDoc: await documentOf({fileName: chartName, data: chartData}, songIni),
    getAudioSources: async () =>
      audio == null ? [] : [{fileName: 'song.opus', data: audio}],
    getExtraAssets: async () => [],
  };
}

function loadExportInputs(project: StoredProject): Promise<ExportInputs> {
  // Two layouts, two stores. The namespace a project was found in is what
  // says which one can read it, and reading a transcription project through
  // the chart-package store answers "not found" rather than failing usefully.
  return project.namespace === DRUM_TRANSCRIPTION_NAMESPACE
    ? loadTranscription(project)
    : loadChartPackage(project);
}

/**
 * Exports one chart from the storage page.
 *
 * The same dialog the editor uses, so a copy taken from here is the same
 * package as a copy taken from there — one export path, not two that can
 * drift. The chart check is off: this page's job is to get the file onto the
 * user's disk before they delete the chart, and a list of problems they
 * cannot act on from here is one more thing in the way.
 */
export function ChartExportDialog({
  project,
  onClose,
  onFailed,
  onReady,
}: {
  project: StoredProject;
  onClose: () => void;
  /** Told why, so the page can say so rather than appearing to do nothing. */
  onFailed: (reason: string) => void;
  /**
   * Fired once the dialog can be shown. The chunk this loads carries the
   * chart parser and the packager, so on a cold click there are seconds
   * between the button and the dialog, and the button has to say so.
   */
  onReady: () => void;
}) {
  const [inputs, setInputs] = useState<ExportInputs | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadExportInputs(project).then(
      loaded => {
        if (cancelled) return;
        setInputs(loaded);
        onReady();
      },
      (error: unknown) => {
        if (cancelled) return;
        // A dialog that never fills in looks like a button that did nothing.
        console.warn('Could not read the chart for export:', error);
        onFailed(
          error instanceof Error
            ? `Could not open ${project.name}: ${error.message}`
            : `Could not open ${project.name}.`,
        );
      },
    );
    return () => {
      cancelled = true;
    };
  }, [project, onFailed, onReady]);

  if (inputs == null) return null;

  return (
    <ExportDialog
      open
      onOpenChange={next => {
        if (!next) onClose();
      }}
      showChartCheck={false}
      songName={inputs.songName}
      artistName={inputs.artistName}
      charterName={inputs.charterName}
      origin={inputs.origin}
      toolsApplied={inputs.toolsApplied}
      sourceChartFormat={inputs.sourceChartFormat}
      chartDoc={inputs.chartDoc}
      getAudioSources={inputs.getAudioSources}
      getExtraAssets={inputs.getExtraAssets}
    />
  );
}
