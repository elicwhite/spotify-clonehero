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
import {wav2vecFrames} from './frames';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ORT_WASM_CDN =
  'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.3/dist/';

const VOCAB: string[] = [
  '<pad>',
  '<s>',
  '</s>',
  '<unk>',
  '|',
  'E',
  'T',
  'A',
  'O',
  'N',
  'I',
  'H',
  'S',
  'R',
  'D',
  'L',
  'U',
  'M',
  'W',
  'C',
  'F',
  'G',
  'Y',
  'P',
  'B',
  'V',
  'K',
  "'",
  'X',
  'J',
  'Q',
  'Z',
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

type OutboundMessage =
  | {type: 'progress'; message: string}
  | {type: 'initDone'}
  | {
      type: 'result';
      lines: LyricLine[];
      words: AlignedWord[];
      syllables: AlignedSyllable[];
      durationMs: number;
      /** Fraction of syllables with mean Viterbi score < -3. Drives the
       *  internal tier-2 Demucs-retry decision; never user-visible. */
      lowConfidenceFrac: number;
      /** True when `lowConfidenceFrac` >= 0.75 — catastrophic alignment.
       *  Used internally to escalate to tier-2; not shown to the user. */
      lowConfidence: boolean;
    }
  | {type: 'error'; message: string};

function post(msg: OutboundMessage) {
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
// CTC emissions
// ---------------------------------------------------------------------------

/** Single forward pass over `audio`, returning log-softmax emissions. */
async function runForward(
  audio: Float32Array,
): Promise<{logProbs: Float32Array; T: number; C: number}> {
  if (!session) throw new Error('Model not loaded');

  const inputTensor = new ort.Tensor('float32', audio, [1, audio.length]);
  let results: ort.InferenceSession.OnnxValueMapType;
  try {
    results = await session.run({input: inputTensor});
  } finally {
    inputTensor.dispose();
  }
  const output = results['output'];

  const dims = output.dims as number[];
  const T = dims[1];
  const C = dims[2];
  const data = output.data as Float32Array;

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

  output.dispose();
  return {logProbs, T, C};
}

/**
 * Forward in 60 s chunks with 10 s overlap, averaging emissions in
 * overlapped frames. Each frame ends up scored by the chunk in which
 * it is closest to the center, where wav2vec2's truncated self-attention
 * has the strongest language-prior context.
 *
 * Empirically (autoresearch-phrase, n=200 Harmonix songs):
 *   chunked-30s no overlap : syl_med 61.3 ms, ps_p90 581 ms
 *   chunked-60s no overlap : syl_med 45.4 ms, ps_p90 566 ms
 *   chunked-60s 10 s overlap: syl_med 19.2 ms, ps_p90 549 ms (= single-pass)
 *
 * Memory: 60 s × 16 kHz → 3 000 wav2vec2 frames → attention scores
 * tensor [1, 12, 3000, 3000] × 4 bytes ≈ 432 MB peak. Comfortable
 * within typical 1 GB browser GPU budgets.
 */
async function runChunked(
  audio: Float32Array,
): Promise<{logProbs: Float32Array; T: number; C: number}> {
  const SAMPLE_RATE = 16000;
  const SAMPLES_PER_FRAME = 320; // wav2vec2 outputs 50 fps
  const CHUNK_SAMPLES = 60 * SAMPLE_RATE;
  const OVERLAP_SAMPLES = 10 * SAMPLE_RATE;
  const STRIDE_SAMPLES = CHUNK_SAMPLES - OVERLAP_SAMPLES;
  const MIN_TAIL_SAMPLES = 8000;

  type Chunk = {sampleStart: number; logProbs: Float32Array; T: number};
  const chunks: Chunk[] = [];
  let start = 0;
  // Estimate total chunks for progress display
  const estChunks = Math.max(
    1,
    Math.ceil((audio.length - OVERLAP_SAMPLES) / STRIDE_SAMPLES),
  );
  while (true) {
    const end = Math.min(start + CHUNK_SAMPLES, audio.length);
    if (end - start < MIN_TAIL_SAMPLES) break;
    const chunk = audio.slice(start, end);
    progress(`CTC inference: chunk ${chunks.length + 1}/${estChunks}`);

    // onnxruntime-web's WebGPU EP specializes the attention Reshape to the
    // first run's sequence length and fails on any later run with a
    // different length on the same (singleton) session — e.g. the shorter
    // tail chunk, or a second alignment pass on different-length vocals.
    // Pad every WebGPU run to a fixed CHUNK_SAMPLES so each session.run
    // sees an identical shape; the silent padded frames are trimmed off.
    const realFrames = wav2vecFrames(chunk.length);
    let fwdInput = chunk;
    if (useWebGPU && chunk.length < CHUNK_SAMPLES) {
      fwdInput = new Float32Array(CHUNK_SAMPLES);
      fwdInput.set(chunk);
    }
    const fwd = await runForward(fwdInput);
    const C = fwd.logProbs.length / fwd.T;
    const T = Math.min(fwd.T, realFrames);
    const logProbs =
      T === fwd.T ? fwd.logProbs : fwd.logProbs.slice(0, T * C);
    chunks.push({sampleStart: start, logProbs, T});
    if (end >= audio.length) break;
    start += STRIDE_SAMPLES;
  }

  if (chunks.length === 0) throw new Error('No audio processed');

  const C = chunks[0].logProbs.length / chunks[0].T;
  // Determine global frame range covered by any chunk.
  let totalT = 0;
  for (const ch of chunks) {
    const frameStart = Math.floor(ch.sampleStart / SAMPLES_PER_FRAME);
    const frameEnd = frameStart + ch.T;
    if (frameEnd > totalT) totalT = frameEnd;
  }

  // Sum + count per frame, then divide. Single combined buffer keeps
  // memory at ~totalT * C * 4 bytes (~1.5 MB for a 6 min song).
  const logProbs = new Float32Array(totalT * C);
  const counts = new Float32Array(totalT);
  for (const ch of chunks) {
    const frameStart = Math.floor(ch.sampleStart / SAMPLES_PER_FRAME);
    for (let t = 0; t < ch.T; t++) {
      const dstFrame = frameStart + t;
      if (dstFrame >= totalT) break;
      counts[dstFrame] += 1;
      const dstOff = dstFrame * C;
      const srcOff = t * C;
      for (let c = 0; c < C; c++) {
        logProbs[dstOff + c] += ch.logProbs[srcOff + c];
      }
    }
  }
  for (let t = 0; t < totalT; t++) {
    const cnt = counts[t];
    if (cnt <= 1) continue;
    const off = t * C;
    for (let c = 0; c < C; c++) logProbs[off + c] /= cnt;
  }

  return {logProbs, T: totalT, C};
}

/**
 * CTC emissions over the full song.
 *
 * Routing:
 *   WebGPU → 60 s chunks with 10 s overlap-and-average. The attention
 *     scores tensor [1, 12, T, T] would blow out maxBufferSize for a
 *     full-song forward, but a 60 s window stays around 432 MB peak
 *     and overlap-and-average recovers single-pass quality (autoresearch
 *     n=200: syl_med 19.2 ms, identical to single-pass).
 *   WASM → single-pass. CPU heap fits a full forward and matches the
 *     autoresearch reference. Falls back to chunked on any failure.
 */
async function getEmissions(
  audio: Float32Array,
): Promise<{logProbs: Float32Array; T: number; C: number}> {
  if (!session) throw new Error('Model not loaded');
  if (audio.length < 8000) throw new Error('No audio processed');

  if (useWebGPU) return runChunked(audio);

  const seconds = audio.length / 16000;
  progress(`CTC inference: full song (${seconds.toFixed(1)}s, single-pass)`);
  try {
    return await runForward(audio);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    progress(
      `Full-song forward failed (${msg.slice(0, 120)}) — falling back to 60s overlapping chunks`,
    );
    return runChunked(audio);
  }
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
  /** Viterbi END frame of the syllable's last char, in ms (no refinement). */
  endMs: number;
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
      const testLen =
        current.map(x => x.text).join(' ').length + 1 + w.text.length;
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
  const sylEndPositions: number[] = [];
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

    sylEndPositions.push(tokens.length);
  }

  if (tokens.length === 0) throw new Error('No valid tokens in syllables');
  progress(`Tokens: ${tokens.length} characters for ${syls.length} syllables`);

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
  const tokenStartFrame = new Map<number, number>();
  const tokenEndFrame = new Map<number, number>();
  const tokenScore = new Map<number, number>();
  for (const a of aligned) {
    tokenStartFrame.set(a.tokenPos, a.startFrame);
    tokenEndFrame.set(a.tokenPos, a.endFrame);
    tokenScore.set(a.tokenPos, a.score);
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
    const startPos = sylStartPositions[si];
    const endPos = sylEndPositions[si] - 1; // last char of this syllable
    const startFrame = tokenStartFrame.get(startPos);
    const endFrameRaw =
      endPos >= startPos ? tokenEndFrame.get(endPos) : undefined;

    if (startFrame !== undefined) {
      // Onset refinement: snap to steepest RMS rise within ±4 frames
      let bestFrame = startFrame;
      let bestRise = 0;
      for (
        let f = Math.max(1, startFrame - 4);
        f < Math.min(T, startFrame + 5);
        f++
      ) {
        const rise = rmsSmoothed[f] - rmsSmoothed[f - 1];
        if (rise > bestRise) {
          bestRise = rise;
          bestFrame = f;
        }
      }
      const startMs = (bestFrame / T) * durationMs;
      const endMs =
        endFrameRaw !== undefined ? (endFrameRaw / T) * durationMs : startMs;
      alignedSyls.push({
        text: syls[si].text,
        startMs,
        endMs,
        joinNext: syls[si].joinNext,
        newLine: syls[si].newLine,
      });
    } else if (alignedSyls.length > 0) {
      const prev = alignedSyls[alignedSyls.length - 1];
      alignedSyls.push({
        text: syls[si].text,
        startMs: prev.startMs,
        endMs: prev.endMs,
        joinNext: syls[si].joinNext,
        newLine: syls[si].newLine,
      });
    }
  }

  // Enforce monotonicity (start and end)
  for (let i = 1; i < alignedSyls.length; i++) {
    if (alignedSyls[i].startMs < alignedSyls[i - 1].startMs) {
      alignedSyls[i].startMs = alignedSyls[i - 1].startMs;
    }
    if (alignedSyls[i].endMs < alignedSyls[i].startMs) {
      alignedSyls[i].endMs = alignedSyls[i].startMs;
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

  // Aggregate Viterbi confidence per syllable. A syllable's confidence is the
  // mean score across its character tokens; we count the fraction below -3.
  let lowSylCount = 0;
  let scoredSylCount = 0;
  for (let si = 0; si < syls.length; si++) {
    const startPos = sylStartPositions[si];
    const endPos = sylEndPositions[si];
    let sum = 0;
    let count = 0;
    for (let p = startPos; p < endPos; p++) {
      const s = tokenScore.get(p);
      if (s !== undefined) {
        sum += s;
        count++;
      }
    }
    if (count > 0) {
      if (sum / count < -3) lowSylCount++;
      scoredSylCount++;
    }
  }
  const lowConfidenceFrac =
    scoredSylCount > 0 ? lowSylCount / scoredSylCount : 0;

  // Drives the internal tier-2 Demucs-retry; never user-visible. 0.75
  // calibrated on n=344 non-Harmonix charts.
  const lowConfidence = lowConfidenceFrac >= 0.75;

  // Group words into display lines
  const lines = groupIntoLines(words);

  // Replace word-level syllables in each line with actual syllable-level data.
  // groupIntoLines produces lines with word-level syllables — replace them.
  let wordIdx = 0;
  for (const line of lines) {
    const lineSyls: {text: string; msTime: number}[] = [];
    const lineWordCount = line.syllables.length; // each "syllable" from groupIntoLines is a word
    for (
      let w = 0;
      w < lineWordCount && wordIdx < words.length;
      w++, wordIdx++
    ) {
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

  progress(`Done: ${alignedSyls.length} syllables, ${lines.length} lines`);

  post({
    type: 'result',
    lines,
    words,
    syllables: alignedSyls,
    durationMs,
    lowConfidenceFrac,
    lowConfidence,
  });
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
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    post({type: 'error', message});
  }
};
