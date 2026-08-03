/**
 * Pipeline orchestration for the drum transcription feature.
 *
 * Sequences the full flow:
 *   audio upload -> decode -> BS-Roformer drum-stem separation
 *     -> resample 44.1k -> 48k -> ML drum transcription (stereo CRNN)
 *     -> chart generation
 *
 * Each step checks OPFS for existing output before running, enabling
 * resumability if the user closes the tab mid-pipeline.
 *
 * The stages themselves (and the progress contract they report through) live
 * in `./stages`; this file is only the three orderings of them.
 */

import {decodeAudio} from '../audio/decoder';
import {createAudioMetadata} from '../audio/types';
import {
  createProject,
  updateProject,
  hasStoredAudio,
  writeProjectBinary,
  writeProjectJSON,
  hasProjectChartFile,
  writePackageInfo,
  writeProjectAssets,
  deleteProjectFile,
  getProject,
  editedVariant,
  CHART_FILE_BASENAMES,
  type ProjectMetadata,
  type PackageInfo,
} from '../storage/opfs';
import {hasDrumStem} from '../ml/roformer-separation';
import {CRNN_SAMPLE_RATE} from './crnn-audio-prep';
import type {LinkSegSections, Synctrack} from '@/lib/tempo-map/types';
import {CrnnTranscriber, type DrumTranscriber} from '../ml/transcriber';
import {writeChartFolder} from '@/lib/chart-edit';
import type {ChartDocument, File as FileEntry} from '@/lib/chart-edit';
import {
  buildChartDocument,
  buildChartDocumentFromExistingChart,
  buildConfidenceData,
  RESOLUTION,
  type StoredSynctrack,
} from './chart-builder';
import {buildDecodedOnsetsFile, DECODED_ONSETS_FILE} from './decoded-onsets';
import type {PhaseAlignResult} from './phase-align';
import {loadPhaseAlignConfig} from '../ml/phase-align-config';
import type {TranscriptionResult} from '../ml/types';
import {
  ensureSynctrack,
  loadTranscriptionAudio48k,
  separateDrumsStep,
  storeUploadedAudioOriginal,
  SYNCTRACK_FILE,
  throwIfAborted,
  type PipelineProgressCallback,
  type SynctrackMode,
} from './stages';

// ---------------------------------------------------------------------------
// Pipeline runner
// ---------------------------------------------------------------------------

/**
 * Run the full drum transcription pipeline.
 *
 * @param audioFile - The audio file (File or ArrayBuffer) to process.
 * @param fileName - Display name for the project.
 * @param onProgress - Callback for progress updates.
 * @param transcriber - Optional transcriber implementation. If omitted, uses CrnnTranscriber.
 * @returns The project ID.
 */
export async function runPipeline(
  audioFile: File | ArrayBuffer,
  fileName: string,
  onProgress: PipelineProgressCallback,
  transcriber?: DrumTranscriber,
): Promise<string> {
  const txr = transcriber ?? createDefaultTranscriber();

  // Step 1: Decode audio and create project
  onProgress({step: 'decoding', progress: 0, projectName: fileName});

  let projectId: string;
  let projectMeta: ProjectMetadata;

  // Get the raw ArrayBuffer from the input
  const arrayBuffer =
    audioFile instanceof File ? await audioFile.arrayBuffer() : audioFile;

  // Create a File object for metadata extraction if we have an ArrayBuffer
  const file =
    audioFile instanceof File
      ? audioFile
      : new File([arrayBuffer], fileName, {type: 'audio/mpeg'});

  // Keep a copy of the source bytes for the tempo pipeline's stem cache:
  // decodeAudioData detaches the buffer it is given.
  const sourceBytes = arrayBuffer.slice(0);

  // Decode the audio
  const audioBuffer = await decodeAudio(arrayBuffer);
  const metadata = createAudioMetadata(file, audioBuffer);

  onProgress({step: 'decoding', progress: 0.5, projectName: fileName});

  // Create project and store audio
  projectMeta = await createProject(metadata.name);
  projectId = projectMeta.id;

  await storeUploadedAudioOriginal(
    projectId,
    sourceBytes,
    metadata,
    audioBuffer.length,
  );

  onProgress({
    step: 'decoding',
    progress: 1,
    projectId,
    projectName: metadata.name,
  });

  // Step 2: Stem separation
  // Stem separation requires ONNX Runtime + WebGPU. If unavailable (e.g.
  // dev mode without model loaded), we skip it gracefully and the
  // transcription step will fall back to using the full audio mix.
  const stemsExist = await hasDrumStem(projectId);
  if (!stemsExist) {
    onProgress({
      step: 'separating',
      progress: 0,
      projectId,
      projectName: metadata.name,
    });

    await updateProject(projectId, {stage: 'separating'});
    await separateDrumsStep(projectId, metadata.name, onProgress);
  }

  onProgress({
    step: 'separating',
    progress: 1,
    projectId,
    projectName: metadata.name,
  });

  // Step 3: Tempo mapping (reuses the /tempo pipeline; the pre-separated
  // drum stem avoids a second GPU separation). Falls back to a flat-tempo
  // chart on failure.
  const chartExists = await hasProjectChartFile(projectId);
  let synctrack: Synctrack | null = null;
  let sections: LinkSegSections | null = null;
  if (!chartExists) {
    const st = await ensureSynctrack(
      projectId,
      metadata.name,
      sourceBytes,
      onProgress,
    );
    synctrack = st?.synctrack ?? null;
    sections = st?.sections ?? null;
  }

  // Step 4: Transcription
  if (!chartExists) {
    onProgress({
      step: 'transcribing',
      progress: 0,
      projectId,
      projectName: metadata.name,
    });

    await updateProject(projectId, {stage: 'transcribing'});

    // Load the drum stem (or full-mix fallback) as interleaved stereo,
    // resampled 44.1k -> 48k for the stereo CRNN.
    const drumAudioStereo = await loadTranscriptionAudio48k(projectId);

    // Run transcription
    const result: TranscriptionResult = await txr.transcribe(
      drumAudioStereo,
      CRNN_SAMPLE_RATE,
      txrProgress => {
        onProgress({
          step: 'transcribing',
          progress: txrProgress.percent,
          projectId,
          projectName: metadata.name,
        });
      },
    );

    // Build ChartDocument from transcription results under the real tempo
    // map (or flat DEFAULT_BPM when tempo mapping failed). PHASE-ALIGN's
    // dev override (localStorage) is read once here, at pipeline start.
    const phaseAlignOut: {result?: PhaseAlignResult} = {};
    const chartDoc = buildChartDocument(
      result.events,
      metadata.name,
      result.durationSeconds,
      synctrack,
      sections,
      loadPhaseAlignConfig(),
      phaseAlignOut,
    );

    // Serialize the chart. This path always builds a fresh ParsedChart with
    // format:'chart' (buildChartDocument, unlike buildChartDocumentFromExistingChart,
    // has no source format to preserve), but find by content type rather
    // than hardcoding the name, so this stays symmetric with the chart-flow
    // write below.
    const files = writeChartFolder(chartDoc);
    const chartFile = files.find(
      f => f.fileName === 'notes.chart' || f.fileName === 'notes.mid',
    );
    if (!chartFile) {
      throw new Error('writeChartFolder did not produce a chart file');
    }

    // Write confidence.json before the chart file: the chart file's presence
    // is the resume gate, so writing it last guarantees a crash never leaves
    // the chart present with confidence.json missing on resume. Both derive
    // from the same events and tempo map — the SAME phase-align shift
    // buildChartDocument applied above, so confidence keys match the
    // chart's snapped ticks exactly.
    const confidenceData = buildConfidenceData(
      result.events,
      chartDoc.parsedChart.tempos,
      RESOLUTION,
      'audio',
      phaseAlignOut.result?.shiftMs ?? 0,
    );
    await writeProjectJSON(projectId, 'confidence.json', confidenceData);
    // Retain the pre-snap decoded onsets alongside confidence.json (plan
    // 0061 §3a) — also before the chart file, for the same crash-safety
    // reason.
    await writeProjectJSON(
      projectId,
      DECODED_ONSETS_FILE,
      buildDecodedOnsetsFile(result.events, 'audio'),
    );
    await writeProjectBinary(projectId, chartFile.fileName, chartFile.data);
  }

  // Mark project as ready for editing
  await updateProject(projectId, {stage: 'editing', gridSource: 'predicted'});

  onProgress({
    step: 'ready',
    progress: 1,
    projectId,
    projectName: metadata.name,
  });

  return projectId;
}

// ---------------------------------------------------------------------------
// Pipeline runner — existing-chart flow (chart-flow feature)
// ---------------------------------------------------------------------------

/** Input for {@link runPipelineFromChart}: an already-parsed chart package. */
export interface ExistingChartPipelineInput {
  /** The parsed existing chart (its SyncTrack is the provided grid). */
  chartDoc: ChartDocument;
  /** The audio file to transcribe (e.g. the package's primary song file). */
  audioFile: File;
  /** Original package identity, for re-export in the same shape. */
  packageInfo: PackageInfo;
  /**
   * Every other file from the original package (not the chart/ini files, not
   * `audioFile`) — album art, video, secondary audio, etc. Stored verbatim
   * so export can round-trip them.
   */
  extraAssets: FileEntry[];
}

/**
 * Run the drum transcription pipeline against an EXISTING chart package.
 *
 * Unlike {@link runPipeline} (audio-only: predicts a tempo map from scratch),
 * this path reuses the supplied chart's own SyncTrack for note placement —
 * the tempo-mapping step is skipped entirely, never a model-predicted one.
 * Feature extraction and model inference (stem separation, CRNN transcribe)
 * are otherwise identical. Scoring against a provided grid instead of a
 * predicted one is worth ~+0.08 edit_rate_w offline (PIPELINE_AUDIT.md), so
 * this is a meaningfully better result whenever the user already has a
 * chart, not just a convenience.
 *
 * The existing chart's other tracks/sections/metadata/ini fields are left
 * untouched; only the Expert Drums track is added or replaced (see
 * {@link buildChartDocumentFromExistingChart}).
 */
export async function runPipelineFromChart(
  input: ExistingChartPipelineInput,
  onProgress: PipelineProgressCallback,
  transcriber?: DrumTranscriber,
): Promise<string> {
  const txr = transcriber ?? createDefaultTranscriber();
  const {chartDoc, audioFile, packageInfo, extraAssets} = input;

  const projectName =
    chartDoc.parsedChart.metadata.name || packageInfo.originalName;

  // Step 1: Decode audio and create project (identical to runPipeline).
  onProgress({step: 'decoding', progress: 0, projectName});

  const arrayBuffer = await audioFile.arrayBuffer();
  const sourceBytes = arrayBuffer.slice(0);
  const audioBuffer = await decodeAudio(arrayBuffer);
  const metadata = createAudioMetadata(audioFile, audioBuffer);

  onProgress({step: 'decoding', progress: 0.5, projectName});

  const projectMeta = await createProject(projectName);
  const projectId = projectMeta.id;

  await storeUploadedAudioOriginal(
    projectId,
    sourceBytes,
    metadata,
    audioBuffer.length,
  );

  // Persist the package identity + passthrough assets up front so a crash
  // mid-pipeline doesn't lose the "write back in the same shape" info.
  await writePackageInfo(projectId, packageInfo);
  await writeProjectAssets(projectId, extraAssets);

  onProgress({
    step: 'decoding',
    progress: 1,
    projectId,
    projectName: metadata.name,
  });

  // Step 2: Stem separation (identical to runPipeline, including the
  // already-separated pre-check — inert today since this is always a fresh
  // project, but kept for consistency with the other two entry points).
  const stemsExist = await hasDrumStem(projectId);
  if (!stemsExist) {
    onProgress({
      step: 'separating',
      progress: 0,
      projectId,
      projectName: metadata.name,
    });
    await updateProject(projectId, {stage: 'separating'});
    await separateDrumsStep(projectId, metadata.name, onProgress);
  }
  onProgress({
    step: 'separating',
    progress: 1,
    projectId,
    projectName: metadata.name,
  });

  // Step 3: Tempo mapping is SKIPPED — the existing chart's own SyncTrack is
  // the provided grid (never a model-predicted one).

  // Step 4: Transcription, chart-built against the PROVIDED grid.
  onProgress({
    step: 'transcribing',
    progress: 0,
    projectId,
    projectName: metadata.name,
  });
  await updateProject(projectId, {stage: 'transcribing'});

  const drumAudioStereo = await loadTranscriptionAudio48k(projectId);
  const result: TranscriptionResult = await txr.transcribe(
    drumAudioStereo,
    CRNN_SAMPLE_RATE,
    txrProgress => {
      onProgress({
        step: 'transcribing',
        progress: txrProgress.percent,
        projectId,
        projectName: metadata.name,
      });
    },
  );

  const finalChartDoc = buildChartDocumentFromExistingChart(
    chartDoc,
    result.events,
    result.durationSeconds,
  );

  // The chart-flow feature preserves the source chart's own format (see
  // buildChartDocumentFromExistingChart) — a MIDI-sourced upload produces
  // notes.mid here, not notes.chart. Find by content type, not by a
  // hardcoded name, so both formats write out symmetrically.
  const files = writeChartFolder(finalChartDoc);
  const chartFile = files.find(
    f => f.fileName === 'notes.chart' || f.fileName === 'notes.mid',
  );
  if (!chartFile) {
    throw new Error('writeChartFolder did not produce a chart file');
  }

  const confidenceData = buildConfidenceData(
    result.events,
    finalChartDoc.parsedChart.tempos,
    finalChartDoc.parsedChart.resolution || RESOLUTION,
    'chart',
  );
  await writeProjectJSON(projectId, 'confidence.json', confidenceData);
  // Retain the pre-snap decoded onsets alongside confidence.json (plan 0061
  // §3a). The chart flow transcribes real onsets too — flow: 'chart'.
  await writeProjectJSON(
    projectId,
    DECODED_ONSETS_FILE,
    buildDecodedOnsetsFile(result.events, 'chart'),
  );
  await writeProjectBinary(projectId, chartFile.fileName, chartFile.data);

  await updateProject(projectId, {stage: 'editing', gridSource: 'provided'});

  onProgress({
    step: 'ready',
    progress: 1,
    projectId,
    projectName: metadata.name,
  });

  return projectId;
}

export interface ResumePipelineOptions {
  /**
   * Aborts the run. Checked at every stage boundary and threaded into the
   * separation, tempo-mapping, and transcription clients, each of which
   * terminates its worker and rejects with an `AbortError` — so a cancel
   * stops GPU work rather than only abandoning the UI. A cancelled run
   * writes nothing.
   */
  signal?: AbortSignal | undefined;
  /**
   * `'regenerate'` ({@link regenerateProject}) recomputes the tempo map and
   * notes even though the project already has a chart, and replaces the
   * project's derived artifacts only once the run has fully succeeded.
   * `'resume'` (the default) only fills in what is missing, persisting each
   * stage as it lands so the next resume can reuse it.
   */
  mode?: SynctrackMode | undefined;
}

/**
 * Resume a pipeline for an existing project that was interrupted.
 *
 * Checks which steps are complete and resumes from the first incomplete step.
 */
export async function resumePipeline(
  projectId: string,
  onProgress: PipelineProgressCallback,
  transcriber?: DrumTranscriber,
  options: ResumePipelineOptions = {},
): Promise<string> {
  const txr = transcriber ?? createDefaultTranscriber();
  const {signal, mode = 'resume'} = options;
  throwIfAborted(signal);

  const meta = await getProject(projectId);

  // Check what's already done
  const hasAudio = await hasStoredAudio(projectId);
  const hasStems = await hasDrumStem(projectId);
  const hasChart = await hasProjectChartFile(projectId);

  if (!hasAudio) {
    throw new Error(
      `Project ${projectId} has no audio stored. Cannot resume pipeline.`,
    );
  }

  // This generic resume path always rebuilds the chart against a freshly
  // predicted tempo map (see Step 3/4 below) — it doesn't know how to
  // reconstruct an existing-chart project's original ParsedChart (other
  // tracks, sections, ini fields). Resuming an interrupted "existing chart"
  // pipeline that way would silently drop the provided-grid guarantee, so
  // refuse rather than corrupt it; the user re-uploads the chart package
  // instead (chart-flow resume is a known follow-up, not yet supported).
  if (meta.gridSource === 'provided' && !hasChart) {
    throw new Error(
      'This project was created from an existing chart and was interrupted ' +
        'before finishing. Resuming an existing-chart pipeline is not yet ' +
        'supported — please re-upload the chart package to restart it.',
    );
  }

  // In regeneration mode the project already has every artifact; the run
  // recomputes them anyway and replaces them at the end (below), so a
  // cancel mid-run leaves the existing chart, tempo map, and review
  // progress exactly as they were.
  const needsWork = mode === 'regenerate' || !hasChart;

  // Step 2: Stem separation (if needed)
  if (!hasStems) {
    onProgress({
      step: 'separating',
      progress: 0,
      projectId,
      projectName: meta.name,
    });

    await updateProject(projectId, {stage: 'separating'});
    await separateDrumsStep(projectId, meta.name, onProgress, signal);
  }
  throwIfAborted(signal);

  // Step 3: Tempo mapping (if needed). Resumed projects have no source
  // bytes in scope (only OPFS PCM), so the tempo worker's stem cache
  // isn't seeded — the pre-separated stem still avoids re-separation.
  let synctrack: Synctrack | null = null;
  let sections: LinkSegSections | null = null;
  let pendingSynctrack: StoredSynctrack | null = null;
  if (needsWork) {
    const st = await ensureSynctrack(projectId, meta.name, null, onProgress, {
      signal,
      mode,
    });
    synctrack = st?.synctrack ?? null;
    sections = st?.sections ?? null;
    pendingSynctrack = st?.pendingStored ?? null;
  }
  throwIfAborted(signal);

  // Step 4: Transcription (if needed)
  if (needsWork) {
    onProgress({
      step: 'transcribing',
      progress: 0,
      projectId,
      projectName: meta.name,
    });

    await updateProject(projectId, {stage: 'transcribing'});

    // Load stereo audio for transcription (drum stem or full mix, at 48 kHz)
    const drumAudioStereo = await loadTranscriptionAudio48k(projectId);

    const result: TranscriptionResult = await txr.transcribe(
      drumAudioStereo,
      CRNN_SAMPLE_RATE,
      txrProgress => {
        onProgress({
          step: 'transcribing',
          progress: txrProgress.percent,
          projectId,
          projectName: meta.name,
        });
      },
      signal,
    );
    throwIfAborted(signal);

    const phaseAlignOut: {result?: PhaseAlignResult} = {};
    const chartDoc = buildChartDocument(
      result.events,
      meta.name,
      result.durationSeconds,
      synctrack,
      sections,
      loadPhaseAlignConfig(),
      phaseAlignOut,
    );

    const files = writeChartFolder(chartDoc);
    const chartFile = files.find(
      f => f.fileName === 'notes.chart' || f.fileName === 'notes.mid',
    );
    if (!chartFile) {
      throw new Error('writeChartFolder did not produce a chart file');
    }

    // Everything the run produces is now in memory. This is the point of no
    // return: regeneration discards the project's previous derived
    // artifacts here rather than up front, so a cancel at any earlier point
    // leaves the persisted project untouched. The subsequent writes have no
    // await on GPU work between them.
    throwIfAborted(signal);
    if (mode === 'regenerate') {
      await Promise.all(
        REGENERATED_ARTIFACT_FILES.map(fileName =>
          deleteProjectFile(projectId, fileName),
        ),
      );
    }
    if (pendingSynctrack) {
      await writeProjectJSON(projectId, SYNCTRACK_FILE, pendingSynctrack);
    }

    // Write confidence.json before the chart file: the chart file's presence
    // is the resume gate, so writing it last guarantees a crash never leaves
    // the chart present with confidence.json missing on resume. Both derive
    // from the same events and tempo map — the SAME phase-align shift
    // buildChartDocument applied above.
    const confidenceData = buildConfidenceData(
      result.events,
      chartDoc.parsedChart.tempos,
      RESOLUTION,
      'audio',
      phaseAlignOut.result?.shiftMs ?? 0,
    );
    await writeProjectJSON(projectId, 'confidence.json', confidenceData);
    // Retain the pre-snap decoded onsets alongside confidence.json (plan
    // 0061 §3a) — a resumed project's own transcription must leave the same
    // artifact as runPipeline's, or a genuinely transcribed project would
    // silently degrade to the no-onsets RESNAP fallback.
    await writeProjectJSON(
      projectId,
      DECODED_ONSETS_FILE,
      buildDecodedOnsetsFile(result.events, 'audio'),
    );
    await writeProjectBinary(projectId, chartFile.fileName, chartFile.data);
  }

  await updateProject(projectId, {stage: 'editing', gridSource: 'predicted'});

  onProgress({
    step: 'ready',
    progress: 1,
    projectId,
    projectName: meta.name,
  });

  return projectId;
}

// ---------------------------------------------------------------------------
// Regeneration
// ---------------------------------------------------------------------------

/**
 * Derived artifacts a successful regeneration replaces. Deleted at the end
 * of the run, immediately before its own outputs are written, so a cancelled
 * or failed regeneration leaves the project exactly as it was. Covers both
 * chart formats plus their edited (autosave) variants — the edited variant
 * must go too, since findProjectChartFile prefers it and a leftover one
 * would shadow the regenerated chart.
 */
export const REGENERATED_ARTIFACT_FILES: readonly string[] = [
  SYNCTRACK_FILE,
  'confidence.json',
  DECODED_ONSETS_FILE,
  'review-progress.json',
  CHART_FILE_BASENAMES.chart,
  CHART_FILE_BASENAMES.mid,
  editedVariant(CHART_FILE_BASENAMES.chart),
  editedVariant(CHART_FILE_BASENAMES.mid),
];

/**
 * Regenerate a project's beat grid (predicted tempo map) and predicted notes
 * from its stored audio, discarding all edits and review progress.
 *
 * The separated drum stem is reused from the fingerprint-keyed stem cache
 * (resumePipeline's separation gate sees it as already done), so this only
 * re-runs tempo mapping + transcription — no GPU separation.
 *
 * Only valid for predicted-grid projects: a provided-grid (chart-flow)
 * project's grid is the user's own chart, and this generic path cannot
 * reconstruct its original ParsedChart (same restriction as resume).
 *
 * Cancellable: `options.signal` stops the in-flight workers and rejects with
 * an `AbortError`. Nothing is deleted or written until the run has produced
 * every output, so cancelling (or failing) leaves the project's chart, tempo
 * map, review progress, and audio anchor untouched.
 */
export async function regenerateProject(
  projectId: string,
  onProgress: PipelineProgressCallback,
  transcriber?: DrumTranscriber,
  options: {signal?: AbortSignal | undefined} = {},
): Promise<string> {
  const meta = await getProject(projectId);
  if (meta.gridSource === 'provided') {
    throw new Error(
      'This project was created from an existing chart; its grid came from ' +
        'that chart, so there is nothing to regenerate.',
    );
  }

  try {
    const result = await resumePipeline(projectId, onProgress, transcriber, {
      signal: options.signal,
      mode: 'regenerate',
    });
    // The regenerated chart is audio-relative from scratch — any leading-
    // silence anchor from the discarded chart no longer applies (0064
    // addendum §1: "regenerate clears it").
    await updateProject(projectId, {audioAnchor: null});
    return result;
  } catch (err) {
    // The project still has its original chart: put its stage back so it
    // isn't mistaken for an interrupted pipeline on the next load.
    await updateProject(projectId, {stage: meta.stage});
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Transcriber selection
// ---------------------------------------------------------------------------

/**
 * Creates the default transcriber — uses CrnnTranscriber (CRNN model).
 * The constructor is safe to call without ONNX loaded; it only
 * accesses the runtime during transcribe() via the Web Worker.
 */
function createDefaultTranscriber(): DrumTranscriber {
  return new CrnnTranscriber();
}

// Chart document construction lives in ./chart-builder (unit-testable
// without pulling in the transcriber/worker machinery).
