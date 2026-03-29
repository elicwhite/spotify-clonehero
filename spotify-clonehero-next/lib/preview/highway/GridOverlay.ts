import * as THREE from 'three';

// ---------------------------------------------------------------------------
// GridOverlay -- renders beat lines as thin plane meshes
// ---------------------------------------------------------------------------

/** Colour for measure boundary lines. */
const MEASURE_LINE_COLOR = 0xffffff;
/** Colour for beat lines within a measure. */
const BEAT_LINE_COLOR = 0xffffff;

/** Opacity for measure boundary lines. */
const MEASURE_LINE_OPACITY = 0.55;
/** Opacity for beat lines. */
const BEAT_LINE_OPACITY = 0.28;

/** Width (in world units) for measure boundary lines. */
const MEASURE_LINE_WIDTH = 0.008;
/** Width (in world units) for regular beat lines. */
const BEAT_LINE_WIDTH = 0.004;

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

/** Pre-computed beat entry with its ms time and visual weight. */
interface BeatEntry {
  msTime: number;
  isMeasure: boolean;
}

/**
 * Renders beat lines and measure boundaries as thin plane meshes
 * in the 3D scene. Uses PlaneGeometry instead of THREE.Line to
 * guarantee visible line thickness on all platforms (WebGL only
 * supports lineWidth=1 on most GPUs).
 *
 * Lines are positioned at the correct world-space Y each frame,
 * matching the same coordinate system as notes.
 *
 * Only lines visible within the highway time window are shown; the rest
 * are hidden. A pool of mesh objects is reused to avoid per-frame allocation.
 */
export class GridOverlay {
  private group: THREE.Group;
  private highwaySpeed: number;
  private halfWidth: number;

  /** All beat positions in ms, pre-computed on construction. */
  private beats: BeatEntry[] = [];

  /** Pool of mesh objects for beat lines. */
  private beatLinePool: THREE.Mesh[] = [];
  /** Pool of mesh objects for measure lines. */
  private measureLinePool: THREE.Mesh[] = [];

  /** Shared materials (one for beats, one for measures). */
  private beatMaterial: THREE.MeshBasicMaterial;
  private measureMaterial: THREE.MeshBasicMaterial;
  /** Shared geometries for beat and measure line planes. */
  private beatGeometry: THREE.PlaneGeometry;
  private measureGeometry: THREE.PlaneGeometry;

  /** Clipping planes to keep lines within the highway bounds. */
  private clippingPlanes: THREE.Plane[] | null = null;

  constructor(config: GridOverlayConfig, clippingPlanes?: THREE.Plane[]) {
    this.highwaySpeed = config.highwaySpeed;
    this.halfWidth = config.highwayWidth / 2;
    this.clippingPlanes = clippingPlanes ?? null;

    this.group = new THREE.Group();
    this.group.visible = false; // hidden until explicitly enabled

    // Shared geometries: thin horizontal planes spanning the highway width
    this.beatGeometry = new THREE.PlaneGeometry(
      this.halfWidth * 2,
      BEAT_LINE_WIDTH,
    );
    this.measureGeometry = new THREE.PlaneGeometry(
      this.halfWidth * 2,
      MEASURE_LINE_WIDTH,
    );

    // Shared materials
    this.beatMaterial = new THREE.MeshBasicMaterial({
      color: BEAT_LINE_COLOR,
      transparent: true,
      opacity: BEAT_LINE_OPACITY,
      depthTest: false,
      side: THREE.DoubleSide,
    });
    if (this.clippingPlanes) {
      this.beatMaterial.clippingPlanes = this.clippingPlanes;
    }

    this.measureMaterial = new THREE.MeshBasicMaterial({
      color: MEASURE_LINE_COLOR,
      transparent: true,
      opacity: MEASURE_LINE_OPACITY,
      depthTest: false,
      side: THREE.DoubleSide,
    });
    if (this.clippingPlanes) {
      this.measureMaterial.clippingPlanes = this.clippingPlanes;
    }

    // Pre-compute all beat positions
    this.computeBeats(config);
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  getMesh(): THREE.Group {
    return this.group;
  }

  /**
   * Called every frame. Positions beat lines within the visible window.
   * Uses the same Y formula as notes: worldY = ((ms - elapsedMs) / 1000) * highwaySpeed - 1
   */
  update(currentTimeMs: number): void {
    // The visible window spans from worldY = -1 (strikeline) to worldY = ~0.9 (top).
    // worldY = ((ms - currentMs) / 1000) * highwaySpeed - 1
    // Solve for ms: ms = currentMs + ((worldY + 1) / highwaySpeed) * 1000
    const windowStartMs = currentTimeMs; // ms at strikeline (worldY = -1 -> ms = currentMs)
    const windowEndMs = currentTimeMs + (1.9 / this.highwaySpeed) * 1000; // ms at top of highway

    // Binary search for the first beat >= windowStartMs
    let lo = 0;
    let hi = this.beats.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.beats[mid].msTime < windowStartMs) lo = mid + 1;
      else hi = mid;
    }

    let beatPoolIdx = 0;
    let measurePoolIdx = 0;

    for (let i = lo; i < this.beats.length; i++) {
      const beat = this.beats[i];
      if (beat.msTime > windowEndMs) break;

      const worldY = ((beat.msTime - currentTimeMs) / 1000) * this.highwaySpeed - 1;

      if (beat.isMeasure) {
        const line = this.acquireMeasureLine(measurePoolIdx++);
        line.position.y = worldY;
        line.visible = true;
      } else {
        const line = this.acquireBeatLine(beatPoolIdx++);
        line.position.y = worldY;
        line.visible = true;
      }
    }

    // Hide unused pool entries
    for (let i = beatPoolIdx; i < this.beatLinePool.length; i++) {
      this.beatLinePool[i].visible = false;
    }
    for (let i = measurePoolIdx; i < this.measureLinePool.length; i++) {
      this.measureLinePool[i].visible = false;
    }
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  dispose(): void {
    this.beatGeometry.dispose();
    this.measureGeometry.dispose();
    this.beatMaterial.dispose();
    this.measureMaterial.dispose();
    // Meshes share geometry and material, so just clear the group
    for (const child of [...this.group.children]) {
      this.group.remove(child);
    }
    this.beatLinePool = [];
    this.measureLinePool = [];
  }

  // -----------------------------------------------------------------------
  // Pool management
  // -----------------------------------------------------------------------

  private acquireBeatLine(index: number): THREE.Mesh {
    if (index < this.beatLinePool.length) {
      return this.beatLinePool[index];
    }
    const mesh = new THREE.Mesh(this.beatGeometry, this.beatMaterial);
    mesh.renderOrder = 2;
    this.beatLinePool.push(mesh);
    this.group.add(mesh);
    return mesh;
  }

  private acquireMeasureLine(index: number): THREE.Mesh {
    if (index < this.measureLinePool.length) {
      return this.measureLinePool[index];
    }
    const mesh = new THREE.Mesh(this.measureGeometry, this.measureMaterial);
    mesh.renderOrder = 2;
    this.measureLinePool.push(mesh);
    this.group.add(mesh);
    return mesh;
  }

  // -----------------------------------------------------------------------
  // Beat computation
  // -----------------------------------------------------------------------

  /**
   * Pre-compute all beat positions (in ms) for the entire song.
   * Walks through the tempo map beat-by-beat, tracking time signatures
   * to determine measure boundaries.
   */
  private computeBeats(config: GridOverlayConfig): void {
    const {tempos, timeSignatures, resolution, durationMs} = config;
    if (tempos.length === 0) return;

    // Build timed tempos
    const timedTempos = buildTimedTempos(tempos, resolution);

    // Build time signature map: sorted by tick
    const sortedTS = [...timeSignatures].sort((a, b) => a.tick - b.tick);
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
        beatInMeasure = 0;
      }

      const ts = sortedTS[tsIdx];
      const beatsPerMeasure = ts.numerator;

      // Convert tick to ms
      const ms = this.tickToMs(currentTick, timedTempos, resolution);

      if (ms > durationMs + 1000) break;

      this.beats.push({
        msTime: ms,
        isMeasure: beatInMeasure === 0,
      });

      beatInMeasure = (beatInMeasure + 1) % beatsPerMeasure;
      currentTick += resolution; // Advance by one beat (one quarter note)
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
