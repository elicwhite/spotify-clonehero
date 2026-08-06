# 0083 — Tap tempo

Status: todo

Owner ask (verbatim): "We need to add a tool that you can tap any key to
calculate a bpm. Perhaps this should just be a tool you get to from right
clicking on the tempo track. It'll need a more complex tooltip/popover UI as
you want to be able to tap along to the song at the point you right clicked at,
and you need a way to reset the tap to click calculated bpm so you can start
tapping again. We need one decimal of bpm in the UI."

Scope: tap tempo only. Two adjacent items that an earlier draft bundled here
have been split into their own plans, because they share no code with this one
beyond the file they happen to live in:

- `plans/completed/0086-piano-roll-wheel-listener.md` — the
  `Unable to preventDefault inside passive event listener invocation` warning.
- `plans/todo/0085-tempo-lane-marquee.md` — rubber-band selection across the
  tempo track.

Nothing in this plan depends on either.

**On line numbers.** `PianoRollTimeline.tsx` is ~4,000 lines and is being
decomposed by a separate in-flight effort. Every citation below is
`file:symbol`, with a line number only where it pins an exact expression. If a
line number does not match, grep the symbol; the symbol is the durable
reference.

---

## 1. The problem, with evidence

### There is no way to enter a BPM by ear

Everything the tempo lane offers today either moves an existing marker or
re-derives the map from audio:

- `buildTempoMenu` (`components/chart-editor/piano-roll/PianoRollTimeline.tsx`)
  offers `Double tempo (×2, re-predict)`, `Halve tempo (÷2, re-predict)`,
  `Make this beat 1 (rephase song)`, `Add tempo marker here`, `Make this a
downbeat`, and the two removal items. Every one of them is fire-and-close:
  `ContextMenuPopover` runs `item.onSelect()` and then `onAfterSelect`, which
  `PianoRollTimeline` wires to `closeMenu`.
- `AddTempoMarkerCommand` (`components/chart-editor/commands.ts`) inserts a
  marker _on the current tempo line_ — deliberately mapping-neutral. It gives
  you a handle to drag; it cannot give you a number.
- `AddBPMCommand` (`commands.ts`) is the only command that types a BPM at a
  tick, and it has **no UI caller in the piano roll at all** today. Its doc
  comment still refers to "the highway BPM popover".
- Dragging a marker (`MoveTempoMarkerCommand` → `applyMarkerMoveBpms`,
  `lib/chart-edit/tempo-remap.ts`) derives BPM from where you drop the marker.
  That is the right gesture for nudging a marker onto a downbeat; it is a
  terrible way to say "this passage is 148.5 BPM".

A tap-tempo control existed once and was deleted:
`lib/tempo-map/structural-correction.ts:5` records "tap-tempo was removed in
plan 0063 Round 2 §6 — ×2/÷2 covers the correction need without a manual tap
gesture". The removed implementation is recoverable at
`git show 49b1dc3^:spotify-clonehero-next/lib/tempo-map/structural-correction.ts`
(49b1dc3 is "Opus-at-rest storage, vocals stem, and lyrics editing (plan
0063)", consistent with that comment) and is worth reading before starting,
mostly as a list of what not to repeat:

```ts
export function fitTapTempo(tapMs: readonly number[]): TapTempoFit {
  const sorted = [...tapMs].sort((a, b) => a - b);
  const span = sorted[sorted.length - 1] - sorted[0];
  const period = span / (sorted.length - 1);
  return {bpm: 60000 / period, phaseMs: sorted[0]};
}
```

Its comment claimed the mean interval is "robust to a jittery middle tap".
That is exactly backwards: `span / (n - 1)` telescopes and therefore depends on
**only the first and last tap**. Every tap in between is discarded; a single
late final tap moves the answer by the full error. (This argument rules out
`span/(n-1)`. It says nothing about a local mean-of-intervals estimator, which
is a different thing and is addressed in §4 alternative 2.) Its output also fed
a whole-song constant-BPM `Synctrack` into RE-PREDICT — a structural
correction, not a local edit. The owner is asking for something narrower and
more useful: a BPM at a point.

---

## 2. Core decisions

### D1 — The tap tool opens from the tempo lane's menu, into the same popover

A menu item `Tap tempo…` is added to `buildTempoMenu`. Selecting it does not
close the menu; it **replaces the menu's contents in place**.

`ContextMenuPopover` already supports this: it takes either `items` or
`children` ("Rendered instead of `items` — for a step that replaces the list in
the same popover, such as an inline confirm"), and its flip-to-fit layout
effect already re-measures when `children` changes (dep list
`[anchor, x, y, items, children]`). The Chart Matrix's inline confirm is the
precedent.

So `MenuState` grows a discriminated content field:

```ts
type MenuContent =
  | {kind: 'items'; items: MenuItem[]}
  | {kind: 'tap'; anchorTick: number; anchorMs: number};
interface MenuState {
  x: number;
  y: number;
  content: MenuContent;
}
```

Anchoring: the popover keeps the coordinates of the original right-click, so
the tap UI appears exactly where the user asked for it. It grows downward and
`computeContextMenuPlacement` flips it if it does not fit — free.

**No change to `ContextMenuPopover`.** `onAfterSelect` is supplied by the call
site, so the call site guards it:

```tsx
onAfterSelect={() => setMenu(m => (m?.content.kind === 'tap' ? m : null))}
```

The `Tap tempo…` item's `onSelect` swaps `content` to `{kind: 'tap', …}`; the
updater above then sees the new content and leaves the menu open. Every other
item leaves `content.kind === 'items'` and still closes. This keeps a component
shared with the Chart Matrix untouched — no new prop to document, gate and
test.

**Alternatives rejected.** (a) A separate floating panel or dialog: loses the
anchor at the tapped position, and the editor already retired its floating
tempo controls into this menu. (b) A sidebar card: too far from the lane, and
the anchor tick would have to be carried across the app. (c) A `<Dialog>`:
modal focus trapping fights "any key is a tap" and blocks watching the
playhead.

### D2 — Dismissal: Escape and Cancel only, for the whole tap session

`useDismissOnOutsidePointerDown(menu !== null, closeMenu)` closes the menu on
the next pointerdown anywhere outside. For a fire-and-close item list that is
right. For a session holding 20 taps it is a trap: one stray click on the
canvas and the work is gone.

Rule: while `menu.content.kind === 'tap'`, outside-pointerdown dismissal is
suppressed **unconditionally** — the argument passed to
`useDismissOnOutsidePointerDown` becomes
`menu !== null && menu.content.kind !== 'tap'`. `handlePointerDown`'s
unconditional `setMenu(null)` ("Any new pointer interaction dismisses an open
menu") gets the same guard, reading a `menuKindRef` kept in sync with `menu`
(that path reads refs, not state).

Escape (which `resolveEscapeTier` already routes to tier `'menu'`, closing the
menu and `stopPropagation`-ing so the global clear-selection hotkey does not
also fire) and the popover's own `Cancel` button always close. There is no
hidden persistence: closing discards the taps, and the popover says so on the
Cancel button's title.

**Why unconditional rather than "only once the session has a tap".** Gating on
tap count requires the tap count to be readable from `PianoRollTimeline`, which
means lifting the session out of `TapTempoPopover` or mirroring it in a ref —
a second source of truth for a value D6 deliberately keeps in one place. Worse,
`useDismissOnOutsidePointerDown` arms with `{once: true}` behind a
`setTimeout(0)`, so toggling its `open` argument **re-arms** it: pressing Reset
(D8: taps cleared, popover stays) would silently re-enable one-click dismissal
at exactly the moment the user is about to start tapping again. The cost of the
unconditional rule is that an empty tap popover needs Escape or Cancel rather
than a click-away. That is one extra keystroke in the least consequential case,
against a trap in the most consequential one.

### D3 — "Tap any key", with a target check and a keyboard-operable popover

While the tap popover is open it installs a `keydown` listener on `window` in
the **capture** phase — the same trick the panel already uses for Escape, and
the reason it works is documented there: window-capture runs before the hotkey
registry's document listener.

The handler runs three checks in order.

**1. Bail entirely (do nothing, do not preventDefault, do not stopPropagation)
when:**

- `isEditableTarget(e.target)` — the target is an `input`, `textarea`,
  `select`, or `[contenteditable]`, or is inside one. The piano roll's own
  `inlineTextEditor` `<input>`, the Song Details dialog's fields and the
  track-name fields are all reachable while the tap popover is open, because D2
  suppresses outside-pointerdown dismissal. Without this check, typing a lyric
  would produce no text and a 60 BPM estimate.
- the target is inside the popover **and is not the tap pad** (below). This is
  what makes Accept / Reset / Cancel / Play reachable by Tab and activatable by
  Enter and Space, rather than swallowing the activation as a tap.
- `e.key` is `Escape` or `Tab`, or is a bare modifier (`Shift`, `Control`,
  `Alt`, `Meta`), or any of `ctrlKey / metaKey / altKey` is set. Escape stays
  live so the panel's Escape tier and any surface using `useDismissOnEscape`
  still work — a capture-phase `stopPropagation()` on every key would disable
  that shared hook app-wide. Modified chords (Mod+S, Mod+Z) are deliberately
  let through unchanged; swallowing every combination would silently break
  save.
- `e.repeat === true` — a held key must not machine-gun taps.

**2. Otherwise it is a tap.** Record it, then `preventDefault()` and
`stopPropagation()`, so no editor hotkey fires: not Space (play/pause), not
`1`/`2` (tool), not the lane keys.

**The tap pad.** The popover renders a focusable tap surface
(`<button type="button" data-tap-pad>` with an explicit accessible name, "Tap
here — or press any key") and focuses it on open. Focus starting there means
the first Space or Enter is a tap, which is what someone who opened a tap tool
expects; Tab moves focus to the real controls, at which point Enter and Space
activate them normally, and Shift+Tab comes back. `isEditableTarget` lives in
`lib/dom/isEditableTarget.ts` with its own tests, because it is small, pure,
and the sort of thing that otherwise gets copied.

**Rejected:** relying on the hotkey registry's `ignoreInputs` guard
(`ChartEditorContext.tsx` sets `defaultOptions={{hotkey: {ignoreInputs: true}}}`)
by rendering a focused read-only `<input>` as the tap target. It makes the
mechanism invisible and depends on `document.activeElement` surviving every
click inside the popover, and it does not solve the "focus is on Accept"
problem at all.

### D4 — Taps are timestamped from `event.timeStamp` and scaled by the playback rate

The session records `event.timeStamp` for each tap. `timeStamp` on a
`KeyboardEvent` is stamped by the browser at input time, in the
`performance.now()` timebase, so it carries no event-loop dispatch latency.
That matters here: this component runs a per-frame canvas draw loop
(`drawRef.current(...)` fires on every wheel, drag and rAF), and under a long
task, dispatch latency is tens of milliseconds and is right-skewed, not
zero-mean.

Wall time has to be converted to song time, because at 0.75× playback one
wall-second is 0.75 song-seconds and a BPM fitted from wall time would be wrong
by exactly the rate. `AudioManager` already exposes the scalar:
`getCurrentTempo()` (`lib/preview/audioManager.ts`) returns
`#tempoConfig.tempo`, the same multiplier `#rawCurrentTime` integrates. Song
period is wall period times the rate, so:

```ts
bpmSong = bpmWall / rate; // rate = audioManager.getCurrentTempo()
```

(At 0.75×, a 500 ms song beat takes 667 ms of wall time; 60000/667 = 90 wall
BPM; 90 / 0.75 = 120. Divide, not multiply.)

The fit function takes `rate` as an argument and is pure. The component passes
`audioManager.getCurrentTempo()` at fit time.

**Rate changes mid-session reset the taps** (and the popover says so). The
alternative is per-interval scaling, which needs a rate history and is
unjustifiable for a control that shows the current speed right next to the
readout. Changing speed mid-tap is a deliberate act, unlike pressing
play/pause.

**Rejected: timestamping against the audio clock.** An earlier draft added
`get rawChartTime()` to `AudioManager` and read it inside the keydown handler,
on the theory that the audio clock is rate-correct for free. Three problems.
(a) Reading the clock inside the handler samples it *after* dispatch, so it
reintroduces exactly the skewed latency `event.timeStamp` avoids. (b)
`#rawCurrentTime` returns `0` whenever `#startedAt < 0` and does not advance
while paused, so tapping a BPM you already know — with the transport stopped —
needs a wall-clock path anyway, and the session then has two clocks and a rule
for switching between them. (c) That rule was "reset the taps when
`isPlaying` changes", which directly contradicts D5's Play/Pause button:
pressing the transport control the popover ships would destroy the session.
A single wall clock plus one scalar removes the accessor, the phase, the test,
the dual-clock rule and the contradiction.

### D5 — Opening the tap tool does not move the playhead; a Play button seeks to the anchor

The owner's ask is to "tap along to the song at the point you right clicked
at", so the anchor and the audio have to be brought together. The popover ships
a transport control:

- While stopped: **`Play from 40.1`** (the anchor's `bar.beat`). It calls
  `audioManager.playChartTime(anchorMs / 1000)` — the existing
  seek-and-play path — and turns into **Pause**.
- While playing: **Pause**, which calls `audioManager.pause()`. Pressing Play
  again resumes from wherever the playhead now is; it does not re-seek, so
  pause/resume mid-take is non-destructive. A separate **Restart from anchor**
  affordance is not added; closing and reopening the tool is the same gesture,
  and Reset is right there.

Merely opening the popover does **not** seek. A right-click that silently
throws away the user's playback position is worse than a labelled button, and
the anchor is visible in the button's own label, so the anchor/playhead
disagreement the button exists to close is legible before it is pressed.

**Rejected: a pre-roll** (seek to `anchorMs - 2000` so the user has a run-up).
Only the BPM is fitted, never the phase (§7), and the `n < 3` gate already
discards the first two taps' reaction-time transient, so a run-up buys nothing
and makes the button's label a lie.

This is also why Space must not reach the global play/pause hotkey (D3): the
transport is reachable from the popover instead.

### D6 — The estimator: integer beat indices + least-squares, in a pure module

New file `lib/tempo-map/tap-tempo.ts` (next to `structural-correction.ts`,
where the deleted fit lived), tests in
`lib/tempo-map/__tests__/tap-tempo.test.ts`. No React, no chart, no audio.

Model: tap `i` lands at time `t_i` on beat index `k_i`, with
`t_i ≈ phase + period · k_i`.

**Push-time guard (per tap, in `pushTap`).**

- **Double strike.** A tap less than `0.5 · P0` after the previous tap (where
  `P0` is the current median interval, or the previous interval when there are
  only two taps) is **discarded and not recorded**. Two fingers landing
  together is an input artefact, not data, and dropping it at push time is what
  keeps beat indices strictly increasing for the fit.
- **Pause.** A gap since the previous tap greater than
  `max(2500 ms, 4 · P0)` clears the prior taps and restarts the session from
  this tap. Rejected alternative: keep the taps and let the index assignment
  give a large `k` across the gap — mathematically fine, but a long pause
  almost always means "I lost it", and silently folding a pre-pause bar into
  the fit is the opposite of what the user intends.

**Fit (over every recorded tap in the session).**

1. **Seed period.** `P0 = median` of consecutive intervals. The median, not the
   mean: it is unaffected by one dropped or doubled tap.
2. **Beat indices.** `k_i = round((t_i - t_0) / P0)`, `k_0 = 0`. This is what
   makes a _missed_ tap harmless — skip a beat and that tap gets `k = 2` rather
   than corrupting the period. The push-time double-strike guard is what
   guarantees `k` is strictly increasing here, so this step has no failure
   branch of its own.
3. **Least squares.** Regress `t` on `k`:
   `period = Σ(k-k̄)(t-t̄) / Σ(k-k̄)²`. Every tap contributes, unlike
   `span/(n-1)` (§1).
4. **One outlier drop.** With `n ≥ 5`, compute residuals
   `r_i = t_i - (a + period·k_i)`; if `max|r_i| > max(0.15·period, 40 ms)`,
   drop that single tap, recompute indices and refit once. Exactly one drop per
   fit — an iterative trimmer that can eat half the taps is unpredictable to a
   user who can see the number move. This is a fit-level operation and never
   interacts with the push-time guard, which has already run.
5. **Rate.** Divide the fitted wall-clock BPM by the playback rate (D4).
6. **Output** `{bpm, periodMs, phaseMs: a, tapCount, stdErrBpm}`, where
   `stdErrBpm` comes from the regression standard error of the slope,
   `se(period) = sqrt(SSR/(n-2) / Σ(k-k̄)²)`, converted through
   `|d(bpm)/d(period)| = 60000/period²`. Shown as `± X.X` so the user can see
   the estimate tighten.

**No sliding window.** Every tap since the last Reset or pause is in the fit.
An earlier draft capped the fit at the last 24 taps so "a user who settles into
the groove is not held back by their first sloppy bar" — but a moving window
re-fits over a changing set and re-references `k_0` to a changing origin, so
the displayed number steps on every eviction and never converges. That is
precisely the reason §4 alternative 3 rejects the EMA, and it applies with
equal force to a window. The sloppy-first-bar case is served by the Reset
button the owner explicitly asked for, and by the single outlier drop. A hard
cap of 512 taps (oldest dropped) exists purely as a memory guard and is
unreachable in practice: 512 taps at 120 BPM is more than four minutes of
continuous tapping.

Gates:

- `n < 3` → `{status: 'insufficient', tapCount}`. The first interval carries
  the user's whole reaction-time transient; two intervals is the minimum that
  can disagree with itself.
- Display the BPM from `n = 3`. Enable **Accept** from `n = 4`.

The tap list itself lives in a pure reducer in the same module
(`emptyTapSession`, `pushTap`, `clearTaps`) so the component holds one state
object and every transition is unit-testable.

Also exported: `octaveShift(bpm, factor)` for the popover's `×2` / `÷2`
buttons, since tapping half-time or double-time is the single most common
tap-tempo mistake and the correction should not require re-tapping.

### D7 — The anchor, and what Accept writes

**Anchor resolution.** `Tap tempo…` is added to **all three** branches of
`buildTempoMenu`, each with its own anchor:

| Branch                         | Anchor tick                     |
| ------------------------------ | ------------------------------- |
| TS chip hit (`hitTsChip`)      | `chip.tick`                     |
| Marker hit (`hitTempoMarker`)  | `marker.tick`                   |
| Empty lane                     | `nearestBeatTick(...)`          |

`nearestBeatTick` returns `null` when `scene.beats` is empty
(`tempoHitTest.ts`), in which case the empty-lane branch today returns
`octaveItems` only. The tap item is still offered there, anchored at
`Math.max(0, snappedTickAt(x))` — the same fallback `buildTempoMenu` already
uses for `downbeatTick`. `anchorMs` comes from the scene's tick→ms mapping, and
the popover shows the anchor as `bar.beat` (`barBeatAtTick`, exported from
`./scene`) so the user can see where the tempo will land.

**The write.** `executeCommand(new AddBPMCommand(anchorTick, bpm, state.tempoGlueMode))`.

- **Replace, not stack.** `AddBPMCommand.execute` filters any tempo at that
  tick before pushing, so re-typing an existing marker's BPM is the same
  operation. No separate "edit" path.
- **Following markers.** The next tempo marker keeps its tick and its BPM; the
  segment `[anchorTick, nextTick)` takes the new BPM, so everything downstream
  **shifts in audio time**. This plan does _not_ offer a "hold the next
  marker's audio position" variant (which would mean recomputing the following
  segment's BPM the way `applyMarkerMoveBpms` does). Reason: tap tempo is used
  when the _incumbent_ map is wrong, so pinning a downstream marker derived
  from that wrong map is pinning the error. Flagged as uncertain — if browser
  QA shows this is surprising on a chart with many markers, a follow-up plan
  can add the pinned variant as a checkbox.
- **Notes.** `tempoGlueMode` defaults to `'audio'` and has no UI, i.e. KEEP-MS:
  `AddBPMCommand` runs `remapKeepMs` over the **whole** document, so every note
  after the anchor keeps its wall-clock time and is re-ticked onto the new
  grid, then passed through `nudgeNoteCollisions`. On an unmapped or
  lightly-charted song that is exactly right — the user is correcting the grid
  to match audio the notes are already aligned to. On a **fully charted** song
  it is a bigger operation than "add a tempo at bar 40": the remaining minutes
  of chart land on new, arbitrary ticks. That is recoverable (undo is a
  whole-doc snapshot restore, so nothing is lost) but it must not be a
  surprise, so the popover's confirm line says so plainly, in two lines above
  Accept:

  > Sets the tempo from bar 40.1 onward.
  > Notes after that point keep their audio timing and move to new grid
  > positions. Later tempo markers keep their chart positions and shift in
  > time. Undo restores everything.

  No em dashes; one sentence per consequence.

- **Bar lines.** Beats and bars after the anchor follow the new BPM, since the
  beat grid is derived from the tempo map. This is the visible payoff and needs
  no extra work.
- **Undo/redo.** Free: `AddBPMCommand` restores the pre-edit snapshot through
  the standard history in `useExecuteCommand`/`EditorSession`. One tap session
  produces exactly one history entry, because only Accept dispatches.

### D8 — Reset is not Cancel

Three distinct controls, because the owner explicitly asked for the middle one:

| Control             | Taps    | Popover | Chart           |
| ------------------- | ------- | ------- | --------------- |
| **Reset** (button)  | cleared | stays   | untouched       |
| **Cancel** / Escape | dropped | closes  | untouched       |
| **Accept**          | dropped | closes  | `AddBPMCommand` |

Reset keeps the anchor tick; it is "start tapping again", which is what you
want after realising you were tapping half-time. Reset returns focus to the tap
pad, so the next keystroke is a tap again (D3). Because D2's dismissal
suppression does not depend on the tap count, Reset cannot re-arm
click-away dismissal.

### D9 — One decimal in the UI, full precision to the chart

The lane already renders `marker.bpm.toFixed(1)`
(`components/chart-editor/piano-roll/draw.ts`) and the menu already says
`Delete tempo marker (${marker.bpm.toFixed(1)} BPM)`. The popover uses the same
`toFixed(1)`, for the BPM and for the `± X.X`.

The value **written** is not rounded to one decimal. `AddBPMCommand` runs it
through `quantizeBpm` (`lib/chart-edit/retime.ts`), which for `.chart` keeps
milli-BPM (three decimals) and for `.mid` the nearest integer µs-per-beat.
Rounding to 0.1 BPM before writing would inject up to ~0.03% of tempo error —
about 100 ms of drift over a four-minute song — for no benefit. The display is
a display.

---

## 3. Data model and API changes

| Change                                                                      | File                                                       |
| --------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `MenuState.items` → `MenuState.content` (discriminated); `menuKindRef`      | `components/chart-editor/piano-roll/PianoRollTimeline.tsx` |
| **new** `fitTapTempo`, `pushTap`, `clearTaps`, `emptyTapSession`, `octaveShift` | `lib/tempo-map/tap-tempo.ts`                               |
| **new** `TapTempoPopover`                                                   | `components/chart-editor/TapTempoPopover.tsx`              |
| **new** `isEditableTarget`                                                  | `lib/dom/isEditableTarget.ts`                              |

No change to `ContextMenuPopover` (D1), no change to `AudioManager` (D4), no
change to `EntityKind` or the capability presets (that was the marquee work,
now plan 0085).

No persistence format changes, so **no migration**: tap tempo writes an
ordinary tempo event through an existing command, and the tap session is
in-memory only.

---

## 4. Alternatives considered and rejected

1. **Reuse the deleted `tapTempoSync` + RE-PREDICT path.** It fits a
   _whole-song_ constant BPM and re-derives every note from onsets. The owner
   asked for a BPM "at the point you right clicked at". Local edit, local
   command. The old estimator's maths is also wrong for this job (§1).
2. **Mean of consecutive intervals.** In its `span/(n-1)` form it uses two of n
   taps (§1). Even a genuinely local variant — mean of the last few intervals —
   is the regression with the beat indices thrown away, so it cannot survive a
   missed tap, which is the single most common thing a human does while tapping
   along. Rejected in favour of the regression, which is the
   maximum-likelihood estimator under i.i.d. tap noise and degrades gracefully.
3. **Exponential moving average of the last few intervals.** Responsive but
   never converges: the displayed number keeps wandering while the user taps
   steadily, which reads as "the tool is unsure". The all-taps regression
   converges monotonically and the `± X.X` readout makes convergence legible.
   (D6 applies the same test to a sliding window and rejects that too.)
4. **A dedicated tap key (Space only, or `T`).** "Tap any key" is the owner's
   ask and it is also better ergonomics — you tap with whatever finger is
   nearest. The cost (suppressing hotkeys, needing a transport button in the
   popover, needing the target check) is paid once in D3.
5. **Writing the BPM at the playhead instead of the right-clicked tick.** The
   playhead is moving while you tap; the anchor must be fixed at gesture start.
   D5 closes the gap in the other direction, by seeking the playhead to the
   anchor on request.
6. **Auto-detecting half/double time from the incumbent map** and correcting
   the tapped BPM. Too clever: it makes the number the user sees disagree with
   what they did. `×2` / `÷2` buttons put the choice in their hands.
7. **A tempo lane with a full editable BPM text field.** Worth having, and
   compatible with this popover (the readout could become an input later), but
   it is a different feature from tapping and out of scope here.

---

## 5. Phased implementation

Each phase compiles, passes `pnpm test` and `pnpm typecheck`, and can land
alone.

**Phase 1 — the estimator (D6).** `lib/tempo-map/tap-tempo.ts` + tests. Pure,
no UI, no wiring. This is where the bulk of the test plan lives.

**Phase 2 — `isEditableTarget` (D3).** `lib/dom/isEditableTarget.ts` + tests.
Trivially small; separate only because it is a shared util and should land
before the thing that depends on it.

**Phase 3 — the tap popover (D1–D5, D7–D9).** `MenuState.content` and the
call-site `onAfterSelect` guard; the D2 dismissal guards; `TapTempoPopover`;
the `Tap tempo…` item in all three `buildTempoMenu` branches; the Accept path
through `AddBPMCommand`.

Browser QA per CLAUDE.md: `new_page` first, load
`public/All Time Low - SUCKERPUNCH (Hubbubble).sng` on `/chart-editor`,
right-click the tempo lane, press **Play from bar.beat**, tap along, watch the
number settle, Reset, tap again, Accept, confirm the lane label and the bar
lines move, confirm Mod+Z restores. Then, specifically for this round's
objections:

- Tab through the popover and activate Accept with Enter and with Space —
  neither may register a tap.
- With the popover open, open the lyrics row inline editor and type; the text
  must appear and the tap count must not move.
- Click on the canvas with 10 taps recorded; the popover must stay open.
- Set playback to 0.75×, tap a known tempo, confirm the accepted BPM matches
  the 1.0× result. This is D4's whole point and it is the one thing a unit test
  of the component cannot prove end to end.
- Press Play/Pause from the popover mid-session and confirm the taps survive
  (D4's rejected audio-clock design would have cleared them).
- `list_console_messages` clean at the end.

---

## 6. Test plan

Jest (`pnpm test`). `lib/drum-fills/db/__tests__/queries.test.ts` fails on this
machine for want of better-sqlite3 native bindings; that is the accepted
pre-existing failure.

### `lib/tempo-map/__tests__/tap-tempo.test.ts`

1. Perfectly even taps at 120 BPM (500 ms apart, n = 8, rate 1) → `bpm === 120`
   to within 1e-9, `stdErrBpm ≈ 0`.
2. `n = 0, 1, 2` → `status: 'insufficient'` with the right `tapCount`; `n = 3`
   → a number.
3. **Regression beats mean-interval:** taps at 500 ms with a 60 ms-late final
   tap. Assert the fit is closer to 120 than `span/(n-1)` is, computing both in
   the test. This is the §1 defect, pinned.
4. Jittered taps (deterministic pseudo-random ±25 ms, seeded) at 143.7 BPM,
   n = 16 → within 1.5 BPM; and the estimate with n = 16 is at least as close
   as with n = 4 (more taps help rather than hurt).
5. **Missed beat:** taps at 500 ms with beat 5 skipped (a 1000 ms gap) → still
   ~120 BPM, because `k` jumps by 2.
6. **Outlier drop:** one tap 200 ms early inside an otherwise clean run,
   n = 8 → within 0.5 BPM, and the reported `tapCount` reflects the drop.
   With n = 4 (below the drop threshold) the outlier is _not_ dropped —
   asserted, so the threshold is documented in a test.
7. **Only one drop:** two bad taps → the fit degrades but does not throw, and
   no more than one tap is discarded.
8. **Double strike (push-time):** a tap 40 ms after the previous one inside a
   500 ms run is not recorded — `tapCount` does not increase and the fit is
   unchanged. Pins D6's push/fit split.
9. **Pause (push-time):** `pushTap` with a gap > `max(2500, 4·P)` clears the
   prior taps and the session restarts at `tapCount === 1`.
10. **Rate scaling:** the same tap times at `rate = 0.75` produce a BPM
    `1/0.75` times the `rate = 1` result, and 400 ms taps at 0.75× fit to
    112.5 BPM. Pins the direction of the division (D4).
11. **No window:** 60 evenly-spaced taps → every tap is in the fit
    (`tapCount === 60`), and the reported BPM after tap 60 differs from the
    BPM after tap 25 by less than after tap 10 — convergence is monotone, no
    eviction step.
12. Two taps 0 ms apart / non-monotonic times → no `Infinity`, no `NaN`, a
    clean `insufficient` or double-strike result.
13. `octaveShift(148.5, 2) === 297`, `octaveShift(148.5, 0.5) === 74.25`.
14. `clearTaps` preserves the anchor; `emptyTapSession` round-trips.

### `lib/dom/__tests__/isEditableTarget.test.ts`

15. `input`, `textarea`, `select`, `[contenteditable="true"]`, and a `<span>`
    nested inside a contenteditable → `true`. A `button`, a `div`, a
    `[contenteditable="false"]`, and `null` → `false`.

### Command layer

16. `AddBPMCommand(tick, 148.4567, 'audio')` on a `.chart` doc → the stored BPM
    is `quantizeBpm`'s value (three decimals), not `148.5`. Pins D9.
17. Accept at a tick that already has a marker → exactly one tempo at that
    tick, with the new BPM.
18. Accept → notes' `msTime` unchanged, ticks changed (KEEP-MS); undo restores
    ticks and the tempo list exactly.

### Component (`TapTempoPopover`, React Testing Library)

19. Keydown `k` with `repeat: false` records a tap and calls `preventDefault`;
    `repeat: true` does not; `Escape` does not and does **not**
    `stopPropagation`; `Meta+z` does not and is not prevented.
20. **Target check:** a keydown dispatched with an `<input>` as target records
    no tap and is not prevented. A keydown whose target is the popover's
    Accept button records no tap (so Enter activates the button).
21. The tap pad has focus on mount, and again after Reset.
22. Accept is disabled below 4 taps. Reset zeroes the count while the popover
    stays mounted. Cancel unmounts without dispatching.
23. The BPM readout renders with exactly one decimal for `148`, `148.04` and
    `148.96`.
24. The transport button reads `Play from <bar.beat>` while stopped and
    `Pause` while playing, against a stubbed audio manager; pressing it while
    stopped calls `playChartTime(anchorMs / 1000)`; pressing it while playing
    calls `pause()` and does not clear the taps.

### Menu wiring

25. `buildTempoMenu` includes a `Tap tempo…` item in all three branches (TS
    chip hit, marker hit, empty lane) and in the empty-lane case with an empty
    `scene.beats`, where the anchor falls back to `snappedTickAt`.
26. Selecting `Tap tempo…` leaves `menu !== null` with
    `content.kind === 'tap'`; selecting any other item closes the menu. Pins
    the call-site `onAfterSelect` guard (D1) with no change to
    `ContextMenuPopover`, whose existing tests must pass verbatim.

---

## 7. Explicitly out of scope

- **The passive-wheel warning** - plan 0086.
- **Tempo-lane marquee selection and multi-marker delete** — plan 0085.
- **Group-dragging tempo markers or time signatures** — needs
  `applyMarkerRunMoveBpms` in `lib/chart-edit/tempo-remap.ts`; noted in plan
  0085, deferred beyond it.
- **Tap-to-set-phase.** Taps set BPM only. Aligning the grid's phase to a tap
  is already served by `Make this beat 1 (rephase song)` and `Make this a
downbeat` (`PlaceDownbeatCommand`), and mixing the two into one gesture makes
  both harder to predict.
- **Tapping to build a whole tempo map** (tap every beat of a song, generate a
  marker per beat). That is what the Chart Assist tempo-map generator is for.
- **A metronome / click track** while tapping. Useful, unrelated, and it needs
  an audio-source decision the editor has not made.
- **An editable BPM text field on the tempo lane.**
- **A "hold the next marker's audio position" write mode** (D7) — recorded as
  the follow-up if browser QA says the default surprises people.

---

## 8. Uncertainties, stated rather than papered over

- The outlier threshold `max(0.15·period, 40 ms)`, the double-strike threshold
  `0.5·P0` and the pause threshold `max(2500 ms, 4·period)` are judgement
  calls, not derived from data. They are named constants in `tap-tempo.ts` with
  the reasoning in comments, and the tests assert behaviour on either side of
  them so they can be retuned safely.
- Whether users expect Accept to also move the _following_ marker (D7) is
  unknown until it is in front of the owner.
- Whether "Accept re-grids every note after the anchor" is acceptable on a
  finished chart, or whether it needs a stronger confirm than a line of copy
  (D7). Browser QA on SUCKERPUNCH, which is fully charted, is the test.
- Whether not seeking on open (D5) reads as the tool ignoring the ask. The
  labelled `Play from bar.beat` button is the mitigation; if QA says people
  expect the seek to be automatic, the button becomes an auto-seek and Cancel
  restores the prior playhead.

---

## 9. Objections considered

A contrarian review of the previous draft. Every factual claim below was
re-verified against the code before the objection was accepted or rejected.

**1. A container-capture wheel listener would break scrolling inside the
context menu it opens.** **Accepted, and the whole item moved out.** Verified:
`ContextMenuPopover` renders inside `containerRef` (the `{menu && …}` block is
a child of the `ref={containerRef}` div), it sets `overflowY: 'auto'` whenever
`computeContextMenuPlacement` returns a `maxHeight`, and `applyWheel` returns
`true` (→ `preventDefault`) even when `sceneRef.current` is null. A
container-capture listener would therefore eat wheel events over a clipped
menu, and this plan's popover is exactly the tall-menu case. The wheel fix is
now plan 0086 and carries the popover-subtree bail as a requirement.

**2. A window-capture keydown listener with no target check swallows typing
app-wide and makes the popover keyboard-dead.** **Accepted; D3 rewritten.**
Verified: the piano roll's `inlineTextEditor` `<input>` is reachable while the
menu is open, D2 keeps it reachable, and `ContextMenuPopover`'s
`useDismissOnEscape` owns a bubble-phase window keydown listener that a
capture-phase `stopPropagation()` would disable for every surface using the
hook. D3 now bails on editable targets (`isEditableTarget`, a new tested util),
bails on popover controls that are not the tap pad (so Enter and Space activate
the focused button), and leaves Escape and modified chords entirely alone.

**3. The dismissal guard needs state the architecture puts out of reach, and
toggling it re-arms a `{once: true}` listener.** **Accepted; D2 changed to an
unconditional suppression.** Verified: `useDismissOnOutsidePointerDown` arms
inside a `setTimeout(0)` with `{once: true}`, so flipping its `open` argument
re-arms it — Reset would have re-enabled one-click dismissal. Suppressing
outside-dismiss for the whole tap session needs only `menu.content.kind`, which
`PianoRollTimeline` already owns, so no session state crosses the component
boundary.

**4. The plan never moves the playhead to the anchor, so it does not implement
the owner's actual ask.** **Accepted; D5 is new.** The popover's transport
button is `Play from <bar.beat>` and calls
`audioManager.playChartTime(anchorMs / 1000)`. Opening the popover deliberately
does not seek (a right-click should not discard the playback position
silently), and the anchor is in the button's label so the disagreement is
visible before it is closed.

**5. The audio clock is a worse input timestamp than `event.timeStamp`, and
resetting on `isPlaying` contradicts the Play/Pause button.** **Accepted; D4
rewritten and Phase 2 (`rawChartTime`) deleted.** Verified:
`AudioManager.getCurrentTempo()` is already public and returns the same scalar
`#rawCurrentTime` integrates, and `#rawCurrentTime` returns `0` while
`#startedAt < 0`. Wall clock plus one scalar removes the new accessor, the
phase, the test, the dual-clock rule and the contradiction. One correction to
the objection: the scaling is `bpmSong = bpmWall / rate`, not `× rate` — song
time runs `rate` times faster than wall time, so a slower rate stretches the
wall interval. Test 10 pins the direction. Rate changes mid-session reset the
taps; play/pause does not.

**6. Bulk tempo delete runs one whole-chart KEEP-MS remap per marker.**
**Accepted, and the whole item moved out.** Verified:
`DeleteTempoMarkerCommand.execute` does `cloneDocForRetime` → filter →
`remapKeepMs` for a single tick, and `BatchCommand.execute` folds members
sequentially over the evolving doc, so N markers is N lossy re-ticks of the
whole chart. Plan 0085 now requires a single `DeleteTempoMarkersCommand` that
filters all N ticks and remaps once, with a multi-marker test.

**7. The stated reason for bundling three features is false.** **Accepted.**
Re-checked the call graphs: tap tempo enters through `onContextMenu` →
`buildTempoMenu` → `ContextMenuPopover`; the marquee touches
`handlePointerDown`, `EntityKind`, `entityHandlers`, `cloneDocFor`,
`AFFORDANCES`, `capabilities.ts`, `KIND_LABELS`, `marquee.ts`, `draw.ts`,
`useEditorKeyboard.ts`; the wheel fix touches `handleWheel`/`applyWheel` and
four JSX props. The only shared thing is the file, which is being split. Three
plans now. The line-number corollary is accepted too: this plan cites
`file:symbol` and keeps line numbers only where they pin an exact expression,
with a note at the top saying so.

**8. Widening `EntityKind` pushes meaningless keys into the highway
reconciler.** **Accepted, and it belongs to plan 0085 now.** Verified:
`useChartElements.ts` iterates every kind in `state.selection` and calls
`reconcilerKeyFor(kind, id, partName)`, whose doc comment is an explicit
round-trip table of exactly five kinds; the hover push does the same. Also
verified: the export is `AFFORDANCES`, not `ENTITY_AFFORDANCES`, and
`EditorCapabilities.editableEntities`' doc comment states outright that
tempo/timesig "aren't hoverable/selectable/draggable UI entities". Plan 0085
carries all three as blocking questions rather than as a type change with a
compile-error checklist.

**9. `ContextMenuItem.keepOpen` modifies a shared component for something the
call site can already do.** **Accepted; the prop is gone.** Verified
`ContextMenuPopover` calls `item.onSelect()` then `onAfterSelect?.()`, and the
call site owns `onAfterSelect`. D1 now uses
`onAfterSelect={() => setMenu(m => (m?.content.kind === 'tap' ? m : null))}`,
which is a zero-line change to the shared file. Test 21 of the old plan is
replaced by test 26, which pins the call-site behaviour instead.

**10. The plan understates what Accept does to a charted song.** **Accepted;
D7's copy and note rewritten.** The confirm line now says notes after the
anchor move to new grid positions, and D7 says in plain terms that on a fully
charted song this re-grids the rest of the chart, is undoable, and is the thing
browser QA on SUCKERPUNCH exists to sanity-check. §8 carries it as an open
question about whether a line of copy is enough.

**11a. `buildTempoMenu` has three branches and `nearestBeatTick` can return
`null`.** **Accepted.** Verified both (the TS-chip and marker branches `return`
early; `nearestBeatTick` returns `null` on empty `beats`). D7 now specifies the
anchor for all three branches and a `snappedTickAt` fallback for the empty-beats
case; test 25 pins it.

**11b. The sliding window contradicts the plan's own rejection of the EMA.**
**Accepted; `MAX_TAPS = 24` is gone.** The window is now "every tap since the
last Reset or pause", with a 512-tap memory guard that is unreachable in
practice. The sloppy-first-bar case is what Reset is for, which is what the
owner asked for.

**11c. Step 3's "merge into an outlier" conflicts with step 5's "exactly one
drop".** **Accepted; D6 restructured.** Double strikes are now a **push-time**
guard that discards the tap before it is ever recorded, so beat indices are
strictly increasing by construction and the fit's single outlier drop never
has to deal with them. Test 8 pins the split.

**11d. The `49b1dc3` citation is right but only rules out `span/(n-1)`, not a
local mean-of-intervals.** **Accepted.** Verified the commit subject. §1 now
says explicitly that the argument only rules out the telescoping form, and §4
alternative 2 gives the separate reason a local mean is still wrong here: it
discards the beat indices, so it cannot survive a missed tap.

**11e. The wheel fix should be its own commit, not Phase 0 of a tempo
feature.** **Accepted** - plan 0086.

**Nothing was rejected outright.** The one substantive correction to the review
is the direction of the playback-rate scaling in objection 5 (divide, not
multiply); the objection's conclusion stands and is adopted.
