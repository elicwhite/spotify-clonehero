# Plan 0038: Renderer projection contract + tool plugins + /guitar-edit

> **Rewritten 2026-07-20** against the current codebase. The original referenced
> `plans/chart-editor-architecture-review.md`, which no longer exists.
> **Dependencies:** 0037 (headless `EditorSession`, metadata-gated dispatch,
> schema-driven note adapter, scope-aware selection/clipboard — the last being
> the hard prerequisite for the difficulty picker here).
> **Unlocks:** future instruments, stacked views, modular toolbox.

## Current state (what already exists — don't rebuild)

- Renderer lives in `lib/preview/highway/` (`HighwayScene`, `SceneReconciler`,
  `trackToElements`, `chartToElements`, `MarkerRenderer`, `NotesManager`,
  `InteractionManager`, …) with a substantial test suite.
- **Guitar rendering already works** in the render layer: `trackToElements.ts`
  has a guitar/bass branch with `GUITAR_NOTE_TYPE_NAMES`, `NoteRenderer` draws
  guitar sustain tails, `NotesManager` has a guitar branch. What's missing is a
  page and editor affordances, not renderer support.
- `instrument === 'drums'` special-casing remains at `lib/preview/highway/index.ts:406`,
  `NotesManager.ts:125`, `trackToElements.ts:70`, and in editor components
  (`ChartEditor.tsx`, `DrumHighwayPreview.tsx`, `LeftSidebar.tsx`,
  `EditorMCPTools.tsx`, `piano-roll/waveformSources.ts`).
- The wrapper is still named `DrumHighwayPreview`
  (`components/chart-editor/DrumHighwayPreview.tsx`) despite rendering
  non-drum content for add-lyrics/tempo/preview.
- **The piano-roll timeline (plan 0062) is a de-facto second projection** of the
  same store (`components/chart-editor/piano-roll/` — scene, notes, lyrics row,
  tempo lane, hit-testing). There is no shared projection contract between it
  and the highway; each assembles its own scene from context state.
- Interaction: `highway/useHighwayMouseInteraction.ts` dispatches on
  `state.activeTool` via a hardcoded `switch` (cursor / place / erase / bpm /
  timesig / section / section-rename). No tool registry.
- **MCP capability gating is already done** — `EditorMCPTools` gates each tool
  on `EditorCapabilities`. After 0037 it also inherits dispatch-path
  enforcement. The original "close the MCP bypass" goal here is complete;
  nothing to do beyond verifying post-0037.
- Audio: `AudioManager` is owned as a ref on `ChartEditorContext`, consumed via
  `usePaddedAudio` and pages. Plan 0066 (stem cache) did not change this.

## Goal

1. **`EditorProjection` is the renderer contract.** `buildProjectionFor(scope,
doc, schema)` produces lanes + elements + markers + overlays + timing; the
   reconciler consumes a projection instead of ad-hoc
   `chartToElements`/`trackToElements` call sites. The highway and the
   piano-roll both consume projections, making "two views of one store" a real
   contract instead of a convention.
2. **Rename `DrumHighwayPreview` → `HighwayPreview`** and remove the remaining
   `instrument === 'drums'` branches by driving lane count/appearance from
   `InstrumentSchema` (schemas for guitar/bass/keys/rhythm already exist).
3. **`/guitar-edit` page** — mirrors `/drum-edit`'s shell with
   `activeScope = {kind:'track', track:{instrument:'guitar', difficulty:'expert'}}`,
   plus the difficulty picker deferred from earlier phases. Proves the editor
   is genuinely instrument-agnostic end-to-end.
4. **`EditorTool` plugins.** Replace the `activeTool` switch in
   `useHighwayMouseInteraction` with a registered-tool interface; each existing
   switch branch becomes a tool. `EditorCapabilities` lists the tools a page
   offers.
5. **Audio service extraction.** Move `audioManagerRef` out of
   `ChartEditorContext` into a sibling `<AudioServiceProvider>`; cursor sync via
   subscription.

## Design

### 1. EditorProjection

```ts
interface EditorProjection {
  lanes: LaneDefinition[];      // from active InstrumentSchema
  elements: ChartElement[];     // via 0037's subscription-driven derivation
  markers: ChartElement[];      // sections, BPMs, timesigs
  overlays: OverlayElement[];   // selection, hover, drag preview
  timing: TimingProjection;     // tempos + timesigs flattened
}

buildProjectionFor(scope: EditorScope, doc: ChartDocument, schema: InstrumentSchema): EditorProjection
```

Projection kinds: `FiveFretProjection` (guitar/bass/rhythm/keys),
`DrumsProjection` (4/5-lane + flags — generalizes the existing path),
`VocalsProjection` (phrases + lyrics; replaces the phantom-track approach in
add-lyrics), `GlobalMarkersProjection` (sections/tempo/timesig — a layer
stacked on any of the above, matching what the piano-roll tempo lane already
does). GHLive is out of scope until a schema exists for it.

A view = one track projection + `GlobalMarkersProjection`. The piano-roll
migrates to consume the same projection output where practical
(`piano-roll/notes.ts`, `lyricsScene.ts`); its scene code stays its own.

### 2. EditorTool

```ts
interface EditorTool {
  id: string;
  cursor(hit: HitResult | null): string;
  onPointerDown/Move/Up(ctx: ToolContext, event: PointerEventInfo): void;
  onActivate?/onDeactivate?(ctx: ToolContext): void;
  renderOverlay?(ctx: ToolContext): ReactNode;
}
interface ToolContext {
  session: EditorSession;               // from 0037
  rendererRef: RefObject<HighwayRendererHandle | null>;
  schema: InstrumentSchema;
  selection: Selection;
}
```

Tools extracted from the existing switch branches: `SelectMoveTool`,
`BoxSelectTool`, `PlaceNoteTool`, `EraseTool`, `TempoMarkerTool`,
`TimeSignatureMarkerTool`, `SectionTool` (incl. rename), `LyricsTimingTool`
(add-lyrics). Star-power/solo tools wait until those entity kinds get adapters
(0037 follow-on). Pointer events go to the active tool only; capability
presets choose the tool set per page.

## Tasks (suggested order)

1. `EditorProjection` types + `buildProjectionFor`.
2. Migrate the drum path onto `DrumsProjection` — no behavior change.
3. Rename `DrumHighwayPreview` → `HighwayPreview`; remove renderer + component
   `instrument === 'drums'` branches in favor of schema-driven config.
4. `FiveFretProjection` (renderer paths mostly exist; wire flags/labels from
   `guitarSchema`).
5. `/guitar-edit` page + difficulty picker in the header.
6. `VocalsProjection`; migrate add-lyrics off the phantom-track hack.
7. `EditorTool` interface + registry; convert switch branches one tool at a
   time, validating each in browser before the next.
8. Audio service extraction (`<AudioServiceProvider>`).
9. Browser validation pass: drum-edit, drum-transcription, add-lyrics, tempo,
   preview, guitar-edit — same shortcuts work everywhere, capability
   differences visible, no console errors.

## Tests

- `projections.test.ts` — `buildProjectionFor` output per scope kind, checked
  against what `chartToElements`/`trackToElements` produce today (parity
  first, then divergence intentional).
- `tools.test.ts` — each tool's pointer flow against a stub `EditorSession`.
- Existing reconciler/highway tests unchanged — the reconciler input shape is
  the same `ChartElement[]`.

## Open questions

1. Five-fret texture: reuse the existing highway texture or a dedicated guitar
   texture? Check YARG for parity (candidate for its own small plan; see the
   texture-footprint decision memo — grayscale bank exists).
2. Difficulty picker copy: match Moonscraper's idiom.
3. Should the piano-roll fully consume `EditorProjection` in this plan, or
   only share the element-building layer? Lean: share element-building only;
   full piano-roll migration is its own plan if warranted.

## Out of scope

- GHLive (no schema yet), vocal pitch editing UI, practice/co-op tracks.
- Multi-scene stacked rendering (more than one track visible at once).
- MCP gating work — already complete via capabilities + 0037 dispatch gating
  (the `editor_state` hardcoded drums/expert fix also lands in 0037).

## Status (2026-07-20)

Tasks 1-8 implemented via workflow wf_9d5544d1-687, commits 88af39b…e9e5282 + cleanup 1b1739d. typecheck/lint/full Jest suite green. Task 9 (browser validation across drum-edit, drum-transcription, add-lyrics, tempo, preview, guitar-edit) pending — needs a user-started dev server + connected Chrome extension.
