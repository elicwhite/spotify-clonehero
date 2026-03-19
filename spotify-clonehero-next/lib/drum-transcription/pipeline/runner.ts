/**
 * Pipeline runner for the drum transcription feature.
 *
 * Orchestrates the full flow:
 *   audio upload -> decode -> Demucs stem separation -> ML drum transcription -> chart generation
 *
 * Each step checks OPFS for existing output before running, enabling
 * resumability if the user closes the tab mid-pipeline.
 */

import {decodeAudio, interleaveAudioBuffer} from '../audio/decoder';
import {createAudioMetadata, TARGET_SAMPLE_RATE} from '../audio/types';
import {
  createProject,
  storeAudio,
  updateProject,
  loadAudioForDemucs,
  hasStoredAudio,
  writeProjectText,
  writeProjectJSON,
  projectFileExists,
  type ProjectMetadata,
} from '../storage/opfs';
import {separateStems, hasSeparatedStems} from '../ml/demucs';
import {OnnxTranscriber, MockTranscriber, type DrumTranscriber} from '../ml/transcriber';
import {rawEventsToDrumNotes} from '../ml/class-mapping';
import {serializeChart} from '../chart-io/writer';
import type {
  ChartDocument,
  TempoEvent,
  TimeSignatureEvent,
  TrackData,
} from '../chart-io/types';
import type {RawDrumEvent, TranscriptionResult} from '../ml/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PipelineStep =
  | 'idle'
  | 'loading-runtime'
  | 'decoding'
  | 'separating'
  | 'transcribing'
  | 'ready'
  | 'error';

export interface PipelineProgress {
  step: PipelineStep;
  /** Progress within the current step, 0-1. */
  progress: number;
  /** Project ID once created. */
  projectId?: string;
  /** Project name. */
  projectName?: string;
  /** Error message if step === 'error'. */
  error?: string;
}

export type PipelineProgressCallback = (progress: PipelineProgress) => void;

// ---------------------------------------------------------------------------
// Pipeline runner
// ---------------------------------------------------------------------------

/**
 * Run the full drum transcription pipeline.
 *
 * @param audioFile - The audio file (File or ArrayBuffer) to process.
 * @param fileName - Display name for the project.
 * @param onProgress - Callback for progress updates.
 * @param transcriber - Optional transcriber implementation. If omitted, tries
 *   OnnxTranscriber (real ONNX model) first, falling back to MockTranscriber.
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

  // Decode the audio
  const audioBuffer = await decodeAudio(arrayBuffer);
  const metadata = createAudioMetadata(file, audioBuffer);

  onProgress({step: 'decoding', progress: 0.5, projectName: fileName});

  // Create project and store audio
  projectMeta = await createProject(metadata.name);
  projectId = projectMeta.id;

  const interleavedPcm = interleaveAudioBuffer(audioBuffer);
  await storeAudio(projectId, interleavedPcm, metadata, audioBuffer.length);

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
  const stemsExist = await hasSeparatedStems(projectId);
  if (!stemsExist) {
    onProgress({
      step: 'separating',
      progress: 0,
      projectId,
      projectName: metadata.name,
    });

    await updateProject(projectId, {stage: 'separating'});

    try {
      // Load the interleaved audio from OPFS
      const storedAudio = await loadAudioForDemucs(projectId);

      await separateStems(projectId, storedAudio, (sepProgress) => {
        onProgress({
          step: 'separating',
          progress: sepProgress.percent,
          projectId,
          projectName: metadata.name,
        });
      });
    } catch (err) {
      // Stem separation failed. Log the full error for debugging,
      // then continue — transcription will use the full audio mix.
      console.warn(
        'Stem separation failed, continuing with full mix:',
        err,
      );
      onProgress({
        step: 'separating',
        progress: 1,
        projectId,
        projectName: metadata.name,
      });
    }
  }

  onProgress({
    step: 'separating',
    progress: 1,
    projectId,
    projectName: metadata.name,
  });

  // Step 3: Transcription
  const chartExists = await projectFileExists(projectId, 'notes.chart');
  if (!chartExists) {
    onProgress({
      step: 'transcribing',
      progress: 0,
      projectId,
      projectName: metadata.name,
    });

    await updateProject(projectId, {stage: 'transcribing'});

    // Load the drum stem for transcription.
    // The transcriber expects mono audio, so we'll average the stereo channels.
    let drumAudioMono: Float32Array;
    try {
      const {loadStem} = await import('../ml/demucs');
      const drumsStereo = await loadStem(projectId, 'drums');
      // Convert interleaved stereo to mono by averaging L+R
      const numSamples = drumsStereo.length / 2;
      drumAudioMono = new Float32Array(numSamples);
      for (let i = 0; i < numSamples; i++) {
        drumAudioMono[i] =
          (drumsStereo[i * 2] + drumsStereo[i * 2 + 1]) * 0.5;
      }
    } catch {
      // If stems aren't available (e.g. separation was skipped),
      // use the full audio mix converted to mono
      const fullAudio = await loadAudioForDemucs(projectId);
      const numSamples = fullAudio.length / 2;
      drumAudioMono = new Float32Array(numSamples);
      for (let i = 0; i < numSamples; i++) {
        drumAudioMono[i] = (fullAudio[i * 2] + fullAudio[i * 2 + 1]) * 0.5;
      }
    }

    // Run transcription
    const result: TranscriptionResult = await txr.transcribe(
      drumAudioMono,
      TARGET_SAMPLE_RATE,
      (txrProgress) => {
        onProgress({
          step: 'transcribing',
          progress: txrProgress.percent,
          projectId,
          projectName: metadata.name,
        });
      },
    );

    // Build ChartDocument from transcription results
    const chartDoc = buildChartDocument(
      result.events,
      metadata.name,
      result.durationSeconds,
    );

    // Serialize chart to .chart format and store
    const chartText = serializeChart(chartDoc);
    await writeProjectText(projectId, 'notes.chart', chartText);

    // Store confidence scores
    const confidenceData = buildConfidenceData(result.events, chartDoc);
    await writeProjectJSON(projectId, 'confidence.json', confidenceData);
  }

  // Mark project as ready for editing
  await updateProject(projectId, {stage: 'editing'});

  onProgress({
    step: 'ready',
    progress: 1,
    projectId,
    projectName: metadata.name,
  });

  return projectId;
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
): Promise<string> {
  const txr = transcriber ?? createDefaultTranscriber();

  const {getProject} = await import('../storage/opfs');
  const meta = await getProject(projectId);

  // Check what's already done
  const hasAudio = await hasStoredAudio(projectId);
  const hasStems = await hasSeparatedStems(projectId);
  const hasChart = await projectFileExists(projectId, 'notes.chart');

  if (!hasAudio) {
    throw new Error(
      `Project ${projectId} has no audio stored. Cannot resume pipeline.`,
    );
  }

  // Step 2: Stem separation (if needed)
  if (!hasStems) {
    onProgress({
      step: 'separating',
      progress: 0,
      projectId,
      projectName: meta.name,
    });

    await updateProject(projectId, {stage: 'separating'});

    try {
      const storedAudio = await loadAudioForDemucs(projectId);

      await separateStems(projectId, storedAudio, (sepProgress) => {
        onProgress({
          step: 'separating',
          progress: sepProgress.percent,
          projectId,
          projectName: meta.name,
        });
      });
    } catch (err) {
      console.warn(
        'Stem separation failed, continuing with full mix:',
        err,
      );
      onProgress({
        step: 'separating',
        progress: 1,
        projectId,
        projectName: meta.name,
      });
    }
  }

  // Step 3: Transcription (if needed)
  if (!hasChart) {
    onProgress({
      step: 'transcribing',
      progress: 0,
      projectId,
      projectName: meta.name,
    });

    await updateProject(projectId, {stage: 'transcribing'});

    let drumAudioMono: Float32Array;
    try {
      const {loadStem} = await import('../ml/demucs');
      const drumsStereo = await loadStem(projectId, 'drums');
      const numSamples = drumsStereo.length / 2;
      drumAudioMono = new Float32Array(numSamples);
      for (let i = 0; i < numSamples; i++) {
        drumAudioMono[i] =
          (drumsStereo[i * 2] + drumsStereo[i * 2 + 1]) * 0.5;
      }
    } catch {
      const fullAudio = await loadAudioForDemucs(projectId);
      const numSamples = fullAudio.length / 2;
      drumAudioMono = new Float32Array(numSamples);
      for (let i = 0; i < numSamples; i++) {
        drumAudioMono[i] = (fullAudio[i * 2] + fullAudio[i * 2 + 1]) * 0.5;
      }
    }

    const result: TranscriptionResult = await txr.transcribe(
      drumAudioMono,
      TARGET_SAMPLE_RATE,
      (txrProgress) => {
        onProgress({
          step: 'transcribing',
          progress: txrProgress.percent,
          projectId,
          projectName: meta.name,
        });
      },
    );

    const chartDoc = buildChartDocument(
      result.events,
      meta.name,
      result.durationSeconds,
    );

    const chartText = serializeChart(chartDoc);
    await writeProjectText(projectId, 'notes.chart', chartText);

    const confidenceData = buildConfidenceData(result.events, chartDoc);
    await writeProjectJSON(projectId, 'confidence.json', confidenceData);
  }

  await updateProject(projectId, {stage: 'editing'});

  onProgress({
    step: 'ready',
    progress: 1,
    projectId,
    projectName: meta.name,
  });

  return projectId;
}

// ---------------------------------------------------------------------------
// Transcriber selection
// ---------------------------------------------------------------------------

/**
 * Creates the default transcriber — always uses OnnxTranscriber (real ADTOF
 * model). The constructor is safe to call without ONNX loaded; it only
 * accesses the runtime during transcribe().
 */
function createDefaultTranscriber(): DrumTranscriber {
  return new OnnxTranscriber();
}

// ---------------------------------------------------------------------------
// Chart document construction
// ---------------------------------------------------------------------------

/** Default resolution (ticks per quarter note). */
const RESOLUTION = 480;

/** Default BPM when no tempo detection is available. */
const DEFAULT_BPM = 120;

/**
 * Build a ChartDocument from raw drum events.
 *
 * Creates a single-tempo chart with all events on the ExpertDrums track.
 */
function buildChartDocument(
  events: RawDrumEvent[],
  songName: string,
  durationSeconds: number,
): ChartDocument {
  const bpm = DEFAULT_BPM;

  const tempos: TempoEvent[] = [{tick: 0, bpm}];
  const timeSignatures: TimeSignatureEvent[] = [
    {tick: 0, numerator: 4, denominator: 4},
  ];

  // Convert raw events to chart drum notes using the tempo map
  const drumNotes = rawEventsToDrumNotes(events, tempos, RESOLUTION);

  // Calculate end tick (slightly after last note or based on duration)
  const lastNoteTick =
    drumNotes.length > 0 ? drumNotes[drumNotes.length - 1].tick : 0;
  const durationTicks = Math.ceil(
    (durationSeconds * bpm * RESOLUTION) / 60,
  );
  const endTick = Math.max(lastNoteTick + RESOLUTION, durationTicks);

  // Create section markers every 4 bars
  const ticksPerBar = RESOLUTION * 4; // 4/4 time
  const sections = [];
  const totalBars = Math.ceil(endTick / ticksPerBar);
  for (let bar = 0; bar < totalBars; bar += 4) {
    const sectionTick = bar * ticksPerBar;
    if (bar === 0) {
      sections.push({tick: sectionTick, name: 'Intro'});
    } else {
      sections.push({tick: sectionTick, name: `Section ${Math.floor(bar / 4) + 1}`});
    }
  }

  const track: TrackData = {
    instrument: 'drums' as const,
    difficulty: 'expert' as const,
    notes: drumNotes,
  };

  return {
    resolution: RESOLUTION,
    metadata: {
      name: songName,
      artist: 'Unknown',
      charter: 'Drum Transcription AI',
      resolution: RESOLUTION,
      offset: 0,
      difficulty: 0,
      previewStart: 0,
      previewEnd: 0,
    },
    tempos,
    timeSignatures,
    sections,
    endEvents: [{tick: endTick}],
    tracks: [track],
  };
}

/**
 * Build confidence data from raw events and the generated chart document.
 *
 * Creates a mapping from note key (tick-noteType) to confidence score,
 * matching the format the editor expects.
 */
function buildConfidenceData(
  events: RawDrumEvent[],
  chartDoc: ChartDocument,
): {notes: Record<string, number>} {
  const notes: Record<string, number> = {};

  // The chart's expert drum track has notes at quantized tick positions.
  // We match each note with its corresponding raw event by index,
  // since rawEventsToDrumNotes preserves event order.
  const track = chartDoc.tracks.find(
    (t) => t.instrument === 'drums' && t.difficulty === 'expert',
  );

  if (track) {
    for (let i = 0; i < track.notes.length && i < events.length; i++) {
      const note = track.notes[i];
      const key = `${note.tick}-${note.type}`;
      notes[key] = events[i].confidence;
    }
  }

  return {notes};
}
