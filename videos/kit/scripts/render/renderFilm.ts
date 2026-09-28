/**
 * Renders a film's picture, muted, in chunks: the film is bundled once, each
 * chunk (a frame range, ideally a scene) is rendered on its own with retries
 * and a long timeout, so one render timeout under load costs a chunk and not
 * the film, and the chunks are joined losslessly with ffmpeg's concat
 * demuxer. With --scale 2 every frame renders at twice the size (Chrome
 * rasterizes text and the WebGL highway at twice the density) and each
 * chunk's encoder scales the PNG frames back down with lanczos before its
 * one lossy encode, so the film is a single generation at any scale.
 *
 *   node --import tsx scripts/render/renderFilm.ts --entry <film/src/index.ts> \
 *     --composition <id> --out <picture.mp4> [--chunks 0-749,750-1424,...] \
 *     [--chunk-size <frames>] [--range <from-to>] [--scale 2] [--crf 12] \
 *     [--concurrency 3] [--retries 2] [--timeout-ms 300000] \
 *     [--offthread-cache-bytes <n>] [--work <dir>] [--resume] [--keep-chunks] \
 *     [--film <dir>] [--props <json>] \
 *     [--browser <chrome>]
 *
 * The output is H.264 in BT.709 limited range, the input the delivery step
 * (deliver.ts) retags and muxes. A chunk that fails is tried again up to
 * --retries more times. Chunks go to --work (default: <out>.chunks), each
 * written under a temporary name and renamed when complete, with a
 * render.json of the settings; the tool only ever deletes those files, and
 * the folder when that leaves it empty. --resume reuses the complete chunks
 * of an earlier run with the same settings (it refuses others; it cannot see
 * code changes, so use it only to finish a run that failed).
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  renderMedia,
  selectComposition,
  type FfmpegOverrideFn,
} from '@remotion/renderer';
import {productAppChromiumOptions} from '../../src/config/index';
import {
  UsageError,
  frameRange,
  int,
  isMain,
  need,
  parseFlags,
  positive,
  runCli,
} from '../lib/cli';
import {produceAtomic, withScratchDir, writeFileAtomic} from '../lib/files';
import {countFrames, probeVideo} from '../lib/media';
import {ffmpeg} from '../lib/proc';
import {
  FILM_FLAGS,
  FILM_USAGE,
  browserOf,
  bundleFilm,
  disposeBundle,
  inputPropsOf,
} from '../lib/remotion';

export type Chunk = readonly [from: number, to: number];

/**
 * The chunks covering [from, to]: the listed ones (which must tile the range
 * in order), or `size`-frame slices, or the whole range.
 */
export function planChunks(
  range: Chunk,
  listed: readonly Chunk[] | null,
  size: number | null,
): Chunk[] {
  const [from, to] = range;
  if (listed) {
    let expect = from;
    for (const [a, b] of listed) {
      if (a !== expect || b < a) {
        throw new UsageError(
          `--chunks must tile ${from}-${to} in order with no gaps: ${a}-${b} should start at ${expect}`,
        );
      }
      expect = b + 1;
    }
    if (expect !== to + 1)
      throw new UsageError(`--chunks end at ${expect - 1}, not ${to}`);
    return [...listed];
  }
  if (!size) return [[from, to]];
  const out: Chunk[] = [];
  for (let a = from; a <= to; a += size)
    out.push([a, Math.min(to, a + size - 1)]);
  return out;
}

/** What a folder of chunks was rendered with (its render.json). */
interface ChunkSettings {
  composition: string;
  width: number;
  height: number;
  fps: number;
  scale: number;
  crf: number;
  props: Record<string, unknown>;
  chunks: Chunk[];
}

const MANIFEST = 'render.json';
const isChunkFile = (name: string) =>
  name === MANIFEST || /^\.?chunk-\d+-\d+\..*mp4$/.test(name);

/** Deletes the files this tool wrote in `work` (and `work`, if that empties it). */
function clearWork(work: string, removeDir: boolean): void {
  if (!fs.existsSync(work)) return;
  for (const name of fs.readdirSync(work)) {
    if (isChunkFile(name)) fs.rmSync(path.join(work, name), {force: true});
  }
  if (removeDir && fs.readdirSync(work).length === 0) fs.rmdirSync(work);
}

/**
 * Readies the chunk folder: a fresh run clears its old chunks; a resumed
 * run checks that they were rendered with these settings.
 */
function prepareWork(
  work: string,
  settings: ChunkSettings,
  resume: boolean,
): void {
  const manifest = path.join(work, MANIFEST);
  if (resume && fs.existsSync(manifest)) {
    const before = fs.readFileSync(manifest, 'utf8');
    if (before !== JSON.stringify(settings)) {
      throw new UsageError(
        `the chunks in ${work} were rendered with other settings (${before}); run without --resume`,
      );
    }
    return;
  }
  if (resume && fs.existsSync(work) && fs.readdirSync(work).some(isChunkFile)) {
    throw new UsageError(
      `${work} has chunks but no ${MANIFEST}; run without --resume`,
    );
  }
  clearWork(work, false);
  writeFileAtomic(manifest, JSON.stringify(settings));
}

/**
 * Remotion's encode of a supersampled chunk, changed to scale the frames down
 * to `width` x `height` as it converts them: its BT.709 conversion filter
 * (`-vf zscale=...`) also resizes, with lanczos. The PNG frames are its only
 * input, so the chunk is one lossy generation at the composition's size. The
 * stream copy that follows the encode is left alone.
 */
export function downscaleInEncode(
  width: number,
  height: number,
): FfmpegOverrideFn {
  return ({args}) => {
    if (args.some((a, i) => a === '-c:v' && args[i + 1] === 'copy')) {
      return args;
    }
    const filters = args.flatMap((a, i) => (a === '-vf' ? [i + 1] : []));
    const at = filters[0];
    if (filters.length !== 1 || !args[at!]?.startsWith('zscale=')) {
      throw new Error(
        `expected one zscale filter in Remotion's encode to scale with, got: ${args.join(' ')}`,
      );
    }
    const out = [...args];
    out[at!] =
      `zscale=w=${width}:h=${height}:filter=lanczos:${args[at!]!.slice('zscale='.length)}`;
    return out;
  };
}

const USAGE = `
Usage: node --import tsx scripts/render/renderFilm.ts ${FILM_USAGE} --out <picture.mp4>
         [--chunks 0-749,750-1424] [--chunk-size <frames>] [--range <from-to>] [--scale 2]
         [--crf 12] [--concurrency 3] [--retries 2] [--timeout-ms 300000]
         [--offthread-cache-bytes <n>] [--work <dir>] [--resume] [--keep-chunks]
`;

interface ChunkRender {
  serveUrl: string;
  composition: Awaited<ReturnType<typeof selectComposition>>;
  inputProps: Record<string, unknown>;
  browserExecutable: string | null;
  scale: number;
  crf: number;
  concurrency: number;
  /** Tries after the first failed one. */
  retries: number;
  timeoutInMilliseconds: number;
  cacheBytes: number | null;
}

/**
 * Renders frames [a, b] to `file` (atomically) at the composition's size,
 * retrying a failed attempt.
 */
async function renderChunk(
  r: ChunkRender,
  [a, b]: Chunk,
  file: string,
): Promise<void> {
  const {width, height} = r.composition;
  const ffmpegOverride =
    r.scale === 1 ? undefined : downscaleInEncode(width, height);
  for (let attempt = 1; ; attempt++) {
    try {
      let shown = -10;
      await produceAtomic(file, async tmp => {
        await renderMedia({
          composition: r.composition,
          serveUrl: r.serveUrl,
          inputProps: r.inputProps,
          codec: 'h264',
          crf: r.crf,
          imageFormat: 'png',
          pixelFormat: 'yuv420p',
          colorSpace: 'bt709',
          muted: true,
          scale: r.scale,
          ffmpegOverride,
          frameRange: [a, b],
          outputLocation: tmp,
          concurrency: r.concurrency,
          timeoutInMilliseconds: r.timeoutInMilliseconds,
          browserExecutable: r.browserExecutable,
          chromiumOptions: productAppChromiumOptions,
          ...(r.cacheBytes === null
            ? {}
            : {offthreadVideoCacheSizeInBytes: r.cacheBytes}),
          onProgress: ({progress}) => {
            const pct = Math.floor(progress * 100);
            if (pct >= shown + 20) {
              shown = pct;
              console.log(`${a}-${b}: ${pct}%`);
            }
          },
        });
        const n = countFrames(tmp);
        if (n !== b - a + 1)
          throw new Error(`the chunk has ${n} frames, expected ${b - a + 1}`);
        const got = probeVideo(tmp);
        if (got.width !== width || got.height !== height) {
          throw new Error(
            `the chunk is ${got.width}x${got.height}, expected ${width}x${height}`,
          );
        }
      });
      console.log(`${a}-${b}: ok (attempt ${attempt})`);
      return;
    } catch (err) {
      const message = (err as Error).message.split('\n')[0];
      if (attempt > r.retries)
        throw new Error(`chunk ${a}-${b} failed ${attempt} times: ${message}`);
      console.log(
        `${a}-${b}: attempt ${attempt} failed (${message}); retrying`,
      );
    }
  }
}

/** Joins the chunks losslessly (concat demuxer, stream copy) and checks the frame count. */
async function joinChunks(
  files: readonly string[],
  out: string,
  expected: number,
): Promise<void> {
  await withScratchDir('render-film', async scratch => {
    const list = path.join(scratch, 'chunks.txt');
    fs.writeFileSync(
      list,
      files.map(f => `file '${f.replace(/'/g, "'\\''")}'\n`).join(''),
    );
    await produceAtomic(out, target => {
      ffmpeg([
        '-y',
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        list,
        '-c',
        'copy',
        target,
      ]);
      const n = countFrames(target);
      if (n !== expected)
        throw new Error(
          `the joined film has ${n} frames, expected ${expected}`,
        );
    });
  });
}

async function main(): Promise<void> {
  const {values} = parseFlags({
    ...FILM_FLAGS,
    out: {type: 'string'},
    chunks: {type: 'string'},
    'chunk-size': {type: 'string'},
    range: {type: 'string'},
    scale: {type: 'string'},
    crf: {type: 'string'},
    concurrency: {type: 'string'},
    retries: {type: 'string'},
    'timeout-ms': {type: 'string'},
    'offthread-cache-bytes': {type: 'string'},
    work: {type: 'string'},
    resume: {type: 'boolean', default: false},
    'keep-chunks': {type: 'boolean', default: false},
  });
  const out = path.resolve(need(values.out, 'out'));
  const id = need(values.composition, 'composition');
  const scale = positive(values.scale, 'scale', 1);
  const listed = values.chunks
    ? values.chunks.split(',').map(c => frameRange(c, 'chunks'))
    : null;
  const size = values['chunk-size']
    ? int(values['chunk-size'], 'chunk-size', undefined, 1)
    : null;
  const inputProps = inputPropsOf(values);
  const browserExecutable = browserOf(values);

  const serveUrl = await bundleFilm(values);
  try {
    const composition = await selectComposition({
      serveUrl,
      id,
      inputProps,
      browserExecutable,
      chromiumOptions: productAppChromiumOptions,
    });
    const r: ChunkRender = {
      serveUrl,
      composition,
      inputProps,
      browserExecutable,
      scale,
      crf: int(values.crf, 'crf', 12, 0),
      concurrency: int(values.concurrency, 'concurrency', 3, 1),
      retries: int(values.retries, 'retries', 2, 0),
      timeoutInMilliseconds: int(
        values['timeout-ms'],
        'timeout-ms',
        300000,
        1000,
      ),
      cacheBytes: values['offthread-cache-bytes']
        ? int(
            values['offthread-cache-bytes'],
            'offthread-cache-bytes',
            undefined,
            0,
          )
        : null,
    };
    const range: Chunk = values.range
      ? frameRange(values.range, 'range')
      : [0, composition.durationInFrames - 1];
    if (range[1] >= composition.durationInFrames) {
      throw new UsageError(
        `--range ends past ${id}'s last frame, ${composition.durationInFrames - 1}`,
      );
    }
    const chunks = planChunks(range, listed, size);
    const work = path.resolve(values.work ?? `${out}.chunks`);
    const settings: ChunkSettings = {
      composition: id,
      width: composition.width,
      height: composition.height,
      fps: composition.fps,
      scale,
      crf: r.crf,
      props: inputProps,
      chunks,
    };
    prepareWork(work, settings, values.resume);
    console.log(
      `${id}: ${composition.width}x${composition.height} at ${composition.fps} fps, ` +
        `frames ${range[0]}-${range[1]} in ${chunks.length} chunks` +
        (scale !== 1 ? `, rendered at ${scale}x` : ''),
    );
    const files = chunks.map(([a, b]) =>
      path.join(work, `chunk-${a}-${b}.mp4`),
    );
    for (const [i, chunk] of chunks.entries()) {
      if (values.resume && fs.existsSync(files[i]!)) {
        console.log(`${chunk[0]}-${chunk[1]}: kept from an earlier run`);
      } else {
        await renderChunk(r, chunk, files[i]!);
      }
    }
    const expected = range[1] - range[0] + 1;
    await joinChunks(files, out, expected);
    if (!values['keep-chunks']) clearWork(work, true);
    console.log(`${expected} frames -> ${out}`);
  } finally {
    disposeBundle(serveUrl);
  }
}

if (isMain(import.meta.url)) runCli(USAGE, main);
