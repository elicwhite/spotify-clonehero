/**
 * Decides whether the highway stage owes the GPU a frame, and whether the
 * animation loop should stay armed at all.
 *
 * Every pixel the stage draws is a function of exactly two things: the chart
 * time the frame is drawn at, and the state the editor has pushed in. Nothing
 * on the highway runs off a wall clock while the transport is stopped -- the
 * hit-flame frame index and the karaoke overlay both index off chart time, and
 * the looping animated textures are only advanced while audio is playing. So a
 * candidate frame whose chart time and pushed state both match the last drawn
 * frame is pixel-identical to it, and skipping it cannot be seen.
 *
 * That makes "render" the default and stopping the narrow case: the gate draws
 * unless it can name the reason the frame would be identical.
 *
 * Two knobs keep the narrow case safe:
 *
 * - `wake()` is the "state changed" signal. It is O(1), it coalesces (any
 *   number of calls between frames cost one frame), and it never draws by
 *   itself -- the next vsync does.
 * - After the last drawn frame the loop stays armed for `lingerMs`, so a burst
 *   of interaction never pays to re-arm mid-gesture and the low-rate poll that
 *   stands in for the parked loop only ever runs during genuinely dead time.
 */

/** Why a candidate frame has to be drawn. */
export type RenderReason =
  /** Nothing has been drawn yet. */
  | 'first'
  /** Audio is advancing, so the looping animated textures advance with it. */
  | 'playing'
  /** Chart time moved: playback, a seek, or a scrub. */
  | 'time'
  /** Something was pushed into the stage since the last drawn frame. */
  | 'wake';

export interface FrameInput {
  /** Monotonic wall clock for this candidate frame, in ms. */
  nowMs: number;
  /** Chart time (minus audio latency) the frame would draw at, in ms. */
  elapsedMs: number;
  /** Whether audio is currently advancing. */
  isPlaying: boolean;
}

export interface FrameDecision {
  /** Draw this frame. */
  render: boolean;
  /** Why it is being drawn; null when it is being skipped. */
  reason: RenderReason | null;
  /**
   * Keep the animation loop armed for the next vsync. False means the caller
   * should park the loop and fall back to its low-rate poll.
   */
  keepAwake: boolean;
}

/**
 * Chart-time difference below which two frames are treated as the same time.
 *
 * Matches the piano roll's playhead threshold so both surfaces agree on what
 * counts as "the transport has not moved". Well under a pixel at any zoom.
 */
export const TIME_EPSILON_MS = 0.05;

/** How long the loop stays armed after the last drawn frame. */
export const DEFAULT_LINGER_MS = 400;

export interface RenderGateOptions {
  /** Overrides {@link DEFAULT_LINGER_MS}. */
  lingerMs?: number;
}

export class RenderGate {
  private readonly lingerMs: number;

  /** Chart time of the last drawn frame; null until one is drawn. */
  private lastElapsedMs: number | null = null;
  /** Wall clock of the last drawn frame; null until one is drawn. */
  private lastRenderNowMs: number | null = null;
  /** A push landed and has not been drawn yet. */
  private wakePending = false;

  constructor(options: RenderGateOptions = {}) {
    this.lingerMs = options.lingerMs ?? DEFAULT_LINGER_MS;
  }

  /**
   * Record that something the renderer reads has changed. Cheap enough to call
   * from every setter on every push; the cost of an actual frame is paid once,
   * at the next `evaluate`.
   */
  wake(): void {
    this.wakePending = true;
  }

  /** Whether a push is waiting to be drawn. */
  get hasPendingWake(): boolean {
    return this.wakePending;
  }

  /**
   * Why this candidate frame has to be drawn, or null if it would be identical
   * to the last one. Pure: safe to call from a poll that is only deciding
   * whether to re-arm the loop.
   */
  reasonToRender(input: FrameInput): RenderReason | null {
    if (this.lastElapsedMs === null) return 'first';
    if (this.wakePending) return 'wake';
    if (input.isPlaying) return 'playing';
    if (Math.abs(input.elapsedMs - this.lastElapsedMs) > TIME_EPSILON_MS) {
      return 'time';
    }
    return null;
  }

  /**
   * Decide this frame and commit the decision. Call once per animation frame,
   * and only when the caller will honour `render` by actually drawing.
   */
  evaluate(input: FrameInput): FrameDecision {
    const reason = this.reasonToRender(input);
    if (reason !== null) {
      this.lastElapsedMs = input.elapsedMs;
      this.lastRenderNowMs = input.nowMs;
      this.wakePending = false;
      return {render: true, reason, keepAwake: true};
    }
    const since =
      this.lastRenderNowMs === null
        ? Infinity
        : input.nowMs - this.lastRenderNowMs;
    return {render: false, reason: null, keepAwake: since < this.lingerMs};
  }

  /**
   * Forget everything drawn so far, so the next frame is unconditional. Used
   * when the surface underneath is replaced (a lost WebGL context), where the
   * previously drawn pixels no longer exist.
   */
  reset(): void {
    this.lastElapsedMs = null;
    this.lastRenderNowMs = null;
    this.wakePending = false;
  }
}
