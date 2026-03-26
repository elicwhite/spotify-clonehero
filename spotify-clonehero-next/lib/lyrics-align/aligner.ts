/**
 * Browser-based vocal alignment engine.
 *
 * Uses wav2vec2-base-960h (95MB quantized, character-level CTC).
 * Pipeline:
 * 1. Load audio → resample to 16kHz mono (Web Audio API)
 * 2. Run ONNX model → CTC emissions (ONNX Runtime Web)
 * 3. Tokenize text → character token sequence
 * 4. Viterbi forced alignment → per-character frame positions
 * 5. Map character timestamps to words/syllables
 *
 * Supports two modes:
 * - Word-level: plain text lyrics → word timestamps
 * - Syllable-level: structured {text, joinNext}[] → per-syllable timestamps
 *   (joinNext=true means this syllable continues into the next to form a word)
 *
 * Ported from ~/projects/vocal-alignment/browser-aligner/src/aligner.ts
 */

import * as ort from 'onnxruntime-web';
import {forcedAlign} from './viterbi';
import {getCachedModel} from './model-cache';
import type {LyricLine} from '@/lib/karaoke/parse-lyrics';

export interface AlignedWord {
  text: string;
  startMs: number;
}

export interface InputSyllable {
  text: string;
  joinNext: boolean;
}

export interface AlignedSyllable {
  text: string;
  startMs: number;
  joinNext: boolean;
}

// WASM path for onnxruntime-web — load from CDN so we don't need to
// bundle the ~20MB WASM files with Next.js.
const ORT_WASM_CDN =
  'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.3/dist/';

let session: ort.InferenceSession | null = null;
let vocab: string[] = [];
let label2idx: Record<string, number> = {};
let modelBuffer: ArrayBuffer | null = null;

/**
 * Phase 1: Download and cache the model + load vocabulary.
 * Does NOT create the ONNX session (to save memory for demucs).
 */
export async function init(
  onProgress?: (msg: string) => void,
): Promise<void> {
  const log = onProgress ?? console.log;

  ort.env.wasm.wasmPaths = ORT_WASM_CDN;
  ort.env.wasm.numThreads = 1;

  log('Loading vocabulary...');
  const vocabResp = await fetch('/models/vocab-base.json');
  vocab = await vocabResp.json();
  label2idx = {};
  for (let i = 0; i < vocab.length; i++) {
    if (vocab[i]) label2idx[vocab[i]] = i;
  }

  log('Downloading alignment model (91 MB)...');
  modelBuffer = await getCachedModel(
    '/models/wav2vec2-base-960h-quantized.onnx',
    'wav2vec2-base-960h-quantized.onnx',
    log,
  );
  log('Model cached — will load when needed');
}

/**
 * Phase 2: Create the ONNX session. Call this AFTER demucs is released
 * to avoid two large models in WASM memory simultaneously.
 */
export async function ensureSession(
  onProgress?: (msg: string) => void,
): Promise<void> {
  if (session) return;
  if (!modelBuffer)
    throw new Error('Model not downloaded — call init() first');
  const log = onProgress ?? console.log;
  log('Loading alignment model into WASM...');
  session = await ort.InferenceSession.create(modelBuffer, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  });
  log('Alignment model ready!');
}

/**
 * Run wav2vec2 model on audio in 30s chunks to avoid WASM OOM.
 */
async function getEmissions(
  audio: Float32Array,
  onProgress?: (msg: string) => void,
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

    if (chunk.length < 8000) break; // skip tiny tail

    onProgress?.(`CTC inference: chunk ${i + 1}/${numChunks}`);

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

  // Concatenate all chunks
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

/**
 * Tokenize text to character indices.
 * The base model uses uppercase A-Z, |, ' with <pad>=0 as blank.
 */
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

/**
 * Group aligned words into karaoke display lines.
 * Returns LyricLine[] compatible with the existing karaoke viewer.
 */
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
    const syllables = current.map(w => ({
      text: w.text,
      msTime: w.startMs,
    }));
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

/**
 * Align lyrics to pre-separated vocals (16kHz mono Float32Array).
 */
export async function alignVocals(
  vocals16k: Float32Array,
  lyrics: string,
  onProgress?: (msg: string) => void,
): Promise<{
  lines: LyricLine[];
  words: AlignedWord[];
  durationMs: number;
}> {
  const log = onProgress ?? console.log;
  const audio = vocals16k;
  const durationMs = (audio.length / 16000) * 1000;
  log(`Vocals: ${(durationMs / 1000).toFixed(1)}s`);

  // Ensure ONNX session is loaded (deferred from init)
  await ensureSession(log);

  // Run model (chunked to avoid WASM OOM)
  log('Running CTC model...');
  const t0 = performance.now();
  const {logProbs, T, C} = await getEmissions(audio, log);
  const modelMs = performance.now() - t0;
  log(
    `Emissions: ${T} frames x ${C} classes (${(modelMs / 1000).toFixed(1)}s)`,
  );

  // Tokenize — character-level (A-Z, |, ')
  const words = lyrics.trim().split(/\s+/).filter(Boolean);
  const text = words.join(' ');
  const {tokens} = tokenize(text);

  if (tokens.length === 0) throw new Error('No valid tokens in lyrics');
  log(`Tokens: ${tokens.length} characters for ${words.length} words`);

  // Track word start positions in the character sequence
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
  log('Running Viterbi alignment...');
  const t1 = performance.now();
  const aligned = forcedAlign(logProbs, T, C, tokens, 0);
  const viterbiMs = performance.now() - t1;
  log(
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
  log(
    `Done: ${alignedWords.length} words, ${lines.length} lines (model: ${(modelMs / 1000).toFixed(1)}s, viterbi: ${(viterbiMs / 1000).toFixed(1)}s)`,
  );

  return {lines, words: alignedWords, durationMs};
}

/**
 * Align structured syllable lyrics to pre-separated vocals.
 *
 * This is the syllable-level equivalent of alignVocals. Instead of plain text,
 * it takes an array of {text, joinNext} syllables and returns per-syllable
 * timestamps. joinNext=true means this syllable and the next form part of the
 * same word (no | separator between them).
 */
export async function alignSyllables(
  vocals16k: Float32Array,
  syllables: InputSyllable[],
  onProgress?: (msg: string) => void,
): Promise<{
  syllables: AlignedSyllable[];
  lines: LyricLine[];
  durationMs: number;
}> {
  const log = onProgress ?? console.log;
  const durationMs = (vocals16k.length / 16000) * 1000;
  log(`Vocals: ${(durationMs / 1000).toFixed(1)}s`);

  await ensureSession(log);

  // 1. Run model (chunked)
  log('Running CTC model...');
  const t0 = performance.now();
  const {logProbs, T, C} = await getEmissions(vocals16k, log);
  const modelMs = performance.now() - t0;
  log(
    `Emissions: ${T} frames x ${C} classes (${(modelMs / 1000).toFixed(1)}s)`,
  );

  // 2. Build character token sequence from syllables
  //    Insert | between words (where joinNext=false → next syllable starts new word)
  const sylStartPositions: number[] = [];
  const tokens: number[] = [];
  const pipeIdx = label2idx['|'];

  for (let si = 0; si < syllables.length; si++) {
    if (si > 0 && !syllables[si - 1].joinNext && pipeIdx !== undefined) {
      tokens.push(pipeIdx);
    }

    sylStartPositions.push(tokens.length);

    for (const ch of syllables[si].text.toUpperCase()) {
      const idx = label2idx[ch];
      if (idx !== undefined) {
        tokens.push(idx);
      }
    }
  }

  if (tokens.length === 0) throw new Error('No valid tokens in syllables');
  log(
    `Tokens: ${tokens.length} characters for ${syllables.length} syllables`,
  );

  // 3. Viterbi
  log('Running Viterbi alignment...');
  const t1 = performance.now();
  const aligned = forcedAlign(logProbs, T, C, tokens, 0);
  const viterbiMs = performance.now() - t1;
  log(
    `Viterbi: ${aligned.length} tokens aligned (${(viterbiMs / 1000).toFixed(1)}s)`,
  );

  // 4. Extract per-syllable timestamps
  const alignedSyls: AlignedSyllable[] = [];
  for (let si = 0; si < syllables.length; si++) {
    const pos = sylStartPositions[si];
    if (pos < aligned.length) {
      const ms = (aligned[pos].startFrame / T) * durationMs;
      alignedSyls.push({
        text: syllables[si].text,
        startMs: ms,
        joinNext: syllables[si].joinNext,
      });
    } else if (alignedSyls.length > 0) {
      alignedSyls.push({
        text: syllables[si].text,
        startMs: alignedSyls[alignedSyls.length - 1].startMs,
        joinNext: syllables[si].joinNext,
      });
    }
  }

  // Enforce monotonicity
  for (let i = 1; i < alignedSyls.length; i++) {
    if (alignedSyls[i].startMs < alignedSyls[i - 1].startMs) {
      alignedSyls[i].startMs = alignedSyls[i - 1].startMs;
    }
  }

  // 5. Build words from syllables and group into display lines
  const words: AlignedWord[] = [];
  const wordSylRanges: [number, number][] = [];
  let wordText = '';
  let wordStartMs = 0;
  let wordStartSyl = 0;
  for (let si = 0; si < alignedSyls.length; si++) {
    if (wordText === '') {
      wordStartMs = alignedSyls[si].startMs;
      wordStartSyl = si;
    }
    wordText += alignedSyls[si].text;
    if (!alignedSyls[si].joinNext) {
      words.push({text: wordText, startMs: wordStartMs});
      wordSylRanges.push([wordStartSyl, si + 1]);
      wordText = '';
    }
  }
  if (wordText) {
    words.push({text: wordText, startMs: wordStartMs});
    wordSylRanges.push([wordStartSyl, alignedSyls.length]);
  }

  const lines = groupIntoLines(words);

  // Replace word-level syllables with actual syllable-level data
  let wordIdx = 0;
  for (const line of lines) {
    const lineSyls: {text: string; msTime: number}[] = [];
    const lineWordCount = line.syllables.length;
    for (
      let w = 0;
      w < lineWordCount && wordIdx < words.length;
      w++, wordIdx++
    ) {
      const [ss, se] = wordSylRanges[wordIdx];
      for (let si = ss; si < se; si++) {
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

  log(
    `Done: ${alignedSyls.length} syllables, ${lines.length} lines (model: ${(modelMs / 1000).toFixed(1)}s, viterbi: ${(viterbiMs / 1000).toFixed(1)}s)`,
  );

  return {syllables: alignedSyls, lines, durationMs};
}
