import {getBasename} from '../src-shared/utils';
import {Files} from './chorus-chart-processing';

export class AudioManager {
  #context: AudioContext;

  #startedAt: number = -1;
  // What was the current time in ms when the song started
  // This is non zero when we seek our pause
  #trackOffset: number = 0;
  #duration: number = 0;
  #tracks: {[trackName: string]: AudioTrack} = {};
  #isInitialized: boolean = false;
  #onSongEnded: (() => void) | null;

  ready: Promise<void>;

  constructor(audioFiles: Files, onSongEnded: () => void) {
    this.#onSongEnded = onSongEnded;
    this.#context = new (window.AudioContext || window.webkitAudioContext)();
    this.#trackOffset = 0;

    this.#context.suspend();

    this.ready = this.#createTracks(audioFiles).then(() => {
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

        const bufferCopy = arrayBuffer.slice(0).buffer;
        let decodedAudioBuffer: AudioBuffer;
        try {
          decodedAudioBuffer = await this.#context.decodeAudioData(
            bufferCopy as ArrayBuffer,
          );
        } catch {
          try {
            const decode = await import('audio-decode');
            decodedAudioBuffer = await decode.default(
              bufferCopy as ArrayBuffer,
            );
          } catch {
            console.error('Could not decode audio');
            return;
          }
        }

        this.#tracks[trackName] = new AudioTrack(
          this.#context,
          decodedAudioBuffer,
          this.#trackEnded.bind(this),
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

  async play({percent, time}: {percent?: number; time?: number}) {
    if (percent == null && time == null) {
      throw new Error('Must provide percent or ms');
    }
    if (this.#isInitialized) {
      await this.stop();
    }

    const currentTime = this.#context.currentTime;
    const songLength = this.#duration;
    const offset: number = time ?? songLength * percent!;
    const percentCalculated: number = percent ?? time! / songLength;
    this.#trackOffset = offset;
    this.#startedAt = currentTime;
    Object.values(this.#tracks).forEach(track => {
      track.start(currentTime, offset);
    });
    this.#isInitialized = true;

    if (this.#context.state === 'suspended') {
      await this.#context.resume();
    }
  }

  get currentTime() {
    if (this.#startedAt < 0) {
      return 0;
    }

    return this.#context.currentTime - this.#startedAt + this.#trackOffset;
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

    this.#onSongEnded = null;
    this.#context.close();
  }

  #trackEnded() {
    if (Object.values(this.#tracks).some(track => track.ended === false)) {
      return;
    }

    this.stop();
    this.#onSongEnded?.();
  }
}

class AudioTrack {
  #context: AudioContext;
  #audioBuffer: AudioBuffer;

  #gainNode: GainNode | null;

  #source: AudioBufferSourceNode | null = null;

  #onSongEnded: (() => void) | null;
  #songEnded: boolean = false;

  constructor(
    context: AudioContext,
    audioBuffer: AudioBuffer,
    onSongEnded: () => void,
  ) {
    this.#context = context;
    this.#audioBuffer = audioBuffer;
    this.#onSongEnded = onSongEnded;

    const gainNode = this.#context.createGain();
    gainNode.connect(this.#context.destination);
    this.#gainNode = gainNode;

    this.volume = 0.5;
  }

  get ended() {
    return this.#songEnded;
  }

  get duration() {
    return this.#audioBuffer.duration;
  }

  get volume() {
    return Math.sqrt(this.#gainNode!.gain.value);
  }

  set volume(volume: number) {
    // Let's use an x*x curve (x-squared) since simple linear (x) does not
    // sound as good.
    // Taken from https://webaudioapi.com/samples/volume/
    this.#gainNode!.gain.setValueAtTime(
      volume * volume,
      this.#context.currentTime,
    );
    // this.#gainNode!.gain.value = 1;
  }

  start(at: number, offset: number) {
    this.#source = this.#context.createBufferSource();
    this.#source.buffer = this.#audioBuffer;
    this.#source.connect(this.#gainNode!);
    this.#source.addEventListener('ended', this.#endedEventListener);
    this.#source.start(at, offset);
    this.#songEnded = false;
  }

  stop() {
    if (this.#source != null) {
      this.#source.stop();
      this.#source.removeEventListener('ended', this.#endedEventListener);
      this.#source.disconnect();
    }

    this.#source = null;
  }

  destroy() {
    this.stop();
    this.#gainNode!.disconnect();
    this.#gainNode = null;
    this.#onSongEnded = null;
  }

  #endedEventListener: () => void = () => {
    this.stop();
    this.#songEnded = true;
    this.#onSongEnded?.();
  };
}
