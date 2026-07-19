/**
 * Numeric validation of the post-processing block (per-frame lane
 * constraints; tom pitch re-order OFF, matching the t3/control ship decode
 * — F50, PIPELINE_AUDIT.md) and reference peak picking against the research
 * repo's scripts/dump_frontend_reference.py output. The fixture holds raw
 * model activations (T, 9), the mono mel (T, 256), the deployed per-lane
 * (System-C tuned) thresholds, and the exact onsets the reference produces.
 */

import fs from 'fs';
import path from 'path';

import {applyPostprocess} from '../ml/postprocess';
import {pickPeaksFromModelOutput} from '../ml/peak-picking';
import {DRUM_CLASSES, NUM_DRUM_CLASSES} from '../ml/types';

const FIXTURE_PATH = path.join(
  __dirname,
  'fixtures',
  'postprocess-reference.json',
);

interface PostprocessFixture {
  T: number;
  nMels: number;
  nInst: number;
  thresholds: number[];
  rawActB64: string; // [t * 9 + c]
  monoMelB64: string; // [t * 256 + m]
  onsets: {lane: number; frame: number}[];
}

function decodeF32(b64: string): Float32Array {
  const buf = Buffer.from(b64, 'base64');
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

describe('postprocess + peak picking vs reference fixture', () => {
  const fixture: PostprocessFixture = JSON.parse(
    fs.readFileSync(FIXTURE_PATH, 'utf8'),
  );
  const rawAct = decodeF32(fixture.rawActB64);
  const monoMel = decodeF32(fixture.monoMelB64);

  it('fixture has the expected shape', () => {
    expect(fixture.nInst).toBe(NUM_DRUM_CLASSES);
    expect(fixture.nMels).toBe(256);
    expect(rawAct.length).toBe(fixture.T * fixture.nInst);
    expect(monoMel.length).toBe(fixture.T * fixture.nMels);
    expect(fixture.onsets.length).toBe(45);
  });

  it('does not mutate the input activations', () => {
    const before = rawAct.slice();
    applyPostprocess(rawAct, fixture.T, monoMel);
    expect(rawAct).toEqual(before);
  });

  it('reproduces the reference onsets exactly', () => {
    const processed = applyPostprocess(rawAct, fixture.T, monoMel);

    const events = pickPeaksFromModelOutput(
      {
        predictions: processed,
        nFrames: fixture.T,
        nClasses: fixture.nInst,
      },
      fixture.thresholds,
    );

    const got = events.map(e => ({
      lane: DRUM_CLASSES.findIndex(c => c.name === e.drumClass),
      frame: Math.round(e.timeSeconds * 100),
    }));

    expect(got.length).toBe(fixture.onsets.length);
    expect(got).toEqual(
      fixture.onsets.map(o => ({lane: o.lane, frame: o.frame})),
    );
  });
});
