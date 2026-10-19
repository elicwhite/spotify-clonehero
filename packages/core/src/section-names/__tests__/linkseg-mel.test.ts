import {readFileSync} from 'fs';
import {join} from 'path';
import {
  melForWindows,
  LINKSEG_N_MELS,
  LINKSEG_MEL_FRAMES,
} from '../linkseg-mel';

// Golden: torchaudio MelSpectrogram+AmplitudeToDB for one real beat window of song0. Locks the JS
// STFT (radix-2 FFT) + shipped filterbank + dB. Tolerance covers radix-2-vs-pocketfft float noise
// (measured <1.1e-3 dB end-to-end); a real break in framing/filterbank/window/dB moves it far more.
const golden = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'linkseg-mel-golden.json'), 'utf8'),
) as {window: number[]; expectedMel: number[]};

describe('melForWindows byte-close vs torchaudio', () => {
  it('reproduces the golden mel window', () => {
    const mel = melForWindows([new Float32Array(golden.window)]);
    expect(mel.length).toBe(LINKSEG_N_MELS * LINKSEG_MEL_FRAMES);
    expect(mel.length).toBe(golden.expectedMel.length);
    let maxDiff = 0;
    for (let i = 0; i < mel.length; i++) {
      maxDiff = Math.max(maxDiff, Math.abs(mel[i] - golden.expectedMel[i]));
    }
    expect(maxDiff).toBeLessThan(5e-3);
  });
});
