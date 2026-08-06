import {getBasename} from '../src-shared/utils';
import {
  evaluateLoop,
  isUsableLoopRegion,
  seekEscapesLoop,
  type LoopRegion,
} from './loopRegion';

type GroupedFile = {
  trackName: string;
  sources: AudioSource[];
}[];

export interface PracticeModeConfig {
  startMeasureMs: number;
  endMeasureMs: number;
  startTimeMs: number; // 2 seconds before start measure
  endTimeMs: number; // 2 seconds after end measure
}

/**
 * The one loop the manager honours. Practice mode and the chart editor's A/B
 * loop both compile down to this, so there is a single place that decides to
 * wrap playback and a single seek path.
 */
interface ActiveLoop extends LoopRegion {
  /** Which clock `startMs`/`endMs` are measured on. */
  timeBase: 'audio' | 'chart';
  /** See `confine` in `evaluateLoop`. */
  confine: boolean;
}

export interface TempoConfig {
  tempo: number; // 0.25 to 4.0 (0.25x to 4x speed)
}

/**
 * Mono PCM plus the rate it was rendered at, for audio this app synthesizes
 * rather than decodes. Handing these straight to {@link AudioManager.replaceTrack}
 * skips a WAV encode and a `decodeAudioData` that only ever existed to get
 * synthesized samples back into an `AudioBuffer` they started next to.
 */
export interface TrackPcm {
  samples: Float32Array;
  sampleRate: number;
}

/**
 * One file's worth of audio for {@link AudioManager}: either encoded bytes to
 * decode, or samples this app synthesized and therefore never has to encode.
 * `Files` is assignable, so callers with real audio pass it unchanged.
 */
export type AudioSource =
  | {fileName: string; data: Uint8Array}
  | {fileName: string; pcm: TrackPcm};

/**
 * The track a file plays under. Files that share one name mix into a single
 * `AudioTrack`, which is what gives them one fader and one set of per-buffer
 * gains: every `drums_N.ogg` is one kit, and the click's per-subdivision
 * voices are one metronome.
 */
function trackNameForFile(fileName: string): string {
  if (fileName.includes('drums')) return 'drums';
  if (fileName.includes('click')) return 'click';
  return getBasename(fileName);
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
  #destroyed: boolean = false;
  #onSongEnded: (() => void) | null;
  #activeLoop: ActiveLoop | null = null;
  #loopEscaped: boolean = false;

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

  constructor(audioFiles: readonly AudioSource[], onSongEnded: () => void) {
    this.#onSongEnded = onSongEnded;
    this.#context = new (window.AudioContext || window['webkitAudioContext'])();
    window['ctx'] = this.#context;
    this.#trackOffset = 0;

    this.#context.suspend();

    this.ready = this.#createTracks(audioFiles).then(() => {
      // `Math.max()` of nothing is -Infinity, which would flow into every
      // seek clamp and the transport readout as a frozen playhead with no
      // error to explain it.
      const durations = Object.values(this.#tracks).map(
        track => track.duration,
      );
      this.#duration = durations.length > 0 ? Math.max(...durations) : 0;
    });
  }

  async #createTracks(audioFiles: readonly AudioSource[]) {
    // Initialize SoundTouch worklet first
    await this.#initializeSoundTouchWorklet();

    // If the manager was destroyed while the worklet loaded (StrictMode
    // double-mount, or the user left the view), stop here — building tracks
    // would connect nodes on a closed context.
    if (this.#destroyed) return;

    // Files that map to the same track name (see `trackNameForFile`) become
    // one track, in the order they were passed. A group is created only when
    // such a file exists, so a package without drums audio has no empty
    // `drums` track that UI built from `trackNames` would offer as a phantom
    // control.
    const groupedFiles: GroupedFile = audioFiles.reduce((acc, file) => {
      const trackName = trackNameForFile(file.fileName);
      const group = acc.find(g => g.trackName === trackName);
      if (group) {
        group.sources.push(file);
      } else {
        acc.push({trackName, sources: [file]});
      }
      return acc;
    }, [] as GroupedFile);

    await Promise.all(
      groupedFiles.map(async group => {
        const trackName = group.trackName;
        const decodedAudioBuffers = await Promise.all(
          group.sources.map(source => this.#toAudioBuffer(source)),
        );
        const filteredAudioBuffers = decodedAudioBuffers.filter(
          Boolean,
        ) as AudioBuffer[];

        // Decoding is async; bail if we were destroyed meanwhile so we don't
        // construct/connect nodes on a closed context.
        if (this.#destroyed) return;

        this.#tracks[trackName] = new AudioTrack(
          this.#context,
          filteredAudioBuffers,
          this.#handleTrackEnded.bind(this),
          this.#soundTouchWorklet,
        );
      }),
    );
  }

  /** Synthesized samples straight into an `AudioBuffer`; encoded bytes through
   *  the platform decoder, falling back to `audio-decode` for formats it
   *  refuses. `undefined` when nothing could decode it. */
  async #toAudioBuffer(source: AudioSource): Promise<AudioBuffer | undefined> {
    if ('pcm' in source) return this.#pcmToBuffer(source.pcm);

    const bufferCopy = source.data.slice(0).buffer as ArrayBuffer;
    try {
      return await this.#context.decodeAudioData(bufferCopy);
    } catch {
      try {
        const decode = await import('audio-decode');
        return await decode.default(bufferCopy);
      } catch {
        console.error('Could not decode audio');
        return undefined;
      }
    }
  }

  #pcmToBuffer({samples, sampleRate}: TrackPcm): AudioBuffer {
    const buffer = this.#context.createBuffer(
      1,
      Math.max(1, samples.length),
      sampleRate,
    );
    buffer.getChannelData(0).set(samples);
    return buffer;
  }

  async #initializeSoundTouchWorklet() {
    if (this.#destroyed) return;
    try {
      // Load the SoundTouch worklet
      await this.#context.audioWorklet.addModule('/soundtouch-worklet.js');

      // The load is async; the context may have closed while it ran.
      if (this.#destroyed) return;

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
      this.#soundTouchWorklet = null;
      // An AbortError here is expected when the context was closed mid-load
      // (teardown / StrictMode double-mount) — don't surface it as an error.
      if (this.#destroyed) return;
      console.error('Failed to initialize SoundTouch worklet:', error);
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

    const tempoChanged = tempo !== this.#tempoConfig.tempo;
    this.#tempoConfig.tempo = tempo;

    if (this.#soundTouchWorklet) {
      // Worklet performs pitch correction only: set rate=1/tempo and tempo=tempo so total time scaling = 1.
      // These parameters only matter while the worklet is in the signal path
      // (tempo !== 1.0); AudioTrack routes around it entirely at tempo 1.0.
      const tempoParam = this.#soundTouchWorklet.parameters.get('tempo');
      const rateParam = this.#soundTouchWorklet.parameters.get('rate');
      const pitchParam = this.#soundTouchWorklet.parameters.get('pitch');
      if (tempoParam)
        tempoParam.setValueAtTime(tempo, this.#context.currentTime);
      if (rateParam)
        rateParam.setValueAtTime(1.0 / tempo, this.#context.currentTime);
      if (pitchParam) pitchParam.setValueAtTime(1.0, this.#context.currentTime);
    }

    // A tempo change may switch a track's routing (direct <-> worklet) or
    // leave the worklet holding audio queued for the old parameters. Either
    // way its FIFOs are now stale, so drop them before anything plays again.
    if (tempoChanged) {
      this.#clearWorklet();
    }

    // Update all tracks to use the new tempo (drive playbackRate at the source)
    Object.values(this.#tracks).forEach(track => {
      track.setTempo(tempo);
    });
  }

  /** Empty the SoundTouch worklet's internal FIFOs so it doesn't play stale,
   *  pre-transition audio once it's back in (or still in) the signal path. */
  #clearWorklet() {
    this.#soundTouchWorklet?.port.postMessage({type: 'clear'});
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
    this.#noteSeek(offset);
    this.#trackOffset = offset;
    this.#startedAt = currentTime;

    // Initialize tempo tracking variables
    this.#effectivePlayTime = offset;
    this.#lastTempoChangeRealTime = currentTime;
    this.#lastTempoChangeEffectiveTime = offset;

    // Sources are being rebuilt at a new offset; if the worklet is in the
    // signal path it may still hold audio queued from before this jump.
    if (this.#tempoConfig.tempo !== 1.0) {
      this.#clearWorklet();
    }

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

  /** Current volume (0-1) for a track, or null for an unknown track. */
  getVolume(trackName: string): number | null {
    const track = this.#tracks[trackName];
    return track ? track.volume : null;
  }

  /**
   * The gain applied to one buffer of a multi-buffer track, on top of the
   * track's own volume. This is how the click's per-subdivision faders move
   * without re-rendering: each subdivision is a buffer in the one `click`
   * track, rendered at unit amplitude.
   *
   * Linear, deliberately: it replaces amplitude a caller would otherwise have
   * baked into the samples, and baked-in amplitude is linear. The track's
   * `volume` keeps its own x-squared curve and multiplies this.
   *
   * A no-op on an unknown track or buffer index.
   */
  setBufferGain(trackName: string, index: number, gain: number) {
    this.#tracks[trackName]?.setBufferGain(index, gain);
  }

  /**
   * Swap one track's audio for freshly rendered samples, leaving every other
   * track playing untouched: the same AudioContext, the same SoundTouch
   * worklet, the same volume, and the same playhead.
   *
   * This exists for the synthesized metronome click, which is a function of
   * the chart's tempo map and so goes stale the moment the user edits one.
   * Constructing a replacement `AudioManager` for that would open a second
   * AudioContext, reload the worklet and re-decode every stem of the song —
   * seconds of work to change one 8 kHz mono track.
   *
   * `bufferGains` sets the new buffers' per-buffer gains (see
   * {@link setBufferGain}) as they are created, so a replacement that changes
   * the buffer layout never plays a frame at the wrong balance.
   *
   * A no-op on an unknown track name: a caller keeping a derived track in
   * step shouldn't have to know whether this manager was built with one.
   */
  async replaceTrack(
    trackName: string,
    pcm: TrackPcm | TrackPcm[],
    bufferGains?: number[],
  ): Promise<void> {
    await this.ready;
    if (this.#destroyed) return;
    const existing = this.#tracks[trackName];
    if (!existing) return;

    const buffers = (Array.isArray(pcm) ? pcm : [pcm]).map(one =>
      this.#pcmToBuffer(one),
    );

    // Read the playhead BEFORE swapping: the new source has to start where
    // the old one was, or the click would sit behind the music.
    const volume = existing.volume;
    const resumeAt = this.#rawCurrentTime;
    const wasStarted = this.#isInitialized;

    existing.destroy();
    const track = new AudioTrack(
      this.#context,
      buffers,
      this.#handleTrackEnded.bind(this),
      this.#soundTouchWorklet,
    );
    track.setTempo(this.#tempoConfig.tempo);
    bufferGains?.forEach((gain, index) => track.setBufferGain(index, gain));
    track.volume = volume;
    this.#tracks[trackName] = track;
    if (wasStarted) track.start(this.#context.currentTime, resumeAt);

    const durations = Object.values(this.#tracks).map(t => t.duration);
    this.#duration = durations.length > 0 ? Math.max(...durations) : 0;
  }

  get trackNames(): readonly string[] {
    return Object.keys(this.#tracks);
  }

  /**
   * Interleaved PCM for a track's primary decoded buffer, for waveform
   * display (piano-roll source selector). Returns `null` for an unknown
   * track or one whose buffer hasn't decoded yet. The data is a copy — the
   * caller owns it and can't perturb playback.
   */
  getTrackPcm(
    trackName: string,
  ): {data: Float32Array; channels: number} | null {
    const track = this.#tracks[trackName];
    return track ? track.interleavedPcm() : null;
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

      // Wrap before smoothing so the playhead never renders past the loop
      // end. A wrap re-enters play(), which restarts this loop with fresh
      // timing, so this tick must not schedule another frame of its own.
      if (this.updateLoop()) {
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

  /**
   * Seek to a position without changing playback state.
   * - If currently playing: keeps playing from the new position.
   * - If paused/uninitialized: updates currentTime to the new position
   *   and rebuilds source nodes so a subsequent resume() plays from the
   *   new position. The AudioContext is NOT resumed here.
   */
  async seekTo(timeSec: number) {
    if (this.isPlaying) {
      return this.play({time: timeSec});
    }

    // Stop any existing sources so we can rebuild them at the new offset.
    // Don't use stop() — it resets timing fields and #isInitialized, which
    // we want to preserve / set explicitly below.
    Object.values(this.#tracks).forEach(track => {
      track.stop();
    });

    // Sources are being rebuilt at the seeked offset; drop anything the
    // worklet still has queued from before the seek.
    if (this.#tempoConfig.tempo !== 1.0) {
      this.#clearWorklet();
    }

    this.#noteSeek(timeSec);

    const realTime = this.#context.currentTime;
    this.#trackOffset = timeSec;
    this.#startedAt = realTime;
    this.#effectivePlayTime = timeSec;
    this.#lastTempoChangeRealTime = realTime;
    this.#lastTempoChangeEffectiveTime = timeSec;

    // Schedule new sources at the seeked offset. AudioContext stays
    // suspended (we don't call resume()), so no audio plays yet — but a
    // later resume() will start playback from this position seamlessly,
    // matching the existing pause()/resume() contract.
    Object.values(this.#tracks).forEach(track => {
      track.start(realTime, timeSec);
    });
    this.#isInitialized = true;

    // Make sure the smoothing loop isn't running so currentTime returns
    // the raw (now-updated) value rather than the stale smoothed value.
    this.#stopSmoothingLoop();
  }

  /**
   * Seek to a chart-relative time position without changing playback state.
   */
  async seekToChartTime(chartTimeSec: number) {
    return this.seekTo(chartTimeSec + this.#chartDelay);
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
    // Idempotent: destroy() may be called multiple times on the same
    // instance in StrictMode dev (setState updaters and effect bodies
    // run twice), and AudioContext.close() on an already-closed context
    // throws InvalidStateError. Guard with a flag so only the first
    // call does teardown.
    if (this.#destroyed) return;
    this.#destroyed = true;

    Object.values(this.#tracks).forEach(track => {
      track.destroy();
    });
    this.#tracks = {};

    this.#onSongEnded = null;
    this.#context.close();
  }

  /**
   * Confine playback to a practice section (audio-time ms), or `null` to
   * release it. Replaces whatever loop is set — the manager honours one at a
   * time.
   */
  setPracticeMode(practiceMode: PracticeModeConfig | null) {
    this.#setActiveLoop(
      practiceMode === null
        ? null
        : {
            startMs: practiceMode.startTimeMs,
            endMs: practiceMode.endTimeMs,
            timeBase: 'audio',
            confine: true,
          },
    );
  }

  /**
   * Set the A/B loop region in chart-relative ms (the time base the chart
   * editor's `loopRegion` state uses), or `null` to clear it. Playback wraps
   * from `endMs` back to `startMs`; seeking to or past the end leaves the
   * user free to keep listening past it.
   *
   * Moving the markers hands control back to the loop, so dragging the end
   * flag behind the playhead wraps on the next frame of playback instead of
   * being mistaken for the user having escaped.
   *
   * Replaces any practice-mode section, so there is only ever one loop.
   */
  setLoopRegion(region: LoopRegion | null) {
    this.#setActiveLoop(
      isUsableLoopRegion(region)
        ? {
            startMs: region.startMs,
            endMs: region.endMs,
            timeBase: 'chart',
            confine: false,
          }
        : null,
    );
  }

  /** Install the one loop, in charge of the playhead from this moment on. */
  #setActiveLoop(loop: ActiveLoop | null) {
    this.#activeLoop = loop;
    this.#loopEscaped = false;
  }

  /**
   * Record whether a seek to `timeSec` (audio clock) leaves the active loop.
   * Every seek runs through here, so the loop can tell "the user went
   * somewhere past the end" from "the end moved behind the playhead".
   */
  #noteSeek(timeSec: number) {
    const loop = this.#activeLoop;
    if (!loop) {
      this.#loopEscaped = false;
      return;
    }
    this.#loopEscaped = seekEscapesLoop(loop, this.#toLoopMs(loop, timeSec));
  }

  /** The active A/B loop in chart ms, or `null` (practice mode is not one). */
  getLoopRegion(): LoopRegion | null {
    const loop = this.#activeLoop;
    if (!loop || loop.timeBase !== 'chart') return null;
    return {startMs: loop.startMs, endMs: loop.endMs};
  }

  #handleTrackEnded() {
    if (Object.values(this.#tracks).some(track => track.ended === false)) {
      return;
    }

    // A loop whose end sits past the last sample never gets a crossing to
    // wrap on, so running out of audio wraps instead of ending the song. An
    // A/B loop skips that once the user has escaped it: someone who seeked
    // past the loop and played the rest of the song out gets the end of the
    // song, not a jump back into a region they deliberately left.
    const loop = this.#activeLoop;
    if (loop !== null && (loop.confine || !this.#loopEscaped)) {
      this.play({time: this.#toAudioSec(loop, Math.max(0, loop.startMs))});
      return;
    }

    this.stop();
    this.#onSongEnded?.();
  }

  /** A position in a loop's own time base, as audio-clock seconds. */
  #toAudioSec(loop: ActiveLoop, ms: number): number {
    const sec = ms / 1000;
    return loop.timeBase === 'chart' ? sec + this.#chartDelay : sec;
  }

  /** An audio-clock position in seconds, as ms in a loop's own time base. */
  #toLoopMs(loop: ActiveLoop, timeSec: number): number {
    const sec =
      loop.timeBase === 'chart' ? timeSec - this.#chartDelay : timeSec;
    return sec * 1000;
  }

  /**
   * Wrap playback if the playhead has left the active loop. Called every
   * frame from the smoothing loop; also exposed so callers with their own
   * tick can drive it. Returns true when it seeked.
   */
  updateLoop(): boolean {
    const loop = this.#activeLoop;
    if (!loop || !this.#isInitialized) {
      return false;
    }

    const currentMs =
      (loop.timeBase === 'chart' ? this.chartTime : this.currentTime) * 1000;

    const {seekToMs, escaped} = evaluateLoop({
      currentMs,
      region: loop,
      isPlaying: this.isPlaying,
      escaped: this.#loopEscaped,
      confine: loop.confine,
    });
    this.#loopEscaped = escaped;

    if (seekToMs === null) return false;

    this.play({time: this.#toAudioSec(loop, seekToMs)});
    return true;
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

  /**
   * A linear multiplier per buffer, applied on top of the track volume. `1`
   * unless a caller sets one: a track built from several buffers is one fader
   * to the mixer, and these are the balance between its parts.
   */
  #bufferGains: number[] = [];

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

    this.#gainNodes = new Array(audioBuffers.length)
      .fill(null)
      .map(() => this.#context.createGain());
    this.#bufferGains = new Array(audioBuffers.length).fill(1);
    this.#routeGains();

    this.#duration = Math.max(
      ...this.#audioBuffers.map(buffer => buffer.duration),
    );

    this.volume = 1;
  }

  /**
   * Where a gain node's output should go: at tempo 1.0 (or with no worklet
   * loaded), straight to the destination, bypassing the SoundTouch worklet's
   * WSOLA processing entirely so unshifted playback carries none of its
   * ~110ms latency. Off 1.0, through the worklet for pitch correction.
   */
  #routeTarget(): AudioNode {
    return this.#workletNode && this.#tempo !== 1.0
      ? this.#workletNode
      : this.#context.destination;
  }

  /** (Re)connect every gain node to the current route target. */
  #routeGains(): void {
    const target = this.#routeTarget();
    this.#gainNodes.forEach(gainNode => {
      gainNode.disconnect();
      gainNode.connect(target);
    });
  }

  get ended() {
    return this.#songEnded;
  }

  /**
   * Interleaved Float32 PCM for this track's primary buffer (for waveform
   * peaks). A copy, so the caller can't perturb the live graph. `null` when
   * no buffer has decoded.
   */
  interleavedPcm(): {data: Float32Array; channels: number} | null {
    const buffer = this.#audioBuffers[0];
    if (!buffer) return null;
    const channels = buffer.numberOfChannels;
    const length = buffer.length;
    const data = new Float32Array(length * channels);
    for (let c = 0; c < channels; c++) {
      const ch = buffer.getChannelData(c);
      for (let i = 0; i < length; i++) data[i * channels + c] = ch[i];
    }
    return {data, channels};
  }

  get duration() {
    return this.#duration;
  }

  get volume() {
    return this.#volume;
    // return Math.sqrt(this.#gainNode!.gain.value);
  }

  set volume(newVolume: number) {
    this.#volume = newVolume;
    this.#gainNodes.forEach((_, index) => this.#applyGain(index));
  }

  /** Set one buffer's linear balance within this track. */
  setBufferGain(index: number, gain: number) {
    if (index < 0 || index >= this.#gainNodes.length) return;
    this.#bufferGains[index] = gain;
    this.#applyGain(index);
  }

  #applyGain(index: number): void {
    // The track volume uses an x*x curve (x-squared) since simple linear (x)
    // does not sound as good. Taken from
    // https://webaudioapi.com/samples/volume/. The per-buffer gain is linear
    // on top of it, matching amplitude baked into samples.
    this.#gainNodes[index].gain.setValueAtTime(
      ((this.#volume * this.#volume) / 2) * this.#bufferGains[index],
      this.#context.currentTime,
    );
  }

  // Tempo control methods
  setTempo(tempo: number) {
    const previousTarget = this.#routeTarget();
    this.#tempo = tempo;
    if (this.#routeTarget() !== previousTarget) {
      this.#routeGains();
    }
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
