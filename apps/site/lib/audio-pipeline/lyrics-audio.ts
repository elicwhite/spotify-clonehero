/**
 * Separator-agnostic audio helpers for the lyrics-alignment pipeline:
 * resampling a vocals stem down to the 16kHz mono input the aligner
 * expects, and mixing a chart's bundled stems back into a single buffer
 * for re-separation. Neither depends on which model produced the stem.
 */

/**
 * Resample an AudioBuffer to 16kHz mono using Web Audio API.
 * Use this when a vocals stem is already available (skip separation).
 */
export async function resampleTo16kMono(
  audioData: Uint8Array,
  mimeType: string,
): Promise<Float32Array> {
  const blob = new Blob([audioData as Uint8Array<ArrayBuffer>], {
    type: mimeType,
  });
  const arrayBuffer = await blob.arrayBuffer();
  const audioCtx = new OfflineAudioContext(1, 1, 16000);
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

  const offlineCtx = new OfflineAudioContext(
    1,
    Math.ceil(audioBuffer.duration * 16000),
    16000,
  );
  const source = offlineCtx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(offlineCtx.destination);
  source.start(0);

  const rendered = await offlineCtx.startRendering();
  return rendered.getChannelData(0);
}

/**
 * Sum a list of audio stems into a single 44.1kHz stereo AudioBuffer suitable
 * for re-separation. Used when a chart's bundled vocal stem produced a
 * low-confidence alignment and we want to fall back to AI separation against
 * a reconstructed full mix.
 *
 * Each stem is decoded (codec is whatever the browser supports), resampled to
 * 44.1kHz by OfflineAudioContext, and summed at the destination. A 1/√N gain
 * keeps loudness ~stable so separation sees a sane signal level regardless of
 * stem count.
 */
export async function mixStemsToAudioBuffer(
  stems: Array<{data: Uint8Array; mimeType: string}>,
): Promise<AudioBuffer> {
  if (stems.length === 0) {
    throw new Error('mixStemsToAudioBuffer: no stems');
  }

  const decoded = await Promise.all(
    stems.map(async s => {
      const blob = new Blob([s.data as Uint8Array<ArrayBuffer>], {
        type: s.mimeType,
      });
      const arrayBuffer = await blob.arrayBuffer();
      const ctx = new OfflineAudioContext(1, 1, 44100);
      return ctx.decodeAudioData(arrayBuffer);
    }),
  );

  const numSamples = Math.max(
    ...decoded.map(b => Math.ceil(b.duration * 44100)),
  );
  const ctx = new OfflineAudioContext(2, numSamples, 44100);
  const stemGain = 1 / Math.sqrt(decoded.length);
  for (const buf of decoded) {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const gain = ctx.createGain();
    gain.gain.value = stemGain;
    src.connect(gain).connect(ctx.destination);
    src.start(0);
  }
  return ctx.startRendering();
}
