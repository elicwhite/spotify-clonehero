import * as THREE from 'three';
import {parseLyrics, type LyricLine} from '@/lib/karaoke/parse-lyrics';

// ---------------------------------------------------------------------------
// Constants (exported for tests)
// ---------------------------------------------------------------------------

/** If gap between phrases is < this, show the upcoming phrase early. */
export const PHRASE_DISTANCE_THRESHOLD_MS = 2000;
/** Fade in/out duration for phrase transitions. */
export const PHRASE_FADE_MS = 500;
/** Duration of the slide-up transition between lines. */
export const TRANSITION_DURATION_MS = 400;
/** Phrases shorter than this are likely effect markers, not real lyrics. */
const MIN_PHRASE_LENGTH_MS = 250;
/** Show upcoming line only when this close to the end of the current line. */
const UPCOMING_LEAD_TIME_MS = 3000;

// Clone Hero color scheme
const COLOR_SUNG = 'rgb(230, 166, 47)'; // orange-gold (already sung / currently singing)
const COLOR_FUTURE = '#FFFFFF'; // white (not yet sung)
const COLOR_UPCOMING_R = 129, COLOR_UPCOMING_G = 129, COLOR_UPCOMING_B = 129;
const SUNG_R = 230, SUNG_G = 166, SUNG_B = 47;
const FUTURE_R = 255, FUTURE_G = 255, FUTURE_B = 255;

/** System font stack matching Clone Hero's look. */
const FONT_FAMILY = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

/** Canvas height in CSS pixels. Fixed so text aspect ratio is preserved. */
const CANVAS_CSS_HEIGHT = 120;

// ---------------------------------------------------------------------------
// LyricsState — pure state tracking (no Three.js, testable)
// ---------------------------------------------------------------------------

export interface LyricsStateSnapshot {
  lineIndex: number;
  syllableIndex: number;
  opacity: number;
  showUpcoming: boolean;
  /** 0→1 progress of the slide-up transition. 0 when not transitioning OR at start of transition. */
  transitionProgress: number;
  /** True when a line transition is active (including the first frame where progress is 0). */
  isTransitioning: boolean;
}

/**
 * Pure state machine for lyrics phrase/syllable tracking.
 * No Three.js or DOM dependencies — fully testable.
 */
export class LyricsState {
  readonly lines: LyricLine[];

  private currentLineIndex = -1;
  private lastTimeMs = -Infinity;
  /** Time when the current line transition started (ms). -1 = no active transition. */
  private transitionStartMs = -1;

  constructor(lines: LyricLine[]) {
    this.lines = lines;
  }

  /** Update state for the given time. Returns a snapshot of the current state. */
  update(timeMs: number): LyricsStateSnapshot {
    if (this.lines.length === 0) {
      return {lineIndex: -1, syllableIndex: -1, opacity: 0, showUpcoming: false, transitionProgress: 0, isTransitioning: false};
    }

    const prevLineIndex = this.currentLineIndex;

    // Seek detection: if time jumped backward or far forward, binary search
    const timeDelta = timeMs - this.lastTimeMs;
    if (timeDelta < -100 || timeDelta > 5000) {
      this.currentLineIndex = this.findLineIndex(timeMs);
      this.transitionStartMs = -1; // cancel any active transition on seek
    } else {
      this.advanceLineIndex(timeMs);
    }
    this.lastTimeMs = timeMs;

    // Detect line change → start slide transition only for short gaps.
    // Long gaps (≥ threshold) use fade out/in instead, so the new line
    // should appear directly at the active position with no slide.
    if (this.currentLineIndex !== prevLineIndex && prevLineIndex >= 0 && this.currentLineIndex > prevLineIndex) {
      const prevLine = this.lines[prevLineIndex];
      const gap = this.lines[this.currentLineIndex].phraseStartMs - prevLine.phraseEndMs;
      if (gap < PHRASE_DISTANCE_THRESHOLD_MS) {
        this.transitionStartMs = timeMs;
      }
    }

    // Calculate transition progress
    let transitionProgress = 0;
    let isTransitioning = false;
    if (this.transitionStartMs >= 0) {
      isTransitioning = true;
      transitionProgress = Math.min(1, (timeMs - this.transitionStartMs) / TRANSITION_DURATION_MS);
      if (transitionProgress >= 1) {
        this.transitionStartMs = -1; // transition complete
        transitionProgress = 0;
        isTransitioning = false;
      }
    }

    const syllableIndex = this.findSyllableIndex(timeMs);
    const opacity = this.calculateOpacity(timeMs);
    const showUpcoming = this.shouldShowUpcoming(timeMs);

    return {
      lineIndex: this.currentLineIndex,
      syllableIndex,
      opacity,
      showUpcoming,
      transitionProgress,
      isTransitioning,
    };
  }

  // -------------------------------------------------------------------------
  // Line/syllable tracking
  // -------------------------------------------------------------------------

  /** Binary search for the active line at a given time. */
  private findLineIndex(timeMs: number): number {
    const lines = this.lines;
    if (lines.length === 0 || timeMs < lines[0].phraseStartMs - PHRASE_FADE_MS) {
      return -1;
    }

    let lo = 0;
    let hi = lines.length - 1;
    let result = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (lines[mid].phraseStartMs <= timeMs) {
        result = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return result;
  }

  /** Advance currentLineIndex forward during normal playback. */
  private advanceLineIndex(timeMs: number): void {
    const lines = this.lines;
    if (this.currentLineIndex < 0) {
      if (lines.length > 0 && timeMs >= lines[0].phraseStartMs - PHRASE_FADE_MS) {
        this.currentLineIndex = 0;
      }
      return;
    }

    while (this.currentLineIndex < lines.length - 1) {
      const nextLine = lines[this.currentLineIndex + 1];
      if (timeMs >= nextLine.phraseStartMs) {
        // Past the next line's first syllable — advance normally
        this.currentLineIndex++;
        continue;
      }
      // Early advance during long gaps: once the fade-out completes, move
      // to the next line immediately. This ensures the canvas shows the
      // correct (new) line content at opacity 0 well before the fade-in
      // begins at `phraseStartMs - PHRASE_FADE_MS`. Without this, the old
      // line would flash for one frame when the fade-in starts.
      // calculateOpacity() handles the rest — it returns 0 when
      // `timeMs < phraseStartMs - PHRASE_FADE_MS`, then fades 0→1.
      const line = lines[this.currentLineIndex];
      const gap = nextLine.phraseStartMs - line.phraseEndMs;
      if (gap >= PHRASE_DISTANCE_THRESHOLD_MS && timeMs >= line.phraseEndMs + PHRASE_FADE_MS) {
        this.currentLineIndex++;
        continue;
      }
      break;
    }
  }

  /** Find the active syllable index within the current line. */
  private findSyllableIndex(timeMs: number): number {
    if (this.currentLineIndex < 0) return -1;
    const line = this.lines[this.currentLineIndex];
    if (!line) return -1;

    let result = -1;
    for (let i = 0; i < line.syllables.length; i++) {
      if (line.syllables[i].msTime <= timeMs) {
        result = i;
      } else {
        break;
      }
    }
    return result;
  }

  // -------------------------------------------------------------------------
  // Opacity / fade
  // -------------------------------------------------------------------------

  /** Calculate overlay opacity based on phrase timing. */
  private calculateOpacity(timeMs: number): number {
    if (this.currentLineIndex < 0) {
      if (this.lines.length > 0) {
        const phraseStart = this.lines[0].phraseStartMs;
        if (timeMs >= phraseStart - PHRASE_FADE_MS && timeMs < phraseStart) {
          return (timeMs - (phraseStart - PHRASE_FADE_MS)) / PHRASE_FADE_MS;
        }
      }
      return 0;
    }

    const line = this.lines[this.currentLineIndex];
    const nextLine = this.lines[this.currentLineIndex + 1];
    const phraseEnd = line.phraseEndMs;

    if (timeMs >= phraseEnd) {
      if (nextLine) {
        const gap = nextLine.phraseStartMs - phraseEnd;
        if (gap < PHRASE_DISTANCE_THRESHOLD_MS) {
          return 1; // Short gap — stay visible
        }
        // Long gap — fade out, then fade in for next
        const fadeOutEnd = phraseEnd + PHRASE_FADE_MS;
        if (timeMs < fadeOutEnd) {
          return 1 - (timeMs - phraseEnd) / PHRASE_FADE_MS;
        }
        const fadeInStart = nextLine.phraseStartMs - PHRASE_FADE_MS;
        if (timeMs >= fadeInStart) {
          return (timeMs - fadeInStart) / PHRASE_FADE_MS;
        }
        return 0;
      }
      // Last line — fade out
      const fadeOutEnd = phraseEnd + PHRASE_FADE_MS;
      if (timeMs < fadeOutEnd) {
        return 1 - (timeMs - phraseEnd) / PHRASE_FADE_MS;
      }
      return 0;
    }

    // Before phrase starts — fade in
    const phraseStart = line.phraseStartMs;
    if (timeMs < phraseStart) {
      return Math.max(0, (timeMs - (phraseStart - PHRASE_FADE_MS)) / PHRASE_FADE_MS);
    }

    return 1;
  }

  /** Whether the upcoming line should be visible. */
  private shouldShowUpcoming(timeMs: number): boolean {
    if (this.currentLineIndex < 0) return false;
    const line = this.lines[this.currentLineIndex];
    const nextLine = this.lines[this.currentLineIndex + 1];
    if (!nextLine) return false;

    // Skip very short phrases (effect markers, not real lyrics)
    const nextDuration = nextLine.phraseEndMs - nextLine.phraseStartMs;
    if (nextDuration < MIN_PHRASE_LENGTH_MS) return false;

    const gap = nextLine.phraseStartMs - line.phraseEndMs;
    if (gap >= PHRASE_DISTANCE_THRESHOLD_MS) return false;

    // Only show when nearing the end of the current line
    return timeMs >= nextLine.phraseStartMs - UPCOMING_LEAD_TIME_MS;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Ease-out cubic for smooth deceleration. */
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/** Linearly interpolate between two values. */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Interpolate an RGB color string. */
function lerpColor(
  r1: number, g1: number, b1: number,
  r2: number, g2: number, b2: number,
  t: number,
): string {
  const r = Math.round(lerp(r1, r2, t));
  const g = Math.round(lerp(g1, g2, t));
  const b = Math.round(lerp(b1, b2, t));
  return `rgb(${r},${g},${b})`;
}

// ---------------------------------------------------------------------------
// LyricsOverlay — Three.js rendering layer
// ---------------------------------------------------------------------------

/**
 * Renders Clone Hero-style karaoke lyrics as a second orthographic render
 * pass on top of the highway scene. Two lines: the active phrase (with
 * per-syllable highlighting) and the upcoming phrase (in gray).
 *
 * When a line ends, the outgoing line slides up and fades while the
 * upcoming line slides up into the active position, growing in size
 * and transitioning from gray to the active color scheme.
 */
export class LyricsOverlay {
  readonly scene: THREE.Scene;
  readonly camera: THREE.OrthographicCamera;
  readonly state: LyricsState;

  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private texture: THREE.CanvasTexture;
  private mesh: THREE.Mesh;

  // Previous snapshot for change detection
  private prevLineIndex = -1;
  private prevSyllableIndex = -1;
  private prevTransitionProgress = -1;
  private needsRedraw = false;

  // Sizing
  private width: number;
  private height: number;
  private dpr: number;

  constructor(
    lyrics: {msTime: number; msLength: number; text: string}[],
    vocalPhrases: {msTime: number; msLength: number}[],
    width: number,
    height: number,
  ) {
    const lines = parseLyrics(lyrics, vocalPhrases);
    this.state = new LyricsState(lines);
    this.width = width;
    this.height = height;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);

    this.camera = new THREE.OrthographicCamera(0, width, height, 0, -1, 1);
    this.scene = new THREE.Scene();

    const ch = CANVAS_CSS_HEIGHT;

    this.canvas = document.createElement('canvas');
    this.canvas.width = width * this.dpr;
    this.canvas.height = ch * this.dpr;
    this.ctx = this.canvas.getContext('2d')!;

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;

    const material = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      depthTest: false,
    });
    const geometry = new THREE.PlaneGeometry(width, ch);
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.position.set(width / 2, height - ch / 2, 0);
    this.scene.add(this.mesh);
  }

  get hasLyrics(): boolean {
    return this.state.lines.length > 0;
  }

  /**
   * Update lyrics state for the current playback time.
   * Returns true if the overlay scene should be rendered this frame.
   */
  update(currentTimeMs: number): boolean {
    const snap = this.state.update(currentTimeMs);
    if (snap.opacity <= 0) return false;

    // Redraw when state changed, during transitions, or after resize
    const stateChanged =
      snap.lineIndex !== this.prevLineIndex ||
      snap.syllableIndex !== this.prevSyllableIndex;

    if (stateChanged || snap.isTransitioning || this.needsRedraw) {
      this.needsRedraw = false;
      this.redrawCanvas(snap);
      this.prevLineIndex = snap.lineIndex;
      this.prevSyllableIndex = snap.syllableIndex;
      this.prevTransitionProgress = snap.transitionProgress;
    }

    (this.mesh.material as THREE.MeshBasicMaterial).opacity = snap.opacity;
    return true;
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);

    const ch = CANVAS_CSS_HEIGHT;

    this.camera.right = width;
    this.camera.top = height;
    this.camera.updateProjectionMatrix();

    // Resize canvas — must recreate the texture because Three.js caches
    // the WebGL texture dimensions from the original canvas size.
    this.canvas.width = width * this.dpr;
    this.canvas.height = ch * this.dpr;
    this.texture.dispose();
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    (this.mesh.material as THREE.MeshBasicMaterial).map = this.texture;

    this.mesh.geometry.dispose();
    this.mesh.geometry = new THREE.PlaneGeometry(width, ch);
    this.mesh.position.set(width / 2, height - ch / 2, 0);

    this.needsRedraw = true;
  }

  dispose(): void {
    this.texture.dispose();
    (this.mesh.material as THREE.MeshBasicMaterial).dispose();
    this.mesh.geometry.dispose();
  }

  // -------------------------------------------------------------------------
  // Canvas rendering
  // -------------------------------------------------------------------------

  /** Ideal font sizes in CSS pixels (before DPR). */
  private static readonly ACTIVE_FONT_PX = 30;
  private static readonly UPCOMING_FONT_PX = 20;
  /** Horizontal padding on each side of the canvas. */
  private static readonly H_PAD_PX = 16;

  /**
   * Compute the font size (in canvas pixels, i.e. CSS × DPR) that fits the
   * given text within the available canvas width, starting from an ideal size
   * and shrinking only if necessary.
   */
  private fitFontSize(idealCssPx: number, text: string): number {
    const ctx = this.ctx;
    const maxWidth = this.canvas.width - LyricsOverlay.H_PAD_PX * 2 * this.dpr;
    let size = Math.round(idealCssPx * this.dpr);

    ctx.font = `${size}px ${FONT_FAMILY}`;
    const measured = ctx.measureText(text).width;

    if (measured > maxWidth && measured > 0) {
      size = Math.round(size * (maxWidth / measured));
    }

    return size;
  }

  private redrawCanvas(snap: LyricsStateSnapshot): void {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const scale = this.dpr;

    ctx.clearRect(0, 0, w, h);

    if (snap.lineIndex < 0) {
      this.texture.needsUpdate = true;
      return;
    }

    // Dark gradient background for readability against bright highway content
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(0, 0, 0, 0.7)');
    grad.addColorStop(0.85, 'rgba(0, 0, 0, 0.4)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    const lines = this.state.lines;
    const activeLine = lines[snap.lineIndex];
    const nextLine = lines[snap.lineIndex + 1] ?? null;
    const prevLine = snap.lineIndex > 0 ? lines[snap.lineIndex - 1] : null;

    // Compute font sizes — fixed ideal, shrunk only if text overflows
    const activeFontSize = this.fitFontSize(
      LyricsOverlay.ACTIVE_FONT_PX, activeLine.text,
    );
    const upcomingFontSize = nextLine
      ? this.fitFontSize(LyricsOverlay.UPCOMING_FONT_PX, nextLine.text)
      : Math.round(LyricsOverlay.UPCOMING_FONT_PX * this.dpr);
    const lineGap = 12 * scale;

    // Base positions (no transition) — offset down for top margin
    const activeBaseY = Math.round(h * 0.48);
    const upcomingBaseY = activeBaseY + activeFontSize + lineGap;

    const t = snap.isTransitioning ? easeOutCubic(snap.transitionProgress) : 0;

    if (snap.isTransitioning && prevLine) {
      // --- Transition in progress ---
      const prevFontSize = this.fitFontSize(
        LyricsOverlay.ACTIVE_FONT_PX, prevLine.text,
      );

      // Outgoing line (previous): slides up + fades out
      const outgoingY = lerp(activeBaseY, activeBaseY - prevFontSize, t);
      const outgoingAlpha = 1 - t;
      if (outgoingAlpha > 0.01) {
        ctx.globalAlpha = outgoingAlpha;
        this.drawPhraseLine(ctx, prevLine, prevLine.syllables.length - 1, prevFontSize, outgoingY, w);
        ctx.globalAlpha = 1;
      }

      // Incoming line (current, was upcoming): slides up from upcoming → active position
      const incomingUpcomingSize = this.fitFontSize(
        LyricsOverlay.UPCOMING_FONT_PX, activeLine.text,
      );
      const incomingY = lerp(upcomingBaseY, activeBaseY, t);
      const incomingFontSize = Math.round(lerp(incomingUpcomingSize, activeFontSize, t));
      this.drawTransitioningLine(ctx, activeLine, snap.syllableIndex, incomingFontSize, incomingY, w, t);

      // Next upcoming line fades in
      if (nextLine && snap.showUpcoming) {
        ctx.globalAlpha = t;
        this.drawUpcomingLine(ctx, nextLine, upcomingFontSize, upcomingBaseY, w);
        ctx.globalAlpha = 1;
      }
    } else {
      // --- Settled state ---

      // Active line
      this.drawPhraseLine(ctx, activeLine, snap.syllableIndex, activeFontSize, activeBaseY, w);

      // Upcoming line
      if (nextLine && snap.showUpcoming) {
        this.drawUpcomingLine(ctx, nextLine, upcomingFontSize, upcomingBaseY, w);
      }
    }

    this.texture.needsUpdate = true;
  }

  /** Measure each syllable and return widths + total. */
  private measureSyllables(
    ctx: CanvasRenderingContext2D,
    line: LyricLine,
    fontSize: number,
  ): {widths: number[]; totalWidth: number} {
    ctx.font = `${fontSize}px ${FONT_FAMILY}`;
    const widths = line.syllables.map(s => ctx.measureText(s.text).width);
    const totalWidth = widths.reduce((sum, w) => sum + w, 0);
    return {widths, totalWidth};
  }

  /** Draw the active phrase line with per-syllable color highlighting. */
  private drawPhraseLine(
    ctx: CanvasRenderingContext2D,
    line: LyricLine,
    activeSyllableIndex: number,
    fontSize: number,
    y: number,
    canvasWidth: number,
  ): void {
    const {widths, totalWidth} = this.measureSyllables(ctx, line, fontSize);
    ctx.textBaseline = 'middle';

    let x = (canvasWidth - totalWidth) / 2;
    for (let i = 0; i < line.syllables.length; i++) {
      ctx.fillStyle = i <= activeSyllableIndex ? COLOR_SUNG : COLOR_FUTURE;
      ctx.fillText(line.syllables[i].text, x, y);
      x += widths[i];
    }
  }

  /**
   * Draw a line that's transitioning from upcoming (gray) to active (highlighted).
   * `t` = 0 means fully gray (upcoming style), t = 1 means fully active style.
   */
  private drawTransitioningLine(
    ctx: CanvasRenderingContext2D,
    line: LyricLine,
    activeSyllableIndex: number,
    fontSize: number,
    y: number,
    canvasWidth: number,
    t: number,
  ): void {
    const {widths, totalWidth} = this.measureSyllables(ctx, line, fontSize);
    ctx.textBaseline = 'middle';

    let x = (canvasWidth - totalWidth) / 2;
    for (let i = 0; i < line.syllables.length; i++) {
      if (i <= activeSyllableIndex) {
        ctx.fillStyle = lerpColor(
          COLOR_UPCOMING_R, COLOR_UPCOMING_G, COLOR_UPCOMING_B,
          SUNG_R, SUNG_G, SUNG_B, t,
        );
      } else {
        ctx.fillStyle = lerpColor(
          COLOR_UPCOMING_R, COLOR_UPCOMING_G, COLOR_UPCOMING_B,
          FUTURE_R, FUTURE_G, FUTURE_B, t,
        );
      }
      ctx.fillText(line.syllables[i].text, x, y);
      x += widths[i];
    }
  }

  /** Draw the upcoming phrase line in gray. */
  private drawUpcomingLine(
    ctx: CanvasRenderingContext2D,
    line: LyricLine,
    fontSize: number,
    y: number,
    canvasWidth: number,
  ): void {
    const {totalWidth} = this.measureSyllables(ctx, line, fontSize);
    ctx.textBaseline = 'middle';
    ctx.fillStyle = `rgb(${COLOR_UPCOMING_R},${COLOR_UPCOMING_G},${COLOR_UPCOMING_B})`;

    const x = (canvasWidth - totalWidth) / 2;
    ctx.fillText(line.text, x, y);
  }
}
