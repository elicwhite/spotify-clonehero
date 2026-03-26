/**
 * Web Worker that runs wav2vec2 CTC alignment off the main thread.
 *
 * Session creation and inference block for seconds — running them here
 * keeps the UI responsive.
 *
 * Messages:
 *   IN:  { type: "init" }
 *   OUT: { type: "progress", message: string }
 *   OUT: { type: "initDone" }
 *
 *   IN:  { type: "align", vocals16k: Float32Array, lyrics: string }
 *   OUT: { type: "progress", message: string }
 *   OUT: { type: "result", lines, words, durationMs }
 *
 *   OUT: { type: "error", message: string }
 */

import * as ort from 'onnxruntime-web';
import {forcedAlign} from './viterbi';
import {getCachedModel} from './model-cache';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ORT_WASM_CDN =
  'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.3/dist/';

const WAV2VEC2_MODEL_URL =
  'https://huggingface.co/onnx-community/wav2vec2-base-960h-ONNX/resolve/main/onnx/model_quantized.onnx';

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
let inputName = 'input';
let outputName = 'output';
const label2idx: Record<string, number> = {};
let modelBuffer: ArrayBuffer | null = null;

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

async function handleInit() {
  ort.env.wasm.wasmPaths = ORT_WASM_CDN;
  ort.env.wasm.numThreads = 1;

  progress('Downloading alignment model (91 MB)...');
  modelBuffer = await getCachedModel(
    WAV2VEC2_MODEL_URL,
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
  progress('Loading alignment model into WASM...');
  session = await ort.InferenceSession.create(modelBuffer, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  });
  inputName = session.inputNames[0] ?? 'input';
  outputName = session.outputNames[0] ?? 'output';
  progress(`Alignment model ready! (I/O: ${inputName} → ${outputName})`);
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
    const results = await session.run({[inputName]: inputTensor});
    const output = results[outputName];

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
// Tokenize
// ---------------------------------------------------------------------------

function tokenize(text: string): {tokens: number[]; chars: string[]} {
  const upper = text.toUpperCase().replace(/\s+/g, '|');
  const tokens: number[] = [];
  const chars: string[] = [];
  for (const ch of upper) {
    const idx = label2idx[ch];
    if (idx !== undefined) {
      tokens.push(idx);
      chars.push(ch);
    }
  }
  return {tokens, chars};
}

// ---------------------------------------------------------------------------
// Full alignment pipeline
// ---------------------------------------------------------------------------

interface AlignedWord {
  text: string;
  startMs: number;
}

interface LyricLine {
  startMs: number;
  endMs: number;
  syllables: {text: string; msTime: number}[];
  text: string;
}

function groupIntoLines(words: AlignedWord[]): LyricLine[] {
  if (words.length === 0) return [];

  const lines: LyricLine[] = [];
  let current: AlignedWord[] = [];
  let lineStartTime = 0;

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (current.length === 0) lineStartTime = w.startMs;
    current.push(w);

    const nextTime = i < words.length - 1 ? words[i + 1].startMs : Infinity;
    const gapToNext = nextTime - w.startMs;

    if (gapToNext > 2000) {
      flush();
    } else {
      const charLen = current.map(x => x.text).join(' ').length;
      const lineAge = w.startMs - lineStartTime;
      if (
        (charLen >= 40 && gapToNext > 490) ||
        (lineAge > 4500 && gapToNext > 650)
      ) {
        flush();
      }
    }
  }
  flush();

  for (let i = 0; i < lines.length; i++) {
    lines[i].endMs =
      i < lines.length - 1 ? lines[i + 1].startMs : lines[i].startMs + 2000;
  }

  return lines;

  function flush() {
    if (current.length === 0) return;
    const syllables = current.map(w => ({text: w.text, msTime: w.startMs}));
    for (let j = 1; j < syllables.length; j++) {
      syllables[j] = {...syllables[j], text: ' ' + syllables[j].text};
    }
    lines.push({
      startMs: current[0].startMs,
      endMs: 0,
      syllables,
      text: current.map(w => w.text).join(' '),
    });
    current = [];
  }
}

async function handleAlign(vocals16k: Float32Array, lyrics: string) {
  const durationMs = (vocals16k.length / 16000) * 1000;
  progress(`Vocals: ${(durationMs / 1000).toFixed(1)}s`);

  await ensureSession();

  // CTC emissions
  progress('Running CTC model...');
  const t0 = performance.now();
  const {logProbs, T, C} = await getEmissions(vocals16k);
  const modelMs = performance.now() - t0;
  progress(
    `Emissions: ${T} frames x ${C} classes (${(modelMs / 1000).toFixed(1)}s)`,
  );

  // Tokenize
  const words = lyrics.trim().split(/\s+/).filter(Boolean);
  const text = words.join(' ');
  const {tokens} = tokenize(text);

  if (tokens.length === 0) throw new Error('No valid tokens in lyrics');
  progress(`Tokens: ${tokens.length} characters for ${words.length} words`);

  // Word start positions
  const wordStartPositions: number[] = [];
  let charIdx = 0;
  for (let wi = 0; wi < words.length; wi++) {
    wordStartPositions.push(charIdx);
    for (const ch of words[wi].toUpperCase()) {
      if (label2idx[ch] !== undefined) charIdx++;
    }
    if (wi < words.length - 1 && label2idx['|'] !== undefined) {
      charIdx++;
    }
  }

  // Viterbi
  progress('Running Viterbi alignment...');
  const t1 = performance.now();
  const aligned = forcedAlign(logProbs, T, C, tokens, 0);
  const viterbiMs = performance.now() - t1;
  progress(
    `Viterbi: ${aligned.length} tokens aligned (${(viterbiMs / 1000).toFixed(1)}s)`,
  );

  // Extract word timestamps
  const alignedWords: AlignedWord[] = [];
  for (let i = 0; i < words.length; i++) {
    const pos = wordStartPositions[i];
    if (pos < aligned.length) {
      const ms = (aligned[pos].startFrame / T) * durationMs;
      alignedWords.push({text: words[i], startMs: ms});
    } else if (alignedWords.length > 0) {
      alignedWords.push({
        text: words[i],
        startMs: alignedWords[alignedWords.length - 1].startMs,
      });
    }
  }

  // Enforce monotonicity
  for (let i = 1; i < alignedWords.length; i++) {
    if (alignedWords[i].startMs < alignedWords[i - 1].startMs) {
      alignedWords[i].startMs = alignedWords[i - 1].startMs;
    }
  }

  // Group into lines
  const lines = groupIntoLines(alignedWords);
  progress(
    `Done: ${alignedWords.length} words, ${lines.length} lines (model: ${(modelMs / 1000).toFixed(1)}s, viterbi: ${(viterbiMs / 1000).toFixed(1)}s)`,
  );

  post({type: 'result', lines, words: alignedWords, durationMs});
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
