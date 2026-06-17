# 0049 — Drum Fills: information-architecture & chrome revisit

User report (with screenshots, 2026-06-12): too many headers/bars stacked on top of
each other before you reach the actual practice content. Revisit the IA holistically:
whether views need real URLs, how headers/navigation work, and how to simplify each
page's content + layout to fit the product. **Don't guess; don't remove things just to
remove them.** Reason from the product and the real code, decide, then implement. Driven
by a multi-agent workflow.

## The problem (verified structural map)

On a groove/ladder/rotation session — or the library→practice flow — these horizontal
bands stack from the viewport top down to the highway:

1. **Global site nav** (`app/layout.tsx:56-97`) — "Music Charts Tools / More Tools /
   Discord / GitHub / Log In". h-12/h-16, on every route.
2. **Drum Fills app header** (`ClientPage.tsx:184-208`) — "Drum Fills" + Home/Grooves/
   Library tabs + MIDI chip.
3. **GrooveHeader card** (`GrooveSession.tsx:141-164`) — big card: groove stave +
   "76 fills · 41 songs · 121–208 BPM" + Rotate/Ladder toggle.
4. **PracticeView title** (`PracticeView.tsx:913-933`) — song — artist, then "208 BPM ·
   1 bar · mixed · complexity 2 · toms, crash-end" + Back.
5. **Mode switcher** (`PracticeView.tsx:935-938`) — "Song loop / Change mode" disclosure.
6. **MIDI warning** (`PracticeView.tsx:940-945`) — full-width amber "No MIDI device
   connected" band (persists whenever no kit is attached).
7. **Transport bar** (`PracticeView.tsx:947-969`) — Play / Restart / (Next) / (shuffle) /
   Tempo slider + presets / "Hits this pass" counter.
8. **Content** — highway (CloneHeroRenderer) + sheet music + HUD sidebar (Last attempt /
   Best / Mastery).

Redundancy: **BPM appears 3×** (GrooveHeader, title, HUD); **taxonomy 2×** (title + HUD);
mode concepts split across GrooveHeader (rotate/ladder) and the playback ModeSwitcher; the
MIDI warning is its own full band even when it could be an inline chip.

## Architecture facts (constraints for the redesign)

- Single SPA route `/drum-fills`; `ClientPage.tsx` holds a `view` union
  (home | library | grooves | practice | today | roulette | groove-session{rotate|ladder})
  and swaps components. No deep-linkable URLs; browser back doesn't move between views.
- Shared across views: **MidiProvider** (device state + profile + calibration offset in
  localStorage — must stay global), **useLibraryScan** (scan state used by Home + Grooves
  - Library). Library/Groove filters are localStorage-backed already (survive nav).
- Audio managers + SRS state are per-PracticeView (not shared) — safe to isolate per route.
- Layout: body is `flex flex-col h-screen`; `<main class="flex flex-col flex-1 min-h-0">`.
  ClientPage drops `max-w-screen-xl` on practice surfaces to go full-bleed. Practice
  surfaces achieve no-page-scroll via nested `flex min-h-0 flex-1` + the content row
  scrolling internally (sheet music) / clipping (highway).
- Global header is in the root layout, shared by ALL tools — changing it affects every
  page, so any "slim/hide on drum-fills" must be scoped (e.g. a route-group layout or a
  drum-fills `layout.tsx`), not a global edit that breaks other tools.

## Goals

- Drastically cut the number of stacked chrome bands above the practice content — the
  highway + notation should dominate the screen.
- One coherent navigation model; no duplicated metadata across bands.
- Decide deliberately whether to split views into real routes (`/drum-fills`,
  `/drum-fills/grooves`, `/drum-fills/library`, a practice/session route, etc.) with a
  shared `app/drum-fills/layout.tsx` hosting the providers + single header — vs. staying
  SPA. Justify the choice from the constraints above; if splitting, keep MidiProvider +
  scan state in the shared layout and preserve deep-linking + browser back.
- Keep ALL existing functionality and information — relocate/consolidate, don't delete.
  Everything currently shown must remain reachable (mode switching, tempo, presets, MIDI
  status/calibration, fill metadata, attempt/best/mastery, rotate/ladder, shuffle, next,
  back/exit, the ladder rung list, today-queue progress).

## Workflow shape

1. **Audit** — screenshot every surface live (chrome-devtools) and confirm the band stack
   per surface; produce a per-surface inventory of what each band shows and where info is
   duplicated.
2. **Design (judge panel)** — several independent IA/layout proposals from different
   angles (real-routes-with-shared-layout; consolidated-single-context-bar; focused
   full-bleed instrument). Score them against the goals/constraints; synthesize ONE chosen
   IA + a concrete per-page content/layout spec. Write it into this doc as
   "## Appendix: chosen IA (2026-06-12)".
3. **Implement** — build the chosen IA in dependency order (shared layout/header/routing
   first, then session+practice chrome consolidation, then browse views + nav polish).
4. **Validate** — tests/lint/tsc; chrome-devtools screenshots of each surface proving the
   band count is reduced and the highway/notation dominate; no page scroll at 1280×800 /
   1920×1080; console clean; deep links + browser back work if routes were split.

## Constraints (unchanged)

No backend; no zustand; reuse before reimplementing; heavy work in workers; Jest for new
business logic; one-way push to the highway renderer; no setState/ref-write during render
(useSyncExternalStore / effect patterns); virtualized grids stay virtualized; localStorage
filter persistence stays; browser-validate with chrome-devtools.

## Appendix: chosen IA (2026-06-12)

Synthesis of the three proposals: **real App-Router routes + a shared `app/drum-fills/layout.tsx`**
(from the _routes_ proposal — it is the only clean seam to host the shared providers AND scope
the global-nav change, and it fixes deep-linking + browser-back + the nav-highlight bug "for
free") combined with the **single context+transport bar** for practice surfaces (from the
_consolidate_ proposal — the lowest-risk, highest-payoff band collapse). The full _instrument_
"hide all nav, 36px perch" angle is **rejected**: hiding the in-tool nav during practice hurts
discoverability for no extra band savings beyond what the shared slim header already gives, and
the "two-mode physical split" adds complexity. We keep a persistent, slim in-tool nav on every
surface and reclaim the global site nav's 64px instead.

### Routing decision — YES, split to real routes

Move from the `view` union in `ClientPage.tsx` to App-Router routes under a new
`app/drum-fills/layout.tsx`. Rationale tied to the constraints:

- The only cross-view shared state is **MidiProvider** (localStorage-backed calibration/profile)
  and **`useLibraryScan`** (in-memory scan + completion callback). Both hoist into the layout,
  which Next keeps mounted while child routes swap — so device connection, calibration offset,
  and an in-flight scan survive navigation exactly as they do today. Filters are already
  localStorage-backed and survive hard navigation. Audio managers + SRS are per-`PracticeView`
  and are _meant_ to reset per fill, so per-route remount is correct.
- A shared layout is **required anyway** to scope any global-nav change (the global nav is in the
  root `app/layout.tsx`, shared by every tool). Once we own that layout, real child routes are
  nearly free and deliver: deep-linkable surfaces, working browser Back/Forward, and a correct
  active-nav highlight derived from `usePathname()` (today a bare practice view wrongly highlights
  "Home").
- One genuinely new data path: deep-linking a groove can't carry a `GrooveCluster` object, so add
  **`getGrooveClusterByKey(similarityKey)`** beside `getGrooveClusters` in
  `lib/drum-fills/db/index.ts` (reuse `buildGrooveClusters`; `getActiveLadders` already builds a
  `byKey` map at index.ts:1098 — factor that lookup, don't reimplement clustering). Jest-cover it.

Route map (each `page.tsx` is a thin server file that sets `metadata` and `dynamic`-imports its
existing client view component — mirrors the current `page.tsx` → `ClientPage` split):

```
app/drum-fills/
  layout.tsx                 # NEW 'use client': MidiProvider + scan + UnsupportedGate + ONE header + nav-scope effect
  page.tsx                   # Home                              → /drum-fills
  grooves/page.tsx           # Grooves list                     → /drum-fills/grooves
  groove/[key]/page.tsx      # Groove session (rotate|ladder)    → /drum-fills/groove/<similarityKey>?mode=rotate|ladder
  library/page.tsx           # Library                          → /drum-fills/library
  practice/[fillId]/page.tsx # Single-fill practice             → /drum-fills/practice/<fillId>
  today/page.tsx             # Today queue                      → /drum-fills/today
  roulette/page.tsx          # Roulette                         → /drum-fills/roulette
```

Navigation rules (replace every `setView`):

- `goHome`/nav pills → `router.push('/drum-fills' | '/drum-fills/grooves' | '/drum-fills/library')`.
- Practice a fill → `router.push('/drum-fills/practice/' + fillId)`; groove card → `router.push('/drum-fills/groove/' + cluster.similarityKey + '?mode=rotate')`; Home "Start ladder" → same with `?mode=ladder`; Start review → `/today`; Surprise/roulette → `/roulette`.
- Rotate⇄Ladder toggle = `router.replace('?mode=…')` (no history spam, deep-linkable, survives reload). `GrooveSession` keeps its internal `initialMode`, fed from the `mode` searchParam.
- **In-surface advance never pushes history**: rotation Next, roulette Next, today-queue Next, ladder rung-select stay internal component state. Only cross-surface navigation pushes.
- Back/Exit buttons → `router.back()` when history exists, else a per-surface fallback `router.push` (practice→`/library`, groove→`/grooves`, today/roulette→`/drum-fills`).

### Global site nav — scoped suppression, never a global edit

The drum-fills tool reclaims the root nav's 64px on every surface, with zero impact on other tools:

- Give the root `<nav>` in `app/layout.tsx:56` a stable class `site-nav` (additive, no behavior change).
- `app/drum-fills/layout.tsx` runs an **effect** (not a render-time DOM write) that adds
  `hide-site-nav` to `document.body` on mount and removes it on cleanup (and on pathname leaving
  `/drum-fills`). Add one additive rule to `globals.css`: `body.hide-site-nav nav.site-nav { display:none }`.
- Reject the `(group)` re-root-layout alternative (App Router allows one root layout; re-rooting
  risks Toaster/analytics/auth). The body-class toggle keeps the single root layout intact and is
  reversible. Regression-check: navigate drum-fills → another tool, confirm the site nav reappears.
- The global nav's only load-bearing affordance (escape to the rest of the site) is preserved as a
  small "← All tools" link in the drum-fills header. Discord/GitHub/Log-In remain unchanged on every
  other route; auth still works because root `ContextProviders` is untouched.

### Final band layout per surface

Two chrome elements are defined once and reused:

- **[H] — the one shared header** (owned by `layout.tsx`, sticky, ~44px, never grows):
  `[← All tools] [Drum Fills ▾ → /drum-fills] [Home | Grooves | Library]  …context slot…  [Scan/Rescan ⟳ + inline progress]  [MIDI chip]`
  - Nav pills are `<Link>`-driven; active state from `usePathname()`.
  - **Context slot**: a thin route-supplied breadcrumb/metadata line. Pages set it through a tiny
    `DrumFillsChromeContext` via an effect (same one-way pattern as MidiContext; no setState-in-render).
    This is the SINGLE canonical home for groove identity ("Groove · 36 fills · 33 songs · 75–241 BPM"),
    ladder "Rung n/N", and today-queue "n/N".
  - **Scan/Rescan + progress** live here (driven by the layout's `useLibraryScan`) — kills Library's
    66px scan bar and lets Home/Grooves trigger rescans from one place. `scanVersion` in the chrome
    context replaces today's `refreshKey` so mounted data pages re-fetch on scan completion.
  - **MIDI chip** is a shadcn **Popover** anchored to the chip (NOT inline-expand) — eliminates the
    +20px header-growth-pushes-everything-down problem. `MidiStatus` content unchanged; renders in the
    popover. `CalibrationDialog` stays a modal opened from inside the popover, still MIDI-gated.

- **[T] — the one practice context+transport bar** (`PracticeContextBar`, NEW; replaces
  `PracticeView.tsx:913–969` title+ModeSwitcher+MIDI-warning+transport quartet). Single
  `flex flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2` row, wraps to 2 lines on
  narrow widths. Pure presentational, props-driven. Left→right slots:
  `[‹Back/Exit] · [Song — Artist (truncate)] · [meta: "200 BPM · 1 bar · 16ths · cx2 · toms, crash-end"] · [session-ctx: small GrooveStave w-16 + Rotate|Ladder toggle + Rung n/N — groove/ladder only] · [Loop-mode ▾ chip = the existing ModeSwitcher disclosure] · [Play/Pause ⎵] [Restart R] [Next:<name> N]? · [transportExtras: shuffle In-order|Shuffle + End session | instance dropdown]? · [Tempo slider 100% 50/75/100] · [⚠ inline MIDI chip when no kit → opens [H] popover] · [Hits: N (ml-auto)]`
  - The meta line is the ONLY place per-fill BPM + taxonomy renders (kills 3× BPM / 2× taxonomy).
  - Loop-mode (Song loop / Isolated / Speed trainer / Roulette) and session-structure (Rotate/Ladder)
    are co-located in this one bar but in visually distinct slots — the two "mode" controls the audit
    flagged as 200px apart are now adjacent, kept as two controls (they are genuinely different concepts).
  - The full-width amber MIDI-warning band is deleted; "no kit" becomes the inline ⚠ chip's state +
    the popover body text (the instructional sentence moves there).

Per-surface ordered bands (top→down):

- **HOME `/drum-fills`** — `[H]` (context slot empty) → scrolling content (centered `max-w-screen-xl`):
  4 stat cards · Due-now card + Start review · Continue-climbing ladder cards · Suggested groove +
  Explore + Surprise me + Start ladder. All actions become `router.push`. Unchanged structurally.
- **GROOVES `/drum-fills/grooves`** — `[H]` → `FilterPanel` band → virtualized `GrooveCard` grid.
  Unchanged (filters localStorage-backed, grid virtualized). Card → groove route. GroovesView's own
  rescan removed (now in `[H]`).
- **LIBRARY `/drum-fills/library`** — `[H]` (scan moved in) → `FilterPanel` (Search, Grouped|All
  toggle, Sort, count, Subdivision/Length/Mastery + Voicing chips, Complexity + Tempo sliders;
  localStorage-backed, unchanged) → `needsRescan` amber banner (kept, contextual) → virtualized
  `GroupedFillGrid`/`FillGrid`. The standalone 66px scan bar is **deleted**.
- **PRACTICE `/drum-fills/practice/[fillId]`** (leanest, the template) — `[H]` (context empty) →
  `[T]` (Back→/library; instance dropdown via `enableInstanceSwitcher`; no session-ctx slot) →
  content row (highway + sheet + `PracticeHud`). Highway begins ~120px from top (was 352).
- **GROOVE — ROTATE `/drum-fills/groove/[key]?mode=rotate`** — `[H]` (context = groove identity +
  range + Rotate|Ladder toggle driving `?mode=`) → `[T]` (session-ctx slot shows small stave +
  toggle; transportExtras = In-order|Shuffle + End session) → content row. **GrooveHeader 170px card
  DELETED** (all info in `[H]`/`[T]`). End-of-session `SessionSummary` unchanged.
- **GROOVE — LADDER `/drum-fills/groove/[key]?mode=ladder`** — `[H]` (context appends "Rung n/N") →
  flex-row: **left rung rail** (`<ol>` with DifficultyBar, ✓ mastered, click-to-jump — KEPT, still
  scrollable) | right = standard `[T]` + content row. The little "Ladder / Rung n of N" stave card
  atop the rail is removed (its content is in `[H]`); the rung list keeps full functionality.
- **TODAY `/drum-fills/today`** — `[H]` (context = "Today queue — n/N" + Exit→/drum-fills) → `[T]`
  (Next advances internal index, no history push) → content. Thin queue row absorbed into `[H]`.
- **ROULETTE `/drum-fills/roulette`** — same shape as Today; `[H]` context = "Fill roulette" + End;
  `[T]` Next = roulette advance. Unchanged behavior.
- **MIDI/CALIBRATION** — header `[H]` Popover (full `MidiStatus`: dot + count/"not connected" +
  Connect + device badges + Profile + Load profile + Reset + Calibrate (−41ms) + Done).
  `CalibrationDialog` modal opened from the popover, MIDI-gated. Surfaced in exactly 2 deliberate
  places: the `[H]` control + the `[T]` inline ⚠ nudge.

Chrome above the highway on a Groove-rotate session drops from ~534px (≈0.54 vp) to ~**104–120px**
(≈0.11): 64px reclaimed (global nav hidden) + 170px GrooveHeader removed + ~146px from collapsing
title/mode/MIDI-warning/transport into one `[T]` bar. The +20px MIDI-expansion shove is gone (popover).

### Nothing-dropped mapping (every current item → new home)

| Current item                                             | New home                                                                       |
| -------------------------------------------------------- | ------------------------------------------------------------------------------ |
| App-header wordmark + Home/Grooves/Library               | `[H]` (Link-driven, active from pathname)                                      |
| Global nav escape (More Tools)                           | `[H]` "← All tools" link; Discord/GitHub/Log-In unchanged on other routes      |
| GrooveHeader stave + "N fills · N songs · BPM range"     | `[H]` context slot (single canonical copy) + `[T]` session-ctx small stave     |
| Rotate/Ladder toggle                                     | `[H]` context slot + `[T]` session-ctx slot, drives `?mode=`                   |
| PracticeView title (song — artist)                       | `[T]` identity slot                                                            |
| Taxonomy sub-line (BPM · bars · subdiv · cx · voicing)   | `[T]` meta slot (ONLY place; HUD/`[H]` never repeat BPM)                       |
| ModeSwitcher (Song loop / Change mode)                   | `[T]` Loop-mode ▾ chip                                                         |
| MIDI-warning full-width band                             | `[T]` inline ⚠ chip → opens `[H]` MIDI popover; sentence in popover body      |
| Transport (Play/Restart/Next/Tempo/presets/Hits)         | `[T]` transport slots (unchanged controls)                                     |
| transportExtras (shuffle+End session; instance dropdown) | `[T]` inline, unchanged                                                        |
| PracticeHud (Last/Best/Mastery/Streak/Due)               | content-row sidebar, unchanged (BPM removed; "Due" line + Mastery-due deduped) |
| Library scan bar (Scan/Rescan/Cancel/Progress)           | `[H]` scan control + inline progress                                           |
| GroovesView rescan                                       | `[H]` scan control                                                             |
| `needsRescan` amber banner                               | stays in Library page                                                          |
| Ladder "Ladder / Rung n of N" stave card                 | `[H]` context ("Rung n/N"); rail keeps the `<ol>`                              |
| Ladder rung `<ol>` list                                  | left rail, unchanged                                                           |
| Today queue progress row + Exit                          | `[H]` context slot + Exit                                                      |
| MidiStatus (Connect/Profile/Load/Reset/Calibrate)        | `[H]` MIDI popover (content unchanged)                                         |
| CalibrationDialog                                        | unchanged modal, opened from popover                                           |
| SessionSummary (fills seen/practiced/avg)                | unchanged (End session in `[T]`)                                               |
| `refreshKey` remount-on-scan                             | `scanVersion` in chrome context; pages re-fetch on change                      |

### Implementation order (dependency-first)

1. **DB getter (testable, no UI):** add `getGrooveClusterByKey(similarityKey)` to
   `lib/drum-fills/db/index.ts` reusing `buildGrooveClusters` + the existing `byKey` lookup pattern;
   Jest test. _(Commit-able unit on its own per the per-plan commit rule — but this whole plan is one commit.)_
2. **Shared layout + nav scope:** `app/drum-fills/layout.tsx` ('use client') hosting `MidiProvider`,
   `useLibraryScan`, `UnsupportedGate`, the single `[H]` header (wordmark + nav pills + context slot +
   scan control + MIDI popover), `DrumFillsChromeContext` (context slot + `scanVersion`), and the
   `hide-site-nav` body-class effect. Add `site-nav` class + the `globals.css` rule in `app/layout.tsx`.
   Convert `MidiChip` inline-expand → Popover. Verify providers + in-flight scan survive a nav loop.
3. **Routes:** create the 7 `page.tsx` files (thin server shells → existing client views). Wire
   `groove/[key]` to load via `getGrooveClusterByKey` + read `?mode`. Replace all `setView` with
   router calls; delete the `view` union + per-view switch from `ClientPage.tsx` (its remaining
   capability/scan logic moves to the layout). Verify deep links + Back + active-nav highlight.
4. **`PracticeContextBar` `[T]`:** new presentational component; refactor `PracticeView` to render it
   in place of lines 913–969 (title + ModeSwitcher + MIDI-warning + transport), passing identity/meta/
   sessionCtx/loopMode/transport/tempo/midi/hits as props. Update `FillRotationSession`,
   `LadderSession`, `GrooveSession`, `TodayQueue`, `RouletteSession` to feed session-ctx + extras as
   props instead of separate `header`/row JSX. Delete the `GrooveHeader` card and the ladder rail
   stave card. HUD de-dup (remove BPM echo; collapse the two "Due" readouts).
5. **Library scan-bar removal:** delete the standalone scan bar from `LibraryView`; the scan control
   now lives in `[H]`. Keep FilterPanel + virtualization + localStorage intact.
6. **Validate:** `npx jest`; `npx tsc --noEmit`; eslint + prettier on touched files; chrome-devtools
   screenshots of every surface at 1280×800 and 1920×1080 proving ≤2 bands above the highway and no
   page scroll; console clean (ignore known SoundTouch worklet AbortError); confirm deep-link + Back +
   nav-highlight + MIDI/scan persistence across navigation, and the site nav reappears when leaving
   `/drum-fills`.
