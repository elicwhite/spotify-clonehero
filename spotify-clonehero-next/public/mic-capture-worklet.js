/**
 * Microphone capture for the sheet-music auto-scroll follower.
 *
 * Forwards mono blocks of raw samples to the main thread, which passes them to
 * the follow worker. It does no analysis: the point of taking the samples here
 * rather than through an AnalyserNode is that the live side must produce chroma
 * with exactly the same code as the reference, and an AnalyserNode would apply
 * its own window and smoothing.
 *
 * Samples accumulate to about a tenth of a second before being posted, because
 * the audio thread hands over 128 frames at a time and one message per 128
 * frames is roughly 172 messages a second for no benefit.
 */

const BLOCK_SAMPLES = 2205; // 0.1s at the 22.05 kHz context rate

class MicCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = new Float32Array(BLOCK_SAMPLES);
    this._filled = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;

    // Sum to mono. A laptop microphone array reports two channels that are
    // nearly the same signal; averaging them is free noise reduction.
    const channels = input.length;
    const frames = input[0].length;
    for (let i = 0; i < frames; i++) {
      let sum = 0;
      for (let c = 0; c < channels; c++) sum += input[c][i];
      this._buffer[this._filled++] = sum / channels;
      if (this._filled === BLOCK_SAMPLES) {
        const out = this._buffer.slice(0);
        this.port.postMessage(out, [out.buffer]);
        this._filled = 0;
      }
    }
    return true;
  }
}

registerProcessor('mic-capture', MicCaptureProcessor);
