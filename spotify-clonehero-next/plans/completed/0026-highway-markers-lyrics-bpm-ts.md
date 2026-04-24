# Plan 0026: Highway Markers — Lyrics, BPM, Time Signatures

> **Dependencies:** 0025 (scene reconciler)
> **Unlocks:** Independent
>
> **Goal:** Render lyrics, vocal phrase markers, BPM changes, and time signature changes on the highway as colored text flag sprites, matching Moonscraper's layout. Each marker type has a distinct color and side of the highway.

## Layout (matching Moonscraper)

```
LEFT SIDE                    HIGHWAY                    RIGHT SIDE
─────────                    ───────                    ──────────
Lyrics (blue)                                           Sections (green) ← already done
Phrase markers (blue)                                   Time Signatures (red)
BPM changes (purple)
```

## Visual Style

All markers use the same text flag sprite approach as sections (plan 0017): a `THREE.Sprite` with a `CanvasTexture` containing the label text on a semi-transparent colored background. This provides a consistent visual language across all marker types.

| Marker Type  | Side  | Color                       | Key Format            | Label Example |
| ------------ | ----- | --------------------------- | --------------------- | ------------- |
| Section      | Right | Green `rgba(0, 200, 40)`    | `section:{tick}`      | `verse_1`     |
| Lyric        | Left  | Blue `rgba(40, 120, 255)`   | `lyric:{tick}`        | `hel-`        |
| Phrase start | Left  | Blue `rgba(40, 120, 255)`   | `phrase-start:{tick}` | `phrase ▶`   |
| Phrase end   | Left  | Blue `rgba(40, 120, 255)`   | `phrase-end:{tick}`   | `phrase ■`    |
| BPM          | Left  | Purple `rgba(180, 40, 255)` | `bpm:{tick}`          | `♩ 120.00`    |
| Time Sig     | Right | Red `rgba(255, 80, 60)`     | `ts:{tick}`           | `4/4`         |

## Architecture

### Extend the SceneReconciler

The reconciler already supports multiple element kinds. Add new renderers:

```typescript
const reconciler = new SceneReconciler(
  scene,
  {
    note: noteRenderer,
    lyric: new MarkerRenderer(clippingPlanes, 'left', [40, 120, 255]),
    'phrase-start': new MarkerRenderer(clippingPlanes, 'left', [40, 120, 255]),
    'phrase-end': new MarkerRenderer(clippingPlanes, 'left', [40, 120, 255]),
    bpm: new MarkerRenderer(clippingPlanes, 'left', [180, 40, 255]),
    ts: new MarkerRenderer(clippingPlanes, 'right', [255, 80, 60]),
    section: new MarkerRenderer(clippingPlanes, 'right', [0, 200, 40]),
  },
  highwaySpeed,
);
```

### MarkerRenderer

A single configurable `ElementRenderer` for all marker types. Parameters: side (left/right), color.

```typescript
// lib/preview/highway/MarkerRenderer.ts

interface MarkerElementData {
  text: string;
  isSelected?: boolean;
}

class MarkerRenderer implements ElementRenderer<MarkerElementData> {
  constructor(
    clippingPlanes: THREE.Plane[],
    side: 'left' | 'right',
    color: [number, number, number], // RGB 0-255
  );

  create(data: MarkerElementData, msTime: number): THREE.Group {
    // Create:
    // 1. Text flag sprite (CanvasTexture with colored background + white text)
    //    - Left side: positioned at -HIGHWAY_HALF_WIDTH - gap, anchored right
    //    - Right side: positioned at +HIGHWAY_HALF_WIDTH + gap, anchored left
    // 2. Thin colored horizontal line across the highway at this Y position
    //    (renderOrder behind notes)
  }

  recycle(group: THREE.Group): void {
    // Dispose children
  }
}
```

This replaces the current section rendering in SceneOverlays with a reconciler-managed approach. Sections would migrate from SceneOverlays to the reconciler using a MarkerRenderer with green color on the right side.

### Extend trackToElements / chartToElements

Currently `trackToElements()` only converts notes from a `Track`. We need a broader function that converts ALL chart elements:

```typescript
// lib/preview/highway/chartToElements.ts

function chartToElements(
  parsedChart: ParsedChart,
  track: Track,
): ChartElement[] {
  const elements: ChartElement[] = [];

  // Notes (existing)
  elements.push(...noteElements(track));

  // Sections
  for (const section of parsedChart.sections) {
    elements.push({
      key: `section:${section.tick}`,
      kind: 'section',
      msTime: section.msTime,
      data: {text: section.name},
    });
  }

  // Lyrics
  for (const lyric of parsedChart.lyrics) {
    elements.push({
      key: `lyric:${lyric.tick}`,
      kind: 'lyric',
      msTime: lyric.msTime,
      data: {text: lyric.text},
    });
  }

  // Vocal phrases
  for (const phrase of parsedChart.vocalPhrases) {
    elements.push({
      key: `phrase-start:${phrase.tick}`,
      kind: 'phrase-start',
      msTime: phrase.msTime,
      data: {text: 'phrase ▶'},
    });
    // phrase end at tick + length
    const endTick = phrase.tick + phrase.length;
    const endMs = phrase.msTime + phrase.msLength;
    elements.push({
      key: `phrase-end:${endTick}`,
      kind: 'phrase-end',
      msTime: endMs,
      data: {text: 'phrase ■'},
    });
  }

  // BPM changes
  for (const tempo of parsedChart.tempos) {
    elements.push({
      key: `bpm:${tempo.tick}`,
      kind: 'bpm',
      msTime: tempo.msTime,
      data: {text: `♩ ${tempo.beatsPerMinute.toFixed(2)}`},
    });
  }

  // Time signatures
  for (const ts of parsedChart.timeSignatures) {
    elements.push({
      key: `ts:${ts.tick}`,
      kind: 'ts',
      msTime: ts.msTime,
      data: {text: `${ts.numerator}/${ts.denominator}`},
    });
  }

  return elements;
}
```

### Migrate Section Rendering

Currently sections are rendered by `SceneOverlays.ts` (green flags + lines). Migrate them to the reconciler:

1. Remove section rendering from SceneOverlays
2. Add section elements to `chartToElements()`
3. Register a green MarkerRenderer for 'section' kind
4. Section selection/drag handled via reconciler keys

### Data Flow

```
ParsedChart (from scan-chart)
  → chartToElements(parsedChart, track)
  → reconciler.setElements(elements)
  → MarkerRenderer.create() for each visible marker
  → Three.js scene shows flags at correct positions
```

For edits:

```
Command modifies ChartDocument
  → writeChart → parseChartFile → new ParsedChart
  → chartToElements(newParsedChart, newTrack)
  → reconciler.setElements(newElements)
  → reconciler diffs: only changed markers are updated
```

## Execution Order

1. **Create `MarkerRenderer.ts`** — configurable text flag renderer (side, color). Reuses the `createSectionTexture` pattern but parameterized.

2. **Create `chartToElements.ts`** — converts ParsedChart + Track to ChartElement[] including notes, sections, lyrics, phrases, BPM, time signatures.

3. **Register all renderers** in `index.ts` — note + 6 marker types.

4. **Update `useEditCommands.ts`** — use `chartToElements` instead of `trackToElements`.

5. **Migrate section rendering** from SceneOverlays to the reconciler. Remove section banner/line code from SceneOverlays.

6. **Update InteractionManager** — section hit testing should work through the reconciler (key-based lookup) instead of SceneOverlays.

7. **Update HighwayEditor.tsx** — section selection/drag uses reconciler keys.

8. **Test** — verify all marker types render at correct positions with correct colors.

## Verification

```bash
yarn test
yarn lint
```

## Browser Testing (chrome-devtools MCP)

Use `public/All Time Low - SUCKERPUNCH (Hubbubble).sng` in `/drum-edit`:

1. Sections visible as green flags on the right — same as before but now via reconciler
2. BPM marker visible as purple flag on the left at tick 0 (song start BPM)
3. Time signature visible as red flag on the right at tick 0 (4/4)
4. If the chart has lyrics: blue lyric flags on the left at each syllable
5. Scroll through — all markers scroll with the highway
6. Section clicking still works (via reconciler key-based hit testing)
7. Sheet-music preview unaffected (doesn't use the editor reconciler for markers)
