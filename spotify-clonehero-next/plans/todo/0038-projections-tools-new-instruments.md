# Plan 0038: Renderer projection + tool plugins + new instruments (Phase 9)

> **Source:** `plans/chart-editor-architecture-review.md` § "Migration plan → Phase 9"
> **Dependencies:** 0037 (chart-editor-core + EntityAdapter + EditorProfile)
> **Unlocks:** Future instruments, alternative views, modular toolbox.

## Context

The renderer is closer to instrument-agnostic than the editor. `trackToElements` already handles guitar (`trackToElements.ts:69`); `MarkerRenderer` and `SceneReconciler` are generic; `setupRenderer` has one asymmetric `instrument === 'drums'` branch (`index.ts:355`); `DrumHighwayPreview` synthesizes a fake drum track for lanes-off mode (`DrumHighwayPreview.tsx:96`).

`HighwayEditor` interaction is now split into hooks (phase 4) but still encoded as a single linear flow.

## Goal

1. `EditorProjection` is the renderer contract. The wrapper renames to `HighwayPreview` and consumes a projection. The fake-drum-track hack disappears.
2. Per-view projections: `FiveFretProjection`, `DrumsProjection`, `GHLiveProjection`, `VocalsProjection`, `GlobalMarkersProjection`.
3. `/guitar-edit` page exists. Proves the editor is genuinely instrument-agnostic.
4. Mouse interaction is `EditorTool` plugins. The phase-4 hook split becomes the foundation; each split-out hook promotes to a tool with a registered id.
5. `EditorMCPTools` capability-gates by reading `EditorProfile.allowedOperations`.

## Design

### 1. EditorProjection contract

```ts
interface EditorProjection {
  lanes: LaneDefinition[]; // from active InstrumentSchema
  elements: ChartElement[]; // from chart adapters
  markers: ChartElement[]; // sections, BPMs, etc.
  overlays: OverlayElement[]; // selection rects, hover, drag preview
  timing: TimingProjection; // tempos + time sigs flattened for renderer
}
```

The reconciler accepts a projection. `chartToElements` and `trackToElements` are wrapped per-projection-kind:

```ts
buildProjectionFor(scope, doc, schema): EditorProjection
```

Each projection kind picks the right entity adapters and assembles the renderer-ready output.

### 2. Per-view projections

- **`FiveFretProjection`** — guitar/bass/rhythm/keys: 5 lanes (or 6 with open). Uses `entityAdapters.note` filtered by `instrument`.
- **`DrumsProjection`** — 4 or 5 lane drums + flag visualization. Existing rendering generalized.
- **`GHLiveProjection`** — guitar-hero-live 6-button.
- **`VocalsProjection`** — phrase + lyric markers; optional pitched note row underneath.
- **`GlobalMarkersProjection`** — sections + tempo + timesig; not its own view but a layer that overlays on any projection above it.

A view is one or more projections stacked. The default editor view is `<active track projection> + GlobalMarkersProjection`.

### 3. /guitar-edit

A new page mirrors `/drum-edit`'s shell but pins `activeScope = { kind: 'track', track: { instrument: 'guitar', difficulty: 'expert' } }`. The active-track picker UI (deferred from phase 1) ships here for the "expert / hard / medium / easy" selector at minimum.

### 4. EditorTool plugins

```ts
interface EditorTool {
  id: string;
  cursor(hit: HitResult | null): string;
  onPointerDown(ctx: ToolContext, event: PointerEventInfo): void;
  onPointerMove(ctx: ToolContext, event: PointerEventInfo): void;
  onPointerUp(ctx: ToolContext, event: PointerEventInfo): void;
  onActivate?(ctx: ToolContext): void;
  onDeactivate?(ctx: ToolContext): void;
  renderOverlay?(ctx: ToolContext): ReactNode;
}

interface ToolContext {
  session: EditorSession;
  rendererRef: RefObject<EditorRenderer | null>;
  schema: InstrumentSchema;
  selection: Selection;
}
```

Tools shipped at this phase:

- `SelectMoveTool` — derived from `useHighwayMouseInteraction`.
- `BoxSelectTool` — derived from the box-select branch.
- `PlaceNoteTool` — derived from place-mode in `useEditorKeyboard`.
- `EraseTool`.
- `TempoMarkerTool`, `TimeSignatureMarkerTool`, `SectionTool` — derived from the popovers + keyboard.
- `LyricsTimingTool` — for add-lyrics.
- `StarPowerTool`, `SoloTool`.

`EditorProfile.tools` is the registered tool list. Active tool change → previous tool's `onDeactivate`, next tool's `onActivate`. Pointer events go to the active tool only.

### 5. MCP capability gating

`EditorMCPTools` reads `profile.allowedOperations` before registering each tool. A profile that doesn't allow `object.add` doesn't register `editor_add_note`. This closes the bypass discovered in the architecture review.

### 6. Audio decoupling (mini-task)

The architecture review notes audio should be a service, not embedded in editor state. This phase moves `AudioManager` ref ownership out of `ChartEditorContext` and into a sibling `<AudioServiceProvider>`. Subscriptions handle cursor sync.

## Tasks (suggested order)

1. **`EditorProjection` types + `buildProjectionFor`.**
2. **Migrate `DrumsProjection`** — drum view stops being implicit; the existing path uses the projection. No behavior change.
3. **Rename `DrumHighwayPreview` → `HighwayPreview`.** Drop synthetic-empty-drum-track branch.
4. **Add `FiveFretProjection`.** Guitar in lanes-only mode (no flag UI yet).
5. **`/guitar-edit` page** + active-track picker UI in the header.
6. **`EditorTool` interface + tool registry.**
7. **Convert each phase-4 hook into a tool.** Validate each before moving on.
8. **`VocalsProjection`** — replaces the phantom-drum-track approach in add-lyrics.
9. **MCP capability gating** via profile.
10. **Audio service extraction.**
11. **Browser validation** — drum-edit, drum-transcription, add-lyrics, guitar-edit. Same shortcuts work in each, profile differences are visible.

## Tests

- `projections.test.ts` — `buildProjectionFor` produces the expected `ChartElement[]` per scope kind.
- `tools.test.ts` — each tool's pointer flow against a stub session.
- `mcp-gating.test.ts` — registering MCP tools against a profile filters by `allowedOperations`.
- Renderer tests aren't expanded here; the reconciler doesn't change shape.

## Open questions

1. **Per-instrument lane visualization** — does five-fret use the existing highway texture (`wor.png`) or a dedicated guitar texture? Look at YARG's renderer for parity. (Probably worth a separate small plan.)
2. **Stacked views** — when phase 9 is done, can a user view drums + global-markers + a vocals strip simultaneously? The projection model supports it, but mounting two scenes in one canvas is non-trivial. Probably defer to phase 10.
3. **Active-track picker copy** — show difficulty as `[expert]` `[hard]` `[medium]` `[easy]` or as `Expert/Hard/Medium/Easy`? Match Moonscraper's idiom for the user base.
4. **Tools that span multiple kinds** — e.g. `BoxSelectTool` selects across notes + sections + lyrics. Lean: tool talks to `EditorProfile.selectableEntities` and lets the profile's set decide.

## Out of scope

- Vocal pitch editing UI. Reserved for a later phase that designs the rolling vocal track.
- Practice / co-op (`[ExpertDoubleBass]`, `[ExpertDoubleGuitar]`) tracks. Active-track picker exposes them, but no special editor support yet.
- Multi-scene rendering (more than one track visible at once).
- A dedicated tool authoring guide for plugin authors. Internal use only at this stage.
