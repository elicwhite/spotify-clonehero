# Plan 0023: Waveform Highway Surface with Grid Overlay

> **Dependencies:** 0019 (highway decomposition)
> **Unlocks:** Independent
>
> **Goal:** Render the audio waveform as the highway surface texture, with beat lines and grid lines as separate transparent meshes on top. The waveform scrolls with the highway, giving the user a visual timing reference while editing.

## Context

The highway currently uses a static repeating texture (`wor.png`) for its surface. The user wants to replace this with the audio waveform, which provides much better timing context when editing drum charts. Beat lines should overlay the waveform so the user sees both the rhythmic grid and the audio shape.

## Architecture

### Three Layers (bottom to top)

```
Layer 1: Waveform surface    (PlaneGeometry with waveform CanvasTexture)
Layer 2: Grid/beat lines      (transparent PlaneGeometry with line texture)
Layer 3: Notes + overlays     (existing note sprites, cursor, sections)
```

### WaveformSurface class (new, in `lib/preview/highway/WaveformSurface.ts`)

```typescript
class WaveformSurface {
  private mesh: THREE.Mesh;
  private canvas: HTMLCanvasElement;
  private texture: THREE.CanvasTexture;

  constructor(
    audioData: Float32Array,   // raw PCM
    channels: number,
    durationMs: number,
    highwayWidth: number,      // 0.9 for drums, 1.0 for guitar
  )

  // Renders the waveform to a canvas texture
  // The canvas height maps to the full song duration
  // The canvas width maps to the highway width
  private renderWaveform(): void

  getMesh(): THREE.Mesh        // add to scene
  update(currentTimeMs: number, highwaySpeed: number): void  // scroll texture offset
  setVisible(visible: boolean): void
  dispose(): void
}
```

### Waveform Rendering

The waveform is pre-rendered to a tall canvas (or tiled for memory efficiency):

```typescript
private renderWaveform(): void {
  // Canvas dimensions: width = 512px (enough resolution), height proportional to duration
  // For a 3-minute song at ~100px per second: height = 18000px
  // This might be too tall — use tiling or downsampled resolution

  const pixelsPerSecond = 50; // adjustable
  const canvasHeight = Math.ceil((this.durationMs / 1000) * pixelsPerSecond);
  const canvasWidth = 512;

  this.canvas.width = canvasWidth;
  this.canvas.height = Math.min(canvasHeight, 16384); // WebGL max texture size

  const ctx = this.canvas.getContext('2d')!;
  ctx.fillStyle = '#1a1a2e'; // dark background
  ctx.fillRect(0, 0, canvasWidth, this.canvas.height);

  // Draw waveform as RMS bars (similar to WaveformDisplay.tsx)
  const samplesPerPixel = (this.audioData.length / this.channels) / this.canvas.height;
  ctx.fillStyle = 'rgba(100, 140, 200, 0.4)'; // subtle blue waveform

  for (let y = 0; y < this.canvas.height; y++) {
    const startSample = Math.floor(y * samplesPerPixel) * this.channels;
    const endSample = Math.floor((y + 1) * samplesPerPixel) * this.channels;

    // Compute RMS for this row
    let sum = 0;
    let count = 0;
    for (let i = startSample; i < endSample && i < this.audioData.length; i++) {
      sum += this.audioData[i] * this.audioData[i];
      count++;
    }
    const rms = count > 0 ? Math.sqrt(sum / count) : 0;
    const barWidth = rms * canvasWidth * 0.8;

    // Draw centered horizontal bar
    const x = (canvasWidth - barWidth) / 2;
    ctx.fillRect(x, this.canvas.height - y - 1, barWidth, 1); // y inverted (bottom = start)
  }

  this.texture = new THREE.CanvasTexture(this.canvas);
  this.texture.wrapS = THREE.ClampToEdgeWrapping;
  this.texture.wrapT = THREE.ClampToEdgeWrapping;
}
```

### Scrolling

The waveform texture scrolls the same way as the highway texture:

```typescript
update(currentTimeMs: number, highwaySpeed: number): void {
  // Map current time to texture offset
  const fraction = currentTimeMs / this.durationMs;
  // The visible window is HIGHWAY_DURATION_MS / durationMs of the total texture
  this.texture.offset.y = fraction;
  this.texture.repeat.y = HIGHWAY_DURATION_MS / this.durationMs;
}
```

### Beat Lines / Grid Overlay

Beat lines are rendered as a separate transparent mesh on top of the waveform:

```typescript
class GridOverlay {
  private mesh: THREE.Mesh;
  private canvas: HTMLCanvasElement;
  private texture: THREE.CanvasTexture;

  constructor(
    tempos: TempoEvent[],
    timeSignatures: TimeSignatureEvent[],
    resolution: number,
    durationMs: number,
    highwayWidth: number,
  )

  // Renders beat lines to a canvas texture (white/grey lines at beat positions)
  private renderGrid(): void
  getMesh(): THREE.Mesh
  update(currentTimeMs: number, highwaySpeed: number): void
  dispose(): void
}
```

### Integration with HighwayScene

```typescript
// In HighwayScene.ts or index.ts
if (waveformData) {
  const waveform = new WaveformSurface(waveformData, channels, durationMs, highwayWidth);
  scene.add(waveform.getMesh()); // renderOrder 0 (behind everything)

  const grid = new GridOverlay(tempos, timeSignatures, resolution, durationMs, highwayWidth);
  scene.add(grid.getMesh()); // renderOrder 1 (above waveform, below notes)
}
```

### Toggle

The waveform surface should be toggleable — user can switch between:
1. Waveform + grid (editor mode)
2. Classic highway texture (preview mode)

```typescript
setHighwayMode(mode: 'waveform' | 'classic'): void {
  this.waveformSurface?.setVisible(mode === 'waveform');
  this.classicHighway.visible = mode === 'classic';
}
```

## Memory Considerations

A full-song waveform texture can be large:
- 3-minute song at 50px/s = 9000px tall × 512px wide = ~18MB uncompressed
- WebGL max texture size is typically 4096 or 16384
- For songs > 5 minutes, need tiling or lower resolution

### Tiling approach (if needed):
- Divide song into segments (e.g., 30-second tiles)
- Only keep the current tile + adjacent tiles loaded
- Swap textures as playback progresses

### Simpler approach for v1:
- Render at lower resolution (20px/s instead of 50)
- Cap canvas height at 4096px
- Good enough for most songs (< 3.5 minutes)

## Execution Order

1. Create `WaveformSurface.ts` — renders waveform to CanvasTexture.
2. Add waveform mesh to scene (behind highway, renderOrder 0).
3. Implement scrolling (texture offset updates each frame).
4. Create `GridOverlay.ts` — renders beat lines to CanvasTexture.
5. Add grid mesh on top of waveform (renderOrder 1).
6. Add toggle between waveform and classic highway modes.
7. Wire up from React: pass audioData to highway, add toggle control to LeftSidebar.
8. Test with different song lengths and tempos.

## Verification

```bash
yarn test
yarn lint
```

## Browser Testing (chrome-devtools MCP)

1. Load test chart with audio — waveform visible on highway surface.
2. Play — waveform scrolls smoothly in sync with audio.
3. Beat lines visible on top of waveform.
4. Notes render on top of both layers.
5. Toggle to classic mode — original highway texture appears.
6. Toggle back — waveform returns.
7. Test with different zoom levels — waveform detail adjusts.
