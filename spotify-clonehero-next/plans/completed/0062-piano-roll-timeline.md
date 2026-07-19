# Plan 0062: Piano-roll timeline (bottom panel) for the chart editor

Spec produced from an interactive design session (2026-07-18). Every requirement
below was either stated by Eli or explicitly approved by him; rejected
alternatives are recorded at the end. A working interactive mockup implementing
all of the interaction decisions lives at
`plans/assets/0062-piano-roll-timeline-mockup.html` (open directly in a
browser; also published at
https://claude.ai/code/artifact/1a1a425b-6d00-4cda-ada3-c1c1904b8f02). The
mockup is the reference for look and feel; this document is the reference for
requirements.

> **Relationship to plan 0061 (in-memory edits + audio-anchored tempo):** this
> plan is the UI surface for tempo-map editing; 0061 is the engine.
> **Reconciled with 0061 2026-07-18** (0061 was revised and merged with this
> plan the same day — read 0061's §3a/§3b/§8 and its appendix
> (`plans/todo/0061-appendix-research-findings.md`) for the full engine model
> this section summarizes):
>
> - Marker drags/deletes are 0061 §3a class (a) hand-edits — KEEP-MS via
>   `swapSynctrack` by default, or **KEEP-TICKS** (0061's new fourth op) when
>   this panel's glue toggle (§9) is set to "glued to grid." The toggle only
>   ever switches between these two — it has no effect on class (b).
> - Downbeat marking (§8) and the tap/bar-1-anchor gesture (0061 §6) are BOTH
>   operations on **one canonical store**, 0061's new §3b `DownbeatFlags` —
>   not two independent mechanisms. §8 below is the per-beat mark/unmark
>   operation on that store; 0061 §6 is the bulk phase-rotation operation on
>   the same store.
> - Tap-tempo/half-double (0061 §7) hosts its buttons in this panel's tempo
>   lane via a `pendingTempoCandidate` preview-state contract — spec'd
>   concretely in 0061 §7's "Panel hosting contract." See "Deferred" below.
> - **Build order:** this plan's `62-3` (tempo/downbeat editing UI) is gated
>   specifically on 0061's `61-3` (class-(a)/KEEP-MS+KEEP-TICKS remap) and
>   `61-6` (bar relabel + downbeat-flag store) — not "0061 phases 1–3"
>   generically. The full combined phase graph, including which tracks
>   parallelize, lives in 0061's new "§8. Merged build order" section; this
>   plan's own "Phasing" section below states only this plan's internal
>   phase order and cross-references that graph for the 0061-side gates.
>   Navigation/note-editing (`62-1`, `62-2`) have no dependency on 0061 at
>   all and can proceed fully in parallel with it — with one exception
>   added by the adversarial-review revision below: `62-1`'s bar-line
>   rendering consumes 0061's `61-6a` derivation module (see §4).
>
> **REVISED per adversarial review 2026-07-18 (Eli-resolved).** Fixes
> integrated in place: bar/TS derivation is denominator-aware and lives in
> a shared module (`61-6a`) that also repoints the highway `GridOverlay`
> (§4, invariant 6); tempo values are format-quantized at edit time so the
> local-drag neighbour-ms residue is bounded and non-accumulating (§7 — not
> bit-identical, since a quantized BPM is the source of truth); marker-drag
> previews
> flow through 0061 §7's `pendingTempoCandidate` channel with defined
> per-view fidelity and invalidation (invariant 5, §7); glue mode moves
> into `ChartEditorContext` (§9, invariant 1); ruler section flags are
> click-to-seek from `62-1` as the conscious mitigation for removing the
> minimap's whole-song seek (Scope, §3); a keyboard/focus-routing
> requirement is added (§12).

## Scope

One new component family (working name `PianoRollTimeline`) that replaces, in
the shared `ChartEditor` shell (`components/chart-editor/ChartEditor.tsx`):

- **`WaveformDisplay`** (bottom waveform strip) — replaced entirely.
- **`TimelineMinimap`** (right-side vertical sections minimap) — replaced
  entirely; its two jobs (section navigation, whole-song seek) move into the
  new panel's ruler. **Known, consciously accepted gap:** the minimap
  offered whole-song click/drag seek at all times; the ruler only covers
  the visible window, so when zoomed in, seeking far away means zoom-out →
  scrub (the zoom range in §3 always permits full-song visibility).
  Mitigation, required from `62-1`: ruler **section flags are
  click-to-seek** (§3), and next/prev-section navigation is retained
  (hotkeys and/or transport buttons) — so structural navigation survives
  the minimap's removal even when zoomed in. An overview strip remains
  rejected (see Rejected alternatives).

Affected pages: every `ChartEditor` host — `/drum-transcription`, `/drum-edit`,
`/add-lyrics`. Per `feedback_no_reexports`: delete the old components and update
all callsites directly; no compatibility shims.

## Two views, one store — sync invariants (hard requirement)

The highway and the piano-roll timeline are **two projections of the same
data store**. Nothing about the chart, the selection, or an in-flight edit
exists in only one of them, and there must be **no code path by which the two
views can disagree** — not "kept in sync," but _incapable of desync_ because
there is only one state and one mutation path. Concretely:

1. **One store.** `ChartEditorContext` state is the only authority:
   `chartDoc` (notes, tempos, TS, sections), `selection`, `hovered`,
   `cursorTick`, `gridDivision`, `loopRegion`, the `DownbeatFlags` store
   (0061 §3b), and `pendingTempoCandidate` (0061 §7). Playback time comes
   from `AudioManager` for both views. The glue mode (§9) is **context
   state, not panel state** — it selects which op a class-(a) tempo command
   runs, i.e. it is edit semantics: a command dispatched from any view must
   resolve it identically, so it lives on `ChartEditorContext` and the
   command reads it at dispatch. The piano roll owns **only** view
   state (scroll, zoom, follow/anchor, panel
   height) — it holds no copy of chart data, ever. If the piano roll needs a
   derived structure (beat-ms cache, peaks), it is a cache of a pure function
   of the store, invalidated by doc revision, never independently mutated.
2. **One mutation path.** Every edit from either view is an `EditCommand`
   executed by the single choke point (0061 §4). An equivalent gesture in
   the two views dispatches the **identical command type with identical
   parameters** — dragging a note on the piano roll and dragging it on the
   highway both produce the same `MoveEntitiesCommand`. Operations the piano
   roll introduces (tempo marker drag/add/delete, downbeat mark/unmark,
   cymbal switch) are defined as commands in the shared command layer, not
   inside the panel — the highway gains them for free even if it never
   surfaces UI for them.
3. **One implementation of edit semantics.** Snapping (grid lattice +
   delta-snap), lane-legality rules (kick/red can't hold cymbals), drag
   thresholds, and marquee selection semantics live in **shared pure
   modules**, called by both the highway interaction layer
   (`useHighwayMouseInteraction` / `InteractionManager.screenToTick`) and
   the piano roll's hit-testing. Where that logic currently lives inside the
   highway path, extract it to the shared module and repoint the highway
   **first, in its own commit** (per the CLAUDE.md no-duplication rule),
   then build the panel on the shared module. The panel must never contain a
   second implementation of snapping or legality.
4. **Rules enforced below the views.** Chart-validity rules (cymbal
   legality, collision handling, tick clamping) are enforced in the
   `lib/chart-edit` mutators/commands, not in per-view gesture code — so no
   view, present or future, can construct an illegal edit. View-side checks
   are UX affordances (e.g. rendering the would-be drop state), not the
   enforcement.
5. **In-flight gestures are visible to both views.** A note-drag preview
   renders through the same shared preview state the highway's drag
   uses — if it lives in context, both views render it live. A **tempo**
   gesture in flight (marker drag with its ghost line) renders through
   0061 §7's `pendingTempoCandidate` — the ONE preview channel for all
   tempo gestures, with per-view fidelity and invalidation rules spec'd
   there (panel: full fidelity every frame; highway: may throttle/defer
   the full note re-tick during the drag; any command dispatch, undo/redo,
   or chart reload clears a non-null candidate first). The commit on
   release is one command, one snapshot, one re-render for both. It is
   never acceptable for one view to show uncommitted geometry while the
   other shows committed geometry after the gesture has ended.
6. **One derivation for every derived fact.** Bar lines, bar numbering, the
   bar.beat readout, and TS chips all derive from `DownbeatFlags` via 0061
   §3b's rules (denominator-aware — beat unit is
   `resolution * 4 / denominator` ticks) in **one shared module** — this is
   0061 §8's `61-6a` task, which extracts the module AND repoints the
   highway's `GridOverlay` (which draws time-signature gridlines from its
   own derivation today, per plan 0057) onto it in its own commit, as a
   prerequisite of this plan's `62-1`. Consumed by the piano roll's
   grid/ruler, the repointed `GridOverlay`, and any readout. Beat positions
   and timed tempos come from the one `buildTimedTempos`-based cache
   (canonical home: `lib/drum-transcription/timing.ts`). If the
   two views ever disagree about where a bar line is, that is by definition
   a bug in this invariant, not a rendering detail.

## Requirements and decisions

### 1. Layout and composition

Horizontal panel docked at the bottom of the editor, full width. Vertical
stack, top to bottom:

| Band         | Height    | Contents                                                                                                |
| ------------ | --------- | ------------------------------------------------------------------------------------------------------- |
| Time ruler   | ~24px     | Bar numbers, section flags, scrub target                                                                |
| Tempo lane   | ~26px     | Tempo markers (◆ + BPM label), time-signature chips, downbeat/tempo context menus                       |
| Note lanes   | remainder | 5 rows: Kick, Red, Yellow, Blue, Green (top→bottom), alternating row tint, lane name labels pinned left |
| Waveform row | ~40px     | Drum-stem waveform, scrub target                                                                        |

- **Compact 5-lane layout** mirroring the highway (decision: chosen over
  expanded per-instrument rows and over a toggleable hybrid). Cymbal vs tom is
  encoded per-note by glyph shape within the row, not by separate rows.
- **Waveform is its own row at the bottom** (decision: chosen over
  waveform-behind-notes after comparing both in the mockup). It shares the
  panel's zoom/scroll exactly.
- **Sections integrate into the ruler** as Moonscraper-style flags (colored
  stem + name label), not a separate lane and not an overview strip (both
  rejected — see Rejected alternatives).
- **Panel height is user-resizable** via a drag handle on its top edge,
  persisted (localStorage, one key **shared across all three host pages** —
  it's one editor, one panel, one height; per-page keys would make the
  same editor feel inconsistent), with a sane default (~220–260px).
  (Decision: resizable chosen over fixed or fixed+collapse.)
- Dark editor chrome matching the existing editor pages.

### 2. View model: the x-axis is real time

The x-axis is **milliseconds, not ticks** (`x = (ms - leftMs) * pxPerMs`).
Rationale (established when tempo editing was added): the audio recording is
the fixed reference in this product — when the user edits the tempo map, the
**waveform must stay still and the grid must move**. Consequences:

- Gridlines, notes, markers are all positioned via `tickToMs` per frame (cache
  the per-beat ms positions; invalidate on tempo edits).
- A tempo edit visibly moves gridlines over a stationary waveform — this is the
  core feedback loop for tempo mapping and is intentional.

### 3. Navigation

- **Wheel scroll = zoom**, exponential, anchored at the cursor (the ms under
  the pointer stays fixed). Zoom range roughly 16× out to 15× in from a
  default where a full 3–4 minute song is visible zoomed out and individual
  1/16ths are comfortably spaced zoomed in.
- **Shift+wheel (and trackpad horizontal deltaX) = horizontal pan.** When a pan
  happens during playback, auto-follow disengages (re-engages on next play).
- **Scrubbing:** mouse-down on the **ruler** or the **waveform row** seeks the
  playhead to that position, and **dragging continues to slide it** (pointer
  capture) until release — not just a click-to-jump. Works during playback.
  Left button only. Cursor is `pointer` over both scrub zones.
- **Section flags are click-to-seek** (from `62-1`): clicking a section flag
  in the ruler seeks the playhead to that section's start. Together with
  retained next/prev-section navigation (hotkeys and/or transport buttons),
  this is the conscious mitigation for removing the minimap's always-visible
  whole-song seek (see Scope) — structural navigation stays one click even
  when zoomed in.
- **Playhead ("red line") follow behavior — catch-up model:**
  - The playhead pins at a configurable **anchor fraction** of the viewport
    (default 50%; must support values like 20% — expose as a component
    prop/setting, not a hardcoded constant).
  - Hitting play **never moves the view**. The playhead travels from wherever
    it is until it reaches the anchor x, and only then does the view scroll to
    keep it pinned.
  - Exception: if the playhead is entirely off-screen when follow engages, snap
    once to place it at the anchor.
  - Scrubbing backward during playback leaves the view still; the line sweeps
    forward until it re-reaches the anchor.
  - Manual pan/zoom pauses following; a Follow toggle (and pressing play)
    re-engages it. Mirrors the existing highway convention.

### 4. Grid rendering

Three visual tiers, brightness-separated (mockup values: bar `#59677c`, beat
`#3a4557`, subdivision `#2a3342` on `#171b24` lanes — deliberately bright; an
earlier dimmer palette was rejected as hard to see):

- **Downbeat/bar lines**: brightest, extend up through the tempo lane to the
  ruler; also drawn faintly through the waveform row.
- **Beat lines**: mid brightness, note-lane area only; hidden when beats are
  closer than ~10px.
- **Subdivision lines**: faintest; appear progressively with zoom (halves, then
  quarters of a beat) only when there is room (~46px+/beat).

Bar lines derive from **downbeat flags**, not from `tick % (4*RES)` — see §8.
The derivation module (0061 `61-6a`, denominator-aware) is a prerequisite of
`62-1`'s grid rendering — the panel must not carry its own TS→bars logic,
even as an interim.

### 5. Note rendering

- Colors per lane (kick orange, red/yellow/blue/green as on the highway).
- Glyphs: **toms and kick = rounded rectangles** (kick has no special wide
  shape — decision), **cymbals = triangles**. Same glyph vocabulary at every
  zoom level.
- **Zoom-adaptive width** (decision: same shapes squished horizontally, not a
  separate "density bar" mode): glyph width tracks the on-screen 1/16 spacing,
  clamped to [1.5px, glyph height]. Zoomed out, notes become thin slivers that
  still read as density-with-color; zoomed in they are full glyphs.
- Selection: bright white rounded halo behind the glyph. Hover: dimmer halo +
  `grab` cursor. Selection state is **shared with the highway** (same
  `selection` map in `ChartEditorContext`).

### 6. Note editing (full parity with the highway — decision)

The panel uses the same command objects (`MoveEntitiesCommand`, add/delete
commands) and the same selection/hover context state as the highway. Editing
requirements, all mockup-verified:

- **Drag a note** to move it: horizontal snapping to the current
  `state.gridDivision` (the mockup's fixed 1/16 stands in for this), vertical
  movement across lanes. Existing 5px drag threshold convention applies (click
  ≠ drag).
- **Multi-selection drag moves in time only** — lanes are locked when more
  than one note is selected (decision).
- **Delta-snapping** (decision, explicitly confirmed): the drag snaps the
  _offset_, preserving each note's relative position — an off-grid note stays
  off-grid relative to its neighbors; the anchor point snaps to the grid.
- **Box-select:** dragging on empty lane space draws a marquee; notes inside
  (time range × lane range) are selected live. Shift+drag adds to the existing
  selection; shift+click toggles single notes; plain click on empty clears.
  **Marquee/drag/scrub may only start from a left-click** — right-click never
  initiates any drag (decision, was a mockup bug).
- **Lane legality:** Kick and **Red can never hold cymbals**. Dragging a
  cymbal onto either lane converts it to the rectangle/tom form, and the
  cymbal flag is destroyed (dragging back off does not restore it).
- **Click-to-add with the active tool, erase tool, hover states** — same tool
  behaviors as the highway (part of the full-parity decision). Not
  mockup-prototyped; implement against the existing tool/command
  infrastructure.
- **Sections and tempo markers are draggable along the timeline** (part of the
  Q4 "also drag sections/tempo" decision). Section drag moves the section
  event (grid-snapped); tempo marker drag is §7.

### 7. Tempo editing

Model and interactions (the design session drew on the ReaBeat DAW plugin's
tempo-mapping UX as prior art, adapted from its per-beat model to sparse
markers per Eli's direction — this is attribution only; every requirement
below is stated in full and self-contained, no external reference needed to
implement it):

- **Sparse tempo markers only.** A ◆ marker exists only where the tempo
  changes. There are **no per-beat handles** (rejected: an earlier prototype
  with a draggable handle on every beat).
- Each marker is conceptually `{tick, ms}`; the **BPM of each segment is
  derived** from the gap to the next marker (`Δbeats / Δms`). **BPM labels
  render only at markers** — never per beat/measure (decision).
  **Format quantization (0061 §2's invariant):** the derived BPM is
  quantized to the document format's representable value (`.chart`
  milli-BPM, `.mid` integer µs/beat) at edit time, and the marker's ms is
  recomputed from the quantized BPM — so the in-memory map is exactly what
  serializes, and round trips are lossless.
- **Drag a marker horizontally** to refit the grid to the audio: the marker's
  ms changes; the BPM of the two adjacent segments recalculates; **neighboring
  markers barely move** (local edit, no ripple — ReaBeat's model). The source
  of truth is a format-quantized BPM, not an exact ms, so bit-identity is
  unattainable; the honest guarantee is that **each neighbour's ms residue is
  bounded by one BPM-quantization step per edit and does not accumulate across
  repeated drags of the same marker** (each drag re-derives from the current
  ms, and `applyMarkerMoveBpms` derives the far segment's BPM from the dragged
  marker's _re-integrated_ landing so the near segment's residue never leaks
  onto the far neighbour). The only other deviation is a one-time sub-ms snap
  of the dragged marker itself to the nearest format-representable BPM. A dashed
  ghost line shows the original position during the drag; the in-flight
  remap preview renders through `pendingTempoCandidate` (0061 §7 — the one
  preview channel for all tempo gestures, with its per-view fidelity and
  invalidation rules). Minimum segment
  length enforced. Marker 0 (song start anchor) cannot be dragged or deleted.
- Generous hit radius (~10px) and hover glow, `ew-resize` cursor (ReaBeat
  widened hit targets deliberately; keep that).
- **Context menu on the tempo lane** (right-click):
  - On empty lane: **"Add tempo marker here"** — inserts at the nearest beat,
    positioned _on the current tempo line_ so the mapping is unchanged until
    the user drags it. Disabled if a marker already exists on that beat. Plus
    the downbeat item (§8).
  - On a marker: **"Delete tempo marker (⟨BPM⟩)"** — removes it; the mapping
    becomes linear between its neighbors, with the note-glue policy applied
    (§9).
- Engine: these are 0061 §3a **class (a) hand-edits** — the remap runs
  KEEP-MS via `swapSynctrack` semantics per 0061 §3, or KEEP-TICKS when the
  glue toggle (§9) is set to "glued to grid" (0061 §3a's fourth op). This
  panel does not implement its own remap math — only the drag gesture and
  the glue-mode read that selects which of the two ops the drag command
  invokes.

### 8. Downbeats and time signatures

Decision: **both explicit TS events and a mark-downbeat gesture**, where
downbeat-marking is the primary gesture and TS events are the derived,
persisted output (matches the .chart format's TS events). **Engine model:
this is the panel's entry point into 0061's §3b `DownbeatFlags` store** — the
data model, load/save derivation rules, and the exact operation this
context menu performs (a single-entry insert/remove into
`downbeats`) are specified in 0061 §3b; this section states only the
panel-side interaction.

- Beats carry a **downbeat flag** (0061 §3b's `DownbeatFlags.downbeats` —
  entries of `{tick, denominator}`, since the beat unit is
  denominator-scaled); bar lines, bar numbering, and the bar.beat position
  readout all derive from it.
- **Context menu on the tempo lane**: "Mark as downbeat" / "Remove downbeat"
  for the nearest beat — inserts/removes one entry in `downbeats` (0061
  §3b; a new entry inherits the nearest preceding TS event's denominator).
  Beat 0 is always a downbeat and is never removable.
- **Time-signature chips** (e.g. `4/4`, `7/4`, `6/8` — the denominator is
  real, not always 4) render in the tempo lane at each point where the
  derived meter (numerator = beats between consecutive downbeats, in that
  region's denominator-scaled beat unit; denominator carried through)
  changes — this is 0061 §3b's save-direction derivation rule, computed live
  for display, not a separate calculation. Persisted as TS events in the
  chart via that same derivation.
- A "this beat is bar 1" phase-rotation (0061 §6's tap/rephase gesture,
  whole-song by design) is
  the **bulk** counterpart to this section's **single-beat** mark/unmark —
  both operations write the same `DownbeatFlags.downbeats` array (0061
  §3b), so they compose correctly regardless of which one the user reaches
  for; the mark/unmark is the right tool for a genuinely local mid-song
  meter change, the tap for a global phase mislabel. No separate verification affordance is needed for either — 0061 §6
  notes that this panel's own grid rendering (§4 above: brightest lines for
  downbeats/bars) already serves that purpose live.

### 9. Note anchoring under tempo edits ("glue")

Decision: **mode toggle, defaulting to audio-glued.** **This toggle is what
motivated adding a fourth op to 0061's engine framework** — see 0061 §3a for
the full four-op table and §3a's "Glue toggle scope note."

- **Glued to audio (default):** when the tempo map changes, notes keep their
  real-time position against the recording; their ticks are recomputed —
  this is 0061's **KEEP-MS** op, including its quantize/abstain and
  collision-nudge rules. Right default because transcribed hits are where
  the drummer played them.
- **Glued to grid:** notes keep ticks and ride the moving gridlines (classic
  DAW/Moonscraper behavior) — this is 0061's new **KEEP-TICKS** op (plain
  `retimeChart`, no re-quantization), for when the map is trusted and the
  user is authoring.
- The toggle is a visible control on the panel ("Notes: glued to audio /
  grid"), applies to marker drags **and** marker deletes symmetrically.
  **The mode itself lives on `ChartEditorContext`** (invariant 1: it is
  edit semantics — it selects the op a class-(a) command runs — so any
  view that ever dispatches a tempo command must resolve it identically;
  the command reads it from context at dispatch, the panel merely renders
  the control). **Persistence: not persisted** — it resets to
  audio-glued on every load. Deliberate: glued-to-grid silently moves
  transcribed notes off the audio, and a mode saved weeks ago is a
  foot-gun; the authoring user flips one toggle per session.
  **Scope (resolved in 0061 §3a):** this toggle only ever switches between
  KEEP-MS and KEEP-TICKS on **class (a)** edits (marker drag/delete — both
  hand-edits to the tempo map). It has **no effect** on a class (b)
  structural correction (§7 of 0061, the half/double/tap-tempo control) —
  that class's op choice (RE-PREDICT, with RESNAP as its only fallback) is
  governed entirely by decoded-onset availability, never by this toggle.

> **Post-landing revision (2026-07-18, Eli).** After QA of the landed feature,
> three UI surfaces spec'd above were removed or reframed (behavior/engine
> unchanged — these are UI-only revisions):
>
> - **Glue toggle removed from the UI (§9).** The panel is now always
>   audio-glued (KEEP-MS). `tempoGlueMode` still lives on `ChartEditorContext`
>   (defaults to `'audio'`, still settable via `SET_TEMPO_GLUE_MODE`) and all
>   glue-aware commands are unchanged — there is simply no visible toggle. The
>   grid-glued (KEEP-TICKS) path stays reachable in code only.
> - **Anchor-fraction dropdown removed (§3).** The playhead follow anchor is
>   code-level config only now (`followAnchor` prop, default 20%); no
>   user-facing control.
> - **Downbeat menu reframed as primary (§8 / 0061 §6).** The tempo-lane menu
>   leads with **"Make this beat 1 (rephase song)"** → the whole-song
>   `RephaseDownbeatsCommand` (disabled when the beat is already bar-aligned,
>   since phase 0 is a no-op), because the phase error is global. The local
>   mark/unmark op is kept as the secondary **"Insert / Remove time signature
>   change"** item for the rare true mid-song meter change. No new engine logic.
> - **Waveform source selector added (§11).** The waveform row's audio source
>   (drum stem / full mix / any AudioManager stem) is now user-selectable via a
>   right-click radio menu + a corner chip; default is the drum stem when
>   present, else the mix. Selection is session-only panel view-state (no
>   project id reaches the panel).

### 10. Context menus (general)

- Custom positioned menu (shadcn/Radix `ContextMenu` or equivalent), opened
  only by right-click; `contextmenu` default prevented on the canvas.
- Right-click **never** scrubs, drags, or starts a marquee (decision).
- **Note context menu**: right-click a note →
  - **"Switch to cymbal" / "Switch to tom"** — toggles the cymbal flag.
    Only offered when at least one target is on a cymbal-legal lane
    (Yellow/Blue/Green); label reflects the common state.
  - **"Delete note"** / **"Delete N notes"**.
  - **Selection-aware:** if the clicked note is in the current selection, the
    action applies to the whole selection; otherwise the click first selects
    just that note.
  - Extensible for other flag edits later (accents, ghosts…).
- Tempo-lane menus per §7/§8.
- Opening any menu is dismissed by click-elsewhere or Escape; starting any
  new pointer interaction closes it.

### 11. Waveform row

- Renders the **drum stem** (the audio the transcription came from), peaks
  precomputed per zoom bucket (the existing `WaveformDisplay` peak approach,
  re-derived for a pannable/zoomable time window).
- Scrub target exactly like the ruler (§3).
- Bar lines faintly continue through it for alignment reading; the played-
  portion shading of the old component is not required (playhead line
  suffices).

### 12. Keyboard and focus routing

The panel must not carve a hole in the editor's existing keyboard story:

- **Panel focus never breaks editor hotkeys.** With focus on (or pointer
  over) the panel canvas, the existing editor shortcuts — grid-division
  changes, tool switching, undo/redo, play/pause — keep working exactly as
  they do with the highway focused.
- **Delete** removes the current selection (the shared selection — same
  command as from the highway) and **Escape** clears an open context menu,
  then an in-flight gesture, then the selection, when the panel has focus.
- Eventual home for bindings is the hotkey-registry plan (0036); until it
  lands, the minimum requirement above holds — route or bubble key events
  so the existing handlers fire, don't swallow them in the canvas.

## Rejected alternatives (do not revisit without new input)

- Expanded per-instrument lanes (9 rows) and a compact/expanded toggle.
- Waveform drawn behind the note lanes (Variant A in the design session).
- Separate section lane; whole-song overview/navigator strip.
- BPM values printed in the ruler; a tempo-graph (BPM-vs-time) lane.
- Per-beat draggable tempo handles (first tempo prototype).
- Density "bar mode" for zoomed-out notes (distinct glyph set at low zoom).
- Page-flip playback follow; jump-to-anchor on play.
- Fixed-height panel.
- Different glyph for kick (wide bar).
- Numeric-first tempo editing (type BPM values as the primary interaction).
  Double-click-to-type may still arrive later as a secondary affordance.

## Architecture and integration

- **Rendering:** single `<canvas>` 2D, DPR-aware, `ResizeObserver`-driven.
  Redraw on a rAF loop only while playing (reading
  `audioManager.currentTime`/`chartTime` as the timing authority — the same
  authority `WaveformDisplay`/`TimelineMinimap` read); event-driven redraws
  otherwise. Note this is a **deliberate behavior change** from those
  components, which run their rAF loops unconditionally — the panel is
  bigger and denser, so idle frames are not free. No
  THREE.js — this panel is 2D and dense; canvas 2D is sufficient and simpler.
  Heavy ML/DSP stays in workers per `feedback_web_worker_for_ml`; this
  component does no such work (peak computation for long songs may move to a
  worker if profiling demands).
- **State:** `ChartEditorContext` for chart doc, selection, hover, tool,
  `gridDivision`, loop region, glue mode (§9), `pendingTempoCandidate`
  (0061 §7) — no new stores (no zustand). View-local state
  (leftMs, pxPerMs, follow, anchor fraction, panel height) lives in
  the component; one-way data flow, same hybrid-interaction philosophy as the
  highway (`feedback_hybrid_interaction`): the canvas hit-tests, React
  decides, commands mutate.
- **Commands:** all edits (note move/add/delete, cymbal toggle, section move,
  tempo marker add/move/delete, downbeat toggle) go through the existing
  command/undo stack — one command per gesture, batch for multi-note
  operations. No `dispatch` inside setState updaters
  (`feedback_no_dispatch_in_setstate_updater`).
- **Timing math:** reuse `buildTimedTempos`/`tickToMs`/`msToTick`
  (`lib/drum-transcription/timing.ts` — a single file, and the **canonical**
  tick↔ms home for the shared beat-ms cache; `lib/chart-utils/tickToMs.ts`
  is a second existing home to be reconciled onto the canonical one during
  the shared-module extraction, one implementation + callsite update)
  and 0061's remap primitives
  (`lib/tempo-map/swap-synctrack`, `retimeChart`). Do not fork tick↔ms logic
  into the component; pure view-math helpers (visible-range, beat-position
  cache) live in a testable non-React module
  (`components/chart-editor/piano-roll/`), while **edit semantics (snapping,
  lane legality, marquee range selection) live in the shared modules of the
  "Two views, one store" section** — extracted from the highway path first,
  in its own commit, then consumed by both views.
- **Removal:** delete `WaveformDisplay.tsx` and `TimelineMinimap.tsx`;
  `ChartEditor.tsx` drops the right-side minimap column and mounts the new
  panel in the bottom bar (inside/alongside `TransportControls`).

## Deferred (candidates from ReaBeat, explicitly not in scope now)

- Snap dragged tempo markers to nearby audio transients (±30ms onset search).
- Gap/confidence highlighting (red tint where beat spacing > 1.35× median;
  suggested-beat lines at strong transients; "N = jump to next gap").
- Tap-tempo and half/double controls (0061 §7 owns the op logic; this panel
  hosts them via the concrete contract in 0061 §7's "Panel hosting contract"
  — a button/gesture slot in the tempo lane plus a `pendingTempoCandidate`
  preview-state field on `ChartEditorContext` that this panel and the
  highway both render from when non-null. The slot and state field are pure
  plumbing and can be built ahead of 0061's `61-7` landing — see 0061 §8's
  merged build order; only the op logic behind the buttons is gated).
- Editable BPM via double-click on a marker.
- Lyrics/vocals lane for `/add-lyrics`.

## Testing

Jest for all non-React logic (`pnpm test`):

- Marker model: segment-BPM derivation, **format-quantized at edit time**
  (derived BPM is `.chart` milli-BPM / `.mid` µs-per-beat representable;
  write→parse changes no tempo value); tick↔ms piecewise mapping incl. tail
  segment; local-only drag invariants (neighbour-ms residue **bounded by one
  BPM-quantization step per edit and non-accumulating** across repeated drags
  of the same marker — not bit-identical, since a quantized BPM is the source
  of truth; the dragged marker itself may snap sub-ms once); add-on-line is
  mapping-neutral; delete linearizes between neighbors; min-segment clamping.
- Glue: audio-glued edit preserves note ms (within remap tolerance, per
  0061's property tests); grid-glued edit preserves ticks.
- Downbeats/TS: bar derivation from flags in denominator-scaled beat units;
  meter-change chip positions; TS-event emission with denominators carried
  through (6/8 and 7/8 fixtures round-trip load→save byte-identically, never
  rewritten as /4); newly marked downbeat inherits the preceding TS event's
  denominator; beat-0 invariants.
- Snapping: delta-snap preserves relative offsets; gridDivision honored;
  lane clamping and cymbal-legality on drop.
- View math: zoom-anchor invariance (ms under cursor fixed), visible-range,
  catch-up follow state machine (incl. off-screen snap case and anchor
  fractions 0.2/0.5).
- **View-parity tests (the "Two views, one store" invariant):** for each
  gesture available in both views, a test asserting the piano-roll
  interaction layer and the highway interaction layer produce the identical
  command (type + params) from equivalent inputs; shared-semantics module
  tests run once and serve both views (snapping, legality, marquee); a
  bar-derivation test asserting the piano-roll ruler and the highway
  `GridOverlay` consume the same `DownbeatFlags`-derived bar list (one
  function, called twice, same output — not two lists compared for
  approximate equality).
- Per `feedback_unit_tests_for_edge_cases`: every real-chart edge case found
  during implementation gets a test.

Browser validation per CLAUDE.md (chrome-devtools MCP): scrub/zoom/drag flows,
section-flag click-to-seek, context menus, editor hotkeys still firing with
the panel focused (§12), no console errors, canvas renders on all three host
pages.

## Phasing

This plan's phases, in this plan's own internal order. **For the full
combined dependency graph against 0061's engine phases (which of these run
in parallel with 0061, which are gated, and on exactly which 0061 phase),
see 0061's "§8. Merged build order" — that section is the authoritative
sequencing for a workflow to execute; this list only states this plan's
internal steps.**

1. **Read-only panel (`62-1`):** layout bands, time-based view,
   grid/notes/waveform rendering, zoom/pan, scrub, catch-up follow, section
   flags incl. click-to-seek (§3 — the minimap-removal mitigation ships
   with the removal, not after). Replaces `WaveformDisplay` +
   `TimelineMinimap`. One 0061-side prerequisite: `61-6a`'s denominator-
   aware bar-derivation module (0061 §8 Group A) for the grid's bar lines
   — everything else starts immediately, in parallel with 0061's own
   phase 1.
2. **Note editing (`62-2`):** shared selection, drag/marquee/delta-snap, lane
   rules, note context menu, click-to-add/erase parity. **Starts with the
   shared-semantics extraction** (snapping/legality/marquee out of the
   highway path, highway repointed, own commit — "Two views, one store" §3),
   then builds the panel gestures on those modules. Needs `62-1` only;
   no 0061 dependency — can finish anytime before phase 3, fully in parallel
   with 0061.
3. **Tempo/downbeat editing (`62-3`):** marker render + drag + menus,
   downbeat/TS chips, glue toggle. Gated on 0061's `61-3` (class-(a)
   KEEP-MS/KEEP-TICKS remap) AND `61-6` (bar relabel + downbeat-flag store)
   — see 0061 §8, not "0061 phases 1–3" generically. This is the single
   pinch point where the two plans converge.
4. **Polish (`62-4`):** resizable height persistence, anchor-fraction
   setting surface, section dragging, perf pass on long charts. Needs `62-3`
   done; independent of 0061's remaining phases (`61-5`/`61-7`/`61-8`).
