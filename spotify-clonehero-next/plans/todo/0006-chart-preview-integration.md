# 0006 - Chart Preview & Audio Sync Integration

> **Dependencies:** 0002 (chart writing - data bridge to ParsedChart)
> **Unlocks:** 0007 (web editor - highway preview component)
>
> **Integration:** This project already uses THREE.js for highway rendering (`lib/preview/highway.ts`) and has audio management (`lib/preview/audioManager.ts`). The chart-preview web component from npm is a separate, more complete implementation. We'll use the npm `chart-preview` package for the transcription editor (it handles drum note textures, strikeline, and playback sync out of the box). Audio comes from OPFS. Component at `app/drum-transcription/components/HighwayPreview.tsx`.
>
> **Note:** The project already has `three` installed as a dependency. `chart-preview` uses its own bundled THREE.js — check for version conflicts.

## 1. chart-preview API Summary (from source analysis)

### Architecture

chart-preview (v1.3.0) provides two layers:

1. **`ChartPreview`** -- Low-level class. Creates a THREE.js scene inside a container `<div>`, manages audio playback, and renders a scrolling 3D highway with note sprites. This is the class we will primarily use.
2. **`ChartPreviewPlayer`** -- Web Component (`<chart-preview-player>`). Wraps `ChartPreview` with a Shadow DOM UI containing play/pause, seek bar, volume, fullscreen, and timestamps. Registers itself as a custom element on import.

For the drum transcription editor, we should use the **low-level `ChartPreview` class directly** because:
- We need custom playback controls that are shared with the waveform editor
- We need to programmatically sync position with the waveform view
- We need to call `animateFrame()` logic on position changes that don't come from the player itself
- The built-in player UI would conflict with our editor layout

### ChartPreview API

```typescript
// Static factory
static async create(config: ChartPreviewConfig): Promise<ChartPreview>

// Static texture loader (cache result per instrument type)
static loadTextures(
  instrumentType: InstrumentType,
  options?: { animationsEnabled?: boolean }
): Promise<{
  highwayTexture: THREE.Texture,
  strikelineTexture: THREE.Texture,
  noteTextures: Map<ExtendedNoteType, Map<number, THREE.Texture>>,
  animatedTextureManager: AnimatedTextureManager
}>

// Playback
async togglePaused(): Promise<void>  // Starts/stops animation loop + audio
async seek(percentComplete: number): Promise<void>  // 0-1, pauses after seeking
get isPaused(): boolean
get chartCurrentTimeMs(): number
get chartEndTimeMs(): number

// Volume
set volume(v: number | null)  // 0-1, applies quadratic curve internally
get volume(): number | null

// Display
resize(): void  // Call when container size changes

// Cleanup
dispose(): void

// Events (via eventemitter3)
on('progress', (percentComplete: number) => void)  // Throttled to ~50ms
on('end', () => void)
off(event, listener)
```

### ChartPreviewConfig

```typescript
interface ChartPreviewConfig {
  parsedChart: ParsedChart       // From scan-chart's parseChartFile()
  textures: LoadTexturesResult   // From ChartPreview.loadTextures()
  audioFiles: Uint8Array[]       // Raw audio file bytes (decoded internally via Web Audio API)
  instrument: Instrument         // 'drums' for our use case
  difficulty: Difficulty          // 'expert' typically
  startDelayMs: number           // Chart offset/delay (can be negative)
  audioLengthMs: number          // Total audio duration in ms
  container: HTMLDivElement      // DOM element to render into
  progressIntervalMs?: number    // Min interval between progress events (default: 50ms)
}
```

### Key Constants from Source

- `HIGHWAY_DURATION_MS = 1500` -- The visible highway shows 1.5 seconds of upcoming notes
- `SCALE = 0.105` -- Base note sprite scale
- Drum lane layout: redDrum=lane 0, yellowDrum=lane 1, blueDrum=lane 2, greenDrum=lane 3, kick=lane 2 (center, with different visual)

### Audio Handling

- Uses a **shared `AudioContext`** singleton (to avoid browser limits of ~6 contexts)
- Each `ChartPreview` instance gets its own `GainNode` for independent volume
- Audio latency is compensated: `chartCurrentTimeMs` subtracts `baseLatency + outputLatency`
- Falls back to `SilentAudioManager` (performance.now-based timing) if AudioContext unavailable
- Audio files are decoded once via `AudioContext.decodeAudioData()` on creation

### Texture Loading

- Textures are fetched from `https://static.enchor.us/preview-*.webp`
- For drums, loads: kick, kick-sp, and for each of red/yellow/blue/green: tom, cymbal variants x ghost/accent/none x sp/normal = ~50 textures
- Animated WebP supported via ImageDecoder API (Chromium only, falls back to static)
- **Textures should be loaded once and cached** -- they are independent of the chart data

---

## 2. How to Instantiate and Configure the 3D Highway

### Initialization Sequence

```typescript
import { ChartPreview, areAnimationsSupported } from 'chart-preview'
import { parseChartFile, getInstrumentType } from 'scan-chart'

// Step 1: Load textures once at app startup (cache these)
const drumTextures = await ChartPreview.loadTextures(
  getInstrumentType('drums'),
  { animationsEnabled: areAnimationsSupported() }
)

// Step 2: Parse the chart file
// chartFileData is a Uint8Array of the .chart file content
const parsedChart = parseChartFile(chartFileData, 'chart', {
  song_length: 0,
  hopo_frequency: 0,
  eighthnote_hopo: false,
  multiplier_note: 0,
  sustain_cutoff_threshold: -1,
  chord_snap_threshold: 0,
  five_lane_drums: false,
  pro_drums: true,  // We want tom/cymbal distinction
})

// Step 3: Create the preview
const containerDiv = document.getElementById('highway-container') as HTMLDivElement
const preview = await ChartPreview.create({
  parsedChart,
  textures: drumTextures,
  audioFiles: [drumStemAudioData],  // Uint8Array of the drum stem audio
  instrument: 'drums',
  difficulty: 'expert',
  startDelayMs: 0,
  audioLengthMs: totalDurationMs,
  container: containerDiv,
  progressIntervalMs: 16,  // ~60fps progress updates for smooth sync
})
```

### Container Setup

The container div must have explicit width and height. ChartPreview reads `offsetWidth` and `offsetHeight` from the container. The THREE.js canvas is appended as a child of the container.

```html
<div id="highway-container" style="width: 100%; height: 400px;"></div>
```

After creation, the canvas is the first child of the container. ChartPreview removes any existing first child before appending.

### Resize Handling

Call `preview.resize()` whenever the container dimensions change (window resize, panel resize, fullscreen toggle). The source shows it reads from `divContainer.offsetWidth/offsetHeight` and updates both camera aspect ratio and renderer size.

---

## 3. Data Format Bridge

### Our Internal Chart Model -> chart-preview's Expected Format

chart-preview expects a `ParsedChart` -- the return type of `scan-chart`'s `parseChartFile()`. This is our primary data interchange format.

#### ParsedChart Structure (drums-relevant fields)

```typescript
interface ParsedChart {
  resolution: number                    // Ticks per quarter note (192 or 480)
  drumType: DrumType | null             // fourLane(0), fourLanePro(1), fiveLane(2)
  metadata: { name, artist, delay, ... }
  tempos: { tick, beatsPerMinute, msTime }[]
  timeSignatures: { tick, numerator, denominator, msTime, msLength }[]
  sections: { tick, name, msTime, msLength }[]
  trackData: [{
    instrument: 'drums',
    difficulty: 'expert',
    noteEventGroups: NoteEvent[][],     // Groups of simultaneous notes
    starPowerSections: [...],
    soloSections: [...],
    flexLanes: [...],
    drumFreestyleSections: [...]
  }]
}
```

#### NoteEvent (the critical type)

```typescript
interface NoteEvent {
  tick: number        // Position in chart ticks
  msTime: number      // Millisecond timestamp
  length: number      // Duration in ticks (0 for drum hits)
  msLength: number    // Duration in ms (0 for drum hits)
  type: NoteType      // kick(13), redDrum(14), yellowDrum(15), blueDrum(16), greenDrum(17)
  flags: number       // Bitmask: tom(16), cymbal(32), ghost(512), accent(1024), doubleKick(8), etc.
}
```

### Two Approaches for the Data Bridge

#### Approach A: Generate .chart file bytes, parse with scan-chart (Simpler)

Since we are writing a .chart serializer anyway, the simplest path is:
1. Our editor maintains the chart in our internal model
2. When loading the preview, serialize to .chart text format
3. Convert to `Uint8Array` via `TextEncoder`
4. Call `parseChartFile(chartBytes, 'chart', modifiers)`
5. Feed the resulting `ParsedChart` to `ChartPreview.create()`

Pros: No format mismatch risk; parseChartFile handles all the tempo/ms calculations.
Cons: Serialization roundtrip on every reload.

#### Approach B: Build ParsedChart directly (More efficient for real-time updates)

Construct a `ParsedChart` object directly from our internal model:
1. Build the `tempos`, `timeSignatures`, `sections` arrays
2. Build `noteEventGroups` as `NoteEvent[][]` where each inner array is a group of simultaneous notes
3. Compute `msTime` and `msLength` ourselves using the tempo map

Pros: No serialization roundtrip; can surgically update data.
Cons: Must replicate tempo-to-ms calculation exactly; risk of format drift.

**Recommendation: Start with Approach A** for correctness, then optimize to Approach B if the roundtrip becomes a bottleneck. For a typical 4-minute song, serializing and parsing should take <50ms.

### Drum Note Mapping (our .chart note numbers -> scan-chart NoteType + flags)

Our editor works with .chart note numbers. Here is the mapping:

| .chart Note # | scan-chart NoteType | flags |
|---|---|---|
| 0 | kick (13) | none |
| 1 | redDrum (14) | tom (16) |
| 2 | yellowDrum (15) | tom (16) or cymbal (32) |
| 3 | blueDrum (16) | tom (16) or cymbal (32) |
| 4 | greenDrum (17) | tom (16) or cymbal (32) |
| 32 | kick (13) | doubleKick (8) |
| 66 | yellowDrum (15) | cymbal (32) -- pro cymbal marker |
| 67 | blueDrum (16) | cymbal (32) -- pro cymbal marker |
| 68 | greenDrum (17) | cymbal (32) -- pro cymbal marker |

For pro drums, cymbal vs tom distinction is encoded in `noteFlags.tom` (16) and `noteFlags.cymbal` (32). The chart-preview renderer uses different textures for each.

---

## 4. Audio Synchronization Approach

### The Core Problem

We have two independent views that must stay in sync:
1. **Waveform view** (WaveSurfer or similar) -- horizontal audio timeline with onset markers
2. **3D highway** (chart-preview) -- vertical scrolling note highway

Both need to reflect the same playback position at all times.

### Architecture: Shared Playback Controller

Create a central `PlaybackController` that owns the canonical playback state:

```typescript
class PlaybackController {
  private _currentTimeMs: number = 0
  private _isPlaying: boolean = false
  private _duration: number = 0

  // The chart-preview's AudioManager handles actual audio playback
  private chartPreview: ChartPreview

  // The waveform view listens for position updates
  private listeners: Set<(timeMs: number) => void>

  play(): void
  pause(): void
  seek(timeMs: number): void
  get currentTimeMs(): number
  get isPlaying(): boolean

  onTimeUpdate(callback: (timeMs: number) => void): void
}
```

### Sync Strategy

**chart-preview as the timing authority:**

chart-preview's `AudioManager` already handles precise audio-to-visual sync with latency compensation. It uses `AudioContext.currentTime` as the clock source during playback. We should let chart-preview be the timing master.

1. **Play/Pause**: Call `chartPreview.togglePaused()`. Update waveform position via `chartPreview.chartCurrentTimeMs`.
2. **Seek from waveform**: User clicks on waveform -> calculate ms position -> `chartPreview.seek(ms / durationMs)` -> waveform updates its own cursor.
3. **Seek from highway**: User drags the seek control -> `chartPreview.seek(percent)` -> waveform reads new position.
4. **Continuous sync during playback**: Use chart-preview's `progress` event (or a `requestAnimationFrame` loop reading `chartCurrentTimeMs`) to update the waveform cursor position.

### Audio File Handling

chart-preview decodes audio files via `AudioContext.decodeAudioData()` from raw `Uint8Array` bytes. We provide the drum stem audio file(s) as `Uint8Array[]`.

For the waveform view, we can either:
- **Option A**: Use the same audio data decoded separately by WaveSurfer (two decoders, same data)
- **Option B**: Mute chart-preview's audio (`preview.volume = 0`) and let WaveSurfer handle playback

**Recommendation: Option A** -- Let chart-preview handle audio playback (it has latency compensation), and let WaveSurfer decode the same audio independently for visualization only (not playback). This avoids fighting two audio players.

### Position Update Flow

```
User clicks Play
    -> PlaybackController.play()
    -> chartPreview.togglePaused()  (starts audio + animation loop)
    -> chartPreview emits 'progress' every ~16ms
    -> PlaybackController updates waveform cursor position

User clicks on waveform at position T
    -> PlaybackController.seek(T)
    -> chartPreview.seek(T / duration)  (pauses, positions audio)
    -> waveform.seekTo(T)
    -> if was playing, chartPreview.togglePaused()  (resumes)
```

---

## 5. Playback Controls Integration

### Shared Control Bar

Since chart-preview's `ChartPreviewPlayer` web component has its own control bar, and we want unified controls for both views, we skip the web component and build our own controls that drive `ChartPreview` directly.

### Required Controls

| Control | Implementation |
|---|---|
| Play/Pause | `chartPreview.togglePaused()` |
| Seek bar | `chartPreview.seek(percent)`, update on `progress` event |
| Current time display | Read `chartPreview.chartCurrentTimeMs` |
| Volume | `chartPreview.volume = value / 100` |
| Playback speed | Not natively supported by chart-preview. Would need to modify `AudioBufferSourceNode.playbackRate`. Could be a future enhancement. |
| Jump to section | Read `parsedChart.sections[]` -> seek to section's `msTime` |

### Keyboard Shortcuts

Build these into the editor frame (not the chart-preview component):

| Key | Action |
|---|---|
| Space | Toggle play/pause |
| Left/Right | Seek by beat or configurable step |
| Ctrl+Left/Right | Seek by section |
| +/- | Zoom waveform (does not affect highway) |

---

## 6. Real-Time Updates When the User Edits Notes

### The Challenge

When a user adds, moves, or deletes a note in the editor, the 3D highway should reflect the change immediately. chart-preview's `NotesManager` pre-processes all note events at construction time and renders them via an `EventSequence` optimized for forward-scanning.

### Current Limitation

chart-preview does **not** expose a method to update notes after creation. The `NotesManager` is constructed with the full `ParsedChart` and the note events are stored as a flat sorted array. There is no `updateNotes()` or `setChartData()` method.

### Approaches

#### Approach A: Rebuild on Edit (Simple, potentially fast enough)

1. User edits a note in the editor
2. Re-serialize the chart to .chart format
3. Re-parse with `parseChartFile()`
4. Dispose the old `ChartPreview`
5. Create a new `ChartPreview` with the updated `ParsedChart`
6. Seek to the previous position

```typescript
async function reloadPreview(currentTimeMs: number) {
  const percent = currentTimeMs / preview.chartEndTimeMs
  preview.dispose()

  const newParsedChart = parseChartFile(serializeChart(), 'chart', modifiers)
  preview = await ChartPreview.create({
    parsedChart: newParsedChart,
    textures: cachedDrumTextures,  // Reuse! Don't reload textures
    audioFiles: cachedAudioFiles,
    instrument: 'drums',
    difficulty: 'expert',
    startDelayMs: 0,
    audioLengthMs: duration,
    container: containerDiv,
  })
  await preview.seek(percent)
}
```

**Cost analysis:**
- Texture loading: 0ms (cached)
- Chart serialization + parsing: ~10-50ms for a typical chart
- Audio decoding: This is the expensive part (~100-500ms per audio file)

**Optimization**: Audio files could be cached as decoded `AudioBuffer` objects, but chart-preview currently re-decodes from raw bytes on every `create()`. This would require either:
- A PR to chart-preview to accept pre-decoded AudioBuffers
- Or accepting the decode latency on rebuilds

#### Approach B: Debounced Rebuild (Practical middle ground)

Same as Approach A but debounce rebuilds (e.g., 500ms after last edit). During the debounce window, the highway shows stale data but the waveform/editor shows current data. This is acceptable UX since users are focused on the editor when making changes.

#### Approach C: Fork chart-preview to Add Update Support (Best UX, most work)

Add a `updateChart(parsedChart)` method to `ChartPreview` that:
1. Rebuilds the `NotesManager` with new data
2. Clears existing note sprites from the scene
3. Preserves audio state and position

This is the cleanest approach but requires maintaining a fork.

**Recommendation: Start with Approach B** (debounced rebuild). If the audio re-decode latency is unacceptable, consider Approach C. Textures are the most expensive resource and those are already cacheable.

---

## 7. Performance Considerations

### THREE.js WebGL Context

- Each `ChartPreview` instance creates its own `WebGLRenderer` (and thus its own WebGL context)
- Browsers limit WebGL contexts (~8-16). With one highway preview this is fine.
- `dispose()` calls `forceContextLoss()` to release the context immediately

### Memory

- Note sprites are created/destroyed dynamically as they enter/leave the 1500ms visible window
- Textures are the largest memory consumer (~50 textures for drums, mostly small WebP images)
- Audio buffers: one decoded AudioBuffer per audio file (typically 10-50MB for a full song)

### Rendering Budget

- The animation loop runs via `requestAnimationFrame` (through `renderer.setAnimationLoop()`)
- Each frame: update note positions, tick animated textures, scroll highway, render scene
- For drums with moderate note density (~5-10 notes/sec), expect ~20-50 sprites visible at once
- This is well within budget for any modern GPU

### Optimizations to Consider

1. **Disable animated textures** (`animationsEnabled: false`) -- saves ImageDecoder overhead and texture updates per frame
2. **Increase `progressIntervalMs`** if we don't need 60fps sync updates (default 50ms is fine for our use)
3. **Pre-decode audio** on first load and cache the `Uint8Array` in memory so rebuilds don't re-fetch
4. **Pause rendering** when the highway panel is not visible (e.g., user switches to a different editor tab)
5. **Reduce resolution** for the highway renderer if it's shown in a small panel:
   ```typescript
   // After creation, the renderer is the canvas in the container
   // THREE.js setSize already handles pixel ratio, but we can reduce for performance
   ```

---

## 8. Styling and Layout Within the Editor

### Proposed Layout

```
+-------------------------------------------------------------------+
|  Toolbar: [Play/Pause] [<< >>] [Speed] [Volume]  | Song: Title    |
+-------------------------------------------------------------------+
|                                                                     |
|  +---------------------------+  +-------------------------------+  |
|  |                           |  |                               |  |
|  |   Waveform View           |  |   3D Highway Preview          |  |
|  |   (WaveSurfer)            |  |   (chart-preview)             |  |
|  |                           |  |                               |  |
|  |   [====|==========----]   |  |        ___                    |  |
|  |   onset markers overlay   |  |   o   |   |  o    o          |  |
|  |                           |  |   - - - strikeline - - -      |  |
|  +---------------------------+  +-------------------------------+  |
|                                                                     |
+-------------------------------------------------------------------+
|                                                                     |
|  Note Editor / Timeline Grid                                        |
|  (drum lane editor with beat grid)                                  |
|                                                                     |
+-------------------------------------------------------------------+
```

### Highway Panel Sizing

The 3D highway works best in a tall, narrow aspect ratio (like the actual Clone Hero game). Recommended minimum:
- Width: 300-400px
- Height: 400-600px (or fill available vertical space)
- The camera is at a 60-degree angle looking down the highway, so wider containers show more empty space on the sides

### CSS Custom Properties

The `ChartPreviewPlayer` web component exposes these CSS custom properties (if we use it):
```css
--player-bg: #000;
--controls-bg: #2a2a3a;
--accent-color: #3b82f6;
```

Since we are using `ChartPreview` directly, the canvas has a transparent background by default. The scene background is not explicitly set (defaults to black from the container). We can style the container div freely.

### Integration with React/Framework

```tsx
function HighwayPreview({ chartData, audioData, currentTimeMs, onSeek }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const previewRef = useRef<ChartPreview | null>(null)
  const texturesRef = useRef<Awaited<ReturnType<typeof ChartPreview.loadTextures>> | null>(null)

  // Load textures once
  useEffect(() => {
    ChartPreview.loadTextures(getInstrumentType('drums'), {
      animationsEnabled: areAnimationsSupported()
    }).then(t => { texturesRef.current = t })
  }, [])

  // Create/recreate preview when chart data changes
  useEffect(() => {
    if (!containerRef.current || !texturesRef.current || !chartData) return

    const create = async () => {
      previewRef.current?.dispose()

      previewRef.current = await ChartPreview.create({
        parsedChart: chartData,
        textures: texturesRef.current!,
        audioFiles: audioData,
        instrument: 'drums',
        difficulty: 'expert',
        startDelayMs: 0,
        audioLengthMs: duration,
        container: containerRef.current!,
        progressIntervalMs: 16,
      })

      previewRef.current.on('progress', (pct) => {
        onSeek?.(pct * previewRef.current!.chartEndTimeMs)
      })
    }
    create()

    return () => { previewRef.current?.dispose() }
  }, [chartData, audioData])

  // Sync external position changes
  useEffect(() => {
    if (previewRef.current && previewRef.current.isPaused) {
      const pct = currentTimeMs / previewRef.current.chartEndTimeMs
      previewRef.current.seek(pct)
    }
  }, [currentTimeMs])

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
}
```

### Resize Observer

Use a `ResizeObserver` on the container to call `preview.resize()`:

```typescript
const observer = new ResizeObserver(() => {
  previewRef.current?.resize()
})
observer.observe(containerRef.current)
```

This is important because chart-preview only listens for `window.resize` events, not container-level resizes.

---

## Summary: Implementation Order

1. **Set up texture caching** -- Load drum textures once at app startup
2. **Create the highway panel** -- Container div with proper sizing
3. **Wire up basic loading** -- Parse chart, create preview, display highway
4. **Build PlaybackController** -- Unified play/pause/seek that drives both views
5. **Audio sync** -- chart-preview plays audio, waveform tracks position via progress events
6. **Edit -> reload cycle** -- Debounced rebuild on note edits (Approach B)
7. **Polish** -- Resize handling, keyboard shortcuts, section jumping
8. **Optimize** -- Cache audio data, consider forking chart-preview for direct note updates
