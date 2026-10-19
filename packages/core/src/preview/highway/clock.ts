/**
 * Everything the highway needs from a playback source.
 *
 * The renderer only ever reads these five values — it never plays, seeks, or
 * mixes. Declaring that narrow surface here lets a non-audio source, such as
 * a video player, drive the highway without either faking an `AudioManager`
 * or widening the renderer.
 *
 * `AudioManager` satisfies this structurally, so existing callers pass it
 * unchanged.
 */
export type HighwayClock = {
  /** Chart-relative playback position, in seconds. */
  readonly chartTime: number;
  /** Chart delay in seconds. Positive = audio has lead-in before the chart. */
  readonly chartDelay: number;
  /**
   * Output latency compensation, in seconds. Applied only while playing.
   * Sources with no observable output latency report 0.
   */
  readonly delay: number;
  readonly isPlaying: boolean;
  readonly isInitialized: boolean;
};
