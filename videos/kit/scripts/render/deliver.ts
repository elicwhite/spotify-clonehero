/**
 * Final delivery: a muted BT.709 render (renderFilm.ts) becomes the master
 * and its smaller variants, every one fully tagged BT.709 limited range with
 * the soundtrack muxed in and its A/V offset measured.
 *
 *   node --import tsx scripts/render/deliver.ts --picture <picture.mp4> --mix <mix.wav> \
 *     --out-dir <dir> --name <file base> [--poster <poster.mp4>] \
 *     [--variant web:18:same --variant 720p:24:h720 | --no-variants] [--tolerance-ms 5]
 *
 * Writes to --out-dir:
 *   <name>.mp4            the master: the render's own encode, retagged and muxed
 *   <name>-<suffix>.mp4   one per --variant (default: web at CRF 18 and the master's
 *                         size, and 720p at CRF 24), re-encoded with lanczos
 *
 * With --poster (a clip rendered with the same settings, such as the film's
 * end card), every file opens on the poster and the film follows, so a site
 * that previews a video by its first frame shows the poster; the soundtrack
 * starts with the film. Checks each output's frame count (poster + film),
 * colour tags and A/V offset, and exits 1 on any failure.
 */
import path from 'node:path';
import {isMain, need, num, parseFlags, runCli} from '../lib/cli';
import {withScratchDir} from '../lib/files';
import {countFrames, probeVideo, type VideoInfo} from '../lib/media';
import {
  describeOffset,
  encodeVariant,
  joinPoster,
  muxAudio,
  parseVariant,
  retagBt709,
  type Variant,
} from './delivery';

const DEFAULT_VARIANTS = ['web:18:same', '720p:24:h720'];

export interface DeliveryOptions {
  picture: string;
  mix: string;
  outDir: string;
  name: string;
  poster?: string;
  variants: readonly Variant[];
  toleranceMs: number;
}

/** One delivered file and what its checks found. */
export interface DeliveredFile {
  file: string;
  info: VideoInfo;
  frames: number;
  /** The measured A/V offset, ms (positive = audio late); null when the mix is silent under it. */
  offsetMs: number | null;
  /** The measured offset, as a line of text. */
  offset: string;
  problems: string[];
}

/** Makes the master and its variants in `outDir`, and checks each one. */
export async function deliver(
  options: DeliveryOptions,
): Promise<DeliveredFile[]> {
  const filmFrames = countFrames(options.picture);
  const outputs: DeliveredFile[] = [];
  await withScratchDir('delivery', async scratch => {
    let picture = options.picture;
    let posterFrames = 0;
    if (options.poster) {
      picture = path.join(scratch, 'joined.mp4');
      posterFrames = await joinPoster(options.poster, options.picture, picture);
    }
    const master = path.join(scratch, 'master-picture.mp4');
    await retagBt709(picture, master);
    const deliverOne = async (pictureFile: string, file: string) => {
      const r = await muxAudio(pictureFile, options.mix, file, -posterFrames);
      const info = probeVideo(file);
      const {frames} = r;
      const offset = describeOffset(r, options.toleranceMs);
      const tags = [
        info.colorPrimaries,
        info.colorTransfer,
        info.colorSpace,
        info.colorRange,
      ].join('/');
      const problems = [
        ...(frames === posterFrames + filmFrames
          ? []
          : [`${frames} frames, expected ${posterFrames} + ${filmFrames}`]),
        ...(tags === 'bt709/bt709/bt709/tv'
          ? []
          : [`colour tags ${tags}, expected bt709/bt709/bt709/tv`]),
        ...(offset.ok ? [] : [offset.line]),
      ];
      outputs.push({
        file,
        info,
        frames,
        offsetMs: r.offsetMs,
        offset: offset.line,
        problems,
      });
    };
    await deliverOne(master, path.join(options.outDir, `${options.name}.mp4`));
    for (const v of options.variants) {
      const encoded = path.join(scratch, `variant-${v.suffix}.mp4`);
      await encodeVariant(master, encoded, v);
      await deliverOne(
        encoded,
        path.join(options.outDir, `${options.name}-${v.suffix}.mp4`),
      );
    }
  });
  return outputs;
}

const USAGE = `
Usage: node --import tsx scripts/render/deliver.ts --picture <picture.mp4> --mix <mix.wav>
         --out-dir <dir> --name <file base> [--poster <poster.mp4>]
         [--variant web:18:same --variant 720p:24:h720 | --no-variants] [--tolerance-ms 5]
`;

async function main(): Promise<void> {
  const {values} = parseFlags({
    picture: {type: 'string'},
    mix: {type: 'string'},
    'out-dir': {type: 'string'},
    name: {type: 'string'},
    poster: {type: 'string'},
    variant: {type: 'string', multiple: true},
    'no-variants': {type: 'boolean', default: false},
    'tolerance-ms': {type: 'string'},
  });
  const specs = values['no-variants']
    ? []
    : (values.variant ?? DEFAULT_VARIANTS);
  const outputs = await deliver({
    picture: need(values.picture, 'picture'),
    mix: need(values.mix, 'mix'),
    outDir: path.resolve(need(values['out-dir'], 'out-dir')),
    name: need(values.name, 'name'),
    poster: values.poster,
    variants: specs.map(parseVariant),
    toleranceMs: num(values['tolerance-ms'], 'tolerance-ms', 5),
  });
  let failed = false;
  for (const o of outputs) {
    const v = o.info;
    console.log(
      `${path.basename(o.file)}  ${v.width}x${v.height} ${v.pixFmt} ${v.colorRange}/${v.colorSpace}/` +
        `${v.colorTransfer}/${v.colorPrimaries}  ${o.frames} frames  ${v.duration.toFixed(3)} s`,
    );
    console.log(`  ${o.offset}`);
    for (const p of o.problems) console.log(`  FAIL: ${p}`);
    if (o.problems.length) failed = true;
  }
  if (failed) process.exitCode = 1;
}

if (isMain(import.meta.url)) runCli(USAGE, main);
