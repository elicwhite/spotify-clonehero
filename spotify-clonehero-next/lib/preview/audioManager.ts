import {getBasename} from '../src-shared/utils';
import {Files} from './chorus-chart-processing';

type GroupedFile = {
  fileName: string;
  datas: Uint8Array[];
}[];

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
    window.ctx = this.#context;
    this.#trackOffset = 0;

    this.#context.suspend();

    this.ready = this.#createTracks(audioFiles).then(() => {
      this.#duration = Math.max(
        ...Object.values(this.#tracks).map(track => track.duration),
      );
    });
  }

  async #createTracks(audioFiles: Files) {
    const groupedFiles: GroupedFile = audioFiles.reduce(
      (acc, file) => {
        const isDrums = file.fileName.includes('drums');
        if (isDrums) {
          const drumGroup = acc.find(group => group.fileName === 'drums');
          drumGroup!.datas.push(file.data);
        } else {
          acc.push({fileName: file.fileName, datas: [file.data]});
        }
        return acc;
      },
      [{fileName: 'drums', datas: []} as GroupedFile[0]],
    );

    await Promise.all(
      groupedFiles.map(async group => {
        const trackName = getBasename(group.fileName);
        const arrayBuffers = group.datas;
        const decodedAudioBuffers = await Promise.all(
          arrayBuffers.map(async arrayBuffer => {
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
            return decodedAudioBuffer;
          }),
        );
        const filteredAudioBuffers = decodedAudioBuffers.filter(
          Boolean,
        ) as AudioBuffer[];

        this.#tracks[trackName] = new AudioTrack(
          this.#context,
          filteredAudioBuffers,
          this.#handleTrackEnded.bind(this),
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

  setVolume(trackName: string, volume: number) {
    if (this.#tracks[trackName] == null) {
      throw new Error(
        `Track ${trackName} does not exist. Only have ${Object.keys(
          this.#tracks,
        ).join(', ')}`,
      );
    }

    this.#tracks[trackName].volume = volume > 1 ? 1 : volume < 0 ? 0 : volume;
  }
  // get tracks() {
  //   return Object.values(this.#tracks);
  // }

  get delay() {
    return this.#context.baseLatency + (this.#context.outputLatency || 0);
  }

  get isPlaying() {
    return this.#context.state === 'running';
  }

  get currentTime() {
    if (this.#startedAt < 0) {
      return 0;
    }

    return this.#context.currentTime - this.#startedAt + this.#trackOffset;
  }

  get isInitialized() {
    return this.#isInitialized;
  }

  async stop() {
    Object.values(this.#tracks).forEach(track => {
      track.stop();
    });

    this.#isInitialized = false;
  }

  destroy() {
    Object.values(this.#tracks).forEach(track => {
      track.destroy();
    });
    this.#tracks = {};

    this.#onSongEnded = null;
    this.#context.close();
  }

  #handleTrackEnded() {
    if (Object.values(this.#tracks).some(track => track.ended === false)) {
      return;
    }

    this.stop();
    this.#onSongEnded?.();
  }
}

class AudioTrack {
  #context: AudioContext;
  #gainNodes: GainNode[] = [];
  #audioBuffers: AudioBuffer[] = [];
  #sources: AudioBufferSourceNode[] = [];

  #duration: number = 0;
  #onSongEnded: (() => void) | null;
  #songEnded: boolean = false;

  #volume: number = 1;

  constructor(
    context: AudioContext,
    audioBuffers: AudioBuffer[],
    onSongEnded: () => void,
  ) {
    this.#context = context;
    this.#audioBuffers = audioBuffers;
    this.#onSongEnded = onSongEnded;

    this.#gainNodes = new Array(audioBuffers.length).fill(null).map(() => {
      const gainNode = this.#context.createGain();

      gainNode.connect(this.#context.destination);

      return gainNode;
    });

    this.#duration = Math.max(
      ...this.#audioBuffers.map(buffer => buffer.duration),
    );
  }

  get ended() {
    return this.#songEnded;
  }

  get duration() {
    return this.#duration;
  }

  get volume() {
    return this.#volume;
    // return Math.sqrt(this.#gainNode!.gain.value);
  }

  set volume(newVolume: number) {
    this.#gainNodes.forEach(gainNode => {
      // Let's use an x*x curve (x-squared) since simple linear (x) does not
      // sound as good.
      // Taken from https://webaudioapi.com/samples/volume/
      gainNode.gain.setValueAtTime(
        newVolume * newVolume,
        this.#context.currentTime,
      );
    });
  }

  start(at: number, offset: number) {
    this.#sources = this.#audioBuffers.map((buffer, index) => {
      const source = this.#context.createBufferSource();
      source.buffer = buffer;

      source.connect(this.#gainNodes[index]);
      source.start(at, offset);
      source.addEventListener('ended', this.#endedEventListener);

      return source;
    });

    this.#songEnded = false;
  }

  stop() {
    this.#sources.forEach(source => this.#stopSource(source));

    this.#sources = [];
  }

  #stopSource(source: AudioBufferSourceNode) {
    source.stop();
    source.removeEventListener('ended', this.#endedEventListener);
    source.disconnect();
  }

  destroy() {
    this.stop();

    this.#gainNodes.forEach(node => {
      node.disconnect();
    });
    this.#gainNodes = [];
    this.#onSongEnded = null;
  }

  #endedEventListener: (event: Event) => void = (event: Event) => {
    const source = event.currentTarget as AudioBufferSourceNode;

    this.#stopSource(source);
    this.#sources.splice(this.#sources.indexOf(source), 1);

    if (this.#sources.length === 0) {
      this.#songEnded = true;

      this.#onSongEnded?.();
    }
  };
}
