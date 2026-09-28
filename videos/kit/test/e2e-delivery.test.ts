/**
 * Delivery end to end on a tiny synthetic picture made with ffmpeg's lavfi
 * sources and encoded as Remotion encodes a render (no Remotion itself): a
 * poster joined in front of the film, the master and a variant retagged,
 * muxed and measured, a review clip muxed from a later film frame, and a
 * contact sheet of the result. Needs ffmpeg with zscale; everything is
 * written to a scratch folder that is deleted afterwards.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {after, before, describe, it} from 'node:test';
import {SAMPLE_RATE, allocStereo, writeWav} from '../scripts/audio/pcm';
import {countFrames, probeVideo} from '../scripts/lib/media';
import {ffmpeg} from '../scripts/lib/proc';
import {contactSheet} from '../scripts/render/contactSheet';
import {deliver, type DeliveredFile} from '../scripts/render/deliver';
import {muxAudio, parseVariant} from '../scripts/render/delivery';
import {DEFAULT_FONT} from '../scripts/render/sheet';
import {mulberry32} from '../src/motion/random';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-e2e-delivery-'));
after(() => fs.rmSync(dir, {recursive: true, force: true}));

const FPS = 30;
const FILM_FRAMES = 60;
const POSTER_FRAMES = 15;
/** The poster's colour, as ffmpeg's lavfi `color` source takes it. */
const POSTER_RGB = [124, 58, 237];

/**
 * An H.264 clip from a lavfi source, encoded from RGB frames with the
 * options Remotion's bt709 mode passes ffmpeg, B-frames and all: the file
 * gets the matrix and range, and its primaries and transfer stay unset.
 */
function encode(source: string, frames: number, out: string): string {
  ffmpeg([
    '-y',
    '-f',
    'lavfi',
    '-i',
    `${source},format=rgb24`,
    '-frames:v',
    String(frames),
    '-c:v',
    'libx264',
    '-colorspace:v',
    'bt709',
    '-color_primaries:v',
    'bt709',
    '-color_trc:v',
    'bt709',
    '-color_range',
    'tv',
    '-vf',
    'zscale=matrix=709:matrixin=709:range=limited',
    '-pix_fmt',
    'yuv420p',
    '-crf',
    '18',
    out,
  ]);
  return out;
}

/** A file's colour tags: primaries, transfer, matrix, range. */
const tagsOf = (file: string) => {
  const v = probeVideo(file);
  return [v.colorPrimaries, v.colorTransfer, v.colorSpace, v.colorRange];
};

/** The mean RGB of one frame of a video. */
function meanRgb(file: string, frame: number): number[] {
  const {stdout} = ffmpeg([
    '-i',
    file,
    '-vf',
    `select=eq(n\\,${frame}),scale=16:16`,
    '-frames:v',
    '1',
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgb24',
    'pipe:1',
  ]);
  const sum = [0, 0, 0];
  for (let i = 0; i < stdout.length; i++) sum[i % 3]! += stdout[i]!;
  return sum.map(v => v / (stdout.length / 3));
}

describe('delivering a film with a poster', () => {
  const size = '320x180';
  const picture = encode(
    `testsrc2=s=${size}:r=${FPS}`,
    FILM_FRAMES,
    path.join(dir, 'picture.mp4'),
  );
  const poster = encode(
    `color=c=0x${POSTER_RGB.map(v => v.toString(16).padStart(2, '0')).join('')}:s=${size}:r=${FPS}`,
    POSTER_FRAMES,
    path.join(dir, 'poster.mp4'),
  );
  // The mix: a noise burst on every beat at 120 BPM, as long as the film.
  const mix = path.join(dir, 'mix.wav');
  const audio = allocStereo((FILM_FRAMES / FPS) * SAMPLE_RATE);
  const rnd = mulberry32(3);
  for (let beat = 0; beat * 0.5 < FILM_FRAMES / FPS; beat++) {
    const at = Math.round(beat * 0.5 * SAMPLE_RATE);
    for (let i = 0; i < 0.12 * SAMPLE_RATE && at + i < audio.l.length; i++) {
      const v = 0.5 * (2 * rnd() - 1) * Math.exp(-i / (0.03 * SAMPLE_RATE));
      audio.l[at + i] = audio.r[at + i] = v;
    }
  }
  writeWav(mix, audio);

  const outDir = path.join(dir, 'final');
  let outputs: DeliveredFile[];
  before(async () => {
    outputs = await deliver({
      picture,
      mix,
      outDir,
      name: 'film',
      poster,
      variants: [parseVariant('small:28:h90')],
      toleranceMs: 5,
    });
  });

  it('starts from renders tagged as Remotion tags them: no primaries or transfer', () => {
    for (const file of [picture, poster]) {
      const [primaries, transfer, matrix, range] = tagsOf(file);
      assert.deepEqual([matrix, range], ['bt709', 'tv'], file);
      assert.ok(
        primaries !== 'bt709' && transfer !== 'bt709',
        `${file} is already tagged ${primaries}/${transfer}`,
      );
    }
  });

  it('writes the master and the variant, each poster + film frames, in sync, all four tags set', () => {
    assert.deepEqual(
      outputs.map(o => path.basename(o.file)),
      ['film.mp4', 'film-small.mp4'],
    );
    for (const o of outputs) {
      assert.deepEqual(o.problems, [], o.file);
      assert.equal(o.frames, POSTER_FRAMES + FILM_FRAMES, o.file);
      assert.equal(countFrames(o.file), POSTER_FRAMES + FILM_FRAMES, o.file);
      assert.ok(
        o.offsetMs !== null && Math.abs(o.offsetMs) < 0.5,
        `${o.file}: ${o.offset}`,
      );
      assert.deepEqual(
        tagsOf(o.file),
        ['bt709', 'bt709', 'bt709', 'tv'],
        o.file,
      );
    }
    assert.deepEqual(
      outputs.map(o => [o.info.width, o.info.height]),
      [
        [320, 180],
        [160, 90],
      ],
    );
  });

  it('opens on the poster and then plays the film', () => {
    const master = outputs[0]!.file;
    const first = meanRgb(master, 0);
    assert.ok(
      first.every((v, i) => Math.abs(v - POSTER_RGB[i]!) < 6),
      `frame 0 is ${first.map(Math.round)}`,
    );
    const film = meanRgb(picture, 0);
    const joined = meanRgb(master, POSTER_FRAMES);
    assert.ok(
      film.every((v, i) => Math.abs(v - joined[i]!) < 2),
      `the film's first frame ${film.map(Math.round)}, joined ${joined.map(Math.round)}`,
    );
  });

  it('muxes a review clip from a later film frame', async () => {
    const clip = path.join(dir, 'clip.mp4');
    const r = await muxAudio(picture, mix, clip, 30);
    assert.equal(r.frames, FILM_FRAMES);
    assert.ok(
      r.offsetMs !== null && Math.abs(r.offsetMs) < 0.5,
      `offset ${r.offsetMs}`,
    );
    assert.ok(r.correlation > 0.9, `correlation ${r.correlation}`);
  });

  it('tiles a contact sheet labelled in film frames', async () => {
    const out = path.join(dir, 'sheet.png');
    const {tiles} = await contactSheet({
      input: outputs[0]!.file,
      out,
      every: 15,
      cols: 5,
      width: 160,
      from: -POSTER_FRAMES,
      font: DEFAULT_FONT,
    });
    assert.equal(tiles, 5);
    assert.ok(fs.statSync(out).size > 0);
  });
});
