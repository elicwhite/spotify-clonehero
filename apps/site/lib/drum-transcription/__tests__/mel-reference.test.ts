/**
 * Numeric validation of the CRNN mel spectrogram against the reference
 * pipeline (pipeline/build_packed_dataset.py compute_mel in the research
 * repo). The fixture holds a 1.5 s stereo 48 kHz PCM slice and the (256, T)
 * log-mel each channel should produce.
 */

import fs from 'fs';
import path from 'path';

import {computeStereoMel} from '../ml/spectrogram';

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'mel-reference.json');

interface MelFixture {
  sr: number;
  nMels: number;
  T: number;
  nFft: number;
  hop: number;
  leftPcmB64: string;
  rightPcmB64: string;
  melLB64: string;
  melRB64: string;
}

function decodeF32(b64: string): Float32Array {
  const buf = Buffer.from(b64, 'base64');
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

describe('mel spectrogram vs reference fixture', () => {
  const fixture: MelFixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));
  const left = decodeF32(fixture.leftPcmB64);
  const right = decodeF32(fixture.rightPcmB64);
  const refL = decodeF32(fixture.melLB64); // [m * T + t]
  const refR = decodeF32(fixture.melRB64);

  it('fixture has the expected config', () => {
    expect(fixture.sr).toBe(48000);
    expect(fixture.nFft).toBe(1024);
    expect(fixture.hop).toBe(480);
    expect(fixture.nMels).toBe(256);
  });

  it('matches the reference mel per bin (max abs diff < 5e-3)', () => {
    const {melStereo, nFrames, nMels} = computeStereoMel(left, right);

    expect(nMels).toBe(fixture.nMels);
    expect(nFrames).toBe(fixture.T);

    const T = fixture.T;
    let maxDiff = 0;
    let maxAt = '';
    for (let m = 0; m < nMels; m++) {
      for (let t = 0; t < T; t++) {
        const dL = Math.abs(melStereo[m * T + t] - refL[m * T + t]);
        if (dL > maxDiff) {
          maxDiff = dL;
          maxAt = `L m=${m} t=${t}`;
        }
        const dR = Math.abs(melStereo[(nMels + m) * T + t] - refR[m * T + t]);
        if (dR > maxDiff) {
          maxDiff = dR;
          maxAt = `R m=${m} t=${t}`;
        }
      }
    }

    console.log(`mel-reference max abs diff = ${maxDiff} at ${maxAt}`);
    expect(maxDiff).toBeLessThan(5e-3);
  });
});
