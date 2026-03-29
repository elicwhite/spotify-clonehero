import * as THREE from 'three';

// ---------------------------------------------------------------------------
// GridOverlay -- renders beat lines on a transparent texture over the highway
// ---------------------------------------------------------------------------

/** Maximum canvas height (same as WaveformSurface). */
const MAX_CANVAS_HEIGHT = 4096;
/** Canvas width in pixels. */
const CANVAS_WIDTH = 512;
/** Resolution: rows per second of audio (must match WaveformSurface). */
const DEFAULT_PX_PER_SECOND = 20;

/** Colour for measure boundary lines. */
const MEASURE_LINE_COLOR = 'rgba(255, 255, 255, 0.35)';
/** Colour for beat lines within a measure. */
const BEAT_LINE_COLOR = 'rgba(255, 255, 255, 0.15)';
/** Thickness for measure boundary lines (px). */
const MEASURE_LINE_HEIGHT = 2;
/** Thickness for beat lines (px). */
const BEAT_LINE_HEIGHT = 1;

export interface TempoEntry {
  tick: number;
  beatsPerMinute: number;
}

export interface TimeSignatureEntry {
  tick: number;
  numerator: number;
  denominator: number;
}

export interface GridOverlayConfig {
  /** Tempo events from the chart. */
  tempos: TempoEntry[];
  /** Time signature events from the chart. */
  timeSignatures: TimeSignatureEntry[];
  /** Chart resolution (ticks per beat). */
  resolution: number;
  /** Total song duration in milliseconds. */
  durationMs: number;
  /** Width of the highway mesh. */
  highwayWidth: number;
  /** Highway speed constant. */
  highwaySpeed: number;
}

/**
 * Renders beat lines and measure boundaries to a transparent canvas texture
 * that sits on top of the waveform surface. Scrolls in sync with the
 * WaveformSurface via the same offset/repeat math.
 */
export class GridOverlay {
  private mesh: THREE.Mesh;
  private canvas: HTMLCanvasElement;
  private texture: THREE.CanvasTexture;
  private material: THREE.MeshBasicMaterial;

  private durationMs: number;
  private highwaySpeed: number;

  constructor(config: GridOverlayConfig) {
    this.durationMs = config.durationMs;
    this.highwaySpeed = config.highwaySpeed;

    this.canvas = document.createElement('canvas');
    this.renderGrid(config);

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;

    this.material = new THREE.MeshBasicMaterial({
      map: this.texture,
      depthTest: false,
      transparent: true,
    });

    const geometry = new THREE.PlaneGeometry(config.highwayWidth, 2);
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.position.y = -0.1;
    // Slightly in front of the waveform surface
    this.mesh.position.z = 0.0001;
    this.mesh.renderOrder = 1;
    this.mesh.visible = false;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  getMesh(): THREE.Mesh {
    return this.mesh;
  }

  /** Scroll the grid in sync with the waveform. Same math as WaveformSurface. */
  update(currentTimeMs: number): void {
    const windowMs = (2 / this.highwaySpeed) * 1000;
    const fraction = currentTimeMs / this.durationMs;
    const windowFraction = windowMs / this.durationMs;

    this.texture.offset.y = fraction;
    this.texture.repeat.y = windowFraction;
  }

  setVisible(visible: boolean): void {
    this.mesh.visible = visible;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }

  // -----------------------------------------------------------------------
  // Grid rendering
  // -----------------------------------------------------------------------

  /**
   * Draws beat lines onto the canvas. Uses the tempo map and time signatures
   * to calculate the millisecond position of each beat, then maps that to
   * canvas rows using the same resolution as the WaveformSurface.
   */
  private renderGrid(config: GridOverlayConfig): void {
    const {tempos, timeSignatures, resolution, durationMs} = config;

    const durationSec = durationMs / 1000;
    let pxPerSecond = DEFAULT_PX_PER_SECOND;
    let canvasHeight = Math.ceil(durationSec * pxPerSecond);
    if (canvasHeight > MAX_CANVAS_HEIGHT) {
      pxPerSecond = MAX_CANVAS_HEIGHT / durationSec;
      canvasHeight = MAX_CANVAS_HEIGHT;
    }
    canvasHeight = Math.max(1, canvasHeight);

    this.canvas.width = CANVAS_WIDTH;
    this.canvas.height = canvasHeight;

    const ctx = this.canvas.getContext('2d')!;
    ctx.clearRect(0, 0, CANVAS_WIDTH, canvasHeight);

    if (tempos.length === 0) return;

    // Build a timed tempo array (tick -> ms)
    const timedTempos = buildTimedTempos(tempos, resolution);

    // Build time signature map: sorted by tick
    const sortedTS = [...timeSignatures].sort((a, b) => a.tick - b.tick);
    // Default 4/4 if no time signatures
    if (sortedTS.length === 0) {
      sortedTS.push({tick: 0, numerator: 4, denominator: 4});
    }

    // Walk through the song beat-by-beat
    let currentTick = 0;
    let tempoIdx = 0;
    let tsIdx = 0;
    let beatInMeasure = 0;

    const durationTicks = this.msTick(durationMs, timedTempos, resolution);

    while (currentTick <= durationTicks) {
      // Find active tempo
      while (
        tempoIdx < timedTempos.length - 1 &&
        timedTempos[tempoIdx + 1].tick <= currentTick
      ) {
        tempoIdx++;
      }

      // Find active time signature
      while (
        tsIdx < sortedTS.length - 1 &&
        sortedTS[tsIdx + 1].tick <= currentTick
      ) {
        tsIdx++;
        beatInMeasure = 0; // Reset beat counter on TS change
      }

      const ts = sortedTS[tsIdx];
      const beatsPerMeasure = ts.numerator;

      // Convert tick to ms
      const ms = this.tickToMs(currentTick, timedTempos, resolution);
      // Convert ms to canvas row
      const row = Math.round((ms / 1000) * pxPerSecond);
      // Draw row from bottom (same convention as WaveformSurface)
      const y = canvasHeight - row - 1;

      if (y >= 0 && y < canvasHeight) {
        const isMeasureBoundary = beatInMeasure === 0;

        if (isMeasureBoundary) {
          ctx.fillStyle = MEASURE_LINE_COLOR;
          ctx.fillRect(0, y - Math.floor(MEASURE_LINE_HEIGHT / 2), CANVAS_WIDTH, MEASURE_LINE_HEIGHT);
        } else {
          ctx.fillStyle = BEAT_LINE_COLOR;
          ctx.fillRect(0, y - Math.floor(BEAT_LINE_HEIGHT / 2), CANVAS_WIDTH, BEAT_LINE_HEIGHT);
        }
      }

      beatInMeasure = (beatInMeasure + 1) % beatsPerMeasure;
      currentTick += resolution; // Advance by one beat (one quarter note)

      // Safety: prevent infinite loop if duration is huge
      if (ms > durationMs + 1000) break;
    }
  }

  // -----------------------------------------------------------------------
  // Timing helpers (local, mirrors SceneOverlays logic)
  // -----------------------------------------------------------------------

  private tickToMs(
    tick: number,
    timedTempos: {tick: number; msTime: number; beatsPerMinute: number}[],
    resolution: number,
  ): number {
    if (timedTempos.length === 0) return 0;
    let idx = 0;
    for (let i = 1; i < timedTempos.length; i++) {
      if (timedTempos[i].tick <= tick) idx = i;
      else break;
    }
    const tempo = timedTempos[idx];
    return (
      tempo.msTime +
      ((tick - tempo.tick) * 60000) / (tempo.beatsPerMinute * resolution)
    );
  }

  /** Approximate tick from ms (inverse of tickToMs, for duration estimate). */
  private msTick(
    ms: number,
    timedTempos: {tick: number; msTime: number; beatsPerMinute: number}[],
    resolution: number,
  ): number {
    if (timedTempos.length === 0) return 0;
    let idx = 0;
    for (let i = 1; i < timedTempos.length; i++) {
      if (timedTempos[i].msTime <= ms) idx = i;
      else break;
    }
    const tempo = timedTempos[idx];
    const deltaMs = ms - tempo.msTime;
    return (
      tempo.tick +
      (deltaMs * tempo.beatsPerMinute * resolution) / 60000
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a timed tempos array (tick + msTime) from raw tempo events and
 * chart resolution. Mirrors the logic in lib/drum-transcription/timing.ts.
 */
function buildTimedTempos(
  tempos: TempoEntry[],
  resolution: number,
): {tick: number; msTime: number; beatsPerMinute: number}[] {
  const sorted = [...tempos].sort((a, b) => a.tick - b.tick);
  const result: {tick: number; msTime: number; beatsPerMinute: number}[] = [];

  let currentMs = 0;
  for (let i = 0; i < sorted.length; i++) {
    const tempo = sorted[i];
    if (i > 0) {
      const prev = result[i - 1];
      const deltaTick = tempo.tick - prev.tick;
      currentMs =
        prev.msTime +
        (deltaTick * 60000) / (prev.beatsPerMinute * resolution);
    }
    result.push({
      tick: tempo.tick,
      msTime: currentMs,
      beatsPerMinute: tempo.beatsPerMinute,
    });
  }

  return result;
}
