/**
 * Web Worker that runs wav2vec2 CTC alignment off the main thread.
 *
 * Session creation and inference block for seconds — running them here
 * keeps the UI responsive.
 *
 * Supports syllable-level alignment: lyrics are automatically syllabified
 * using TeX hyphenation patterns and aligned at the character level.
 *
 * Messages:
 *   IN:  { type: "init" }
 *   OUT: { type: "progress", message: string }
 *   OUT: { type: "initDone" }
 *
 *   IN:  { type: "align", vocals16k: Float32Array, lyrics: string }
 *   OUT: { type: "progress", message: string }
 *   OUT: { type: "result", lines, words, syllables, durationMs }
 *
 *   OUT: { type: "error", message: string }
 */

import * as ort from 'onnxruntime-web';
import {forcedAlign} from './viterbi';
import {getCachedModel} from './model-cache';
import {syllabifyLyrics} from './syllabify';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ORT_WASM_CDN =
  'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.3/dist/';

const VOCAB: string[] = [
  '<pad>', '<s>', '</s>', '<unk>', '|',
  'E', 'T', 'A', 'O', 'N', 'I', 'H', 'S', 'R', 'D', 'L',
  'U', 'M', 'W', 'C', 'F', 'G', 'Y', 'P', 'B', 'V', 'K',
  "'", 'X', 'J', 'Q', 'Z',
];

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let session: ort.InferenceSession | null = null;
const label2idx: Record<string, number> = {};
let modelBuffer: ArrayBuffer | null = null;
let useWebGPU = false;

for (let i = 0; i < VOCAB.length; i++) {
  if (VOCAB[i]) label2idx[VOCAB[i]] = i;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function post(msg: any) {
  self.postMessage(msg);
}

function progress(message: string) {
  post({type: 'progress', message});
}

// ---------------------------------------------------------------------------
// Init — download + cache model
// ---------------------------------------------------------------------------

const WAV2VEC2_FP16_URL =
  'https://huggingface.co/elicwhite/wav2vec2-base-960h-fp16-onnx/resolve/main/wav2vec2-base-960h-fp16.onnx';
const WAV2VEC2_QUANTIZED_URL =
  'https://huggingface.co/onnx-community/wav2vec2-base-960h-ONNX/resolve/main/onnx/model_quantized.onnx';

async function handleInit() {
  ort.env.wasm.wasmPaths = ORT_WASM_CDN;
  // Multi-threading requires nested pthread workers which fail inside a bundled
  // web worker. WebGPU is the primary speed path; WASM stays single-threaded.
  ort.env.wasm.numThreads = 1;

  // Prefer fp16 model + WebGPU, fall back to quantized + WASM
  const hasWebGPU = typeof navigator !== 'undefined' && 'gpu' in navigator;

  if (hasWebGPU) {
    try {
      progress('Downloading alignment model (189 MB, fp16/WebGPU)...');
      modelBuffer = await getCachedModel(
        WAV2VEC2_FP16_URL,
        'wav2vec2-base-960h-fp16.onnx',
        progress,
      );
      useWebGPU = true;
      progress('Model cached — will load when needed');
      post({type: 'initDone'});
      return;
    } catch {
      progress('fp16 model unavailable, falling back to quantized...');
    }
  }

  // Fall back to quantized model (works with WASM)
  useWebGPU = false;
  progress('Downloading alignment model (91 MB, int8/WASM)...');
  modelBuffer = await getCachedModel(
    WAV2VEC2_QUANTIZED_URL,
    'wav2vec2-base-960h-quantized.onnx',
    progress,
  );
  progress('Model cached — will load when needed');
  post({type: 'initDone'});
}

// ---------------------------------------------------------------------------
// Ensure session
// ---------------------------------------------------------------------------

async function ensureSession() {
  if (session) return;
  if (!modelBuffer) throw new Error('Model not downloaded — call init first');

  // Prefer WebGPU (5-10x faster), fall back to WASM
  const provider = useWebGPU ? 'webgpu' : 'wasm';
  progress(`Loading alignment model (${provider})...`);

  try {
    session = await ort.InferenceSession.create(modelBuffer, {
      executionProviders: [provider],
      graphOptimizationLevel: 'all',
    });
    progress(`Alignment model ready (${provider})!`);
  } catch (e) {
    if (provider === 'webgpu') {
      progress('WebGPU failed, falling back to WASM...');
      session = await ort.InferenceSession.create(modelBuffer, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
      });
      progress('Alignment model ready (wasm fallback)!');
    } else {
      throw e;
    }
  }
}

// ---------------------------------------------------------------------------
// CTC emissions (chunked)
// ---------------------------------------------------------------------------

async function getEmissions(
  audio: Float32Array,
): Promise<{logProbs: Float32Array; T: number; C: number}> {
  if (!session) throw new Error('Model not loaded');

  const CHUNK_SECONDS = 30;
  const CHUNK_SAMPLES = CHUNK_SECONDS * 16000;
  const totalSamples = audio.length;
  const numChunks = Math.ceil(totalSamples / CHUNK_SAMPLES);

  const allChunks: {data: Float32Array; T: number; C: number}[] = [];

  for (let i = 0; i < numChunks; i++) {
    const start = i * CHUNK_SAMPLES;
    const end = Math.min(start + CHUNK_SAMPLES, totalSamples);
    const chunk = audio.slice(start, end);

    if (chunk.length < 8000) break;

    progress(`CTC inference: chunk ${i + 1}/${numChunks}`);

    const inputTensor = new ort.Tensor('float32', chunk, [1, chunk.length]);
    const results = await session.run({input: inputTensor});
    const output = results['output'];

    const dims = output.dims as number[];
    const T = dims[1];
    const C = dims[2];
    const data = output.data as Float32Array;

    // log_softmax
    const logProbs = new Float32Array(T * C);
    for (let t = 0; t < T; t++) {
      let maxVal = -Infinity;
      for (let c = 0; c < C; c++) maxVal = Math.max(maxVal, data[t * C + c]);
      let expSum = 0;
      for (let c = 0; c < C; c++) expSum += Math.exp(data[t * C + c] - maxVal);
      const logExpSum = Math.log(expSum) + maxVal;
      for (let c = 0; c < C; c++) {
        logProbs[t * C + c] = data[t * C + c] - logExpSum;
      }
    }

    allChunks.push({data: logProbs, T, C});
    inputTensor.dispose();
    output.dispose();
  }

  if (allChunks.length === 0) throw new Error('No audio processed');

  const C = allChunks[0].C;
  const totalT = allChunks.reduce((sum, ch) => sum + ch.T, 0);
  const logProbs = new Float32Array(totalT * C);
  let offset = 0;
  for (const ch of allChunks) {
    logProbs.set(ch.data, offset);
    offset += ch.T * C;
  }

  return {logProbs, T: totalT, C};
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AlignedWord {
  text: string;
  startMs: number;
  newLine: boolean;
}

interface AlignedSyllable {
  text: string;
  startMs: number;
  joinNext: boolean;
  newLine: boolean;
}

interface LyricLine {
  phraseStartMs: number;
  phraseEndMs: number;
  syllables: {text: string; msTime: number}[];
  text: string;
}

// ---------------------------------------------------------------------------
// Group words into display lines
// ---------------------------------------------------------------------------

/**
 * Group words into display lines.
 *
 * Primary breaks come from the user's input line breaks (newLine flag).
 * Lines are only further split if they exceed MAX_LINE_CHARS.
 */
function groupIntoLines(words: AlignedWord[]): LyricLine[] {
  if (words.length === 0) return [];

  const MAX_LINE_CHARS = 60;
  const lines: LyricLine[] = [];
  let current: AlignedWord[] = [];

  for (let i = 0; i < words.length; i++) {
    const w = words[i];

    // Break at input line boundaries
    if (w.newLine && current.length > 0) {
      flush();
    }

    // If adding this word would make the line too long, flush first
    if (current.length > 0) {
      const testLen = current.map(x => x.text).join(' ').length + 1 + w.text.length;
      if (testLen > MAX_LINE_CHARS) {
        flush();
      }
    }

    current.push(w);
  }
  flush();

  return lines;

  function flush() {
    if (current.length === 0) return;
    const syllables = current.map(w => ({text: w.text, msTime: w.startMs}));
    for (let j = 1; j < syllables.length; j++) {
      syllables[j] = {...syllables[j], text: ' ' + syllables[j].text};
    }
    const firstMs = current[0].startMs;
    const lastMs = current[current.length - 1].startMs;
    lines.push({
      phraseStartMs: firstMs,
      phraseEndMs: lastMs,
      syllables,
      text: current.map(w => w.text).join(' '),
    });
    current = [];
  }
}

// ---------------------------------------------------------------------------
// Full alignment pipeline (syllable-level)
// ---------------------------------------------------------------------------

async function handleAlign(vocals16k: Float32Array, lyrics: string) {
  const durationMs = (vocals16k.length / 16000) * 1000;
  progress(`Vocals: ${(durationMs / 1000).toFixed(1)}s`);

  // Syllabify lyrics text into structured syllables
  const syls = syllabifyLyrics(lyrics);
  progress(
    `Syllabified: ${lyrics.trim().split(/\s+/).length} words → ${syls.length} syllables`,
  );

  await ensureSession();

  // 1. CTC emissions
  progress('Running CTC model...');
  const t0 = performance.now();
  const {logProbs, T, C} = await getEmissions(vocals16k);
  const modelMs = performance.now() - t0;
  progress(
    `Emissions: ${T} frames x ${C} classes (${(modelMs / 1000).toFixed(1)}s)`,
  );

  // 2. Build character token sequence from syllables
  //    Insert | between words (where joinNext=false → next syllable starts new word)
  const sylStartPositions: number[] = [];
  const tokens: number[] = [];
  const pipeIdx = label2idx['|'];

  for (let si = 0; si < syls.length; si++) {
    // Insert | word separator before new words (except the first syllable)
    if (si > 0 && !syls[si - 1].joinNext && pipeIdx !== undefined) {
      tokens.push(pipeIdx);
    }

    sylStartPositions.push(tokens.length);

    // Tokenize this syllable's characters
    for (const ch of syls[si].text.toUpperCase()) {
      const idx = label2idx[ch];
      if (idx !== undefined) {
        tokens.push(idx);
      }
    }
  }

  if (tokens.length === 0) throw new Error('No valid tokens in syllables');
  progress(
    `Tokens: ${tokens.length} characters for ${syls.length} syllables`,
  );

  // 2.5. Compute RMS energy per frame and boost blank in quiet frames
  const SAMPLES_PER_FRAME = 320;
  const rmsEnergy = new Float32Array(T);
  for (let f = 0; f < T; f++) {
    const start = f * SAMPLES_PER_FRAME;
    const end = Math.min(start + SAMPLES_PER_FRAME, vocals16k.length);
    if (start < vocals16k.length) {
      let sumSq = 0;
      for (let s = start; s < end; s++) sumSq += vocals16k[s] * vocals16k[s];
      rmsEnergy[f] = Math.sqrt(sumSq / (end - start));
    }
  }

  // Find median RMS to set threshold
  const sortedRms = Float32Array.from(rmsEnergy).sort();
  const medianRms = sortedRms[Math.floor(sortedRms.length / 2)];
  const silenceThreshold = medianRms * 0.1;
  const silentFrames = rmsEnergy.filter(v => v < silenceThreshold).length;

  // Only apply boost if there are meaningful gaps (>2% silent frames)
  if (silentFrames > T * 0.02) {
    const BLANK_BOOST = 15;
    for (let f = 0; f < T; f++) {
      if (rmsEnergy[f] < silenceThreshold) {
        logProbs[f * C + 0] += BLANK_BOOST; // index 0 = blank
      }
    }
    progress(
      `RMS gap boost: ${silentFrames} silent frames (${((silentFrames / T) * 100).toFixed(0)}%)`,
    );
  }

  // 3. Viterbi
  progress('Running Viterbi alignment...');
  const t1 = performance.now();
  const aligned = forcedAlign(logProbs, T, C, tokens, 0);
  const viterbiMs = performance.now() - t1;
  progress(
    `Viterbi: ${aligned.length} tokens aligned (${(viterbiMs / 1000).toFixed(1)}s)`,
  );

  // 4. Extract per-syllable timestamps
  // Build token→frame lookup from aligned results (keyed by tokenPos)
  const tokenFrame = new Map<number, number>();
  for (const a of aligned) {
    tokenFrame.set(a.tokenPos, a.startFrame);
  }

  // Smooth RMS for onset detection
  const rmsSmoothed = new Float32Array(T);
  if (T > 5) {
    const kernel = [0.06, 0.24, 0.4, 0.24, 0.06];
    for (let f = 0; f < T; f++) {
      let sum = 0;
      for (let k = 0; k < 5; k++) {
        const idx = f - 2 + k;
        if (idx >= 0 && idx < T) sum += rmsEnergy[idx] * kernel[k];
      }
      rmsSmoothed[f] = sum;
    }
  } else {
    rmsSmoothed.set(rmsEnergy);
  }

  const alignedSyls: AlignedSyllable[] = [];
  for (let si = 0; si < syls.length; si++) {
    const pos = sylStartPositions[si];
    const frame = tokenFrame.get(pos);
    if (frame !== undefined) {
      // Onset refinement: snap to steepest RMS rise within ±4 frames
      let bestFrame = frame;
      let bestRise = 0;
      for (let f = Math.max(1, frame - 4); f < Math.min(T, frame + 5); f++) {
        const rise = rmsSmoothed[f] - rmsSmoothed[f - 1];
        if (rise > bestRise) {
          bestRise = rise;
          bestFrame = f;
        }
      }
      const ms = (bestFrame / T) * durationMs;
      alignedSyls.push({
        text: syls[si].text,
        startMs: ms,
        joinNext: syls[si].joinNext,
        newLine: syls[si].newLine,
      });
    } else if (alignedSyls.length > 0) {
      alignedSyls.push({
        text: syls[si].text,
        startMs: alignedSyls[alignedSyls.length - 1].startMs,
        joinNext: syls[si].joinNext,
        newLine: syls[si].newLine,
      });
    }
  }

  // Enforce monotonicity
  for (let i = 1; i < alignedSyls.length; i++) {
    if (alignedSyls[i].startMs < alignedSyls[i - 1].startMs) {
      alignedSyls[i].startMs = alignedSyls[i - 1].startMs;
    }
  }

  // 5. Build words from syllables and track which belong to each word
  const words: AlignedWord[] = [];
  const wordSylRanges: [number, number][] = []; // [startSylIdx, endSylIdx) per word
  let wordText = '';
  let wordStartMs = 0;
  let wordStartSyl = 0;
  let wordNewLine = false;
  for (let si = 0; si < alignedSyls.length; si++) {
    if (wordText === '') {
      wordStartMs = alignedSyls[si].startMs;
      wordStartSyl = si;
      wordNewLine = alignedSyls[si].newLine;
    }
    wordText += alignedSyls[si].text;
    if (!alignedSyls[si].joinNext) {
      words.push({text: wordText, startMs: wordStartMs, newLine: wordNewLine});
      wordSylRanges.push([wordStartSyl, si + 1]);
      wordText = '';
    }
  }
  if (wordText) {
    words.push({text: wordText, startMs: wordStartMs, newLine: wordNewLine});
    wordSylRanges.push([wordStartSyl, alignedSyls.length]);
  }

  // Group words into display lines
  const lines = groupIntoLines(words);

  // Replace word-level syllables in each line with actual syllable-level data.
  // groupIntoLines produces lines with word-level syllables — replace them.
  let wordIdx = 0;
  for (const line of lines) {
    const lineSyls: {text: string; msTime: number}[] = [];
    const lineWordCount = line.syllables.length; // each "syllable" from groupIntoLines is a word
    for (let w = 0; w < lineWordCount && wordIdx < words.length; w++, wordIdx++) {
      const [ss, se] = wordSylRanges[wordIdx];
      for (let si = ss; si < se; si++) {
        // Add space before first syllable of non-first words
        const prefix = lineSyls.length > 0 && si === ss ? ' ' : '';
        lineSyls.push({
          text: prefix + alignedSyls[si].text,
          msTime: alignedSyls[si].startMs,
        });
      }
    }
    line.syllables = lineSyls;
    line.text = lineSyls.map(s => s.text).join('');
  }

  progress(
    `Done: ${alignedSyls.length} syllables, ${lines.length} lines`,
  );

  post({type: 'result', lines, words, syllables: alignedSyls, durationMs});
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

self.onmessage = async (e: MessageEvent) => {
  try {
    if (e.data.type === 'init') {
      await handleInit();
    } else if (e.data.type === 'align') {
      await handleAlign(e.data.vocals16k, e.data.lyrics);
    }
  } catch (err: any) {
    post({type: 'error', message: err.message ?? String(err)});
  }
};
