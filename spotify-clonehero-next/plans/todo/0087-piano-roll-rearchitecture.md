# 0087 — `PianoRollTimeline.tsx`: two bug fixes and three extractions

Status: todo

## 0. Decision, up front

**The seven-phase rearchitecture this plan originally proposed is deferred.
Its largest phases (the gesture-union rewrite, the commit extraction, and the
canvas/view hooks) are not justified by the evidence available today, and the
review that produced that judgement is recorded in §7.**

What this plan now does, in order:

| Phase | What                                                       | Why now                                                              |
| ----- | ---------------------------------------------------------- | -------------------------------------------------------------------- |
| **0** | Two real bugs in gesture teardown                          | User-visible, small, and independent of any refactor                 |
| **A** | Measured section-label widths, `pickSectionAt` → `hitTest`  | Removes the last impure hit test; covered by 10 existing assertions   |
| **B** | `chartScene.ts` — pure scene derivation                    | Genuinely pure; the memo dep-array trap is a real, non-obvious catch  |
| **C** | `contextMenus.ts` — 740 lines of pure menu assembly         | Best payoff-to-risk ratio in the file; 39 existing contextmenu assertions guard the wiring |
| **D** | Move-time jsdom coverage for the eight uncovered gestures   | Worth doing on its own merits; also the precondition for anything more |

> **Concurrency note.** Another agent owns `lib/project-storage/**`,
> `lib/chart-editor-core/songIniMetadata.ts`,
> `components/chart-editor/TrackEditPage.tsx`,
> `components/chart-editor/ChartEditor.tsx`,
> `app/drum-transcription/components/EditorApp.tsx` and parts of
> `lib/chart-edit/`. None of those are touched here. Phases 0/A/B/C/D write
> **only** inside `components/chart-editor/piano-roll/` — not
> `components/chart-editor/editing/`, which the original plan claimed as its
> own and which currently holds 237 uncommitted lines plus two untracked files
> from other in-flight work.

Then stop and re-measure. Phases E (band geometry), F (gesture union), G
(gesture commit) and H (canvas/view hooks) are specified in §6 as **deferred**,
with the conditions that would have to be true to start them.

The short version of why: the file's 4,329 lines are not 4,329 lines of
untested decision logic. Eleven pure modules with eleven test files already sit
next to it — `gestures.ts`, `hitTest.ts`, `tempoHitTest.ts`, `loopFlags.ts`,
`sectionDrag.ts`, `notes.ts`, `viewMath.ts`, `wavePeaks.ts`,
`waveformSources.ts`, `panelHeight.ts`, `escapeRouting.ts`. The bulk of the
1,270-line pointer block is ref plumbing wrapped around helpers that were
already extracted. The extraction with real remaining payoff is the context
menus; the rest is a line-count exercise with a weak regression signal.

---

## 1. Measurements

`components/chart-editor/piano-roll/PianoRollTimeline.tsx` is 4,329 lines in
the working tree. It is **not** 4,329 lines at HEAD: the working tree carries
584 uncommitted lines of change in this file and 237 in
`components/chart-editor/editing/marquee.ts`, plus untracked
`editing/deleteSelection.ts`, `editing/__tests__/panelMarquee.test.ts`,
`piano-roll/TapTempoPopover.tsx` and `piano-roll/__tests__/tapTempoPopover.test.tsx`.

Recent size history:

```
937a91d  2026-08-04  4690
c03af04  2026-08-04  4659
9d417ea  2026-08-05  3896   "Rebuild the piano roll around a split renderer (plans 0078, 0079)"
b3f6bce  2026-08-05  4068
5a3622f  2026-08-05  4075
working tree          4329
```

Three commits landed in this file today. The prior decomposition (extracting
`draw.ts`, 996 lines) bought 763 lines and feature work re-consumed 433 of them
within 24 hours. That is direct evidence that the growth here is **new
features, not sprawl** — decomposition does not hold against it, and any plan
anchored to line numbers in this file goes stale within a day. Every line
number below was re-verified against the working tree at the time of writing
and should be re-verified before use.

Region breakdown, for arguing phases from sizes:

| Region                                                                            | Lines       | ~Count    |
| --------------------------------------------------------------------------------- | ----------- | --------- |
| Module docblock                                                                   | 1–69        | 69        |
| Imports                                                                           | 71–271      | 200       |
| Module-scope helpers/types (`stackedRowGeometry`, `sceneForTrackRow`, menu types) | 272–473     | 200       |
| Props + refs + local state declarations                                           | 479–731     | 250       |
| `tempoCache` + `scene` memos                                                      | 733–913     | 180       |
| Store-push effects                                                                | 915–1014    | 100       |
| `draw()`                                                                          | 1017–1286   | 270       |
| Sizing (DPR + `ResizeObserver`) and view initialisation                           | 1288–1384   | 96        |
| rAF / idle-poll render loop                                                       | 1386–1483   | 98        |
| Geometry + picking helpers (`panelGeometry` … `snappedTickAt`)                    | 1486–1739   | 253       |
| `setGhost`, `selectNote`, `selectLyric`                                           | 1743–1814   | 72        |
| `applyWheel` + the non-passive wheel listener                                     | 1816–1883   | 68        |
| `beginMarquee`, `handlePointerDown`, `handlePointerMove`, `endPointer`            | 1885–3154   | **1,270** |
| Context-menu builders + `handleContextMenu`                                       | 3165–3905   | **740**   |
| Gesture cancellation + Escape routing + doc-change invalidation                   | 3907–3997   | 90        |
| Structural tempo correction (`previewOctave`, accept/reject)                      | 3999–4062   | 64        |
| Panel-height resize handlers                                                      | 4064–4106   | 43        |
| JSX                                                                               | 4108–4304   | 196       |
| `hitSection`                                                                      | 4310–4325   | 16        |

### What the existing jsdom suites actually cover

This matters more than the size table, because §5's verification depends on it:

| Suite                        | pointerdown | pointermove | pointerup | contextmenu |
| ---------------------------- | ----------- | ----------- | --------- | ----------- |
| `contextMenu.test.tsx`       | 10          | 2           | 5         | 29          |
| `lyricSelection.test.tsx`    | 11          | 7           | 9         | 0           |
| `sectionContextMenu.test.tsx`| 0           | 0           | 0         | 10          |
| `tapTempoPopover.test.tsx`   | 0           | 0           | 0         | 0           |
| `emptyVisibleTracks.test.tsx`| 0           | 0           | 0         | 0           |

Nine move sequences total, covering lyric chip drag, marquee, and the mixed
note+lyric drag. **Move-time behaviour for tempo marker drag, TS chip drag,
section drag, loop flag drag, phrase-edge drag, place-drag, erase paint and
sustain resize has zero jsdom coverage.** Phase D exists to close that. Until
it is closed, "the suites pass unchanged" is not a meaningful gate for any
phase that rewrites those branches — the suites cannot fail.

---

## 2. Phase 0 — fix the two teardown bugs (no refactor)

Both are real, both are user-visible, and neither should wait behind an
extraction program. This is a deliberate reversal of the original plan's rule
7 ("fixed structurally by a later phase").

### 2a. `cancelInFlightGesture` leaves a sustain-resize / place-drag preview painted

`endPointer` (3133–3146) nulls fourteen refs. `cancelInFlightGesture`
(3916–3928) nulls twelve — it omits `noteResizeRef` and `placeNoteRef`.

`draw()` reads `noteResizeRef.current` and `placeNoteRef.current`
**unconditionally** (1098–1109 for the stacked rows, 1150–1152 for the flat
path); neither read is gated on `pointerMode`. So Escape during a sustain
resize sets the mode to idle but leaves the resize preview painted until the
eventual pointerup arrives.

**Fix:** null both refs in `cancelInFlightGesture`.

*Correction to the original plan's claim:* it said `ghostRef` was the third
omission. That is imprecise. `endPointer` does not clear `ghostRef` in its
common teardown either — it clears it only inside the place-drag commit branch
(2895). The difference is therefore real for place-drag specifically (Escape
mid-place-drag leaves the ghost) but is not a third entry in the teardown list.
Null `ghostRef` in `cancelInFlightGesture` too, and say so in the comment.

### 2b. Panel-height drag survives Escape, and borrows the wrong doc-invalidation exemption

`pointerModeRef.current = 'resize'` is set from **two unrelated gestures**:

- `PianoRollTimeline.tsx:2240` — note sustain resize (`noteResizeRef`)
- `PianoRollTimeline.tsx:4072` — panel-height drag handle (`resizeDragRef`)

Two consumers read that conflated value, and each one wants a different answer:

1. **Escape routing** (`resolveEscapeTier(menu !== null, pointerModeRef.current !== 'idle')`,
   ~3971). Escape during a panel-height drag returns `'gesture'` and calls
   `cancelInFlightGesture`, which sets `pointerModeRef = 'idle'` but **never
   nulls `resizeDragRef`**. `handleResizePointerMove` (4083) gates on
   `resizeDragRef.current`, not on the mode — so the panel keeps resizing after
   Escape while escape routing believes nothing is in flight.
2. **Doc-identity invalidation** (~3953):
   `if (mode !== 'idle' && mode !== 'resize' && mode !== 'scrub') cancelInFlightGesture()`.
   The comment justifying the exemption says "Resize and scrub hold no doc
   reference". That is true of the panel-height handle and **false** of a
   sustain resize: `PanelNoteResize` carries `noteId` (`sceneTypes.ts:91–97`),
   which is a reference into the pre-undo doc. An undo mid-sustain-resize
   currently leaves the gesture live against a doc the note may not exist in.

**Fix:** stop conflating them.

- Add a distinct `'panel-resize'` variant to `PointerMode` (line 350) and use
  it at 4072. The sustain resize keeps `'resize'`.
- `cancelInFlightGesture` handles `'panel-resize'` by **reverting the panel to
  `resizeDragRef.current.startHeight`** and nulling `resizeDragRef`. Escape
  cancelling a drag back to its start is what Escape means everywhere else in
  this panel; ending it in place would be the odd one out.
- The doc-identity effect's exemption becomes `mode !== 'panel-resize' && mode !== 'scrub'`.
  A sustain resize is now invalidated on doc identity change, like every other
  gesture that holds a doc reference. **This is a deliberate behaviour change**,
  and it is the correct one.

**Tests:** three `lyricSelection`-style jsdom cases in a new
`__tests__/gestureTeardown.test.tsx` —
(i) Escape mid-sustain-resize clears the preview (assert the resize argument
reaching `drawNotes` is null on the next frame);
(ii) Escape mid-panel-resize restores the start height and a subsequent
pointermove on the handle does not resize;
(iii) undo mid-sustain-resize cancels the gesture (no `ResizeNotesCommand` on
the eventual pointerup).

**Browser QA:** Escape during a sustain resize, during a place-drag, and during
a panel-height drag. Undo mid-sustain-resize.

---

## 3. Phase A — measured section-label widths (was phase 3)

The only impure hit test left. `hitSection` (4310) grabs a 2D context, sets
`'600 10px system-ui, sans-serif'`, and measures each section name — a second,
independent measurement of text that `drawRuler` already painted. Every other
band already does this properly: `drawTempoLane` records into
`tsChipWidthsRef`, `drawLyricsRow` into `lyricChipWidthsRef`, and their hit
tests read those maps (comment at 660: hit-testing "reads the SAME widths the
pill was actually painted at").

**Change:** `drawRuler` records section label widths into a
`sectionLabelWidthsRef` map; `hitSection` moves into `hitTest.ts` as a pure
`pickSectionAt(sections, view, x, widths)` alongside `pickLyricChipAt`.

**Known risk:** on the very first frame the map is empty. Use a documented
`DEFAULT_SECTION_LABEL_W` fallback — the same first-frame gap already exists
for TS chips and lyric chips, so this introduces no new class of problem. It is
cheap insurance; whether a `pointerdown` before the first paint is reachable at
all is an open question and not worth a test either way.

**Verify:** `sectionContextMenu.test.tsx` (10 contextmenu assertions) and
`contextMenu.test.tsx` unchanged; new `pickSectionAt` cases in
`hitTest.test.ts`; browser check that section flags hit correctly at three zoom
levels and with a long section name.

This is the phase where the payoff (a real correctness improvement) and the
safety net (existing coverage that actually exercises the path) line up best.

---

## 4. Phase B — `chartScene.ts` (pure scene derivation, was phase 2)

**Moves out:** the bodies of the `tempoCache` (745–793) and `scene` (799–913)
memos.

```ts
export function buildTempoCache(input: {
  tempos: readonly Tempo[]; timeSignatures: readonly TimeSignature[];
  resolution: number; durationSeconds: number;
}): TempoCache;
export function buildChartScene(input: {
  doc: ChartDocument; cache: TempoCache;
  showNotes: boolean; activeScope: EditorScope;
  visibleTrackKeys: ReadonlySet<string>;
}): ChartScene;
```

**Load-bearing constraint:** the component keeps two `useMemo`s with the
**exact** dep arrays it has today. The `tempoCache` memo deliberately depends
on `parsedTempos` / `parsedTimeSignatures` / `resolution` *references* rather
than on `effectiveDoc` identity, because `cloneDocFor('note', doc)` preserves
those references and a note edit must not re-walk the beat grid (comment at
733–741). Changing the deps here is a performance regression on long charts
that no test will catch. Copy them verbatim.

**Verify:** existing suites, plus new `__tests__/chartScene.test.ts`: a fixture
doc → expected `rows` / `lanes` / `totalMs` / `lyricsVisible` / `allTrackKeys`;
hidden tracks excluded from `rows` but present in `allTrackKeys`;
`showNotes: false` yields empty rows and no lyrics; and a reference-identity
test that a note-only doc change reuses the same `TempoCache` input references.

---

## 5. Phase C — `contextMenus.ts` (was phase 4)

**Moves out:** `buildTempoMenu` (158), `buildNoteMenu` (104),
`buildInsertNoteItem` (42), `buildSectionMenu` (81), `buildLoopMenu` (16),
`buildLyricsMenu` (93), `buildSourceMenu` (9), the item list inside
`openStackedViewMenu` (29), `commitBarLinePlan` (14), and the band-routing body
of `handleContextMenu` (127).

```ts
export interface MenuEnv {
  scene: ChartScene; geometry: PanelGeometry; view: PianoRollView;
  state: EditorState; capabilities: EditorCapabilities;
  tsChipWidths: ReadonlyMap<number, number>;
  lyricChipWidths: ReadonlyMap<string, number>;
  sectionLabelWidths: ReadonlyMap<number, number>;
  waveSources: WaveformSource[]; selectedSourceId: string | null;
  showVocalsWave: boolean;
}
export interface MenuActions {
  executeCommand(c: EditCommand): void;
  dispatch(a: EditorAction): void;
  openInlineTextEditor(x: number, y: number, initial: string, onCommit: (t: string) => void): void;
  openTapTool(anchorTick: number): void;
  previewOctave(factor: number): void;
  setWaveSource(id: string): void;
  toggleVocalsWave(): void;
}
export function buildMenuAt(env: MenuEnv, actions: MenuActions, x: number, y: number): ContextMenuItem[];
```

**`PanelGeometry` is the existing return type of `panelGeometry()`, exported as
a named interface.** This phase does **not** depend on the deferred band-geometry
extraction (phase E) — `panelGeometry()` already returns exactly the shape the
menu builders need. Export the type, pass the value.

`handleContextMenu` keeps only: `preventDefault`, the stacked-gutter branch,
`pointFromEvent` + the client-Y-to-container-Y conversion, the waveform row's
"open above the pointer" offset, and the `openItemsMenu` call.

**Removes `previewOctaveRef`** — `previewOctave` becomes a plain member of
`MenuActions`, so declaration order stops mattering. This is a genuine ref
deletion, not a relocation.

**Keeps in the component:** the `MenuState` / `MenuContent` union, the tap
tool's in-place content swap (`setMenu(open => …)` at 3253 — it mutates popover
state, not menu content), and the `openItemsMenu` / `closeUnlessTapping`
helpers.

**Verify:** `contextMenu.test.tsx`, `sectionContextMenu.test.tsx`,
`tapTempoPopover.test.tsx`, `lyricSelection.test.tsx` unchanged. New
`__tests__/contextMenus.test.ts` asserting item lists directly, with no DOM:
per band (ruler / lyrics / tempo / lanes / waveform / stacked gutter) ×
(hit / empty) × (editing enabled / read-only viewer). That matrix is ~30 cases
and is currently covered by roughly six jsdom cases.

Depends on phase A (three of the menu builders call `hitSection`; with it pure,
the whole menu module is pure and testable without a canvas).

---

## 6. Phase D — move-time gesture coverage

Standalone value, independent of any further refactor: the eight gesture kinds
with zero jsdom move coverage are also the eight where phase 0's two bugs
lived. Add `pointerdown → pointermove → pointerup` sequences, in the style of
`lyricSelection.test.tsx`, for:

tempo marker drag (including the per-move `SET_PENDING_TEMPO_CANDIDATE`),
TS chip drag, section drag (including the sub-threshold fall-back-to-seek at
3049–3055), loop flag drag, phrase-edge drag, place-drag, erase paint, sustain
resize.

Assert on the commands executed and the actions dispatched, not on pixels. Each
gesture also gets an Escape-mid-gesture case, since phase 0 just changed what
Escape does for two of them.

This is the honest prerequisite for anything in §7. It is worth doing whether
or not that work ever happens.

---

## 7. Deferred: the rearchitecture (phases E–H)

Recorded here so the design work is not lost, and so the conditions for
resuming are explicit rather than a matter of taste.

### Why deferred

1. **The testability payoff is largely already banked.** Every clamp and
   threshold the gesture-union phase promised to make testable is already a
   pure exported function with an existing unit test:
   `exceedsDragThreshold` (`editing/gestures.ts:21`, `gestures.test.ts`),
   `phraseEdgeDragBounds` (`hitTest.ts:291`, `hitTest.test.ts`),
   `clampMarkerMs` (`tempoHitTest.ts:64`, `tempoHitTest.test.ts` +
   `tempoInteraction.test.ts`), `moveLoopEdge` (`loopFlags.ts:77`,
   `loopFlags.test.ts`), the lyric phrase clamp (inline at 2434, covered by
   `lyricSelection.test.tsx:507`), `computeNoteDragDelta`
   (`editing/gestures.ts:79`). What remains genuinely untested is the
   **pointerdown routing table** (band × tool × capability → gesture) — a real
   gap, but one that could be closed by extracting that one decision table
   without touching gesture state at all.
2. **The regression signal doesn't exist yet.** See §1's event counts. Phase D
   has to land first.
3. **The file is being rewritten right now.** Three commits today, 584
   uncommitted lines in this file and 237 in `editing/` — the second of which
   is exactly where the deferred work would write.
4. **No named bug traces to the shape.** The teardown drift was the only
   candidate, and phase 0 fixes it in a few lines. One such bug in a file that
   absorbed five feature plans in two days is evidence the shape is holding
   up, not failing.

### Phase E (deferred) — `panelLayout.ts`, and the divergence it must resolve

The original plan called `draw()`'s band math and `panelGeometry()`'s
"identical" and proposed a shared `computePanelLayout`. They are **not**
identical, in two ways:

```
draw()          1037: const stacked = showNotes && stackedPianoRollRef.current && (scene?.rows.length ?? 0) > 1;
panelGeometry() 1531: const stacked =              stackedPianoRollRef.current && (currentScene?.rows.length ?? 0) > 1;

draw()          1047: const laneH = (laneBottom - laneTop) / laneCount;
panelGeometry() 1541: const laneH = stackedRows ? (stackedRows.rows[0]?.laneH ?? STACKED_LANE_H)
                                                : (laneBottom - laneTop) / laneCount;
```

The `laneH` divergence is not a bug — it is the point. `draw()`'s value is the
non-stacked paint height; `panelGeometry()`'s is what `laneGeometry()` (1559)
feeds to the stacked hit test. In the default `/chart-editor` layout
(`ChartEditorClient.tsx:33` sets `stackedPianoRoll: true`) they hold different
numbers simultaneously. A `PanelLayout` with one `laneH` and one `stacked`
either returns both variants — replacing a "MUST match exactly" comment with
two fields that must match, i.e. fixing nothing — or changes one caller, which
is a behaviour change. And a new `panelLayout.test.ts` written against
whichever definition lands cannot catch the choice being wrong.

There are also nine `const stacked =` bindings in the file (1037, 1326, 1531,
1591, 1818, 1945, 2320, 3790, plus `stackedLayout` at 4102 which reads the prop
rather than the ref), not two.

**If this phase is ever run,** it must be written as an explicit, tested
decision — name which definition wins for which caller and why, test both — not
as a mechanical move. That decision is the actual work; the file move is
incidental.

### Phase F (deferred) — the `Gesture` union

The proposed union was:

```
idle | scrub | note-drag | note-resize | place | marquee | erase
     | tempo | timesig | section | loop | lyric | phrase-edge
```

Three design errors in it, recorded so they are not repeated:

1. **No home for the panel-height drag.** The plan counted `resizeDragRef`
   among the eleven refs collapsed, but the union has no variant for it, and
   it is not a canvas gesture at all. Phase 0 resolves this by splitting the
   `PointerMode` value instead; any future union must either exclude
   `resizeDragRef` from its scope or add a variant and re-decide both Escape
   routing and doc-identity invalidation explicitly.
2. **`updateGesture(gesture, env, point) => Gesture` cannot express the tempo
   branch.** The "one `if (next !== gestureRef.current)`" payoff requires
   move-time transitions to be pure and immutable. The tempo branch
   (2390–2419) mutates `drag.currentMs` in place, executes a
   `MoveTempoMarkerCommand`, and dispatches `SET_PENDING_TEMPO_CANDIDATE` on
   **every** pointermove. The marquee is not the only per-move dispatcher. The
   lyric branch (2424) meanwhile builds a fresh object, so the two conventions
   would have to converge, changing when `draw()` observes the new values
   relative to the dispatch. Gesture branches also write DOM
   (`canvas.style.cursor = 'ew-resize'` at 2398 and 2464). So `updateGesture`
   needs an effects channel too, not just `beginGesture` — at which point the
   component is a dispatcher plus an effect interpreter, and the
   "collapses to one identity check" claim is gone.
3. **The coupling is renamed, not reduced.** `GestureEnv` (scene, layout, view,
   live store state, capabilities) is the same near-whole-component signature
   the plan itself used to reject a hook-per-gesture. After E–H, answering "why
   did dragging a tempo marker do X" spans `PianoRollTimeline.tsx`,
   `gesture.ts`, `gestureCommit.ts`, `panelLayout.ts`, `tempoHitTest.ts`,
   `draw.ts`/`usePianoRollCanvas`, and the reducer — seven files, up from
   three today.

### Phases G and H (deferred)

`gestureCommit.ts` (extract `endPointer`'s 294-line switch) and the
`usePianoRollCanvas` / `usePianoRollView` / overlay-component split. Both are
downstream of F and inherit its preconditions. The `commitGesture` logic worth
testing — the mixed note+lyric `BatchCommand` rule (2934–2970, 3058–3108), the
deliberate exclusion of co-selected tempo markers and sections from a note drag
(2941–2947), the lyric drag's post-clamp reselection (3094–3107) — is better
served by phase D's jsdom cases in the meantime, at a fraction of the risk.

**The original phase 7 acceptance criterion — "that lands around 1,000; if the
result is 1,050 rather than 950, stop" — is withdrawn.** It was a proxy metric,
and the plan was candid about targeting a number. The 1,000-line rule lives in
one place, `.claude/skills/thermo-nuclear-code-quality-review/SKILL.md:95` and
`:186`, both phrased as a trigger for reviewing *new growth* ("a file crossing
1000 lines due to the PR" / "pushes a file from below 1000 lines to above
1000"). `CLAUDE.md` has no such rule. Nine other tracked files are over it with
no decomposition plan. (SKILL.md:36 does say "prefer extracting… instead of
letting a file sprawl past 1000 lines", so it is not purely a growth trigger —
but it is a preference, not a budget, and it does not license a seven-phase
program with no regression signal.)

### Conditions to resume

All three, not any one:

1. Phase D has landed — move-time jsdom coverage exists for all eight
   currently-uncovered gesture kinds.
2. `piano-roll/` and `editing/` are quiet: no open plans touching them, no
   uncommitted work in them.
3. A named bug whose root cause is "the gesture state lives in eleven refs",
   rather than "this clamp was wrong".

---

## 8. What NOT to do

Unchanged from the original review, and still right:

1. **Do not split the panel into per-band React components** (`RulerBand`,
   `TempoLane`, `LyricsRow`, `WaveformRow`). It is one canvas, one draw pass,
   one pointer capture, one rAF loop. The marquee is explicitly a whole-panel
   gesture that selects across bands (the `PanelMarquee` docblock at 325–333
   and `bandsTouched`). Component-per-band would thread geometry props
   everywhere, need a shared canvas ref anyway, and turn one coherent `draw()`
   into five that must be sequenced by hand.
2. **Do not move gesture state into `useState`/`useReducer`.** `draw()` is an
   empty-dep `useCallback` invoked through `drawRef.current` from the rAF loop
   and from every handler, specifically to keep pointer moves off React's
   render path. A `useReducer` would re-render at 60fps during a drag.
3. **Do not create a hook per gesture.** Each would need the whole environment;
   the routing table stays central regardless; `draw()` would read thirteen
   hook refs.
4. **Do not split `draw.ts` further.** It is already a 996-line leaf with a
   flat, parameterised export surface.
5. **Do not extract a "container / presentational" pair.** The JSX is canvases
   and three overlays.
6. **Do not create `helpers.ts` / `utils.ts` grab-bags**, and **do not leave
   re-export shims** when symbols move: update every import directly.
7. **Do not "fix" the render-time ref assignments** (`editStateRef`,
   `stackedPianoRollRef`, `showPianoRollNotesRef`, `panelHeightRef`, `drawRef`)
   by moving them into effects. Assigning during render is idempotent and
   StrictMode-safe; an effect would make handlers read one commit stale, which
   is precisely wrong for a pointer handler that must see the state the render
   is committing.
8. **Do not change the `tempoCache` memo's dependency array.** See phase B.
9. **Do not weaken the jsdom suites.** No deleting cases because a unit test now
   covers the same rule; no converting mounted tests to shallow ones. They are
   the wiring test for everything this plan takes apart.
10. **Do not batch phase 0's fixes into a later phase.** They are user-visible
    and independent. This is a reversal of the original plan's position.

The measured-width caches (`tsChipWidthsRef`, `lyricChipWidthsRef`, and phase
A's `sectionLabelWidthsRef`) are a deliberate correctness mechanism, documented
at line 660 — the paint pass telling the hit-test pass what it actually
painted. They stay.

---

## 9. Verification

Per phase: `pnpm typecheck` clean, `pnpm test` clean
(`lib/drum-fills/db/__tests__/queries.test.ts` is a known, accepted failure —
better-sqlite3 native bindings are not built here).

The five jsdom suites:

```
components/chart-editor/piano-roll/__tests__/contextMenu.test.tsx        (797 lines)
components/chart-editor/piano-roll/__tests__/lyricSelection.test.tsx     (527)
components/chart-editor/piano-roll/__tests__/sectionContextMenu.test.tsx (324)
components/chart-editor/piano-roll/__tests__/tapTempoPopover.test.tsx    (248)
components/chart-editor/piano-roll/__tests__/emptyVisibleTracks.test.tsx (132)
```

For phases A, B and C: **these pass unchanged.** If one of them requires an
edit, that is the signal the phase changed behaviour — stop and re-scope.
Phase C is the one where this gate is strong (39 contextmenu assertions);
phase A's is adequate (10); phase B's is weak, which is why phase B carries its
own reference-identity unit test.

Phase 0 and phase D **add** cases to these suites (or add a sibling suite).
That is expected and is not a signal of anything.

Browser QA after phases 0, A and C (chrome-devtools MCP per CLAUDE.md;
`new_page` first — other agents share the browser). Navigate to
`/chart-editor`, `upload_file`
`public/All Time Low - SUCKERPUNCH (Hubbubble).sng`, then exercise:

- Ruler: scrub, section click-to-seek, section drag, section right-click
  rename/delete/add, loop flag drag, loop band "Clear loop".
- Lyrics row: chip drag, phrase-edge resize, all three right-click menus,
  inline editor Enter / Escape / blur.
- Tempo lane: marker drag (ghost line + accept on release), TS chip drag,
  right-click add/delete/rephase/downbeat, tap tempo, ×2 / ÷2 preview with
  Accept and Reject.
- Note lanes: select, shift-select, drag (single and multi), sustain resize on
  guitar, place tool click and click-drag, erase paint, note right-click menu,
  Insert note.
- Marquee from each band, including a drag that crosses bands and one that
  stays inside the tempo lane (which must select markers only).
- Stacked layout: per-row marquee containment, gutter menu, wheel over the
  gutter still scrolling natively.
- Escape during each gesture kind, **including the panel-height handle**;
  undo/redo mid-gesture (the doc-identity invalidation at 3949) **including
  mid-sustain-resize**.
- `list_console_messages` clean throughout.

---

## 10. Objections considered

A contrarian review attacked the original seven-phase plan. Every factual claim
in it was verified against the working tree. All nine held. Resolutions:

| # | Objection | Verified? | Resolution |
| - | --------- | --------- | ---------- |
| 1 | The `Gesture` union has no variant for the panel-height resize, yet `resizeDragRef` was counted among the eleven refs collapsed. `pointerModeRef = 'resize'` is set from two unrelated gestures (2240, 4072), and two consumers read the conflated value with opposite requirements. Plus a live bug: Escape during a panel-height drag nulls the mode but not `resizeDragRef`, so the panel keeps resizing. | Yes, all of it | **Accepted in full.** Promoted to phase 0 (§2b) with a `'panel-resize'` mode, an explicit Escape behaviour (revert to start height), and a corrected doc-invalidation exemption. `PanelNoteResize.noteId` (`sceneTypes.ts:93`) confirms the sustain resize *does* hold a doc reference, so the old exemption was wrong. |
| 2 | `updateGesture => Gesture` can't express the tempo branch: it mutates in place, executes a command, and dispatches on every pointermove; the lyric branch uses the opposite convention; gesture branches also write `canvas.style.cursor`. So `updateGesture` needs an effects channel too, and the "one identity check" payoff evaporates. | Yes (2390–2419, 2424, 2398, 2464) | **Accepted.** Recorded as design error 2 in §7 phase F. The claimed redraw payoff was the main argument for the union; it does not survive. |
| 3 | The testability justification is mostly already satisfied — all five helpers phase 5 proposed to test are already pure exported functions with existing tests, as are six more. | Yes; verified each symbol and its test file | **Accepted, and it is the decisive objection.** §7's first "why deferred". One partial disagreement recorded on the merits: the **pointerdown routing table** genuinely is untested and is not covered by any existing pure module. That is a real gap — but it is one small extraction, not a seven-phase program, and §7 says so. |
| 4 | Phase 1's premise is disprovable: `draw()` and `panelGeometry()` compute different `stacked` and different `laneH`, deliberately. A single `PanelLayout` either returns both (fixing nothing) or changes a caller (a behaviour change in a phase that forbids them). Also four `stacked` computations, not two. | Yes — the divergence is exact as quoted; grep finds **nine** `const stacked =` bindings, more than the objection claimed | **Accepted.** Phase 1 demoted to deferred phase E, rescoped as "an explicit, tested decision about which definition wins for which caller", not a mechanical move. |
| 5 | The verification story doesn't cover the phases that need it: 9 move sequences across all five suites, covering lyric drag / marquee / mixed drag only. Zero move coverage for the eight gestures phases 5–6 rewrite. Phase 4, which needs the signal least, has the most. | Yes; counts reproduced exactly | **Accepted.** Became phase D (§6), and precondition 1 for resuming §7. §9 now states explicitly which phases have a strong gate and which do not. |
| 6 | The 1,000-line rule is a growth heuristic (`SKILL.md:95`, `:186` — "crossing… due to the PR"), not a repo budget; nine other files are over it with no plan; and phase 7's acceptance criterion was a line count, which is proxy-metric optimisation. | Yes; wording and the nine files confirmed | **Mostly accepted.** The phase-7 line-count criterion is withdrawn (§7). **Partial disagreement, on the merits:** `SKILL.md:36` also says "prefer extracting helpers… instead of letting a file sprawl past 1000 lines", so it is not purely a growth trigger. But a preference is not a budget, and it does not license this program. Recorded in §7. |
| 7 | The file is being rewritten right now by other work, and the plan is anchored to ~60 line numbers. Three commits today; 584 uncommitted lines here and 237 in `editing/` — and `editing/` is exactly where the plan said it would write. The opening claim "after the marquee work landed" is wrong: it has not landed. | Yes, all of it | **Accepted.** §1 now leads with the churn data and the uncommitted-work inventory, states that line numbers must be re-verified before use, and the false "after the marquee work landed" claim is deleted. Precondition 2 for resuming. |
| 8 | The plan defers a real user-visible bug behind five phases on purpose. `cancelInFlightGesture` omits `noteResizeRef` and `placeNoteRef`; `draw()` reads both unconditionally, so Escape leaves the preview painted. Two-line fix. Also: the plan's claim that `ghostRef` is omitted is wrong — `endPointer` doesn't clear it either, so that is parity. | Yes; `draw()` reads at 1098–1109 and 1150–1152 with no mode gate | **Accepted, and rule 7 reversed.** Now phase 0 (§2a), with jsdom cases. On `ghostRef` the objection is right about the teardown *list* but the effective behaviour still differs for place-drag (`endPointer` clears it at 2895 inside the commit branch, `cancelInFlightGesture` never does), so it is nulled in phase 0 with that reasoning in the comment. §2a records the correction. |
| 9 | Phases 5–7 do a milder version of what §5 rule 3 correctly rejects: seven files to answer "why did the tempo drag do X", up from three, and `GestureEnv` is the same near-whole-component signature used to condemn per-gesture hooks. | Yes, by construction from the plan's own interfaces | **Accepted.** Design error 3 in §7 phase F. Moot given the deferral, but recorded so a future attempt does not rediscover it. |
| — | Recommended action: defer 5, 6, 7; land 3, 2, 4 in that order; rescope 1; fix the two bugs today. | — | **Adopted essentially verbatim**, with two changes: phase D (move-time coverage) is added as real work rather than a hypothetical precondition, and phase C's dependency on phase 1 is removed by exporting the existing `panelGeometry()` return type instead of extracting a new one. |

---

## 11. Open questions

- Whether the first-frame section-width fallback in phase A is reachable at
  all. Cheap to add regardless; not worth a test if it is not.
- Whether extracting the pointerdown routing table alone — the one genuinely
  untested piece of gesture logic (§7, objection 3) — is worth doing without
  the rest of the union. Decide after phase D, with the routing table's
  behaviour actually pinned by tests.
- Phase E's `laneH` / `stacked` decision (§7). Not answered here on purpose: it
  needs the two callers read side by side against a stacked chart in the
  browser, not a guess in a plan.
