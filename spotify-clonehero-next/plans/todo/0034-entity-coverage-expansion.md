# Plan 0034: Expand entity coverage (Phase 5)

> **Source:** `plans/chart-editor-architecture-review.md` § "Migration plan → Phase 5"
> **Dependencies:** 0033 (HighwayEditor decomposed)
> **Unlocks:** Phase 8 (`EntityAdapter` migration is easier when all kinds already conform to a single shape).

## Context

`EntityKindHandler` covers `note | section | lyric | phrase-start | phrase-end`. BPM markers, time signatures, star power phrases, solo sections, drum activation lanes, and drum flex lanes have ad-hoc command classes (`AddBPMCommand`, `AddSoloSection`, etc.) and **don't participate in unified selection / drag / undo**.

Adding them as entity kinds buys:

- Unified drag (select a star power phrase, hold-drag both endpoints).
- Unified delete via `Delete` keyboard shortcut.
- Cross-kind box-select (e.g. drag-select a region containing notes + a tempo marker).
- Phase 8's adapter migration covers them automatically.

## Goal

Every editable object on the highway is an entity with `listIds / locate / move`. The drum-only kinds are capability-gated; non-drum tracks (after phase 9) won't expose them.

## New entity kinds

- `bpm` — single tick, no length.
- `timesig` — single tick, no length.
- `star-power-start` + `star-power-end` — two-handler pattern (mirrors phrase-start/phrase-end).
- `solo-start` + `solo-end` — same.
- `drum-activation-start` + `drum-activation-end` — capability-gated drum-only.
- `drum-flex-lane-start` + `drum-flex-lane-end` — capability-gated drum-only.

Drum activation lanes and flex lanes are stored on the drum track; star power and solo are per-track for instruments that support them.

## Design

### 1. Handler structure

For length-bearing entities, the start and end handlers share a `helpers/<kind>.ts` file with `addX`, `removeX`, `moveXStart`, `moveXEnd`, `getXs`. The handler IDs are scoped by `(track, index, start|end)` after phase 1. Two handlers both reference the same underlying object; moving one moves only that endpoint.

```ts
// helpers/star-power.ts
export interface StarPowerPhrase {
  startTick: number;
  lengthTicks: number;
}

export function getStarPowerPhrases(
  doc: ChartDocument,
  scope: EditorScope,
): StarPowerPhrase[];
export function addStarPower(
  doc: ChartDocument,
  scope: EditorScope,
  phrase: StarPowerPhrase,
): void;
export function moveStarPowerStart(doc, scope, oldStart, newStart): void;
export function moveStarPowerEnd(doc, scope, oldEnd, newEnd): void;
```

Same shape for solo, drum activation, drum flex lane.

### 2. EntityRef format (interim, pre-phase-8)

- BPM: `bpm:{tick}`
- Timesig: `timesig:{tick}`
- Star power: `sp:{instrument}:{difficulty}:{phraseIndex}:start|end`
- Solo: `solo:{instrument}:{difficulty}:{soloIndex}:start|end`
- Drum activation: `da:{difficulty}:{laneIndex}:start|end`
- Drum flex lane: `dfl:{difficulty}:{laneIndex}:start|end`

These id formats are interim — phase 8 replaces with a structured `EntityRef`.

### 3. Capability gates

`EditorCapabilities` already gates per-`EntityKind`. Add the new kinds to the existing sets. Drum-edit preset includes the drum-only ones; add-lyrics preset excludes everything except lyrics + phrases.

### 4. UI for new kinds

- Tempo + timesig markers: drag works on the existing markers (already rendered). No new visuals.
- Star power: visible on the highway as the existing star power phrase. Selection highlight + endpoint drag handles (small spheres at start/end ticks).
- Solo, activation, flex lane: same handle pattern as star power.

Visual handle implementation reuses the phrase-end MarkerRenderer — phrase boundaries already render an endpoint marker; the new kinds get the same treatment.

### 5. MoveEntitiesCommand (already generic)

`MoveEntitiesCommand` already takes a `kind`. New kinds just need their handlers registered; the command works unchanged. **Verify this** during the first kind's implementation.

## Tasks (suggested order)

1. **`bpm` and `timesig` handlers** (single-tick, no length). Smallest path; verify the `MoveEntitiesCommand` integration works for kinds without a length.
2. **`star-power-start` / `star-power-end` handlers.** Both endpoints share `helpers/star-power.ts`. Add to drum-edit + future-guitar capability sets.
3. **`solo-start` / `solo-end` handlers.**
4. **`drum-activation-start` / `drum-activation-end` handlers.** Capability-gated.
5. **`drum-flex-lane-start` / `drum-flex-lane-end` handlers.** Capability-gated.
6. **Renderer integration** — ensure the SceneReconciler treats the new endpoint handles as their own kind so InteractionManager can hit-test them.
7. **InteractionManager hit-test paths** for each new kind.
8. **Browser validation** on drum-edit: select tempo, drag tempo, delete tempo, undo. Same for star power phrase, solo, activation, flex lane.

## Tests

- `lib/chart-edit/__tests__/star-power.test.ts` — add / remove / move-start / move-end. Reject inversion. Reject crossing adjacent phrase.
- `lib/chart-edit/__tests__/solo.test.ts` — same.
- `lib/chart-edit/__tests__/drum-activation.test.ts` — capability-gated; only valid on drum tracks.
- `lib/chart-edit/__tests__/drum-flex-lane.test.ts` — same.
- `lib/chart-edit/__tests__/bpm-timesig.test.ts` — add / remove / move; verify msTime gets recomputed correctly via the round-trip.
- Each command's execute/undo test.

## Open questions

1. **Single endpoint adjustment** — when the user drags a star power phrase as a unit (both endpoints together), is that one `BatchCommand` of two moves, or a separate "move-phrase-rigid" mechanic? Lean: `BatchCommand`. Keeps the entity handlers simple.
2. **Cross-track selection of star power / solo** — if the user has two tracks visible (phase 9), can they multi-select star power across both? Out of scope for this phase. Keep selection bounded by `activeScope` for now.

## Out of scope

- "Event" track entities (Moonscraper's `[Events]` section beyond named sections). The chart format already supports them but we have no existing UI; deferred.
- Practice / activation phrase scoring. Just timing edits.
- Adding a new toolbar tool per kind. The user creates each via the right-click context menu (existing pattern) or via menu actions; new tools land in phase 9's tool plugin system.
