import * as THREE from 'three';

// ---------------------------------------------------------------------------
// WaveformSurface -- renders a high-detail oscilloscope-style waveform
// ---------------------------------------------------------------------------

/**
 * Canvas height for the visible window. Higher = more detail.
 * This canvas is re-drawn every frame for just the visible ~1.3s window,
 * so it can be high-resolution without memory issues.
 */
const CANVAS_HEIGHT = 2048;
/** Canvas width — higher = crisper horizontal peaks. */
const CANVAS_WIDTH = 512;

/** Waveform line colour (light grey, like Moonscraper). */
const WAVE_COLOR = 'rgba(200, 200, 200, 0.7)';

/**
 * Fraction of the canvas half-width the loudest sample should reach (per side).
 * 0.8 means the global peak renders at 80% of the highway width per side, so
 * the symmetric waveform fills 80% of the highway width at its loudest point.
 */
const PEAK_FILL_RATIO = 0.8;

/** Resting y position of the waveform mesh on the highway. */
const MESH_BASE_Y = -0.1;

/**
 * Time (ms) shown at the mesh's bottom edge for a given time at the
 * strikeline. Notes place "now" at worldY = -1 (the receptor line), but the
 * mesh — centered at `meshBaseY` with height 2 — has its bottom edge at
 * `meshBaseY - 1`, slightly below the strikeline. The texture's bottom row
 * must therefore show audio from slightly BEFORE the strikeline time, or
 * the whole waveform renders offset from the notes (0.1 world units ≈ 67ms
 * at highwaySpeed 1.5).
 */
export function bottomEdgeTimeMs(
  strikelineTimeMs: number,
  meshBaseY: number,
  highwaySpeed: number,
): number {
  return strikelineTimeMs + (meshBaseY / highwaySpeed) * 1000;
}

/**
 * Compute the global peak amplitude (absolute value) across all samples and
 * channels in a PCM buffer. Returns 0 if the buffer is silent or empty.
 *
 * Pulled out as a pure helper so the normalization math is unit-testable.
 */
export function computeGlobalPeak(audioData: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < audioData.length; i++) {
    const v = audioData[i];
    const abs = v < 0 ? -v : v;
    if (abs > peak) peak = abs;
  }
  return peak;
}

/**
 * Compute the half-width (in pixels, from the canvas centre line) for a row
 * given the row's local peak amplitude, the global peak, and the canvas
 * half-width. Caller is responsible for clamping/skipping sub-pixel rows.
 *
 * If `globalPeak` is 0 (silent audio), returns 0 — render nothing.
 */
export function computeRowHalfWidth(
  rowPeak: number,
  globalPeak: number,
  canvasHalfWidth: number,
): number {
  if (globalPeak <= 0) return 0;
  const normalized = rowPeak / globalPeak;
  return normalized * canvasHalfWidth * PEAK_FILL_RATIO;
}

/**
 * Align a scroll position (in fractional samples) to the fixed bucket grid
 * that canvas rows are drawn on. Buckets are anchored to the audio timeline
 * (bucket `i` always covers samples `[i*bucketSize, (i+1)*bucketSize)`), so
 * a given slice of audio renders identically at every scroll position —
 * without this the row boundaries drift with the scroll and the per-row
 * min/max peaks shimmer frame to frame.
 *
 * Returns the index of the bucket containing `startSamples` plus the
 * fractional phase `[0, 1)` into that bucket, which the caller compensates
 * for by nudging the mesh along the highway.
 */
export function computeBucketAlignment(
  startSamples: number,
  bucketSizeSamples: number,
): {startBucket: number; phase: number} {
  const exact = startSamples / bucketSizeSamples;
  const startBucket = Math.floor(exact);
  return {startBucket, phase: exact - startBucket};
}

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
 * Renders the audio waveform as a scrolling oscilloscope on the highway surface.
 *
 * Unlike the previous approach (pre-render entire song at low res), this
 * re-renders only the visible ~1.3-second window each frame at high
 * resolution. This matches Moonscraper's detailed waveform display where
 * individual transients (snare hits, kick hits) are clearly visible as
 * peaks extending from the center line.
 */
export class WaveformSurface {
  private mesh: THREE.Mesh;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private texture: THREE.CanvasTexture;
  private material: THREE.MeshBasicMaterial;

  private audioData: Float32Array;
  private channels: number;
  private sampleRate: number;
  private durationMs: number;
  private highwaySpeed: number;
  private lastRenderedBucket: number | null = null;
  /**
   * Loudest absolute sample value across the entire audio buffer. Used to
   * normalize the per-row amplitudes so the visual peak fills a consistent
   * fraction of the highway regardless of overall loudness. Computed once at
   * construction with a single pass over the PCM (a few hundred ms for a
   * 4-minute stereo song at 48kHz).
   */
  private globalPeak: number;

  constructor(config: WaveformSurfaceConfig) {
    this.audioData = config.audioData;
    this.channels = config.channels;
    this.durationMs = config.durationMs;
    this.highwaySpeed = config.highwaySpeed;
    this.globalPeak = computeGlobalPeak(config.audioData);

    // Derive sample rate from total samples and duration
    const totalSamples = config.audioData.length / config.channels;
    this.sampleRate = totalSamples / (config.durationMs / 1000);

    this.canvas = document.createElement('canvas');
    this.canvas.width = CANVAS_WIDTH;
    this.canvas.height = CANVAS_HEIGHT;
    this.ctx = this.canvas.getContext('2d')!;

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
    // The 2048-row canvas is minified onto far fewer screen pixels. Nearest
    // filtering would sample a different subset of texels as the scroll
    // phase sweeps, making thin peaks sparkle frame to frame; mipmapped
    // linear filtering averages the full footprint so the waveform holds
    // still. Anisotropy keeps the grazing view angle from over-blurring.
    this.texture.minFilter = THREE.LinearMipmapLinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = true;
    this.texture.anisotropy = 8;

    this.material = new THREE.MeshBasicMaterial({
      map: this.texture,
      depthTest: false,
      // Transparent so the gray highway floor shows through rows without
      // audio peaks. The canvas is cleared each frame (no opaque black
      // fill) to honour this.
      transparent: true,
    });

    const geometry = new THREE.PlaneGeometry(config.highwayWidth, 2);
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.position.y = MESH_BASE_Y;
    // Render above the highway floor (HIGHWAY_FLOOR_RENDER_ORDER = 0) so
    // the gray plane stays visible at the edges as a frame, but below
    // markers / notes / cursor.
    this.mesh.renderOrder = 1;
    this.mesh.visible = false;
  }

  getMesh(): THREE.Mesh {
    return this.mesh;
  }

  /**
   * Called every frame. Re-renders the waveform canvas for the currently
   * visible time window and marks the texture as needing upload.
   *
   * `currentTimeMs` is the AUDIO time at the strikeline (chart time plus
   * any chart delay — the caller converts, since only the caller knows the
   * delay).
   */
  update(currentTimeMs: number): void {
    // The highway plane spans 2 world units. At highwaySpeed, that
    // corresponds to windowMs of visible time.
    const windowMs = (2 / this.highwaySpeed) * 1000;
    const windowSamples = (windowMs / 1000) * this.sampleRate;
    const bucketSize = windowSamples / CANVAS_HEIGHT;

    // The texture's bottom row sits at the mesh's bottom edge, slightly
    // below the strikeline where notes at currentTimeMs are placed. Rows
    // are drawn on a bucket grid anchored to the audio timeline so their
    // content is independent of the scroll position; the sub-bucket phase
    // is absorbed by nudging the mesh toward the strikeline (at most one
    // row, ~0.001 world units).
    const bottomMs = bottomEdgeTimeMs(
      currentTimeMs,
      MESH_BASE_Y,
      this.highwaySpeed,
    );
    const startSamples = (bottomMs / 1000) * this.sampleRate;
    const {startBucket, phase} = computeBucketAlignment(
      startSamples,
      bucketSize,
    );
    this.mesh.position.y = MESH_BASE_Y - phase * (2 / CANVAS_HEIGHT);

    if (startBucket === this.lastRenderedBucket) return;
    this.lastRenderedBucket = startBucket;

    this.renderWindow(startBucket, bucketSize);
    this.texture.needsUpdate = true;
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
  // Oscilloscope-style waveform rendering for the visible window
  // -----------------------------------------------------------------------

  private renderWindow(startBucket: number, bucketSize: number): void {
    const ctx = this.ctx;
    const w = CANVAS_WIDTH;
    const h = CANVAS_HEIGHT;
    const centerX = w / 2;

    // Clear to fully transparent so the highway floor shows through
    // anywhere we don't draw a peak.
    ctx.clearRect(0, 0, w, h);

    const totalSamples = this.audioData.length / this.channels;

    // Draw waveform: for each row, find the peak amplitude across its fixed
    // audio-timeline bucket and draw a horizontal line extending from the
    // center. This gives the oscilloscope look where louder parts have wider
    // peaks (like Moonscraper).
    ctx.fillStyle = WAVE_COLOR;

    for (let row = 0; row < h; row++) {
      const bucket = startBucket + row;
      // Bucket boundaries depend only on the bucket index, never on the
      // scroll position, so a row covering a given slice of audio always
      // renders the same peak.
      const rowStartSample = Math.max(0, Math.floor(bucket * bucketSize));
      const rowEndSample = Math.min(
        totalSamples,
        Math.floor((bucket + 1) * bucketSize),
      );
      if (rowEndSample <= rowStartSample) continue;

      // Find min/max amplitude across all channels for this row
      let minVal = 0;
      let maxVal = 0;
      for (let s = rowStartSample; s < rowEndSample; s++) {
        for (let c = 0; c < this.channels; c++) {
          const val = this.audioData[s * this.channels + c];
          if (val < minVal) minVal = val;
          if (val > maxVal) maxVal = val;
        }
      }

      // Normalize against the global peak so the loudest sample in the song
      // fills PEAK_FILL_RATIO of the highway half-width. Quiet sections still
      // remain proportionally smaller, but loud sections reliably fill the
      // highway instead of being clipped to a fraction of it.
      const peak = Math.max(Math.abs(minVal), Math.abs(maxVal));
      const halfWidth = computeRowHalfWidth(peak, this.globalPeak, centerX);

      if (halfWidth < 0.5) continue;

      // Canvas y: row 0 = top of canvas = end of time window (top of highway)
      // row h-1 = bottom of canvas = start of time window (strikeline)
      const y = h - 1 - row;

      ctx.fillRect(centerX - halfWidth, y, halfWidth * 2, 1);
    }
  }
}
