# 0075 — Single-scene multi-highway rendering

> Contrarian-reviewed and revised in place (2026-08-03); the review's ten
> findings and their dispositions are folded in below, and every file:line
> citation was re-audited against the runtime chrome setters that landed
> concurrently.

> **Owner direction (2026-08-03, YARG / Rock Band multiplayer screenshots as
> reference):** side-by-side highways must render as ONE merged scene — a
> single THREE.js renderer, a single canvas, a single RAF loop — with the
> highways laid out side by side inside it, each highway a group in the
> shared scene, and shared chrome drawn once at the scene level: karaoke
> lyrics top-center spanning all highways, tempo / time-signature readouts
> once. Not N canvases sitting flush. One scene.
>
> **Owner decision (2026-08-03): per-viewport cameras.** Each highway renders
> through its own camera into its own viewport/scissor slice, reproducing
> today's per-lane look exactly. The converging shared-vanishing-point camera
> is explicitly **not** chosen; it stays documented as a possible later
> toggle (§2, "Future option").
>
> **Owner decision (2026-08-03) — what the highway draws:** _"The highways
> should have the grid lines, but they don't need the editable tempo markers
> on the left. Same for lyric placement."_ Encoded as §5:
>
> 1. Beat/measure **grid lines stay** on every highway (`GridOverlay`, per
>    highway root) — they are highway rendering, not chrome.
> 2. **No tempo chrome in the highway scene at all.** No BPM or
>    time-signature badges, no rail, no highway-side tempo-marker editing.
>    The piano roll's tempo lane is the sole tempo readout and editor.
> 3. **Lyric / phrase placement markers leave the highway.** Lyric editing
>    lives in the piano roll's lyrics row only.
> 4. The top-center **karaoke `LyricsOverlay` stays** — display-only,
>    stage-level, drawn once. That was an explicit earlier owner requirement
>    and is unaffected by (3).
> 5. **Sections are not mentioned by the owner, so section markers stay on
>    the highway exactly as they are today** — hover, select, drag, rename.
>
> **This plan contains no open gates.** Every decision above is closed.
>
> **Dependencies:** 0040 (unified scene interaction), 0067 (per-track command
> targeting), 0074 Phase 3 (multi-pane highway, Chart Matrix, deterministic
> teardown).
> **Preserves without modification:** the hybrid interaction architecture —
> THREE raycasts, React decides, one-way state push.

## Context

Plan 0074 Phase 3 shipped side-by-side highways the cheapest way that could
work: one `HighwayEditorPane` per visible track, each pane a full
`HighwayPreview` with its own `WebGLRenderer`, its own canvas, its own
`setAnimationLoop`, its own camera, its own `THREE.Scene`. The panes are
CSS'd flush inside one dark surface with a 1px seam
(`HighwayEditor.tsx:214-221`) so the result _reads_ as one strip.

That shape forced three compromises, all documented in the code as
compromises rather than as design:

- **Karaoke lyrics are drawn in the leftmost pane only**
  (`HighwayEditor.tsx:242`). The comment is explicit that this is a fit to
  the renderer, not to the design: the overlay "cannot be centered across
  panes without moving it out of THREE and into a DOM layer over the whole
  highway area. Leftmost-pane placement is the honest fit for the current
  renderer." (`HighwayEditor.tsx:75-83`)
- **BPM / time-signature badges are hidden entirely whenever there is more
  than one pane** (`HighwayEditor.tsx:243`). They are world-space sprites
  anchored just outside the highway rails, so a narrow pane's frustum cuts
  them in half. The chart-wide readout is simply absent in every
  multi-highway layout today.
- **A hard pane cap** (`MAX_HIGHWAY_PANES`, `HighwayEditor.tsx:47`) with a
  "+N more" overflow chip. It has already drifted from 3 to 4 (commit
  `08bc303`) after the 2026-08-03 GPU spike.

The per-canvas model also carries a real ceiling: browsers cap live WebGL
contexts (commonly 8-16 per page), and the editor is not the only thing on
a page that wants one. Plan 0074's risk register lists "Multi-pane GPU cost
unmeasured", and its Phase 3 notes record that the one-canvas/scissor
approach was _withdrawn_ during review as "a bigger project than the
feature". This plan is that project, run deliberately.

The good news, verified below: the scene core was already factored for this.
`lib/preview/highway/cell.ts` exists specifically as "the reusable,
editor-agnostic core of a single highway scene… Shared verbatim with the
multi-cell grid via cell.ts" (`cell.ts:29-38`, `index.ts:547`). The lyrics
overlay is already a self-contained scene + ortho camera sized to the whole
canvas. The interaction stack already targets commands per-track above the
renderer. What is missing is a _stage_: one owner of the renderer, the
scene, the RAF loop, and the layout.

## Current state (re-verified 2026-08-03 after the concurrent runtime-setter landing, branch `plan-0074-phase-1`)

> Citations below supersede the first draft's. The concurrent workflow landed
> **runtime chrome setters** mid-review, which moved most of `index.ts` and
> changed one of the first draft's claims from true to false (flagged inline).

### Renderer

- `setupRenderer(metadata, chart, sizingRef, ref, audioManager, config)`
  (`index.ts:104`) creates **one** `PerspectiveCamera(90, 1/1, 0.01, 10)` at
  `z=0.8, y=-1.3, rotation.x=60°` (`index.ts:125-128`), **one**
  `WebGLRenderer` (`:131`), appends its `domElement` into `ref` (`:181`), and
  drives **one** `setAnimationLoop(animation)` (`:632`), whose body renders
  `scene, camera` (`:679`) then the lyrics pass (`:685-687`).
- `prepTrack(track)` creates a **fresh `THREE.Scene` per renderer**
  (`index.ts:229`) with black distance fog (`:238`), delegates to
  `buildHighwayCell(scene, …)` (`:549`), then builds `SceneOverlays` (`:576`)
  and `InteractionManager` (`:588-589`) against the same scene and camera.
- Everything is added directly to the scene at absolute world coordinates
  centered on `x = 0`: the floor plane (`HighwayScene.ts:74-82`), the
  hitbox/strikeline (`:97-109`, `:212-249`), overlay groups
  (`SceneOverlays.ts:176-177` plus **six lazy per-frame add sites** at
  `:300, :321, :453, :515, :544`), waveform + grid surfaces
  (`HighwayScene.ts:25-46`), and every reconciled element group
  (`SceneReconciler.ts:254`). **No group indirection anywhere.**
- Clipping planes are world-space and **Y-only**: `Plane((0,1,0), 1)` and
  `Plane((0,-1,0), 0.9)` (`index.ts:194-196`, `cell.ts:75-82`). An X
  translation of a highway subtree does not disturb them — load-bearing for
  this plan, and verified clean by review.
- Marker flags anchor at world `x = ±(0.45 + 0.02)` off a hardcoded
  `HIGHWAY_HALF_WIDTH = 0.45` (`MarkerRenderer.ts:8, :217, :221`) and extend
  _outward_; the rule line spans `0.9` (`:229`). Schema highway widths are
  0.9 (drums, `instruments/drums.ts:178, :203`) and 1.1 (guitar/bass,
  `instruments/guitar.ts:105`).
- Resize is per renderer: a `window` resize listener (`index.ts:168`) **plus**
  a `ResizeObserver` on `sizingRef` (`:171-173`), both calling `setSize()`
  (`:155-161`) which sets `camera.aspect`, `renderer.setSize`, and
  `lyricsOverlay.resize`.
- **Chrome flags are now runtime setters, not construction-time config**
  (this is the concurrent change). `RendererConfig.showLyrics` (`index.ts:91`)
  and `showTempoBadges` (`:101`) are still accepted as initial values, but
  `setLyricsVisible(visible)` (`:485-487`) flips a `let` read per frame at
  `:685`, and `setTempoBadgesVisible(visible)` (`:494-500`) routes through
  `hiddenKindsFor(visible)` (`:121`) into a **new**
  `SceneReconciler.setHiddenKinds` (`SceneReconciler.ts:197-206`) that
  re-applies the filter to the retained `declaredElements` (`:114, :138`).
  `LyricsOverlay` is now always constructed and always fed, regardless of
  visibility (`index.ts:455-477`).
  **Correction to the first draft:** the claim that `HighwayPreview`
  recreates its renderer when `showLyrics`/`showTempoBadges` change is now
  **false** — those deps were removed (`HighwayPreview.tsx:212-218`) and the
  flags are pushed through a separate effect (`:222-225`) against refs
  (`:155-158`).
- **Teardown is already deterministic and refcounted** (plan 0074 Phase 3).
  `destroy()` is idempotent via `disposedSync` (`index.ts:153, :270-271`),
  releases the GPU synchronously through `forceContextLoss()` (`:278`) before
  returning, and only the last live renderer clears the module-scoped marker
  texture cache, gated on `liveRendererCount` (`index.ts:70, :137, :272,
:309-310`; `MarkerRenderer.ts:24, :290`). `teardown.test.ts:93, :115` pins
  both.

### Lyrics overlay — already scene-level shaped

`LyricsOverlay` owns its **own** `THREE.Scene` and an
`OrthographicCamera(0, width, height, 0, -1, 1)` (`LyricsOverlay.ts:348,
:383-384`), draws into a 2D canvas of full canvas width × a fixed 120 CSS px
height (`:36, :389-390`), wraps it in a `CanvasTexture` (`:393`) on a
`PlaneGeometry(width, ch)` positioned at the **top center of the canvas**
(`:402-405`), and exposes `resize(width, height)` (`:455`). `setupRenderer`
renders it as a second pass with `autoClear = false` (`index.ts:684-689`).

It is already a full-canvas, top-center, canvas-to-texture overlay. It is
"per pane" today only because the canvas is per pane. Moving it to the stage
requires **no change to `LyricsOverlay` at all**.

### Interaction — world-space assumptions that X translation breaks

This is the review's blocker finding and the first draft's one outright
false claim. `InteractionManager` is **not** translation-invariant:

- `highwayPlane = new THREE.Plane((0,0,1), 0)` is world-space
  (`InteractionManager.ts:52`).
- `hitTestHighway` intersects that plane and then tests
  `Math.abs(hit.x) > this.highwayHalfWidth` (`:389-397`) and
  `worldXToLane(hit.x)` (`:399`, `:587-598`), both against schema
  `worldXOffset`s centered on `x = 0`.
- `screenToWorldPoint` (`:569-584`) returns the same world point, feeding
  `screenToLane` (`:481-483`) and `screenToMs` (`:495`).

With a root at `x = S` and its camera translated to `S`, the intersection
returns world `x ≈ S ± 0.45`: **every highway-plane hit fails the bounds
check and every lane resolves wrong**, so clicking empty highway — the
note-placement path — is dead in highways 2..N. Sprite raycasts are
world-consistent and survive. `hitTestMarkerLines` (`:341-349`) survives only
incidentally: it projects world `(0, y, 0)` and reads only `projected.y`,
which an X-only camera translation leaves alone because the camera has no
yaw.

### Editor

- `HighwayEditor.tsx` resolves the pane list from `state.visibleTrackKeys`
  (`:163-169`), falls back to `[activeScope]` without the Chart Matrix
  (`:181-188`), slices at `MAX_HIGHWAY_PANES = 4` (`:47, :190-191`), renders
  a CSS grid of `1fr` columns with a `1px` gap (`:218, :221`), and hands each
  pane `showLyrics={index === 0}` / `showTempoBadges={panes.length === 1}`
  (`:242-243`).
- `HighwayEditorPane.tsx` owns everything per pane: `HighwayPreview` (`:403`),
  the transparent interaction div (`:415-423`), the label chip (`:397-401`),
  the marquee rect (`:425-443`), `HighwayPopovers` (`:445`), and one instance
  each of `useMarkerDrag`, `useHighwayMouseInteraction`, `useHighwaySync`,
  `useChartElements`.
- **Per-track command targeting is a state override, not a renderer
  concern**: `paneState = {...state, activeScope: paneScope}` (`:143-146`).
  Tools resolve `trackKey` from `ctx.state.activeScope` alone, so this
  retargets the whole tool/command stack per pane with zero changes to
  `tools/*` (`:11-18`). Note hover/selection ids are unconditionally
  track-qualified (`useHighwayMouseInteraction.ts:439-445`, `scope.ts:42`).
- `useHighwayMouseInteraction` reads canvas size from **its own interaction
  div** — `offsetWidth/offsetHeight` (`:236-240`) — and passes it to
  `im.hitTest(x, y, w, h, gridDivision)` (`:272-280`).
- `useHighwaySync` pushes lyrics per pane using that pane's `partName`
  (`:146-157`).

### Other consumers of `setupRenderer` (must keep working, unchanged)

- `app/sheet-music/[slug]/CloneHeroRenderer.tsx:26` — one renderer, one
  track, read-only preview.
- `app/chart-review/ChartReviewClient.tsx:1098` — **two concurrent
  renderers** ("current on top, next pre-rendered behind", `:1047`). This is
  why the `liveRendererCount` marker-texture refcount cannot be deleted.

### Existing test surface

- `components/chart-editor/__tests__/multi-pane-highway.test.tsx` — mocks
  `setupRenderer` wholesale (`:126-135`), stubs a per-track `hitTest`
  (`:73-105`), drives the **real** interaction/tool/command stack.
- `components/chart-editor/__tests__/highway-shared-chrome.test.tsx` —
  **new/untracked, from the concurrent workflow.** Asserts the
  `RendererConfig` 6th argument of every `setupRenderer` call (`:82-88`) plus
  two CSS-seam assertions (`:224, :235`).
- `lib/preview/highway/__tests__/teardown.test.ts` — fakes only
  `WebGLRenderer` (`:42-59`).
- `SceneReconciler.test.ts`, `cell.test.ts`, `InteractionManager.test.ts`,
  `LyricsOverlay.test.ts`, `useChartElements.test.ts` — unit suites.

### Verified clean by review (no work needed)

No `instanceof THREE.Scene`, `.background`, `.environment`, or
`overrideMaterial` anywhere in `lib/preview/highway` or
`components/chart-editor`. `SceneReconciler` and `SceneOverlays` only call
`.add()` / `.remove()`. Fog is set once on the Scene (`index.ts:238`) and
stays a stage concern. Clip planes are Y-only and translation-proof.

## Goal

One `WebGLRenderer`, one canvas, one `THREE.Scene`, one RAF loop for the
whole highway strip. N highways as sibling groups in that scene. Karaoke
lyrics drawn once, spanning the strip. Each highway draws its notes, its
grid lines, and its section markers — and nothing else (§5). Adding or
removing a highway mounts or unmounts a group; it never rebuilds the scene
or the context. Every interaction contract from plans 0040 / 0067 / 0074
survives for the entity kinds that remain on the highway, with the one
X-translation correction §6 makes explicit.

## Design

### 1. Scene graph shape

```
THREE.Scene                       (one, owned by the stage; fog as today)
├── HighwayRoot "drums:expert"    worldX = 0     layer 1
│   ├── floor mesh, hitbox/strikeline        (buildHighwayCell)
│   ├── NoteRenderer groups + section MarkerRenderer groups
│   │       via SceneReconciler  (note + section are the ONLY kinds — §5)
│   ├── SceneOverlays groups (cursor, ghost, loop, crosshair, eraser)
│   └── WaveformSurface / GridOverlay meshes    (grid lines stay — §5)
├── HighwayRoot "guitar:expert"   worldX = S     layer 2
├── HighwayRoot "guitar:hard"     worldX = 2S    layer 3
└── …
LyricsOverlay                     (own Scene + OrthographicCamera,
                                   full canvas width, top-center — unchanged)
```

There is no chrome root and no rail: the only stage-level chrome is the
karaoke overlay, which is not part of the main scene at all (§5).

`HighwayRoot` (new, `lib/preview/highway/HighwayRoot.ts`) is a `THREE.Group`
subclass carrying:

- `worldX` — its slot along X. Also handed to that root's
  `InteractionManager` (§6).
- `layerIndex` — the THREE layer its subtree is stamped onto.
- `syncLayers()` — `traverse(o => o.layers.set(layerIndex))`.

**Layer semantics (review finding 2).** Cameras use
`camera_i.layers.enable(layerIndex_i)`, **not** `layers.set(...)`, so layer 0
stays enabled on every camera. Consequences, and they are the whole point:

- A **stamped** object (`layers.set(i)`, layer 0 cleared) renders only in
  camera `i`'s pass. This is the pruning that keeps total draw calls flat.
- An **unstamped** object stays on layer 0 and is drawn by _every_ camera —
  never skipped, so it is always visible in its own viewport. Because roots
  are X-separated and each camera sits at its own root's X, an unstamped
  object of root `j` lands outside camera `i`'s frustum and is culled. The
  cost is a wasted culled draw; there is no visual bug in either direction.
  (`layers.set(i)` on the camera would have inverted this: unstamped objects
  would be invisible _everywhere_, including their own viewport — a real
  bug, and the first draft got this backwards.)
- `syncLayers()` is therefore an optimization with a _safe_ miss, so its
  trigger does not have to be exhaustive: the stage calls it when a root's
  `reconciler.getActiveGroupsRevision()` (`SceneReconciler.ts:82, :341`)
  advances, and once more after `SceneOverlays.update()` returns having added
  anything. The six lazy `scene.add` sites in `SceneOverlays`
  (`:300, :321, :453, :515, :544`, plus the constructor's `:176-177`) are
  exactly why the miss must be safe rather than merely rare.

**Spacing.** `HIGHWAY_ROOT_SPACING = 8` world units. **Spacing is not
visually load-bearing** — the viewport rects are what the user sees (§2). It
exists for two reasons only: the scene stays inspectable in devtools, and it
is what makes an unstamped object fall outside every foreign frustum. The
first draft justified the number by fog distance; that was wrong and is
withdrawn — `material.fog = false` on the fret hitbox sprites
(`HighwayScene.ts:194`) means fog never hides anything reliably. Scissor and
frustum culling are the entire story.

**1 vs 2 vs 3 vs N.** No special cases in the scene graph. A single highway
is one `HighwayRoot` at `worldX = 0` — the identical code path, which is what
makes an N=1 rollout meaningful as a first exercise of the stage.

**The cap** (see §2 for the formula) is kept, raised to 6, and made
width-derived rather than constant.

### 2. Camera model — per-viewport cameras (owner-decided 2026-08-03)

**Decision: N `PerspectiveCamera`s, one per root, each rendered into its own
`setViewport` / `setScissor` rect of the shared canvas.** Each camera is the
camera `setupRenderer` builds today (`index.ts:125-128`), translated to its
root's `worldX`, with `aspect = rect.width / rect.height`.

Because the camera parameters, the X translation, and (for equal rects) the
aspect are all identical to today's per-canvas cameras, **each lane is
pixel-identical to what ships now** — verified by review. That is the point:
the merge is structural (one context, one scene, shared chrome), not a
visual redesign.

**Frame loop** (note the explicit full-canvas clear — review finding 4:
with `setScissorTest(true)` and `autoClear`, only the scissor rects are
cleared, leaving the inter-highway gaps and any dead edge strip filled with
stale, driver-dependent pixels):

```
renderer.setScissorTest(false)
renderer.setViewport(0, 0, W, H); renderer.setScissor(0, 0, W, H)
renderer.clear()                                  // full canvas, once
renderer.autoClear = false
renderer.setScissorTest(true)
for each root i:
    highwayTexture_i.offset.y = scrollOffset      // re-set per pass
    renderer.setViewport(glRect_i); renderer.setScissor(glRect_i)
    renderer.render(scene, camera_i)
renderer.setScissorTest(false)
renderer.setViewport(0, 0, W, H)
renderer.render(lyrics.scene, lyrics.camera)      // full-canvas chrome pass
renderer.autoClear = true
```

Per-root per-frame work (`reconciler.updateWindow`, waveform/grid update,
`sceneOverlays.update`) is today's `animation()` body (`index.ts:633-690`),
run once per root before its pass.

**Why not one shared camera spanning the strip.** One reason, and it is
sufficient: **it breaks every screen↔world conversion in the interaction
stack.** `hitTest(x, y, canvasW, canvasH)` maps pane-local pixels straight to
NDC (`InteractionManager.ts:149`), `screenToWorldPoint` likewise
(`:576-577`), and `hitTestMarkerLines` projects world→screen with
`tempWorld.project(this.camera)` (`:347-349`). All of it assumes NDC spans
_this highway's_ frustum. A shared camera forces every call site to
translate pane-local pixels into whole-canvas NDC, and
`useHighwayMouseInteraction` gets its size from its own div (`:236-240`), so
the change reaches into hooks the hybrid interaction contract wants left
dumb.

Two arguments from the first draft are **withdrawn** as unsound (review
finding 7): (a) "fret sprites would no longer face the viewer squarely" is
false — `THREE.Sprite`s are screen-aligned billboards
(`HighwayScene.ts:195`) and never skew under any camera; (b) "off-center
highways would keystone" describes exactly the converging band view that the
future option below contemplates, so it cannot simultaneously be the reason
to reject it. The honest framing is: a shared camera is a _different look_,
the owner chose the current look, and the interaction math is the concrete
cost.

**Future option — converging shared-vanishing-point band view (not
scheduled).** The scene graph this plan builds already supports it: one
camera, roots at their real X, no scissor. What such a switch would also
entail, so nobody discovers it late:

- `InteractionManager` needs a pane-local→canvas-global NDC translation on
  top of the root-local X correction §6 introduces.
- **Fog falloff becomes asymmetric.** `scene.fog` (`index.ts:238`) is
  Euclidean distance from the single camera, so outer highways would fade
  differently from the center one.
- `hitTestMarkerLines`' `projected.y`-only trick (`:347-349`) survives an X
  translation _only because the camera has no yaw_. Under a shared camera
  viewing an off-center root, `projected.y` is no longer independent of X.
  Testing §2 pins this invariant now, so the day it breaks is loud.
- Each lane's look changes — which is the point of choosing it.

**Layout math is pure and lives in `lib/preview/highway/layout.ts`:**

```ts
export interface HighwayRect {
  // top-left origin, CSS px (DOM space)
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface StageLayout {
  canvas: {width: number; height: number};
  highways: HighwayRect[]; // one per mounted highway, left→right
  maxHighways: number;
  measured: boolean; // false when canvasWidth is 0/non-finite
}
export function computeStageLayout(input: {
  canvasWidth: number;
  canvasHeight: number;
  highwayCount: number;
}): StageLayout;

/** GL viewports are bottom-left origin. One conversion, one place. */
export function toGlRect(r: HighwayRect, canvasHeight: number): HighwayRect;
```

**The width-derived cap (review finding 6).** With the chrome rail gone
(§5), the whole canvas width is available to highways. Solving
`n·MIN_HIGHWAY_PX + (n−1)·HIGHWAY_GAP_PX ≤ canvasWidth` for `n` — note the
denominator is explicitly **gap-inclusive**, which the first draft left
ambiguous:

```ts
const fits = Math.floor((canvasWidth + HIGHWAY_GAP_PX) /
                        (MIN_HIGHWAY_PX + HIGHWAY_GAP_PX));
maxHighways = Math.min(MAX_HIGHWAYS, Math.max(1, fits));

MIN_HIGHWAY_PX = 200   HIGHWAY_GAP_PX = 1   MAX_HIGHWAYS = 6
```

**Unmeasured-width rule (this is what keeps the jsdom routing suites
alive).** jsdom has no layout, so `offsetWidth` is 0 and the formula would
yield `maxHighways = 1`, collapsing every multi-pane routing test to a single
pane. Therefore: when `canvasWidth` is `0` or non-finite,
`computeStageLayout` returns `measured: false`, `maxHighways = MAX_HIGHWAYS`,
and zero-width rects. React uses `maxHighways` for the pane slice, so
routing/labelling/overflow tests behave exactly as they do today under the
constant cap; only the _rect_ assertions are gated on `measured`. This rule
is spelled out here because it is the difference between "the tests carry
over" and "the tests silently degrade".

Suite invariants: rects never overlap; `Σ widths + gaps === canvasWidth`
when measured; gap is exactly `HIGHWAY_GAP_PX`; `toGlRect` y-flips and
round-trips; `maxHighways` is monotone in width, clamped to
`[1, MAX_HIGHWAYS]`, and equals `MAX_HIGHWAYS` when unmeasured.

**One layout, two consumers.** React renders the interaction overlays from
`layout.highways` and pushes **the same object** to `stage.setLayout(layout)`.

**Why the cap survives one context.** The context-exhaustion reason is gone;
three others are not. (a) Below ~200 CSS px a highway's lanes are illegible
and its click targets unusable. (b) Per-frame CPU is still linear in N — N ×
`updateWindow` + N × `SceneOverlays.update` + N × `render`, in one RAF
budget. (c) The Chart Matrix needs a bound to render "+N more" against.
Width-derivation means the number is computed and unit-tested rather than a
constant that drifts (it already drifted 3 → 4).

### 3. Reconciler multiplexing — N instances scoped to roots

**Decision: N `SceneReconciler` instances, one per `HighwayRoot`.** The only
change to the class is widening its first constructor parameter from
`THREE.Scene` to `THREE.Object3D` — it only calls `.add()` / `.remove()`
(`SceneReconciler.ts:63, :149, :254, :274, :397`). Review confirmed nothing
downcasts to `Scene` or touches `background` / `environment` /
`overrideMaterial`. Every existing test passes a `THREE.Scene`, which _is_ an
`Object3D`; those suites are untouched.

The same one-line widening applies to `SceneOverlays` (`:152, :176-177`),
`createWaveformSurface` / `createGridOverlay` (`HighwayScene.ts:26, :39`),
and `buildHighwayCell(scene, …)` → `buildHighwayCell(root, …)`
(`cell.ts:195`).

Rejected: **one reconciler with track-keyed roots.** Grounds, strongest
first:

- Namespacing every key breaks `key.startsWith('note:')`
  (`InteractionManager.ts:191`), `MARKER_PRIORITY` prefix matching (`:213`),
  `parseMarkerKey` (`markerKeys.ts`), and `reconcilerKeyFor`.
- `selectedKeys` / `hoveredKey` (`SceneReconciler.ts:97-99`) are
  single-valued and correct per highway; they would need partitioning.
- `hiddenKinds` (`:107`) and its new runtime setter (`:197`) are per highway
  by design.
- `getActiveGroupsRevision()` (`:341`) is the InteractionManager's
  cache-invalidation signal (`:181-207`); a single global revision means one
  highway's churn invalidates its neighbours' sprite caches.

_Rhetoric correction (review finding 8):_ the first draft claimed that last
point costs a rebuild "every frame, for every highway, forever". It does
not — `rebuildSpriteCachesIfNeeded` runs on `hitTest()` entry
(`InteractionManager.ts:152`), i.e. **once per pointer event**, not per RAF.
The rejection stands on the three stronger grounds above.

**Files / exports that change:**

| File                                                  | Change                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/preview/highway/SceneReconciler.ts`              | ctor param + field `scene: THREE.Scene` → `root: THREE.Object3D`; **`setHiddenKinds` (`:197-206`) and the `declaredElements` retention (`:114, :138, :205`) deleted** — their only caller was per-pane chrome suppression, which §5 makes permanent                               |
| `lib/preview/highway/SceneOverlays.ts`                | same widening                                                                                                                                                                                                                                                                     |
| `lib/preview/highway/HighwayScene.ts`                 | `createWaveformSurface` / `createGridOverlay` first param widened (grid lines themselves unchanged — §5)                                                                                                                                                                          |
| `lib/preview/highway/cell.ts`                         | `buildHighwayCell(root: THREE.Object3D, …)`; `CellMarkerRenderers` drops `lyric`/`phraseStart`/`phraseEnd`/`bpm`/`ts`, keeping only `section`; the reconciler's renderer map becomes `{note, section}`; `hiddenElementKinds` param deleted (the permanent set is a constant here) |
| **`lib/preview/highway/InteractionManager.ts`**       | **new `rootWorldX` ctor arg + root-local X correction (§6)**; `MARKER_PRIORITY` (`:291-296`) narrows to `['section:']`; `elementToMarkerHit` (`:364-383`) narrows to the `section` case                                                                                           |
| `lib/preview/highway/MarkerRenderer.ts`               | **class unchanged** — five of its six instances simply stop being constructed. No `anchorX` work; the rail that needed it is dead                                                                                                                                                 |
| `lib/preview/highway/HighwayRoot.ts`                  | **new** — root group, `worldX`, `layerIndex`, `syncLayers()`                                                                                                                                                                                                                      |
| `lib/preview/highway/layout.ts`                       | **new** — pure layout math (§2)                                                                                                                                                                                                                                                   |
| `lib/preview/highway/stage.ts`                        | **new** — `setupStage`, `HighwayStage`, `StageHighwayHandle`                                                                                                                                                                                                                      |
| `lib/preview/highway/rendererRegistry.ts`             | **new** — the `liveRendererCount` refcount, shared by `setupRenderer` and `setupStage`                                                                                                                                                                                            |
| `lib/preview/highway/index.ts`                        | `setupRenderer` builds into a `HighwayRoot`; `RendererConfig.showLyrics`/`showTempoBadges`, `hiddenKindsFor`, `setLyricsVisible`, `setTempoBadgesVisible` deleted; refcount moved out; stage re-exported                                                                          |
| `components/chart-editor/highway/useMarkerDrag.ts`    | `MarkerKind` (`:25`) narrows to `'section'`; the lyric/phrase clamp branches and their `lyricId`/`phraseStartId`/`phraseEndId` imports go. The piano roll's lyrics row keeps its own drag path (`MoveEntitiesCommand`, unchanged)                                                 |
| `components/chart-editor/highway/HighwayPopovers.tsx` | the `'bpm'` (`:32, :294`) and `'timesig'` (`:33, :306`) popover variants die; `'section'` (`:34, :316`) and `'section-rename'` (`:36, :326`) stay                                                                                                                                 |
| `components/chart-editor/tools/registry.ts`           | `TOOL_REGISTRY.bpm` / `.timesig` (`:39-40`) lose their only surface and are deleted along with `tempoMarkerTool` / `timeSignatureMarkerTool`; `'bpm'`/`'timesig'` drop out of `ToolMode` (`lib/chart-editor-core/state.ts:20-21`). Already dead in the shipping UI — see §5       |

### 4. The stage API

```ts
export function setupStage(
  metadata: ChartResponseEncore,
  chart: ParsedChart,
  sizingRef: RefObject<HTMLDivElement>,
  canvasHostRef: RefObject<HTMLDivElement>,
  audioManager: AudioManager,
  config?: StageConfig, // { tomStyle? }
): HighwayStage;

export interface HighwayStage {
  /** Mount a highway group. Never rebuilds the scene or the context. */
  addHighway(
    id: string,
    opts: {
      track: Track | null; // null for vocals/global scopes
      showDrumLanes: boolean;
    },
  ): Promise<StageHighwayHandle>;
  /** Unmount + dispose one highway group. Renderer and siblings untouched. */
  removeHighway(id: string): void;
  getHighway(id: string): StageHighwayHandle | null;
  /** One-way layout push. React measures, the stage obeys. */
  setLayout(layout: StageLayout): void;
  /** Chart-wide, drawn once. Feeds the karaoke overlay only (§5). */
  setLyricsData(lyrics, vocalPhrases): void;
  setTimingData(timedTempos, resolution): void;
  startRender(): void;
  /** Idempotent; releases the GPU synchronously before returning. */
  destroy(): void;
}

/** Per highway. Today's `HighwayRendererHandle` minus the canvas-global
 *  members (`setLyricsData` and the two chrome-visibility setters move to
 *  the stage / disappear). */
export interface StageHighwayHandle {
  getCamera(): THREE.PerspectiveCamera;
  getWorldX(): number;
  getHighwaySpeed(): number;
  setOverlayState(state: OverlayState): void;
  getInteractionManager(): Promise<InteractionManager | null>;
  getReconciler(): Promise<SceneReconciler>;
  getNoteRenderer(): Promise<NoteRenderer>;
  setWaveformData(config): Promise<void>;
  setGridData(config): Promise<void>;
  setHighwayMode(mode: HighwayMode): void;
  getHighwayMode(): HighwayMode;
}
```

### 5. What the highway draws (owner decision, 2026-08-03)

The owner's instruction — _"The highways should have the grid lines, but
they don't need the editable tempo markers on the left. Same for lyric
placement."_ — resolves both the first draft's tempo-rail question and a
scope question it never asked. The net effect is that **the highway becomes
a notes-plus-grid-plus-sections surface**, and every other entity kind moves
to the piano roll, where it is already better served.

**Grid lines stay (owner decision 1).** `GridOverlay` is beat/measure
geometry built into each highway root by `setGridData`
(`HighwayScene.ts:38-46`, `useHighwaySync.ts:102-120`) and is untouched by
this plan beyond the `THREE.Object3D` widening. It is highway _rendering_ —
the thing that makes the surface readable — not chrome, so it is per root
and stays per root at every highway count. This is also the one part of the
old "tempo chrome" story the owner explicitly wants kept, so it is stated
separately from everything below.

**No tempo chrome in the highway scene at all (owner decision 2).** No BPM
or time-signature badges, no rail, no highway-side tempo editing. The piano
roll's tempo lane is the sole tempo readout _and_ editor. This closes the
first draft's Option A/B question in favour of something narrower than
either: the rail is dead, and so is the badge geometry it was going to fix.

The arithmetic that killed the rail is worth keeping on the record: badges
anchor at world `|x| ≥ 0.47` and extend outward (`MarkerRenderer.ts:214-222`);
today's camera in an 84 px-wide viewport has `aspect ≈ 0.1-0.15`, a
horizontal half-extent at strikeline depth (~0.85) of ~0.09-0.13 world
units, so both badges sit entirely outside it. The rail would have
reproduced, inside the fix, exactly the clipping bug `showTempoBadges` exists
to paper over. Fixing that needed a `MarkerRenderer.anchorX` change and
160-200 px stolen from the highway strip at every layout. None of that is
now built.

The code already pointed here: the badges are read-only on every capability
preset, and the current comment calls the piano roll's tempo lane "the
full-width place to read and edit them" (`HighwayEditor.tsx:80-87`).

**Lyric / phrase placement markers leave the highway (owner decision 3).**
Lyric editing lives in the piano roll's lyrics row only — syllable chips,
phrase bands, edge-drag phrase resize, and the inline "Edit lyric…" editor
(`PianoRollTimeline.tsx:8-11, :380, :900`; `piano-roll/lyricsScene.ts`;
`piano-roll/hitTest.ts:192-284`).

**Karaoke `LyricsOverlay` stays (owner decision 4).** It is display-only and
has nothing to do with placement. The stage owns exactly one, constructed at
full canvas width/height, `resize`d from the single `ResizeObserver`, and
rendered in the full-canvas pass of §2. Because its plane is already anchored
top-center of its own ortho frustum (`LyricsOverlay.ts:402-405`), "top center
spanning all highways" is correct by construction — the single largest
structural win in this plan, at zero lines inside `LyricsOverlay`.
`RendererConfig.showLyrics`, `setLyricsVisible`, and
`HighwayEditor.tsx:242`'s `showLyrics={index === 0}` are deleted with it.

_Which vocal part drives it (review finding 10)._ Today each pane pushes its
own `partName` (`useHighwaySync.ts:146-157`): a vocals scope pushes its
active part, a track pane pushes `DEFAULT_VOCALS_PART`
(`HighwayEditorPane.tsx:148-149`). One stage-level push needs one rule:

> The stage's lyrics part is `state.activeScope.part` when `activeScope` is a
> vocals scope (`/add-lyrics`), and `DEFAULT_VOCALS_PART` otherwise.

Timing is safely chart-global: one `audioManager`, one chart, one tempo map
(verified by review).

**Sections stay exactly as they are (owner decision 5).** The owner did not
mention sections, so section markers keep hover, select, drag, and rename on
the highway: `MarkerRenderer` instance, reconciler `section` renderer,
`InteractionManager` section hit path, `useMarkerDrag` section branch, and
both section popovers all survive. This is deliberately the _only_ marker
kind left on the highway.

#### What this removes, concretely

The permanent hidden set replaces every per-pane suppression mechanism
(owner decision 4 of the coordinator's reading — hidden-kinds becomes the
permanent state, not a hack):

```ts
// lib/preview/highway/cell.ts — the highway draws these kinds and no others.
const HIGHWAY_ELEMENT_KINDS = new Set(['note', 'section']);
```

- The reconciler's renderer map (`cell.ts:268-281`) becomes `{note, section}`.
  `SceneReconciler.updateWindow` already no-ops kinds with no registered
  renderer (`:219-220`), but the reconciler is _also_ constructed with the
  complementary hidden set so those elements are never stored, sorted, or
  windowed at all — one enforcement point, unit-testable, no per-frame cost.
- `CellMarkerRenderers` (`cell.ts:152-160`) drops `lyric`, `phraseStart`,
  `phraseEnd`, `bpm`, `ts`. Five of six `MarkerRenderer` constructions
  (`cell.ts:251-266`) go; **the `MarkerRenderer` class itself is unchanged**.
- `SceneReconciler.setHiddenKinds` (`:197-206`) and the `declaredElements`
  retention it required (`:114, :138, :205`) are **deleted**: the concurrent
  workflow added them purely so a pane's share of chart-wide chrome could
  change at runtime, and there is no longer any chart-wide chrome in the
  scene. The constructor's `hiddenKinds` param stays, now fed a constant.
- `InteractionManager.MARKER_PRIORITY` (`:291-296`) narrows from four
  prefixes to `['section:']`; `elementToMarkerHit` (`:364-383`) narrows to
  the `section` case. `hitTestMarkerFlags` / `hitTestMarkerLines` keep their
  shape — one kind instead of four.
- `useMarkerDrag`'s `MarkerKind` (`:25`) narrows to `'section'`.
- `HighwayPopovers`' `'bpm'` / `'timesig'` variants die (`:32-33, :294, :306`);
  `'section'` / `'section-rename'` stay (`:34, :36, :316, :326`).
- `tempoMarkerTool` / `timeSignatureMarkerTool` and their `TOOL_REGISTRY`
  entries (`tools/registry.ts:39-40`) die, and `'bpm'`/`'timesig'` leave
  `ToolMode` (`lib/chart-editor-core/state.ts:20-21`).
- `RendererConfig.showLyrics` / `showTempoBadges`, `setLyricsVisible`,
  `setTempoBadgesVisible`, `hiddenKindsFor`, and
  `HighwayEditor.tsx:242-243`'s two props are deleted.

`buildMarkerElements` / `chartToElements` / `buildProjectionFor` are **not**
changed — the piano roll consumes the same projection and still needs every
marker kind. The highway's reconciler is where the narrowing happens.

#### Capability-surface audit (verified, per the coordinator's request)

- **`TEMPO_CAPABILITIES` — confirmed safe.** `hoverable`, `selectable`, and
  `draggable` are all **empty sets** (`capabilities.ts:255-257`), and the
  preset's own doc comment says tempo/time-signature/section markers are
  "editable via the piano roll's tempo lane and ruler (not gated by the
  `hoverable`/`selectable`/`draggable` `EntityKind` sets)"
  (`capabilities.ts:241-252`). `/tempo` therefore never used highway marker
  interaction at all; nothing to route.
- **`ADD_LYRICS_CAPABILITIES` — routed, with one caveat.** It sets
  `showPianoRollNotes: true` (`capabilities.ts:219`), so the piano roll's
  lyrics row renders on `/add-lyrics` and carries the full lyric/phrase
  interaction set the highway is losing: chip drag, phrase-band edge resize
  (`MoveEntitiesCommand`, cited in `capabilities.ts:174-178`), and inline
  lyric text edit — a superset of the highway's drag-only affordance.
  _Caveat:_ the lyrics row is hidden when the vocals part has no phrases
  (`lyricsVisible` / `lyricsRowHeight`, `PianoRollTimeline.tsx:439, :469`).
  That is not a regression — the highway also showed nothing in that state,
  and lyrics are _created_ by the aligner (`ReplaceLyricsCommand`), never by
  a highway gesture: there is no lyric-placement tool in `TOOL_REGISTRY`
  (`registry.ts:35-42`). "Lyric placement" in the owner's phrasing means
  moving existing lyric/phrase flags, which is exactly what moves to the
  piano roll.
- **BPM / time-signature tools were already unreachable.** `EditToolbar.tsx`
  is the only UI that sets `activeTool` to `'bpm'` / `'timesig'`
  (`EditToolbar.tsx:42-43`) and it is **not imported anywhere** —
  `UtilityCluster` replaced it and ships cursor / add-note / section only
  (`capabilities.ts:61-67`: "plan 0074 Phase 7 moved this row into
  `UtilityCluster` and dropped bpm/timesig/erase"). Removing the two tools
  costs the shipping UI nothing.
- **`DRUM_EDIT_CAPABILITIES` keeps `lyric`/`phrase-*` in its
  hoverable/selectable/draggable sets** (`capabilities.ts:168-186`) — those
  sets now govern the piano-roll lyrics row alone on that preset. No
  capability preset changes in this plan; only which _surface_ honours them.
- **`PREVIEW_CAPABILITIES`** has empty interaction sets already; unaffected.

**Per-highway labels (instrument · difficulty) — DOM chips.** Keep exactly
what ships today (`HighwayEditorPane.tsx:397-401`): an absolutely-positioned
`pointer-events-none` chip over the highway's rect. Crisp at any DPI, zero
texture and zero draw cost, inert to raycasting, already asserted by
`multi-pane-highway.test.tsx:300`. In-scene sprites would add a
`CanvasTexture` per highway and be subject to fog and clip planes for no
benefit.

### 6. Interaction — one canvas, N overlays, and the root-local X correction

**`InteractionManager` changes. The first draft's "unchanged" is retracted.**

Each root's `InteractionManager` gains a `rootWorldX: number` constructor
argument (defaulting to 0, so `setupRenderer`, `/sheet-music`, and
`/chart-review` are unaffected), and every world-space X it reads or writes
becomes root-local:

- `hitTestHighway` (`:389-399`): after `ray.intersectPlane`, use
  `localX = hit.x − rootWorldX` for both the `Math.abs(localX) >
highwayHalfWidth` bounds check and `worldXToLane(localX)`.
- `screenToWorldPoint` (`:569-584`): return the point with `x` shifted by
  `−rootWorldX`, so `screenToLane` (`:481-483`) and `screenToMs` (`:495`)
  inherit the fix.
- `hitTestMarkerLines` (`:341-349`): probe `tempWorld.set(rootWorldX, y, 0)`
  instead of `(0, y, 0)`. Under a per-viewport camera with no yaw this is a
  no-op for `projected.y`, which is precisely why it must be written
  explicitly and pinned by a test — it is the invariant a future shared
  camera would silently break (§2).

Everything downstream of these three sites — lane resolution, tick snapping,
kick/open full-width hit testing (`:426-465`), sprite raycasts (world-
consistent, untouched) — is then correct at any `worldX`.

**Hit-test surface narrows with §5.** `hitTest`'s four-tier priority
(`:154-173`) keeps its shape but tier 1 and tier 3 now consider **section
markers only**: `MARKER_PRIORITY` (`:291-296`) becomes `['section:']` and
`elementToMarkerHit` (`:364-383`) keeps just the `section` case. `HitResult`'s
`lyric` / `phrase-start` / `phrase-end` variants become unreachable from the
highway — they stay in the type because the piano roll's own hit-testing
(`piano-roll/hitTest.ts`) produces the same entity kinds. Upstream,
`useHighwayMouseInteraction`'s `markerHitToRef` / `hitToEntityRef`
(`:149-192`) simplify to the section branch, and `hitTick`'s `phrase-end`
case goes with it.

**Alternative considered and rejected: place every root at `x = 0`.** It
would make the IM change unnecessary (scissor + layers alone would isolate
the highways). Rejected because it removes the safety net that makes the
layer-stamp miss benign: with all roots coincident, an unstamped object from
root `j` renders _superimposed_ on root `i`'s highway instead of falling
outside its frustum (§1). Given `SceneOverlays` has six lazy add sites that
`syncLayers()` can legitimately lag, superimposition is the wrong failure
mode to design in. The IM correction is three sites and one test.

**One transparent overlay `<div>` per highway**, absolutely positioned over
that highway's rect from `layout.highways`, stacked above the single shared
canvas. This is what keeps the hybrid interaction architecture intact:

- `useHighwayMouseInteraction` is unchanged. `getCanvasSize()` still reads
  its own div's `offsetWidth/offsetHeight` (`:236-240`), which now equals the
  GL viewport rect, so `im.hitTest(x, y, w, h, gridDivision)` (`:272-280`)
  holds verbatim.
- Per-track command targeting is unchanged: `paneState = {...state,
activeScope: laneScope}` (`HighwayEditorPane.tsx:143`) and
  `trackQualifiedNoteId` (`useHighwayMouseInteraction.ts:439-445`) are
  editor-side and never touch the renderer. The plan-0067 / 0074 contract
  survives byte-for-byte.
- The hybrid rules hold: **THREE raycasts** (`InteractionManager`), **React
  decides** (tools registry), **one-way push** (`useHighwaySync` /
  `useChartElements` → stage handles). `setLayout` is a push, not a query;
  nothing in the stage reads React state back.
- Last-interacted `SET_ACTIVE_SCOPE` on mousedown
  (`HighwayEditorPane.tsx:248-256`) is unchanged, as is "no focus concept
  anywhere".
- **Drags stay owned by the highway they started in.** Overlay divs are
  siblings, so a pointer crossing into a neighbour's div fires
  `onMouseLeave` on the origin div — already the behavior with N canvases
  (`useHighwayMouseInteraction.ts:539-552` keeps the drag pinned and does not
  clear hover while `isDragging || markerDrag`), and preserved unchanged. A
  cross-highway drag is not a feature here, and marquee selection stays
  highway-local.

_Rejected — one canvas-wide pointer surface resolving the highway from
`event.clientX`._ It must re-derive pane-local pixels anyway (the raycast
needs them), it breaks per-highway `onMouseLeave` hover clearing, and it puts
layout knowledge into the interaction hook.

**New failure mode to guard.** DOM rects and GL rects must come from one
`computeStageLayout` result or hit-testing silently desyncs from pixels by a
few pixels — the worst kind of bug, because it presents as a raycast
tolerance problem. Guarded by construction (one object, two consumers) and by
an explicit identity test.

### 7. Lifecycle

- **Create.** `setupStage` once per editor mount, keyed on `metadata` +
  `audioManager` — the same deps `HighwayPreview` uses today minus the track
  (`HighwayPreview.tsx:212-218`). Changing the visible track set recreates
  nothing.
- **Add / remove a highway.** `addHighway` builds a `HighwayRoot`, loads that
  instrument's textures, runs `buildHighwayCell` into the root, constructs
  `SceneOverlays` + `InteractionManager` (with `rootWorldX`), adds the root,
  stamps layers, returns the handle. `removeHighway` disposes that root's
  reconciler, note renderer, scene overlays, interaction manager,
  waveform/grid surfaces, and `AnimatedTextureManager`, then removes the
  root. **The renderer, scene, canvas, RAF loop, lyrics overlay, and marker
  texture cache are untouched.**
- **Resize.** One `ResizeObserver` on the canvas host, replacing N observers
  - N `window` listeners (`index.ts:168-173`): `renderer.setSize(W, H)` once,
    `lyricsOverlay.resize(W, H)` once, `computeStageLayout` recomputed, each
    `camera_i.aspect` set from its rect. A width change can change
    `maxHighways`, which flows back to React as a normal derived value.
- **Teardown.** One `stage.destroy()`. The `disposedSync` idempotence guard
  and the synchronous `setAnimationLoop(null) → dispose → forceContextLoss`
  sequence (`index.ts:270-278`) carry over verbatim — the plan-0074 Phase 3
  contract pinned by `teardown.test.ts:93`. The `liveRendererCount` refcount
  (`index.ts:70, :137, :272, :309-310`) moves to `rendererRegistry.ts` and is
  shared by `setupRenderer` and `setupStage`: **it cannot be deleted**,
  because `/chart-review` mounts two concurrent `setupRenderer`s
  (`ChartReviewClient.tsx:1047, :1098`). What goes away is the _editor's_
  reason for it.
- **Context loss.** One context is now one failure domain. The stage
  registers a `webglcontextlost` handler that tears down and rebuilds itself,
  re-adding every highway from the current visible set. Previously a lost
  context killed one pane; now it would blank the strip, so recovery is
  required, not optional.

**Component collapse:**

| Today                                                   | After                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `components/chart-editor/HighwayPreview.tsx`            | **deleted**, with its export in `components/chart-editor/index.ts:61-62`. `HighwayRendererHandle` is superseded by `StageHighwayHandle`. Per the repo's no-re-export-shims rule, every import site is updated directly.                                                             |
| `components/chart-editor/highway/HighwayEditorPane.tsx` | → `highway/HighwayLane.tsx`: same four hooks, same `paneState` override, same label chip / marquee / popovers, **no canvas**. Gets its reconciler + interaction manager from the stage via a new `useStageHighway(id, scope)` hook. `showLyrics` / `showTempoBadges` props deleted. |
| `components/chart-editor/HighwayEditor.tsx`             | keeps pane-list resolution (`:163-191`); gains the canvas host, the `ResizeObserver`, the `computeStageLayout` call, and the `stage.setLayout` push. The `1fr` grid + `1px` gap (`:218, :221`) is replaced by absolutely-positioned overlays.                                       |
| `components/chart-editor/highway/useHighwaySync.ts`     | the lyrics effect (`:146-157`) and the timing effect (`:134-138`) move to a stage-level `useStageSync` (with §5's part rule); waveform, grid, highway-mode, and overlay-state effects stay per lane.                                                                                |

### 8. Performance

- **Contexts: N → 1.** Ends the context-exhaustion failure class for the
  editor. (`/chart-review`'s two are unrelated and unchanged.)
- **Draw calls: unchanged per highway, summed over N.** Same objects,
  materials, and render orders; camera layers prune each pass to its own
  stamped subtree. Metric: `renderer.info.render.calls` at 1 / 2 / 4
  highways, before and after.
- **Shader programs compile once, not once per context.** One
  `WebGLPrograms` cache serves every highway. Expect the win on _mount time
  for highways 2..N_, not steady-state frame time.
- **`MarkerRenderer`'s texture cache becomes trivially shared.** The
  module-scoped `Map<string, CanvasTexture>` (`MarkerRenderer.ts:24`) already
  shares JS objects across panes, but each WebGL context uploads its own GPU
  copy. One context = one upload per distinct label; section names dominate,
  so this is where the largest texture-memory win should show
  (`renderer.info.memory.textures`).
- **Per-frame CPU is unchanged and still linear in N.** This is the honest
  ceiling, and it is why the cap survives §2.
- **New per-frame cost:** one full-canvas clear plus N ×
  (`setViewport`, `setScissor`) — strictly cheaper than N context switches.
- **Deferred optimization (final phase, measure first):** two difficulties of
  one instrument load two full `CellTextures` + `AnimatedTextureManager` sets
  (`cell.ts:111-150`). Sharing is safe on the stage because the sequential
  passes re-set `highwayTexture.offset.y` before each render — the exact
  precondition `cell.ts:88-91` names. Not in the critical path.

## Phasing

Five phases (the first draft's Phase 2 is merged into Phase 3 — review
finding 9). Each is independently shippable and green: `pnpm typecheck &&
pnpm test && pnpm lint`, plus the browser checklist.

- **Phase 1 — Root widening, layers, layout, IM correction.** Widen
  `SceneReconciler`, `SceneOverlays`, `createWaveformSurface`,
  `createGridOverlay`, `buildHighwayCell` to `THREE.Object3D`. Add
  `HighwayRoot` + `syncLayers()`. Add `layout.ts` + suite. Add
  `InteractionManager`'s `rootWorldX` (default 0) + its unit test at
  `worldX ≠ 0`. Extract `rendererRegistry.ts`. `setupRenderer` builds its
  cell into a `HighwayRoot` at `worldX = 0`. **No user-visible change**; the
  app still ships on N canvases.
- **Phase 2 — The stage, handling N from day one.** `setupStage` with the
  full API. `HighwayEditorPane` → `HighwayLane`; `HighwayEditor` renders one
  canvas host + N overlay divs from one layout; per-viewport cameras +
  scissor + layers + the full-canvas clear; `stage.setLayout`. Lyrics move to
  the stage pass with §5's part rule. Delete `HighwayPreview.tsx`, its
  `index.ts` export, `RendererConfig.showLyrics`/`showTempoBadges`,
  `setLyricsVisible`, `setTempoBadgesVisible`, and `hiddenKindsFor`. Retarget
  the multi-pane and shared-chrome suites.
  _Why not stage-at-N=1 first (the first draft's Phase 2):_ routing "stage
  when `panes.length === 1`, `HighwayPreview` when > 1" makes the single
  highest-traffic interaction in the feature — toggling a track on or off —
  cross between two rendering implementations, tearing down the stage to spin
  up per-pane contexts and back. That recreates exactly the churn this plan
  exists to abolish. The stage handles N from the start; N=1 is simply its
  first exercise, behind the existing UI.
- **Phase 3 — Highway marker de-scope (§5).** The highway becomes
  notes + grid + sections. `HIGHWAY_ELEMENT_KINDS = {note, section}` in
  `cell.ts`; five `MarkerRenderer` constructions removed; `setHiddenKinds`
  and `declaredElements` deleted from `SceneReconciler`; `MARKER_PRIORITY`
  and `elementToMarkerHit` narrowed; `useMarkerDrag.MarkerKind` narrowed to
  `'section'`; `HighwayPopovers`' bpm/timesig variants, `tempoMarkerTool`,
  `timeSignatureMarkerTool`, their `TOOL_REGISTRY` entries, and the
  `'bpm'`/`'timesig'` `ToolMode` members deleted. `GridOverlay` untouched.
  No capability preset changes. Verify on `/add-lyrics` that lyric and
  phrase editing is fully served by the piano-roll lyrics row, and on
  `/tempo` that nothing changes at all (its highway interaction sets were
  already empty).
- **Phase 4 — Cap + rebuild-free add/remove + context-loss recovery.**
  Width-derived `maxHighways` wired to the pane slice with the unmeasured
  fallback; visibility toggles route through `addHighway` / `removeHighway`
  instead of remount; `webglcontextlost` handler.
- **Phase 5 — Browser validation + perf record.** Full checklist,
  measurements recorded in this file, per-instrument texture sharing only if
  the numbers ask for it.

## Testing strategy

Behavior-first; jsdom where jsdom is honest, browser where it is not.

**What jsdom covers:**

1. **`layout.test.ts` (pure, no THREE, highest value).** Rects for 1 / 2 / 3
   / 6 highways; gap exactness; non-overlap; widths + gaps sum to canvas
   width; `toGlRect` y-flip and round-trip; `maxHighways` monotone in width
   and clamped; **`measured: false` + `maxHighways === MAX_HIGHWAYS` at
   width 0** (the rule the routing suites depend on); degenerate inputs.
2. **`InteractionManager` at `worldX ≠ 0` (the blocker's regression test).**
   Construct two IMs on the same schema, one at `worldX = 0` and one at
   `worldX = 8`, with cameras translated to match. Assert: identical
   pane-local pixel inputs produce identical `lane` / `tick` / `type` from
   `hitTest`, `screenToLane`, and `screenToMs`; a click at the highway's
   right edge is in-bounds for both; a click beyond `highwayHalfWidth`
   returns `null` for both. Plus the invariant test: `hitTestMarkerLines`'
   `projected.y` is identical at `worldX = 0` and `worldX = 8` — the thing a
   future shared camera would break.
3. **`reconciler-multiplex.test.ts`.** Two `SceneReconciler`s on two
   `HighwayRoot`s inside one `THREE.Scene`, real THREE objects, no GL:
   `setElements` / `updateWindow` on A never mutate B's `children`; A's
   `getActiveGroupsRevision()` is unaffected by B's churn; `dispose()` on A
   leaves B mounted. Plus `HighwayRoot.syncLayers()` stamps every descendant
   including groups added after mount, **and** the layer-semantics guarantee:
   an unstamped object still tests true against `camera_i.layers` (i.e.
   cameras `enable`, never `set`).
4. **`highway-element-kinds.test.ts` (§5's enforcement point).** Push a full
   `buildProjectionFor` element set — notes, sections, lyrics, phrase
   start/end, bpm, ts — at a stage highway's reconciler and assert only
   `note:` and `section:` keys are ever stored (`getElements()`) and grouped
   (`getActiveGroups()`); no lyric/phrase/bpm/ts element is windowed or
   positioned. Companion: `InteractionManager` returns `null` (or a highway
   hit) where a lyric/phrase/bpm/ts hit would previously have resolved, and
   still resolves sections normally.
5. **Interaction routing through the stage boundary** — the existing
   `multi-pane-highway.test.tsx` value, with the mock boundary moved from
   `setupRenderer` to `setupStage`. Per-highway `hitTest` stubs; real
   `useHighwayMouseInteraction` / tool registry / command stack.
6. **Lifecycle / teardown** — `three` faked at `WebGLRenderer` only, as
   `teardown.test.ts:42-59` already does: `destroy()` idempotent and
   synchronous through `forceContextLoss()`; `addHighway` constructs no
   second `WebGLRenderer`; `removeHighway` calls neither `dispose` nor
   `forceContextLoss`; the marker-texture cache survives a `removeHighway`
   and survives a `stage.destroy()` while a `setupRenderer` is still live.
   The fake also records the **frame sequence**, asserted in order:
   `setScissorTest(false)` → full-canvas `setViewport`/`setScissor` →
   **`clear()`** → `setScissorTest(true)` → N × (`setViewport`, `setScissor`,
   `render`) → `setScissorTest(false)` → full `setViewport` → lyrics
   `render`. A real regression guard for finding 4, even though it proves
   nothing about pixels.
7. **Layout↔overlay agreement** — render `HighwayEditor` with a stubbed
   canvas size and assert the overlay divs' inline rects are the _same
   objects_ `stage.setLayout` received.

**What jsdom cannot cover — named, not faked:**

- That `setViewport` / `setScissor` actually confine a highway to its rect,
  and that the full-canvas clear actually paints the gaps.
- That layer stamping prevents cross-viewport bleed.
- Any frame-rate, `renderer.info.render.calls`, or texture-memory claim in
  §8.
- That per-viewport cameras render pixel-identically to today's per-canvas
  cameras. Screenshot comparison, full stop.
- Raycast accuracy under a real camera aspect: jsdom has no layout, so
  `offsetWidth` is 0 and every hit-test in jsdom is a stub.

**Browser checklist (chrome-devtools MCP, per CLAUDE.md):**

- 1 / 2 / 3 / 6 highways screenshotted against the current build.
- Hover, select, **place a note on empty highway**, and drag in the
  _rightmost_ highway — the path the `rootWorldX` bug would kill — targeting
  the right track and note ids.
- Inter-highway gaps and any dead edge strip are black, not garbage
  (finding 4).
- Add and remove a highway mid-playback: no flicker, no re-seek, zero
  `webglcontextlost` events.
- Resize the window and collapse/expand the sidebar; rects and hit testing
  stay aligned.
- Karaoke line centered across the whole strip at 1, 2, and 4 highways; the
  part rule holds on `/add-lyrics` with a non-default part selected.
- **Grid lines render on every highway** at 1 / 2 / 4, in both classic and
  waveform modes (§5 decision 1 — the one thing the owner asked to keep).
- **No bpm / time-signature / lyric / phrase marker is visible on any
  highway**, and section markers still hover, select, drag, and rename.
- `/add-lyrics`: move a lyric chip and resize a phrase band in the piano
  roll's lyrics row; confirm the highway shows no lyric flags and that the
  karaoke line still tracks the edit.
- `/tempo`: unchanged end to end (its highway interaction sets were already
  empty) — tempo and time-signature edits still work from the piano-roll
  tempo lane and ruler.
- Record `renderer.info.render.calls` and `renderer.info.memory.textures`
  before and after, at each highway count.

### Fate of the existing multi-pane tests

**`multi-pane-highway.test.tsx`** — mock boundary moves to `setupStage`;
`mockRendererInstances` (`:59-70`) becomes `mockStageHighways`, keyed by
highway id.

_Carries over unchanged_ (all routing, none canvas-shaped): `renders a safe
empty state` (`:295`), `renders one pane per visible track, each labeled with
instrument · difficulty` (`:300`), `renders four visible tracks with no
overflow chip` (`:318`), `caps panes at N and shows a "+N more" overflow
indicator` (`:338`), `points the overflow chip at the piano roll` (`:372`),
`drops visible ids for tracks the doc no longer contains` (`:414`), `pointer
interaction in each pane targets that pane's own track` (`:435`), `stores
note selections track-qualified` (`:479`), `retargets keyboard entry to the
pane that was last moused down in` (`:518`), `cycles the active track with
Alt+ArrowDown / Alt+ArrowUp` (`:547`), `renders a single vocals pane`
(`:580`), and the whole `single-track piano roll ↔ highway selection` block
(`:732-1000`).

The two cap-shaped cases (`:318`, `:338`) survive **only because of the
unmeasured-width rule in §2** — under a naive width-derived cap they would
collapse to one pane in jsdom. They gain an explicit comment saying so.

_Dies and is replaced_: `disposes a pane's renderer deterministically when
its track is toggled off` (`:674`) — there is no per-pane renderer. Replaced
by **`removes the highway's root and disposes its reconciler without touching
the stage renderer`**: asserts `stage.removeHighway(id)` called, that
highway's reconciler `dispose`d, `stage.destroy` **not** called.

**`highway-shared-chrome.test.tsx`** (new/untracked, from the concurrent
workflow) — the four flag-assertion cases die with the flags and setters they
assert (`:82-88`): `draws lyrics and tempo badges in a single-pane highway`
(`:151`), `draws lyrics in the leftmost pane only` (`:162`), `hides the tempo
badges in every pane` (`:176`), `keeps the shared chrome on for a single
vocals pane` (`:188`). Any assertions that workflow adds against
`setLyricsVisible` / `setTempoBadgesVisible` die with them too.

Replaced by: **`constructs exactly one lyrics overlay for the stage
regardless of highway count`**, **`drives the stage lyrics push from the
active vocal part on a vocals scope and the default part elsewhere`**, and
**`reconciles only note and section elements on every highway root`** (the
§5 enforcement point, sharing the fixture with
`highway-element-kinds.test.ts`).

**`useChartElements.test.ts`** — extended, not rewritten. It asserts the
element set pushed to the reconciler, and that push is unchanged (the piano
roll consumes the same projection); a new case pins that the highway
reconciler _stores_ only `note:` / `section:` from that same push.

**`components/chart-editor/__tests__/capability-gates.test.tsx`** — any case
asserting highway hover/select/drag of a `lyric` / `phrase-start` /
`phrase-end` entity moves to the piano-roll lyrics-row equivalent. Cases
asserting the capability _sets_ themselves are unchanged: no preset changes
(§5 audit).

The two layout cases retarget: `gives panes no border or rounding of their
own` (`:224`) becomes a DOM assertion on the lane overlay divs; `seats the
panes flush in one surface separated by a hairline` (`:235`) has no CSS seam
left and becomes the `HIGHWAY_GAP_PX` assertion in `layout.test.ts`.

**`lib/preview/highway/__tests__/SceneReconciler.test.ts`** — the
`setHiddenKinds` cases the concurrent workflow added die with the method;
the constructor-`hiddenKinds` cases stay and gain the permanent
`HIGHWAY_ELEMENT_KINDS` fixture.

**`InteractionManager.test.ts`** — cases hit-testing `lyric` /
`phrase-start` / `phrase-end` flags and lines die (those kinds never reach a
highway reconciler); the `section` cases stay and become the whole marker
story. Extended with the `rootWorldX` cases (Testing §2).

**`teardown.test.ts`** — both cases survive, parameterized over
`setupRenderer` **and** `setupStage`. The marker-cache case moves to
`rendererRegistry` and gains a mixed case (one of each live simultaneously).

**`cell.test.ts`, `LyricsOverlay.test.ts`** — unchanged; the widening is
type-only and `cell.test.ts` only exercises the clipping-plane helpers.

## Non-goals

- **No change to `/sheet-music`'s `CloneHeroRenderer` or `/chart-review`'s
  dual-renderer preview.** `setupRenderer` stays, keeps its single-canvas
  contract, keeps sharing the marker-texture refcount, and gets
  `rootWorldX = 0` by default.
- **No converging shared-vanishing-point camera.** Owner-decided against
  (2026-08-03); documented as a future option in §2, not scheduled.
- **No change to note or marker art, `MarkerRenderer`'s implementation,
  `GridOverlay`, `projection.ts`, `chartToElements` / `buildMarkerElements`,
  the command stack, or `visibleTrackKeys` semantics.** §5 removes _which_
  kinds a highway reconciler accepts and the two now-unreachable tempo
  tools; it changes no rendering code and no element derivation.
- **No capability-preset changes.** `DRUM_EDIT`, `ADD_LYRICS`, `TEMPO`, and
  `PREVIEW` keep their exact `hoverable` / `selectable` / `draggable` /
  `editableEntities` sets (§5 audit). Only which surface honours them moves.
- **No piano-roll changes.** §5 relies on the lyrics row and tempo lane as
  they already ship; it adds nothing to them. If the lyrics row turns out to
  be missing an affordance the highway had, that is a follow-up plan, not a
  silent scope grab here.
- **No cross-highway drags or marquee.** Gestures stay owned by the highway
  they start in, as today.
- **No per-instrument texture sharing** before the final phase, and only then
  if measurement asks for it.
- **No mobile / vertically-stacked highway layout.** `computeStageLayout` is
  horizontal-only.
- **No demand-render or per-highway frame throttling.**

## Risks

- **Layer stamping is add-time and `SceneOverlays` adds lazily** at six sites
  (`:300, :321, :453, :515, :544`, plus `:176-177`). Mitigated _by design_:
  cameras `enable` rather than `set` layer indices, so an unstamped object is
  drawn everywhere and culled everywhere but its own frustum — wasted work,
  never invisible. Pinned by the layer-semantics test.
- **One context is one failure domain.** A lost context blanks the whole
  strip. The Phase 4 recovery handler is required, not optional.
- **DOM/GL rect divergence is a silent hit-testing bug.** Mitigated
  structurally (one `computeStageLayout` result feeds both) and by an
  identity test.
- **The `rootWorldX` correction has no jsdom-visible failure mode.** jsdom
  hit-tests are stubs, so the unit test in Testing §2 (real THREE math, no
  GL) plus the "place a note on empty highway in the rightmost lane" browser
  step are the only real guards. Treat both as blocking.
- **Two code paths for the same scene core.** `setupRenderer` and
  `setupStage` coexist indefinitely. `cell.ts` must remain the only place the
  core is built; a fix applied to one path and not the other is a bug by
  construction.
- **Concurrent workflow drift is live** — it moved most of `index.ts` and
  falsified one first-draft claim _during the review_. This plan deletes the
  flush-pane CSS, the chrome flags, and the runtime chrome setters rather
  than building on them, so further cosmetic drift there is absorbed at
  Phase 2. The contracts actually depended on are: the `paneState` scope
  override (`HighwayEditorPane.tsx:143`), the renderer handle shape, and
  `SceneReconciler.setHiddenKinds` (`:197`) — which Phase 3 **reuses** rather
  than reinventing. **Re-verify every `index.ts` / `HighwayPreview.tsx`
  citation at the start of Phase 1**; they have drifted once already.
- **`MAX_HIGHWAY_PANES` has already drifted 3 → 4.** Width-derived math
  absorbs further drift; no particular number is ratified.
- **§5 moves lyric editing to a row that can be hidden.** The piano-roll
  lyrics row does not render when the vocals part has no phrases
  (`PianoRollTimeline.tsx:439, :469`). Not a regression — the highway showed
  nothing in that state either, and lyrics are created by the aligner, never
  by a highway gesture (no lyric-placement tool exists) — but it means a
  chart with zero lyrics has no lyric UI anywhere until the aligner runs.
  Confirm on `/add-lyrics` in the Phase 3 browser pass; if it reads as a
  hole, the fix belongs in the piano roll (empty-state row), not on the
  highway.
- **`ToolMode` loses two members.** `'bpm'` / `'timesig'`
  (`lib/chart-editor-core/state.ts:20-21`) are reducer-level state. Removing
  them is safe _today_ because `EditToolbar.tsx` — the only writer — is
  unimported dead code, but persisted or restored editor state carrying one
  of those values would now be invalid. Check the reducer's tool-mode
  handling for a default-case fallback before deleting.
- **Per-frame CPU stays linear in N.** The single-context win is memory and
  mount-time, not frame-time. If 6 highways miss budget, the lever is
  demand-render, out of scope here.

## Done when

- The editor renders every highway layout — 1, 2, 3, up to the width-derived
  cap — through **one** `WebGLRenderer`, **one** canvas, **one**
  `THREE.Scene`, **one** `setAnimationLoop`, verified in the browser with a
  `renderer.info` readout and a single `<canvas>` in the highway area's DOM.
- Karaoke lyrics render once, top-center, spanning the whole strip at every
  highway count, driven by the §5 part rule. `showLyrics` and
  `setLyricsVisible` no longer exist.
- **Every highway draws notes, grid lines, and section markers — and nothing
  else.** No BPM badge, no time-signature badge, no lyric or phrase flag
  appears on any highway at any highway count, verified in the browser and
  pinned by `highway-element-kinds.test.ts`. `showTempoBadges`,
  `setTempoBadgesVisible`, `hiddenKindsFor`, and
  `SceneReconciler.setHiddenKinds` no longer exist.
- **Grid lines render on every highway** in both classic and waveform modes,
  unchanged from today.
- **Section markers on the highway are untouched** — hover, select, drag,
  and rename all behave exactly as they do now.
- Tempo and time-signature editing works from the piano roll's tempo lane
  alone, and lyric / phrase editing from its lyrics row alone;
  `tempoMarkerTool`, `timeSignatureMarkerTool`, and the `'bpm'`/`'timesig'`
  `ToolMode` members are gone.
- Every highway lane is pixel-identical to today's equivalent pane
  (screenshot comparison at 1, 2, and 4 highways), and the inter-highway gaps
  are cleanly cleared.
- Placing, hovering, selecting, and dragging work identically in **every**
  highway including the rightmost — the `rootWorldX` correction verified by
  unit test at `worldX ≠ 0` and by the browser step.
- Adding or removing a highway mounts or unmounts a group: no new
  `WebGLRenderer`, no scene rebuild, no lyrics-overlay reconstruction, no
  audio re-seek, no marker-texture-cache clear. Pinned by test.
- Pointer interaction in every highway resolves to `(trackKey, element)` and
  stamps its commands with that highway's track — the plan-0067 / 0074
  contract — with `multi-pane-highway.test.tsx`'s routing assertions passing
  unchanged against the new stage boundary.
- `stage.destroy()` is idempotent and releases the GPU synchronously before
  returning; the marker-texture refcount still protects `/chart-review`'s two
  concurrent `setupRenderer`s.
- `components/chart-editor/HighwayPreview.tsx` is deleted, every import site
  updated directly (no re-export shim).
- `/sheet-music` and `/chart-review` render exactly as before.
- `pnpm typecheck && pnpm test && pnpm lint` green; the browser checklist
  completed and its measurements recorded in this file.
