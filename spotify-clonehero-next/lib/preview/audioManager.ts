import {getBasename} from '../src-shared/utils';
import {Files} from './chorus-chart-processing';

export class AudioManager {
  #context: AudioContext;

  // What was the current time in ms when the song started
  // This is non zero when we seek our pause
  #trackOffset: number = 0;

  #duration: number = 0;

  #tracks: {[trackName: string]: AudioTrack} = {};

  #isInitialized: boolean = false;

  constructor(audioFiles: Files) {
    this.#context = new (window.AudioContext || window.webkitAudioContext)();
    this.#trackOffset = 0;

    this.#context.suspend();

    this.#createTracks(audioFiles).then(() => {
      this.#duration = Math.max(
        ...Object.values(this.#tracks).map(track => track.duration),
      );
    });
  }

  async #createTracks(audioFiles: Files) {
    await Promise.all(
      audioFiles.map(async audioFile => {
        const trackName = getBasename(audioFile.fileName);
        const arrayBuffer = audioFile.data;

        let decodedAudioBuffer: AudioBuffer;
        try {
          decodedAudioBuffer = await this.#context.decodeAudioData(
            arrayBuffer.buffer as ArrayBuffer,
          );
        } catch {
          try {
            const decode = await import('audio-decode');
            decodedAudioBuffer = await decode.default(
              arrayBuffer.buffer as ArrayBuffer,
            );
          } catch {
            console.error('Could not decode audio');
            return;
          }
        }

        this.#tracks[trackName] = new AudioTrack(
          this.#context,
          decodedAudioBuffer,
        );
      }),
    );
  }

  async pause() {
    if (this.#context.state === 'running') {
      await this.#context.suspend();
    }
  }

  async resume() {
    if (this.#context.state === 'suspended') {
      await this.#context.resume();
    }
  }

  async play({percent, ms}: {percent?: number; ms?: number}) {
    if (percent == null && ms == null) {
      throw new Error('Must provide percent or ms');
    }
    if (this.#isInitialized) {
      await this.stop();
    }

    const time = this.#context.currentTime;
    const songLength = this.#duration || 60 * 5 * 1000;
    const offset: number = ms ?? songLength * percent!;
    const percentCalculated: number = percent ?? ms! / songLength;
    this.#trackOffset = offset;
    Object.values(this.#tracks).forEach(track => {
      track.start(time, offset);
    });
    this.#isInitialized = true;

    // progressListener(percentCalculated);

    // const {audioCtx: audioContext, audioSources} =
    //   await setupAudioContext(audioFiles);
    // Update the audio context
    // audioCtx = audioContext;
    // audioCtx.onstatechange = () => {
    //   playPauseListener(audioCtx.state === 'running');
    // };
    // audioSources.forEach(source => {
    //   source.start(0, offset / 1000);
    // });

    // await audioCtx.resume();
  }

  async stop() {
    Object.values(this.#tracks).forEach(track => {
      track.stop();
    });

    this.#isInitialized = false;
  }

  destory() {
    Object.values(this.#tracks).forEach(track => {
      track.destroy();
    });

    this.#tracks = {};
    this.#context.close();
  }
}

class AudioTrack {
  #context: AudioContext;
  #audioBuffer: AudioBuffer;

  #gainNode: GainNode;

  #source: AudioBufferSourceNode | null = null;

  constructor(context: AudioContext, AudioBuffer: AudioBuffer) {
    this.#context = context;
    this.#audioBuffer = AudioBuffer;

    const gainNode = this.#context.createGain();
    gainNode.connect(this.#context.destination);
    this.#gainNode = gainNode;

    this.volume = 0.5;
  }

  get duration() {
    return this.#audioBuffer.duration;
  }

  get volume() {
    return Math.sqrt(this.#gainNode.gain.value);
  }

  set volume(volume: number) {
    // Let's use an x*x curve (x-squared) since simple linear (x) does not
    // sound as good.
    // Taken from https://webaudioapi.com/samples/volume/
    this.#gainNode.gain.value = volume * volume;
  }

  start(at: number, offset: number) {
    this.#source = this.#context.createBufferSource();
    this.#source.buffer = this.#audioBuffer;
    this.#source.connect(this.#gainNode);
    this.#source.start(at, offset);
  }

  stop() {
    if (this.#source != null) {
      this.#source.stop();
      this.#source.disconnect();
    }

    this.#source = null;
  }

  destroy() {
    this.stop();
    this.#gainNode.disconnect();
  }
}
