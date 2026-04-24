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
import {
  CrnnTranscriber,
  MockTranscriber,
  type DrumTranscriber,
} from '../ml/transcriber';
import {rawEventsToDrumNotes, getChartMapping} from '../ml/class-mapping';
import {
  createEmptyChart,
  writeChartFolder,
  addDrumNote,
  addSection,
} from '@/lib/chart-edit';
import type {ChartDocument, DrumNoteType} from '@/lib/chart-edit';
import {buildTimedTempos, msToTick} from '../timing';
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

      await separateStems(projectId, storedAudio, sepProgress => {
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
      console.warn('Stem separation failed, continuing with full mix:', err);
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

    // Load the drum stem for transcription (stereo interleaved).
    // The CrnnTranscriber expects stereo audio and handles mono conversion internally.
    let drumAudioStereo: Float32Array;
    try {
      const {loadStem} = await import('../ml/demucs');
      drumAudioStereo = await loadStem(projectId, 'drums');
    } catch {
      // If stems aren't available (e.g. separation was skipped),
      // use the full audio mix (already stereo interleaved)
      drumAudioStereo = await loadAudioForDemucs(projectId);
    }

    // Run transcription
    const result: TranscriptionResult = await txr.transcribe(
      drumAudioStereo,
      TARGET_SAMPLE_RATE,
      txrProgress => {
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
    const files = writeChartFolder(chartDoc);
    const chartFile = files.find(f => f.fileName === 'notes.chart');
    if (!chartFile) {
      throw new Error('writeChartFolder did not produce notes.chart');
    }
    const chartText = new TextDecoder().decode(chartFile.data);
    await writeProjectText(projectId, 'notes.chart', chartText);

    // Store confidence scores
    const confidenceData = buildConfidenceData(
      result.events,
      [{tick: 0, beatsPerMinute: DEFAULT_BPM}],
      RESOLUTION,
    );
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

      await separateStems(projectId, storedAudio, sepProgress => {
        onProgress({
          step: 'separating',
          progress: sepProgress.percent,
          projectId,
          projectName: meta.name,
        });
      });
    } catch (err) {
      console.warn('Stem separation failed, continuing with full mix:', err);
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

    // Load stereo audio for transcription
    let drumAudioStereo: Float32Array;
    try {
      const {loadStem} = await import('../ml/demucs');
      drumAudioStereo = await loadStem(projectId, 'drums');
    } catch {
      drumAudioStereo = await loadAudioForDemucs(projectId);
    }

    const result: TranscriptionResult = await txr.transcribe(
      drumAudioStereo,
      TARGET_SAMPLE_RATE,
      txrProgress => {
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

    const files = writeChartFolder(chartDoc);
    const chartFile = files.find(f => f.fileName === 'notes.chart');
    if (!chartFile) {
      throw new Error('writeChartFolder did not produce notes.chart');
    }
    const chartText = new TextDecoder().decode(chartFile.data);
    await writeProjectText(projectId, 'notes.chart', chartText);

    const confidenceData = buildConfidenceData(
      result.events,
      [{tick: 0, beatsPerMinute: DEFAULT_BPM}],
      RESOLUTION,
    );
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
 * Creates the default transcriber — uses CrnnTranscriber (CRNN model).
 * The constructor is safe to call without ONNX loaded; it only
 * accesses the runtime during transcribe() via the Web Worker.
 */
function createDefaultTranscriber(): DrumTranscriber {
  return new CrnnTranscriber();
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

  // Create an empty parsed chart (single tempo + 4/4 time signature)
  const parsedChart = createEmptyChart({
    format: 'chart',
    resolution: RESOLUTION,
    bpm,
    timeSignature: {numerator: 4, denominator: 4},
  });

  // Set metadata on the parsed chart
  parsedChart.metadata = {
    ...parsedChart.metadata,
    name: songName,
    artist: 'Unknown',
    charter: 'Drum Transcription AI',
    diff_drums: 0,
  };

  // Convert raw events to chart drum notes using the tempo map
  const tempos = [{tick: 0, beatsPerMinute: bpm}];
  const drumNotes = rawEventsToDrumNotes(events, tempos, RESOLUTION);

  // Add an ExpertDrums track
  parsedChart.trackData.push({
    instrument: 'drums',
    difficulty: 'expert',
    starPowerSections: [],
    rejectedStarPowerSections: [],
    drumFreestyleSections: [],
    soloSections: [],
    flexLanes: [],
    noteEventGroups: [],
    textEvents: [],
    versusPhrases: [],
    animations: [],
    unrecognizedMidiEvents: [],
  } as never);

  const track = parsedChart.trackData[0];

  // Add each drum note using chart-edit's addDrumNote
  for (const note of drumNotes) {
    addDrumNote(track, {
      tick: note.tick,
      type: note.type,
      length: note.length,
      flags: {
        cymbal: note.flags.cymbal,
        doubleKick: note.flags.doubleKick,
        accent: note.flags.accent,
        ghost: note.flags.ghost,
      },
    });
  }

  // Calculate end tick (slightly after last note or based on duration)
  const lastNoteTick =
    drumNotes.length > 0 ? drumNotes[drumNotes.length - 1].tick : 0;
  const durationTicks = Math.ceil((durationSeconds * bpm * RESOLUTION) / 60);
  const endTick = Math.max(lastNoteTick + RESOLUTION, durationTicks);

  // Add end event
  parsedChart.endEvents = [{tick: endTick, msTime: 0, msLength: 0}];

  const doc: ChartDocument = {parsedChart, assets: []};

  // Create section markers every 4 bars
  const ticksPerBar = RESOLUTION * 4; // 4/4 time
  const totalBars = Math.ceil(endTick / ticksPerBar);
  for (let bar = 0; bar < totalBars; bar += 4) {
    const sectionTick = bar * ticksPerBar;
    if (bar === 0) {
      addSection(doc, sectionTick, 'Intro');
    } else {
      addSection(doc, sectionTick, `Section ${Math.floor(bar / 4) + 1}`);
    }
  }

  return doc;
}

/**
 * Build confidence data from raw events and the generated chart document.
 *
 * Creates a mapping from note key (tick-noteType) to confidence score,
 * matching the format the editor expects.
 */
function buildConfidenceData(
  events: RawDrumEvent[],
  tempos: {tick: number; beatsPerMinute: number}[],
  resolution: number,
): {notes: Record<string, number>} {
  const notes: Record<string, number> = {};

  // Build confidence by converting each raw event to its tick+type key directly,
  // rather than matching by index (which breaks after the sort in rawEventsToDrumNotes).
  const timedTempos = buildTimedTempos(tempos, resolution);

  for (const event of events) {
    const mapping = getChartMapping(event.drumClass);
    const ms = event.timeSeconds * 1000;
    const tick = msToTick(ms, timedTempos, resolution);
    const key = `${tick}-${mapping.noteType}`;
    // If multiple events map to the same tick+type, keep the highest confidence
    if (notes[key] === undefined || event.confidence > notes[key]) {
      notes[key] = event.confidence;
    }
  }

  return {notes};
}
