/**
 * Puts the matching slice of the film's mix under a rendered clip (or the
 * whole film), muxed so the AAC encoder delay is trimmed, then measures the
 * result's A/V offset against the mix. Use it for every sync review and for
 * the final film; see delivery.ts for why Remotion's own mux is not enough.
 *
 *   node --import tsx scripts/render/mux.ts --picture <in.mp4> --mix <mix.wav> \
 *     --out <out.mp4> [--from 0] [--tolerance-ms 5]
 *
 * --from is the film frame of the clip's first frame: 0 for the whole
 * film, the range start for a clip, negative when the clip opens on frames
 * before the film (a poster), which play silence; write a negative one as
 * `--from=-30`, or it reads as a flag. The frame rate comes from
 * the picture; a mix shorter than the clip is padded with silence. Exits 1
 * when the measured offset is beyond --tolerance-ms or the muxed audio does
 * not correlate with the mix.
 */
import path from 'node:path';
import {int, isMain, need, num, parseFlags, runCli} from '../lib/cli';
import {describeOffset, muxAudio} from './delivery';

const USAGE = `
Usage: node --import tsx scripts/render/mux.ts --picture <in.mp4> --mix <mix.wav> --out <out.mp4>
         [--from 0] [--tolerance-ms 5]
`;

async function main(): Promise<void> {
  const {values} = parseFlags({
    picture: {type: 'string'},
    mix: {type: 'string'},
    out: {type: 'string'},
    from: {type: 'string'},
    'tolerance-ms': {type: 'string'},
  });
  const out = path.resolve(need(values.out, 'out'));
  const r = await muxAudio(
    need(values.picture, 'picture'),
    need(values.mix, 'mix'),
    out,
    int(values.from, 'from', 0),
  );
  console.log(
    `muxed the mix from film frame ${r.fromFrame} (${(r.fromFrame / r.fps).toFixed(6)} s) -> ${out}`,
  );
  const {line, ok} = describeOffset(
    r,
    num(values['tolerance-ms'], 'tolerance-ms', 5),
  );
  console.log(line);
  if (!ok) process.exitCode = 1;
}

if (isMain(import.meta.url)) runCli(USAGE, main);
