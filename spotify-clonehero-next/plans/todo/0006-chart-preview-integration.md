# 0006 - Chart Preview & Audio Sync Integration

> **Dependencies:** 0002 (chart writing - data bridge to ParsedChart)
> **Unlocks:** 0007 (web editor - highway preview component)
>
> **Integration:** This project already has a working THREE.js highway renderer (`lib/preview/highway.ts`), a React wrapper (`app/sheet-music/[slug]/CloneHeroRenderer.tsx`), and a full-featured AudioManager (`lib/preview/audioManager.ts`). We will use these existing components directly for the drum transcription editor -- no external `chart-preview` npm package.
>
> The AudioManager already handles multiple audio stems, speed control via SoundTouch, per-track volume, practice mode looping, and latency compensation. WaveSurfer (for waveform display) should integrate with AudioManager, not replace it.

---

## 1. CloneHeroRenderer & Highway Renderer API Summary (from source)

### Architecture

The project's highway preview has two layers:

1. **`setupRenderer()`** (`lib/preview/highway.ts`) -- Low-level function. Creates a THREE.js scene, camera, WebGL renderer, loads textures from `/assets/preview/assets2/`, and builds a scrolling 3D note highway from a `ParsedChart`. Returns an object with `prepTrack()`, `startRender()`, and `destroy()` methods.
2. **`CloneHeroRenderer`** (`app/sheet-music/[slug]/CloneHeroRenderer.tsx`) -- React component. Wraps `setupRenderer()` with refs, lifecycle management, and an instrument/difficulty picker UI.

### setupRenderer API

```typescript
import { setupRenderer, SelectedTrack } from '@/lib/preview/highway';

// Parameters
const renderer = setupRenderer(
  metadata: ChartResponseEncore,  // Song metadata (needs song_length)
  chart: ParsedChart,              // From scan-chart's parseChartFile()
  sizingRef: RefObject<HTMLDivElement>,  // Container for reading dimensions
  ref: RefObject<HTMLDivElement>,        // Container to append canvas into
  audioManager: AudioManager,      // Drives playback timing
);

// Returns
renderer.prepTrack(track: Track)   // Builds scene for a specific instrument/difficulty track
renderer.startRender()             // Starts the requestAnimationFrame loop
renderer.destroy()                 // Tears down event listeners, stops animation loop
```

### Key Types

```typescript
type ParsedChart = ReturnType<typeof parseChartFile>;  // from chorus-chart-processing.ts
type Track = ParsedChart['trackData'][0];
type NoteGroup = Track['noteEventGroups'][0];
type Note = NoteGroup[0];

type SelectedTrack = {
  instrument: Instrument;  // 'drums', 'guitar', 'bass', etc.
  difficulty: Difficulty;  // 'expert', 'hard', 'medium', 'easy'
};
```

### CloneHeroRenderer React Component Props

```typescript
interface CloneHeroRendererProps {
  metadata: ChartResponseEncore;           // Song metadata
  chart: ParsedChart;                       // Full parsed chart
  track: ParsedChart['trackData'][0];       // Specific instrument+difficulty track
  audioManager: AudioManager;               // Audio playback controller
}
```

Usage:
```tsx
<CloneHeroRenderer
  metadata={metadata}
  chart={parsedChart}
  track={parsedChart.trackData[0]}  // e.g., expert drums
  audioManager={audioManager}
/>
```

### Rendering Pipeline (from source)

1. `setupRenderer()` creates camera (90 FOV, 60-degree angle), WebGL renderer, clipping planes
2. `prepTrack()` builds the scene:
   - Adds drum highway mesh (textured scrolling plane, 0.9 width)
   - Adds drum hit box sprite (strikeline)
   - Calls `generateNoteHighway()` which iterates all `noteEventGroups`, creating THREE.Sprite objects positioned at `(time / 1000) * highwaySpeed` on the Y axis
3. `startRender()` starts `requestAnimationFrame` loop that:
   - Reads `audioManager.currentTime` (in seconds) and `audioManager.delay` (latency compensation)
   - Computes `scrollPosition = -1 * (elapsedTime / 1000) * highwaySpeed`
   - Updates `highwayTexture.offset.y` (scrolling background) and `highwayGroups.position.y` (note positions)
   - Only animates when `audioManager.isPlaying && audioManager.isInitialized`

### Key Constants

- `highwaySpeed = 1.5` -- Multiplier for scroll speed (units per second)
- `SCALE = 0.105` -- Base note sprite scale
- `NOTE_SPAN_WIDTH = 0.99` -- Width of the note lane area
- Drum lanes: redDrum=0, yellowDrum=1, blueDrum=2, greenDrum=3 (kick is centered)

### Texture Loading

Textures are loaded from local assets (not remote URLs):
- Highway: `/assets/preview/assets/highways/wor.png`
- Hit box: `/assets/preview/assets/isolated-drums.png`
- Drum toms: `/assets/preview/assets2/drum-tom-{red,yellow,blue,green}.webp`
- Drum cymbals: `/assets/preview/assets2/drum-cymbal-{red,yellow,blue,green}.webp`
- Drum kick: `/assets/preview/assets2/drum-kick.webp`

---

## 2. AudioManager API Summary (from source)

### Construction

```typescript
import { AudioManager } from '@/lib/preview/audioManager';

const audioManager = new AudioManager(
  audioFiles: Files,           // Array of { fileName: string; data: Uint8Array }
  onSongEnded: () => void,     // Callback when all tracks finish
);

await audioManager.ready;  // Wait for audio decoding + SoundTouch worklet init
```

AudioManager groups files by name: all `drums_*` files merge into a single "drums" track. Other stems (song, guitar, bass, rhythm, keys, vocals, vocals_1, vocals_2) become individual tracks keyed by their basename.

### Playback

```typescript
await audioManager.play({ percent?: number, time?: number })  // Start from position (time in seconds)
await audioManager.pause()   // Suspend AudioContext
await audioManager.resume()  // Resume AudioContext
await audioManager.stop()    // Stop all sources

audioManager.isPlaying       // boolean (AudioContext is 'running')
audioManager.isInitialized   // boolean (sources have been started)
audioManager.currentTime     // number (seconds, tempo-compensated)
audioManager.delay           // number (seconds, baseLatency + outputLatency)
```

### Per-Stem Volume Control

```typescript
audioManager.setVolume(trackName: string, volume: number)  // 0.0 to 1.0
// Track names are basenames: 'drums', 'song', 'guitar', 'bass', 'rhythm', 'keys', 'vocals', etc.
// Applies x-squared curve internally for natural-sounding volume
```

### Speed Control

```typescript
audioManager.setTempo(tempo: number)      // 0.25 to 4.0
audioManager.speedUp(factor?: number)     // Default 1.25x multiplier
audioManager.slowDown(factor?: number)    // Default 0.8x multiplier
audioManager.resetSpeed()                 // Back to 1.0
audioManager.getCurrentTempo(): number
```

Uses SoundTouch AudioWorklet for pitch-corrected tempo changes. Falls back to raw playbackRate if worklet unavailable.

### Practice Mode

```typescript
audioManager.setPracticeMode({ startMeasureMs, endMeasureMs, startTimeMs, endTimeMs } | null)
audioManager.checkPracticeModeLoop()  // Call in animation loop to auto-loop
```

---

## 3. Data Format Bridge

### Our Internal Chart Model -> CloneHeroRenderer's Expected Format

CloneHeroRenderer expects a `ParsedChart` -- the return type of `scan-chart`'s `parseChartFile()`. This is our primary data interchange format.

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
  msTime: number      // Millisecond timestamp (used by highway.ts for Y positioning)
  length: number      // Duration in ticks (0 for drum hits)
  msLength: number    // Duration in ms (0 for drum hits)
  type: NoteType      // kick(13), redDrum(14), yellowDrum(15), blueDrum(16), greenDrum(17)
  flags: number       // Bitmask: tom(16), cymbal(32), ghost(512), accent(1024), doubleKick(8), etc.
}
```

The highway renderer reads `note.msTime` for Y positioning, `note.type` for lane assignment, and `note.flags` for tom vs cymbal texture selection.

### Data Bridge: Serialize chart -> parse with scan-chart -> feed to renderer

Since we are writing a .chart serializer anyway (plan 0002), the approach is:

1. Our editor maintains the chart in our internal model
2. When loading the preview, serialize to .chart text format
3. Convert to `Uint8Array` via `TextEncoder`
4. Call `parseChartFile(chartBytes, 'chart', modifiers)` to get a `ParsedChart`
5. Feed the resulting `ParsedChart` to `CloneHeroRenderer` (or `setupRenderer()` directly)

```typescript
import { parseChartFile } from '@eliwhite/scan-chart';

const chartBytes = new TextEncoder().encode(serializeToChartFormat(internalModel));
const parsedChart = parseChartFile(chartBytes, 'chart', {
  song_length: 0,
  hopo_frequency: 0,
  eighthnote_hopo: false,
  multiplier_note: 0,
  sustain_cutoff_threshold: -1,
  chord_snap_threshold: 0,
  five_lane_drums: false,
  pro_drums: true,  // We want tom/cymbal distinction
});
```

This avoids any format mismatch risk -- `parseChartFile` handles all tempo-to-ms calculations, note grouping, and flag resolution. For a typical 4-minute song, serialization + parsing should take <50ms.

### Drum Note Mapping (our .chart note numbers -> scan-chart NoteType + flags)

| .chart Note # | scan-chart NoteType | flags | Highway lane |
|---|---|---|---|
| 0 | kick (13) | none | centered (kick sprite) |
| 1 | redDrum (14) | tom (16) | 0 |
| 2 | yellowDrum (15) | tom (16) or cymbal (32) | 1 |
| 3 | blueDrum (16) | tom (16) or cymbal (32) | 2 |
| 4 | greenDrum (17) | tom (16) or cymbal (32) | 3 |
| 32 | kick (13) | doubleKick (8) | centered (kick sprite) |
| 66 | yellowDrum (15) | cymbal (32) | 1 |
| 67 | blueDrum (16) | cymbal (32) | 2 |
| 68 | greenDrum (17) | cymbal (32) | 3 |

The highway renderer (`getTextureForNote`) checks `noteFlags.cymbal` (32) to choose cymbal vs tom textures.

---

## 4. Audio Synchronization Approach

### The Core Problem

We have three independent views that must stay in sync:
1. **Waveform view** (WaveSurfer) -- horizontal audio timeline with onset markers
2. **3D highway** (CloneHeroRenderer) -- vertical scrolling note highway
3. **Note editor** -- drum lane editor with beat grid

All need to reflect the same playback position at all times.

### Architecture: AudioManager as the Single Timing Authority

AudioManager already handles precise audio-to-visual sync with latency compensation. It uses `AudioContext.currentTime` as the clock source during playback. The highway renderer already reads `audioManager.currentTime` and `audioManager.delay` in its animation loop. We keep this as-is.

**WaveSurfer integrates with AudioManager, not the other way around:**

- WaveSurfer is used for **visualization only** (rendering the waveform, showing onset markers). It does NOT play audio.
- AudioManager plays all audio through its existing stem management.
- During playback, WaveSurfer's cursor position is updated from `audioManager.currentTime` via `requestAnimationFrame` or AudioManager progress callbacks.

### Stem Volume Controls

Users need the option to hear just the drum track or the entire song during transcription editing. AudioManager already supports this:

```typescript
// Solo drums (mute everything else)
audioManager.setVolume('drums', 1.0);
audioManager.setVolume('song', 0.0);
audioManager.setVolume('guitar', 0.0);
audioManager.setVolume('bass', 0.0);
audioManager.setVolume('vocals', 0.0);

// Full mix
audioManager.setVolume('drums', 1.0);
audioManager.setVolume('song', 0.8);
audioManager.setVolume('guitar', 0.8);
audioManager.setVolume('bass', 0.8);
audioManager.setVolume('vocals', 0.8);

// Drums + click track only
audioManager.setVolume('drums', 1.0);
// (other stems muted)
```

The UI should expose per-stem volume sliders or at minimum a "drums only" / "full mix" toggle. Available track names depend on which audio files the song ships with (commonly: song, guitar, bass, rhythm, keys, vocals, drums).

### WaveSurfer Integration

WaveSurfer should decode the drum stem audio independently for waveform visualization (not playback):

```typescript
// WaveSurfer renders the drum waveform for visual reference
const wavesurfer = WaveSurfer.create({
  container: waveformRef.current,
  interact: true,
  media: undefined,  // No playback -- visualization only
});

// Load drum audio for waveform display
wavesurfer.loadBlob(new Blob([drumAudioData]));

// Sync cursor position from AudioManager during playback
function syncWaveformPosition() {
  if (audioManager.isPlaying) {
    const currentTimeSec = audioManager.currentTime;
    wavesurfer.seekTo(currentTimeSec / totalDurationSec);
    requestAnimationFrame(syncWaveformPosition);
  }
}
```

When the user clicks on the waveform to seek:
```typescript
wavesurfer.on('seek', (progress: number) => {
  // progress is 0-1
  const timeSec = progress * totalDurationSec;
  audioManager.play({ time: timeSec });
});
```

### Position Update Flow

```
User clicks Play
    -> audioManager.play({ time: currentPosition })
    -> AudioContext resumes, sources start
    -> Highway animation loop reads audioManager.currentTime (already wired)
    -> requestAnimationFrame loop updates WaveSurfer cursor
    -> Note editor scrolls to current position

User clicks on waveform at position T
    -> audioManager.play({ time: T })
    -> Highway automatically follows (reads audioManager.currentTime)
    -> WaveSurfer cursor updates

User adjusts speed
    -> audioManager.setTempo(newTempo)
    -> All stems adjust simultaneously (pitch-corrected via SoundTouch)
    -> Highway scroll speed automatically adjusts (reads tempo-compensated currentTime)
```

---

## 5. Playback Controls Integration

### Shared Control Bar

We build our own unified controls that drive AudioManager directly. The highway renderer follows automatically since it reads from AudioManager in its animation loop.

### Required Controls

| Control | Implementation |
|---|---|
| Play/Pause | `audioManager.play({ time })` / `audioManager.pause()` / `audioManager.resume()` |
| Seek bar | `audioManager.play({ time: seekMs / 1000 })`, update from `audioManager.currentTime` |
| Current time display | `audioManager.currentTime * 1000` (convert to ms) |
| Playback speed | `audioManager.setTempo(value)` -- already supports 0.25x to 4.0x with pitch correction |
| Per-stem volume | `audioManager.setVolume(trackName, value)` -- individual sliders for drums/song/guitar/bass/vocals |
| Drums only toggle | Set all non-drum stems to volume 0 |
| Jump to section | Read `parsedChart.sections[]` -> `audioManager.play({ time: section.msTime / 1000 })` |
| Practice mode loop | `audioManager.setPracticeMode({ startMeasureMs, endMeasureMs, startTimeMs, endTimeMs })` |

### Keyboard Shortcuts

Build these into the editor frame:

| Key | Action |
|---|---|
| Space | Toggle play/pause |
| Left/Right | Seek by beat or configurable step |
| Ctrl+Left/Right | Seek by section |
| +/- | Zoom waveform (does not affect highway) |
| [ / ] | Adjust playback speed |

---

## 6. Real-Time Updates When the User Edits Notes

### The Key Insight

When a user adds, moves, or deletes a note in the editor, the 3D highway should reflect the change. Critically, **audio does not need to be reprocessed** -- only the chart data changes. AudioManager continues playing uninterrupted.

### Approach: Rebuild Renderer with New Chart Data (Audio Untouched)

1. User edits a note in the editor
2. Re-serialize the chart to .chart format
3. Re-parse with `parseChartFile()` to get updated `ParsedChart`
4. Destroy the old renderer (`renderer.destroy()`)
5. Create a new renderer with updated `ParsedChart`, same `AudioManager` instance
6. Highway resumes at current playback position (AudioManager never stopped)

```typescript
function rebuildHighway(updatedInternalModel: InternalChartModel) {
  // AudioManager keeps playing -- don't touch it

  // Serialize and re-parse chart
  const chartBytes = new TextEncoder().encode(serializeToChartFormat(updatedInternalModel));
  const newParsedChart = parseChartFile(chartBytes, 'chart', chartModifiers);
  const newTrack = newParsedChart.trackData.find(
    t => t.instrument === 'drums' && t.difficulty === 'expert'
  );

  // Destroy old renderer (stops animation loop, removes canvas)
  rendererRef.current?.destroy();

  // Create new renderer with same AudioManager
  const renderer = setupRenderer(
    metadata,
    newParsedChart,
    sizingRef,
    ref,
    audioManager,  // Same instance, still playing
  );
  renderer.prepTrack(newTrack);
  renderer.startRender();
  rendererRef.current = renderer;
}
```

**Cost analysis:**
- Chart serialization + parsing: ~10-50ms for a typical chart
- Texture loading: Textures are loaded fresh per `setupRenderer` call (room for optimization -- see below)
- Audio: 0ms (AudioManager is untouched, keeps playing)

**Optimization: Debounce rebuilds** (e.g., 300ms after last edit). During the debounce window, the highway shows stale note data but audio continues and the waveform/editor shows current data. This is acceptable UX since users are focused on the editor when making changes.

**Future optimization:** Refactor `setupRenderer()` to accept pre-loaded textures so they don't reload on every rebuild. The texture loading (`loadTomTextures`, `loadCymbalTextures`, etc.) could be done once and cached.

---

## 7. Performance Considerations

### THREE.js WebGL Context

- Each `setupRenderer()` call creates its own `WebGLRenderer` (and thus its own WebGL context)
- `destroy()` calls `renderer.setAnimationLoop(null)` but does NOT currently call `forceContextLoss()` -- we should add this to avoid leaking contexts on rebuilds
- Browsers limit WebGL contexts (~8-16). With one highway preview and debounced rebuilds this is fine, but we should ensure the old context is released before creating a new one

### Memory

- Note sprites are all created upfront (the entire chart is pre-rendered as THREE.Sprite objects in `generateNoteHighway`). Clipping planes hide notes outside the visible window.
- Textures: ~10 drum textures (4 tom colors + 4 cymbal colors + kick + highway + hitbox)
- Audio buffers: Managed by AudioManager, one decoded AudioBuffer per stem (typically 10-50MB total for a full song)

### Rendering Budget

- The animation loop runs via `requestAnimationFrame` (through `renderer.setAnimationLoop()`)
- Each frame: read AudioManager time, update highway texture offset and note group Y position, render scene
- For drums with moderate note density, all note sprites exist in the scene but most are clipped. This is acceptable for typical charts but could be optimized for very long/dense charts.

### Optimizations to Consider

1. **Cache textures across rebuilds** -- Extract texture loading from `setupRenderer()` so drum/cymbal/tom textures load once and are reused
2. **Add `forceContextLoss()`** to `destroy()` to release WebGL contexts immediately
3. **Pause rendering** when the highway panel is not visible (e.g., user switches to a different editor tab)
4. **Lazy note sprite creation** -- Only create sprites for notes within a time window around the current position, rather than the entire chart. This would improve rebuild speed for long charts.
5. **Pre-decode audio** on first load and cache the decoded AudioBuffers in memory

---

## 8. Styling and Layout Within the Editor

### Proposed Layout

```
+-------------------------------------------------------------------+
|  Toolbar: [Play/Pause] [<< >>] [Speed] [Stem Mixer]  | Song Title |
+-------------------------------------------------------------------+
|                                                                     |
|  +---------------------------+  +-------------------------------+  |
|  |                           |  |                               |  |
|  |   Waveform View           |  |   3D Highway Preview          |  |
|  |   (WaveSurfer, viz only)  |  |   (CloneHeroRenderer)         |  |
|  |                           |  |                               |  |
|  |   [====|==========----]   |  |        ___                    |  |
|  |   onset markers overlay   |  |   o   |   |  o    o          |  |
|  |                           |  |   - - - strikeline - - -      |  |
|  +---------------------------+  +-------------------------------+  |
|                                                                     |
+-------------------------------------------------------------------+
|  Stem Mixer: [Drums: ====] [Song: ====] [Guitar: ==] [Bass: ==]   |
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

### Resize Observer

Use a `ResizeObserver` on the container since the highway renderer only listens for `window.resize`:

```typescript
const observer = new ResizeObserver(() => {
  // setupRenderer reads sizingRef dimensions on resize
  // but we need to trigger the resize handler explicitly
});
observer.observe(sizingRef.current);
```

Note: The current `setupRenderer()` listens for `window.resize` events and reads `sizingRef.current.offsetWidth/offsetHeight`. For container-level resizes (e.g., panel drag), we may need to extend this.

### Integration Pattern for Drum Transcription Editor

```tsx
function DrumTranscriptionEditor({ metadata, audioFiles, chartModel }) {
  const sizingRef = useRef<HTMLDivElement>(null!);
  const canvasRef = useRef<HTMLDivElement>(null!);
  const rendererRef = useRef<ReturnType<typeof setupRenderer> | null>(null);
  const [audioManager] = useState(() =>
    new AudioManager(audioFiles, () => { /* song ended */ })
  );

  // Parse chart from internal model
  const parsedChart = useMemo(() => {
    const chartBytes = new TextEncoder().encode(serializeToChartFormat(chartModel));
    return parseChartFile(chartBytes, 'chart', chartModifiers);
  }, [chartModel]);

  const drumTrack = useMemo(() =>
    parsedChart.trackData.find(t => t.instrument === 'drums' && t.difficulty === 'expert'),
    [parsedChart]
  );

  // Setup renderer when chart changes
  useEffect(() => {
    if (!canvasRef.current || !drumTrack) return;

    rendererRef.current?.destroy();
    const renderer = setupRenderer(metadata, parsedChart, sizingRef, canvasRef, audioManager);
    renderer.prepTrack(drumTrack);
    renderer.startRender();
    rendererRef.current = renderer;

    return () => renderer.destroy();
  }, [parsedChart, drumTrack, audioManager]);

  // Stem volume controls
  const [stemVolumes, setStemVolumes] = useState({
    drums: 1.0, song: 0.8, guitar: 0.8, bass: 0.8, vocals: 0.8
  });

  useEffect(() => {
    Object.entries(stemVolumes).forEach(([stem, vol]) => {
      try { audioManager.setVolume(stem, vol); } catch { /* stem may not exist */ }
    });
  }, [stemVolumes]);

  return (
    <div>
      <PlaybackToolbar audioManager={audioManager} />
      <div className="flex">
        <WaveformPanel audioManager={audioManager} drumAudioData={...} />
        <div className="relative h-full" ref={sizingRef}>
          <div ref={canvasRef} className="h-full" />
        </div>
      </div>
      <StemMixer volumes={stemVolumes} onChange={setStemVolumes} />
      <NoteEditor chartModel={chartModel} onEdit={handleEdit} />
    </div>
  );
}
```

---

## Summary: Implementation Order

1. **Data bridge** -- Implement serialize-to-.chart -> `parseChartFile()` pipeline (depends on plan 0002)
2. **Wire up CloneHeroRenderer** -- Render the highway from transcription output using existing `setupRenderer()` + `AudioManager`
3. **Stem volume controls** -- UI for per-stem volume using `audioManager.setVolume()`, with "drums only" and "full mix" presets
4. **WaveSurfer integration** -- Waveform visualization (no playback), cursor synced to `audioManager.currentTime`
5. **Unified playback controls** -- Play/pause/seek/speed that drive `AudioManager`, highway and waveform follow automatically
6. **Edit -> rebuild cycle** -- Debounced highway rebuild on note edits (re-serialize + re-parse + new renderer, audio untouched)
7. **Polish** -- Resize handling, keyboard shortcuts, section jumping, practice mode loop
8. **Optimize** -- Cache textures across rebuilds, add `forceContextLoss()` to destroy, lazy note sprite creation
