import * as THREE from 'three';

// ---------------------------------------------------------------------------
// WaveformSurface -- renders audio waveform as the highway surface texture
// ---------------------------------------------------------------------------

/** Maximum canvas height (WebGL texture size limit). */
const MAX_CANVAS_HEIGHT = 4096;
/** Canvas width in pixels. */
const CANVAS_WIDTH = 512;
/** Resolution: rows per second of audio. Lower = handles longer songs. */
const DEFAULT_PX_PER_SECOND = 20;

/** Waveform background colour. */
const BG_COLOR = '#111122';
/** Waveform bar colour (semi-transparent). */
const WAVE_COLOR = 'rgba(100, 140, 200, 0.5)';

export interface WaveformSurfaceConfig {
  /** Raw interleaved PCM audio data. */
  audioData: Float32Array;
  /** Number of audio channels (1 or 2). */
  channels: number;
  /** Total duration in milliseconds. */
  durationMs: number;
  /** Width of the highway mesh (0.9 for drums, 1.0 for guitar). */
  highwayWidth: number;
  /** Highway speed constant (units per second in world space). */
  highwaySpeed: number;
}

/**
 * Renders a pre-computed audio waveform to a CanvasTexture and maps it
 * onto a PlaneGeometry mesh positioned behind the highway. The texture
 * offset is updated each frame to scroll in sync with note positions.
 */
export class WaveformSurface {
  private mesh: THREE.Mesh;
  private canvas: HTMLCanvasElement;
  private texture: THREE.CanvasTexture;
  private material: THREE.MeshBasicMaterial;

  private durationMs: number;
  private highwaySpeed: number;

  constructor(config: WaveformSurfaceConfig) {
    this.durationMs = config.durationMs;
    this.highwaySpeed = config.highwaySpeed;

    this.canvas = document.createElement('canvas');
    this.renderWaveform(config);

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;

    this.material = new THREE.MeshBasicMaterial({
      map: this.texture,
      depthTest: false,
      transparent: false,
    });

    // Use a tall plane (same height/width as the classic highway)
    const geometry = new THREE.PlaneGeometry(config.highwayWidth, 2);
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.position.y = -0.1;
    this.mesh.renderOrder = 0;
    this.mesh.visible = false; // hidden until explicitly enabled
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  getMesh(): THREE.Mesh {
    return this.mesh;
  }

  /**
   * Called every frame. Scrolls the texture offset so the visible window
   * corresponds to the current playback position.
   *
   * The highway shows a time range of `windowMs = 2000 / highwaySpeed`
   * milliseconds (matching the 2-unit-tall plane at the given speed).
   * We map that window to the texture coordinates.
   */
  update(currentTimeMs: number): void {
    const windowMs = (2 / this.highwaySpeed) * 1000;
    // The strikeline is at the bottom of the highway (world y = -1),
    // and the highway plane spans from y = -1.1 to y = 0.9.
    // currentTimeMs corresponds to the strikeline position.
    // We want the bottom of the texture to show `currentTimeMs`.
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
  // Waveform rendering
  // -----------------------------------------------------------------------

  /**
   * Draws the waveform to the internal canvas. The canvas represents the
   * full song duration vertically -- y=0 is the end (top) and
   * y=canvasHeight is the start (bottom), matching the texture offset
   * direction where offset.y increases as we advance through the song.
   */
  private renderWaveform(config: WaveformSurfaceConfig): void {
    const {audioData, channels, durationMs} = config;

    const durationSec = durationMs / 1000;
    // Compute resolution that fits within MAX_CANVAS_HEIGHT
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

    // Background
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, CANVAS_WIDTH, canvasHeight);

    // Compute RMS per row and draw centered bars
    const totalSamples = audioData.length / channels;
    const samplesPerRow = totalSamples / canvasHeight;

    ctx.fillStyle = WAVE_COLOR;

    for (let row = 0; row < canvasHeight; row++) {
      const startSample = Math.floor(row * samplesPerRow);
      const endSample = Math.min(
        Math.floor((row + 1) * samplesPerRow),
        totalSamples,
      );

      // Compute RMS across all channels for this row
      let sum = 0;
      let count = 0;
      for (let s = startSample; s < endSample; s++) {
        for (let c = 0; c < channels; c++) {
          const val = audioData[s * channels + c];
          sum += val * val;
          count++;
        }
      }
      const rms = count > 0 ? Math.sqrt(sum / count) : 0;

      // Map RMS to bar width (leave margins on edges)
      const barWidth = rms * CANVAS_WIDTH * 0.85;
      if (barWidth < 1) continue;

      const x = (CANVAS_WIDTH - barWidth) / 2;
      // Row 0 = song start. In the texture, y=0 is top.
      // offset.y = fraction maps bottom of viewport to that fraction.
      // With ClampToEdge and repeat.y, the texture is sampled bottom-up.
      // We draw row 0 (song start) at canvas bottom so offset.y=0 shows
      // the start at the bottom of the highway.
      const y = canvasHeight - row - 1;
      ctx.fillRect(x, y, barWidth, 1);
    }
  }
}
