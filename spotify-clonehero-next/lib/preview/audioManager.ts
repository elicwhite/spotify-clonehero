import {getBasename} from '../src-shared/utils';
import {Files} from './chorus-chart-processing';

type GroupedFile = {
  fileName: string;
  datas: Uint8Array[];
}[];

export interface PracticeModeConfig {
  startMeasureMs: number;
  endMeasureMs: number;
  startTimeMs: number; // 2 seconds before start measure
  endTimeMs: number; // 2 seconds after end measure
}

export interface TempoConfig {
  tempo: number; // 0.25 to 4.0 (0.25x to 4x speed)
}

export class AudioManager {
  #context: AudioContext;
  #soundTouchWorklet: AudioWorkletNode | null = null;
  #tempoConfig: TempoConfig = {tempo: 1.0};

  #startedAt: number = -1;
  // What was the current time in ms when the song started
  // This is non zero when we seek our pause
  #trackOffset: number = 0;
  #duration: number = 0;
  #tracks: {[trackName: string]: AudioTrack} = {};
  #isInitialized: boolean = false;
  #onSongEnded: (() => void) | null;
  #practiceModeConfig: PracticeModeConfig | null = null;

  // Track effective playback time accounting for tempo changes
  #effectivePlayTime: number = 0;
  #lastTempoChangeRealTime: number = 0;
  #lastTempoChangeEffectiveTime: number = 0;

  // -----------------------------------------------------------------------
  // Audio clock smoothing
  // -----------------------------------------------------------------------
  // AudioContext.currentTime updates at the audio hardware rate which
  // doesn't align with requestAnimationFrame. This causes visible stutter
  // when used to position notes/playheads. We smooth it by running our own
  // rAF loop that advances via the rAF timestamp (perfectly monotonic) and
  // gently corrects drift against the real audio clock.
  // -----------------------------------------------------------------------
  #smoothedTime: number = 0; // smoothed currentTime in seconds
  #lastFrameTime: number = 0; // rAF timestamp of previous tick
  #smoothingRafId: number = 0; // rAF handle for the smoothing loop

  // Generation counter to prevent concurrent play() calls from creating
  // orphaned audio sources. Each play() call increments this and checks
  // it after async operations to bail out if a newer call has started.
  #playGeneration: number = 0;

  /**
   * Chart delay in seconds. Positive = audio has lead-in silence before chart
   * starts. Set via setChartDelay() after construction.
   *
   * chartTime = currentTime - chartDelay
   * audioTime = chartTime + chartDelay
   */
  #chartDelay: number = 0;

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
    // Initialize SoundTouch worklet first
    await this.#initializeSoundTouchWorklet();

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
          this.#soundTouchWorklet,
        );
      }),
    );
  }

  async #initializeSoundTouchWorklet() {
    try {
      // Load the SoundTouch worklet
      await this.#context.audioWorklet.addModule('/soundtouch-worklet.js');

      // Create the worklet node
      this.#soundTouchWorklet = new AudioWorkletNode(
        this.#context,
        'soundtouch-processor',
        {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [2], // Stereo output
          processorOptions: {},
        },
      );

      // Option B: Drive speed at the source; worklet performs pitch correction only.
      // Configure SoundTouch so its combined time scaling is 1 (no additional time change),
      // and pitch shift equals 1/tempo: set rate = 1/tempo, tempo = tempo, pitch = 1.0
      const tempoParam = this.#soundTouchWorklet.parameters.get('tempo');
      const rateParam = this.#soundTouchWorklet.parameters.get('rate');
      const pitchParam = this.#soundTouchWorklet.parameters.get('pitch');
      if (tempoParam)
        tempoParam.setValueAtTime(
          this.#tempoConfig.tempo,
          this.#context.currentTime,
        );
      if (rateParam)
        rateParam.setValueAtTime(
          1.0 / this.#tempoConfig.tempo,
          this.#context.currentTime,
        );
      if (pitchParam) pitchParam.setValueAtTime(1.0, this.#context.currentTime);

      // Connect the worklet to destination so audio can flow through
      this.#soundTouchWorklet.connect(this.#context.destination);
    } catch (error) {
      console.error('Failed to initialize SoundTouch worklet:', error);
      this.#soundTouchWorklet = null;
    }
  }

  // Tempo control methods
  setTempo(tempo: number) {
    if (tempo < 0.25 || tempo > 4.0) {
      throw new Error('Tempo must be between 0.25 and 4.0');
    }

    // Update effective play time when tempo changes
    if (this.#isInitialized && this.#startedAt >= 0) {
      const currentRealTime = this.#context.currentTime;
      const timeSinceLastChange =
        currentRealTime - this.#lastTempoChangeRealTime;

      // When tempo is 0.5 (half speed), audio time progresses at half the rate of real time
      const effectiveTimeSinceLastChange =
        timeSinceLastChange * this.#tempoConfig.tempo;

      this.#effectivePlayTime =
        this.#lastTempoChangeEffectiveTime + effectiveTimeSinceLastChange;
      this.#lastTempoChangeRealTime = currentRealTime;
      this.#lastTempoChangeEffectiveTime = this.#effectivePlayTime;
    }

    this.#tempoConfig.tempo = tempo;

    if (this.#soundTouchWorklet) {
      // Worklet performs pitch correction only: set rate=1/tempo and tempo=tempo so total time scaling = 1
      const tempoParam = this.#soundTouchWorklet.parameters.get('tempo');
      const rateParam = this.#soundTouchWorklet.parameters.get('rate');
      const pitchParam = this.#soundTouchWorklet.parameters.get('pitch');
      if (tempoParam)
        tempoParam.setValueAtTime(tempo, this.#context.currentTime);
      if (rateParam)
        rateParam.setValueAtTime(1.0 / tempo, this.#context.currentTime);
      if (pitchParam) pitchParam.setValueAtTime(1.0, this.#context.currentTime);
    }

    // Update all tracks to use the new tempo (drive playbackRate at the source)
    Object.values(this.#tracks).forEach(track => {
      track.setTempo(tempo);
    });
  }

  // Convenience methods for speed control
  speedUp(factor: number = 1.25) {
    const newTempo = Math.min(this.#tempoConfig.tempo * factor, 4.0);
    this.setTempo(newTempo);
    return newTempo;
  }

  slowDown(factor: number = 0.8) {
    const newTempo = Math.max(this.#tempoConfig.tempo * factor, 0.25);
    this.setTempo(newTempo);
    return newTempo;
  }

  resetSpeed() {
    this.setTempo(1.0);
  }

  getTempoConfig(): TempoConfig {
    return {...this.#tempoConfig};
  }

  getCurrentTempo(): number {
    return this.#tempoConfig.tempo;
  }

  async pause() {
    if (this.#context.state === 'running') {
      this.#stopSmoothingLoop();
      await this.#context.suspend();
    }
  }

  async resume() {
    if (this.#context.state === 'suspended') {
      await this.#context.resume();
      this.#startSmoothingLoop();
    }
  }

  async play({percent, time}: {percent?: number; time?: number}) {
    if (percent == null && time == null) {
      throw new Error('Must provide percent or time');
    }

    // Stop any existing smoothing loop (will restart after audio is playing)
    this.#stopSmoothingLoop();

    // Increment generation so any earlier in-flight play() call will bail out
    // after its async operations complete.
    const generation = ++this.#playGeneration;

    // Always stop existing sources to prevent stacking audio on top of
    // already-playing sources.
    if (this.#isInitialized) {
      this.stop();
    }

    const currentTime = this.#context.currentTime;
    const songLength = this.#duration;
    const offset: number = time ?? songLength * percent!;
    this.#trackOffset = offset;
    this.#startedAt = currentTime;

    // Initialize tempo tracking variables
    this.#effectivePlayTime = offset;
    this.#lastTempoChangeRealTime = currentTime;
    this.#lastTempoChangeEffectiveTime = offset;

    Object.values(this.#tracks).forEach(track => {
      track.start(currentTime, offset);
    });
    this.#isInitialized = true;

    if (this.#context.state === 'suspended') {
      await this.#context.resume();
      // If a newer play() call started while we were awaiting resume(),
      // our sources have already been stopped. Don't do anything else.
      if (generation !== this.#playGeneration) {
        return;
      }
    }

    this.#startSmoothingLoop();
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

  get trackNames(): readonly string[] {
    return Object.keys(this.#tracks);
  }

  get delay() {
    return this.#context.baseLatency + (this.#context.outputLatency || 0);
  }

  get isPlaying() {
    return this.#context.state === 'running';
  }

  /**
   * Raw (unsmoothed) playback position in seconds. Reads directly from
   * AudioContext.currentTime which updates at the hardware sample rate
   * and may jitter relative to requestAnimationFrame.
   */
  get #rawCurrentTime(): number {
    if (this.#startedAt < 0) {
      return 0;
    }

    // Calculate effective time since last tempo change
    const currentRealTime = this.#context.currentTime;
    const timeSinceLastChange = currentRealTime - this.#lastTempoChangeRealTime;

    const effectiveTimeSinceLastChange =
      timeSinceLastChange * this.#tempoConfig.tempo;

    return this.#lastTempoChangeEffectiveTime + effectiveTimeSinceLastChange;
  }

  /**
   * Start the internal rAF smoothing loop. Called automatically on play/resume.
   * Multiple calls are safe — only one loop runs at a time.
   */
  #startSmoothingLoop(): void {
    if (this.#smoothingRafId) return; // already running

    const tick = (frameTime: number) => {
      if (!this.isPlaying || !this.#isInitialized) {
        // Playback ended while loop was scheduled — stop
        this.#smoothingRafId = 0;
        this.#lastFrameTime = 0;
        this.#smoothedTime = this.#rawCurrentTime;
        return;
      }

      const raw = this.#rawCurrentTime;

      if (this.#lastFrameTime === 0) {
        // First tick — initialize
        this.#lastFrameTime = frameTime;
        this.#smoothedTime = raw;
      } else {
        // Advance by real elapsed time × current tempo
        const realDeltaSec = (frameTime - this.#lastFrameTime) / 1000;
        this.#lastFrameTime = frameTime;
        this.#smoothedTime += realDeltaSec * this.#tempoConfig.tempo;

        // Drift correction against the authoritative audio clock.
        const drift = raw - this.#smoothedTime;
        if (Math.abs(drift) > 0.08) {
          // Large discontinuity (seek, pause/resume, tab switch) — snap
          this.#smoothedTime = raw;
        } else {
          // Absorb 2% of drift per frame (~60fps → corrects 50ms in ~1.5s)
          this.#smoothedTime += drift * 0.02;
        }
      }

      this.#smoothingRafId = requestAnimationFrame(tick);
    };

    this.#smoothingRafId = requestAnimationFrame(tick);
  }

  /** Stop the smoothing loop. Called on pause/stop. */
  #stopSmoothingLoop(): void {
    if (this.#smoothingRafId) {
      cancelAnimationFrame(this.#smoothingRafId);
      this.#smoothingRafId = 0;
    }
    this.#lastFrameTime = 0;
    this.#smoothedTime = this.#rawCurrentTime;
  }

  /**
   * Current playback position in seconds (smoothed).
   * During playback, returns a jitter-free value driven by the internal
   * rAF loop. When paused/stopped, returns the raw audio clock value.
   */
  get currentTime(): number {
    if (this.#lastFrameTime === 0) {
      return this.#rawCurrentTime;
    }
    return this.#smoothedTime;
  }

  get isInitialized() {
    return this.#isInitialized;
  }

  get duration() {
    return this.#duration;
  }

  /**
   * Chart delay in seconds. Positive = audio has lead-in before chart.
   */
  get chartDelay() {
    return this.#chartDelay;
  }

  /**
   * Set the chart delay (in seconds). Call after construction when chart
   * metadata is available.
   */
  setChartDelay(delaySec: number) {
    this.#chartDelay = delaySec;
  }

  /**
   * Current playback position in chart-relative seconds.
   * Accounts for the chart delay: chartTime = currentTime - chartDelay.
   * Use this for note positioning, display, seeking to chart positions.
   */
  get chartTime() {
    return this.currentTime - this.#chartDelay;
  }

  /**
   * Seek to a chart-relative time position (in seconds).
   * Internally adds chartDelay to get the audio time.
   */
  async playChartTime(chartTimeSec: number) {
    return this.play({time: chartTimeSec + this.#chartDelay});
  }

  async stop() {
    Object.values(this.#tracks).forEach(track => {
      track.stop();
    });

    this.#isInitialized = false;
    // Clear tempo tracking variables when stopping
    this.#effectivePlayTime = 0;
    this.#lastTempoChangeRealTime = 0;
    this.#lastTempoChangeEffectiveTime = 0;
    this.#stopSmoothingLoop();
  }

  destroy() {
    Object.values(this.#tracks).forEach(track => {
      track.destroy();
    });
    this.#tracks = {};

    this.#onSongEnded = null;
    this.#context.close();
  }

  setPracticeMode(practiceMode: PracticeModeConfig | null) {
    this.#practiceModeConfig = practiceMode;
  }

  getPracticeMode(): PracticeModeConfig | null {
    return this.#practiceModeConfig;
  }

  isPracticeMode(): boolean {
    return this.#practiceModeConfig !== null;
  }

  #handleTrackEnded() {
    if (Object.values(this.#tracks).some(track => track.ended === false)) {
      return;
    }

    // If in practice mode, loop back to start of practice section
    if (this.#practiceModeConfig !== null) {
      this.play({time: this.#practiceModeConfig.startTimeMs / 1000});
      return;
    }

    this.stop();
    this.#onSongEnded?.();
  }

  // Check if we need to loop in practice mode
  checkPracticeModeLoop() {
    if (!this.#practiceModeConfig || !this.#isInitialized) {
      return;
    }

    const currentTimeMs = this.currentTime * 1000;

    // If we've reached the end of the practice section, loop back
    if (currentTimeMs >= this.#practiceModeConfig.endTimeMs) {
      this.play({time: this.#practiceModeConfig.startTimeMs / 1000});
    } else if (currentTimeMs < this.#practiceModeConfig.startTimeMs) {
      this.play({time: this.#practiceModeConfig.startTimeMs / 1000});
    }
  }
}

class AudioTrack {
  #context: AudioContext;
  #gainNodes: GainNode[] = [];
  #audioBuffers: AudioBuffer[] = [];
  #sources: AudioBufferSourceNode[] = [];
  #tempo: number = 1.0;
  #workletNode: AudioWorkletNode | null = null;

  #duration: number = 0;
  #onSongEnded: (() => void) | null;
  #songEnded: boolean = false;

  #volume: number = 0;

  constructor(
    context: AudioContext,
    audioBuffers: AudioBuffer[],
    onSongEnded: () => void,
    workletNode?: AudioWorkletNode | null,
  ) {
    this.#context = context;
    this.#audioBuffers = audioBuffers;
    this.#onSongEnded = onSongEnded;
    this.#workletNode = workletNode || null;

    this.#gainNodes = new Array(audioBuffers.length).fill(null).map(() => {
      const gainNode = this.#context.createGain();

      // Connect through the worklet if available, otherwise directly to destination
      if (this.#workletNode) {
        gainNode.connect(this.#workletNode);
      } else {
        gainNode.connect(this.#context.destination);
      }

      return gainNode;
    });

    this.#duration = Math.max(
      ...this.#audioBuffers.map(buffer => buffer.duration),
    );

    this.volume = 1;
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
        (newVolume * newVolume) / 2,
        this.#context.currentTime,
      );
    });
  }

  // Tempo control methods
  setTempo(tempo: number) {
    this.#tempo = tempo;
    // Update live sources so the graph feeds more/fewer samples per second
    this.#sources.forEach(src => {
      try {
        src.playbackRate.setValueAtTime(tempo, this.#context.currentTime);
      } catch {
        src.playbackRate.value = tempo;
      }
    });
  }

  getTempo(): number {
    return this.#tempo;
  }

  start(at: number, offset: number) {
    // Defensively stop any existing sources to prevent stacking
    if (this.#sources.length > 0) {
      this.stop();
    }

    this.#sources = this.#audioBuffers.map((buffer, index) => {
      const source = this.#context.createBufferSource();
      source.buffer = buffer;

      // Option B: Drive tempo via playbackRate on the source
      try {
        source.playbackRate.setValueAtTime(
          this.#tempo,
          this.#context.currentTime,
        );
      } catch {
        // Fallback for browsers without setValueAtTime on AudioParam
        source.playbackRate.value = this.#tempo;
      }

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
