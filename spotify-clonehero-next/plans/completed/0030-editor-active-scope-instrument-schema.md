# Plan 0030: Active scope + instrument lane registry (Phase 1)

> **Source:** `plans/chart-editor-architecture-review.md` § "Migration plan → Phase 1"
> **Dependencies:** 0029 (capabilities + lyric/phrase drag landed)
> **Unlocks:** 0031 (vocal-part parameterization), all subsequent phases.

## Context

Today the chart editor implicitly assumes `instrument === 'drums' && difficulty === 'expert'`. `findExpertDrumsTrack(doc)` is called from `lib/chart-edit/entities/index.ts:131`, `components/chart-editor/ChartEditor.tsx`, `ChartEditorContext.tsx`, `HighwayEditor.tsx`, `useEditCommands.ts`, `useEditorKeyboard.ts`, `NoteInspector.tsx`, `EditorMCPTools.tsx`, and `DrumHighwayPreview.tsx`. The state object also stores both `chartDoc` and a manually-mirrored `chart` plus a `track` slice.

Lane geometry is duplicated in three places: `LANE_ORDER` in `lib/chart-edit/entities/index.ts:82` and `components/chart-editor/commands.ts:474`, world positions in `lib/preview/highway/InteractionManager.ts:14`, and place-mode key bindings inline in `useEditorKeyboard.ts`. Flag bindings (`Q`/`A`/`S`) and `PRO_DRUMS_MODIFIERS` are likewise hardcoded.

The architecture review's **non-negotiable principle** applies: scan-chart owns the canonical type system (`Instrument`, `Difficulty`, `NoteType`, `noteFlags`, `IniChartModifiers`, `defaultIniChartModifiers`). The instrument schema introduced here is a presentation layer over those primitives, never a re-declaration.

## Goal

1. Introduce an explicit **`EditorScope`** in editor state. `state.track` and `state.chart` go away; `chartDoc + activeScope` is the source of truth.
2. Define an **`InstrumentSchema`** that carries lane → display data + scan-chart `NoteType`, plus flag bindings and place-mode keys. One schema for drums (covering 4-lane and 5-lane via `LaneDefinition.variant`) and one for guitar.
3. Replace every `findExpertDrumsTrack` / `findExpertDrumsIndex` call with a generic `findTrack(doc, trackKey)` lookup driven by the active scope.
4. Pin `activeScope` in each consumer page (`drum-edit`, `drum-transcription`, `add-lyrics`).
5. Drop the local `PRO_DRUMS_MODIFIERS` constant — read modifiers from `chartDoc.parsedChart.iniChartModifiers`, falling back to scan-chart's `defaultIniChartModifiers`.

The active-track **picker UI** is explicitly deferred (no current consumer needs it; will land in phase 9 alongside `/guitar-edit`). Phase 1 ships the data model + selector hook + a programmatic API.

## Non-goals

- No new instrument support yet. Guitar `InstrumentSchema` is defined but not consumed by any page in this phase.
- No `ChartOperation` / `EntityAdapter` rewrite (phase 8).
- No projection layer (phase 9). The renderer stays on its current props contract.
- No EditorProfile (phase 8). Capabilities config keeps its current shape.

## Design

### 1. EditorScope in state

```ts
import type {Instrument, Difficulty} from '@eliwhite/scan-chart';

export type TrackKey = {instrument: Instrument; difficulty: Difficulty};

export type EditorScope =
  | {kind: 'global'}
  | {kind: 'track'; track: TrackKey}
  | {kind: 'vocals'; part: string};
```

Reducer state:

- Replace `chart: ParsedChart`, `track: ParsedTrackData | null` slices with `activeScope: EditorScope`.
- `chartDoc` stays; helpers derive everything else from it.
- Memoized selectors live in a small `selectors.ts` file: `selectActiveTrack(state)`, `selectActiveLanes(state)`, `selectActiveSchema(state)`, `selectIniModifiers(state)`.

### 2. InstrumentSchema as data

```ts
import type {Instrument, NoteType} from '@eliwhite/scan-chart';
import {noteTypes, noteFlags} from '@eliwhite/scan-chart';

export interface LaneDefinition {
  index: number;
  noteType: NoteType;
  label: string;
  color: string;
  defaultKey?: string;
  worldXOffset: number;
  variant?: string; // '4-lane' | '5-lane' | undefined
}

export interface FlagBinding {
  flag: keyof typeof noteFlags;
  label: string;
  defaultKey?: string;
  appliesTo?: NoteType[];
}

export interface InstrumentSchema {
  instrument: Instrument;
  lanes: LaneDefinition[];
  flagBindings: FlagBinding[];
  defaultLaneForNewNote: (laneIndex: number) => {type: NoteType; flags: number};
}
```

Two schemas in `lib/chart-edit/instruments/`:

- `drums.ts` — kick / red / yellow / blue / orange / green (5-lane variant only includes green).
- `guitar.ts` — open / green / red / yellow / blue / orange.

`schemaForTrack(track)` selects the right schema. For drums it inspects `track.drumType` (4-lane vs 5-lane) and returns the right lane subset.

### 3. Sweep `findExpertDrumsTrack`

New helper in `lib/chart-edit/index.ts`:

```ts
export function findTrack(
  doc: ChartDocument,
  key: TrackKey,
): {track: ParsedTrackData; index: number} | null;
```

Replace all 14+ callsites. `entityHandlers.note` takes the active `TrackKey` from a context object rather than calling `findExpertDrumsTrack` directly — this requires a small interface change: `EntityKindHandler.locate` and `move` receive `(doc, id, scope)`.

### 4. Consumer pinning

- `app/drum-edit/page.tsx` — `<ChartEditor activeScope={{ kind: 'track', track: { instrument: 'drums', difficulty: 'expert' } }} />`.
- `app/drum-transcription/components/EditorApp.tsx` — same.
- `app/add-lyrics/page.tsx` — `{ kind: 'vocals', part: 'vocals' }`.

If a consumer doesn't pass `activeScope`, the editor falls back to the first available track (with a console warning during this transition phase).

### 5. Drop PRO_DRUMS_MODIFIERS

`useEditCommands.ts:11` defines `PRO_DRUMS_MODIFIERS` as a local const. Replace with:

```ts
function getModifiers(doc: ChartDocument): IniChartModifiers {
  return doc.parsedChart.iniChartModifiers ?? defaultIniChartModifiers;
}
```

`defaultIniChartModifiers` is imported from scan-chart. If scan-chart doesn't export it (verify in implementation), open an upstream PR — see `0039-upstream-scan-chart-primitives.md`.

### 6. InteractionManager lane positions

`LANE_X_POSITIONS` in `InteractionManager.ts:14` becomes a runtime input: the manager receives `lanes: LaneDefinition[]` from the active schema and reads `worldXOffset` per index. Same for `screenToLane` lookup.

## Tasks (suggested order)

1. **Add `TrackKey` / `EditorScope` types** to `components/chart-editor/types.ts`. Import `Instrument`, `Difficulty` from scan-chart.
2. **Define `InstrumentSchema` types and the drums + guitar schemas** in `lib/chart-edit/instruments/`. Tests verifying lane → NoteType bindings match scan-chart's `noteTypes`.
3. **Add `findTrack(doc, key)` helper** in `lib/chart-edit/index.ts`. Tests.
4. **Rewire `entityHandlers.note`** to take a `TrackKey` (passed via the scope-aware locate/move shape). Backwards-compatible default during migration.
5. **Reducer surgery** — replace `chart` + `track` slices with `activeScope`. Add `selectors.ts`. Update `EXECUTE_COMMAND` / `UNDO` / `REDO` paths. **Update reducer tests if any exist; add minimal new tests for the selector path.**
6. **Sweep `findExpertDrumsTrack` callsites** across `ChartEditor`, `ChartEditorContext`, `HighwayEditor`, `commands.ts`, `useEditorKeyboard`, `useEditCommands`, `NoteInspector`, `EditorMCPTools`, `DrumHighwayPreview`. Each callsite reads `state.activeScope` and either calls `findTrack` or pulls from a memoized selector.
7. **Pin scopes in consumer pages** — drum-edit, drum-transcription, add-lyrics.
8. **Drop `PRO_DRUMS_MODIFIERS`.** Use parsed modifiers + scan-chart's `defaultIniChartModifiers`. Verify scan-chart exports it; if not, create an upstream task.
9. **Read lane positions from `InstrumentSchema`** in `InteractionManager`. Drop `LANE_X_POSITIONS` const.
10. **Browser validation** for all three consumer pages: drum-edit, drum-transcription, add-lyrics. Take screenshots, verify console clean, hit-test still hits the right lanes, undo/redo still work, MCP tools (where exercised) still resolve to the right track.

## Tests

- `lib/chart-edit/__tests__/instruments.test.ts` — schema → NoteType identity for drums (4-lane + 5-lane) and guitar.
- `lib/chart-edit/__tests__/find-track.test.ts` — `findTrack(doc, key)` returns the right slice for each `(instrument, difficulty)` combo, returns `null` for missing.
- `lib/chart-edit/__tests__/entity-handlers.test.ts` — extend existing test to verify `noteHandler` works with a non-default `TrackKey`.
- Browser validation per CLAUDE.md.

## Open questions

1. **Schema variant for 5-lane drums** — store one schema with conditional lane subset, or two schemas (`drums-4` / `drums-5`) and a selector? Lean: one schema, `lanes` filtered by the track's `drumType`. Simpler for guitar later (no variant) and lets the schema register both 4-lane red and 5-lane green by `variant`.
2. **`activeScope` default when not provided** — fall through to the first track with a warning, or hard-error? Lean: warning + fallback during this transition phase, hard-error after phase 1 lands across all consumers.
3. **Editing a chart that has no tracks** — `add-lyrics` already supports this via lanes-off. Verify the scope `{ kind: 'vocals', part: 'vocals' }` doesn't try to resolve a notes track anywhere.

## Out of scope

- Active-track picker UI (deferred to phase 9).
- Vocal-part parameterization (phase 2).
- Hotkey registry (phase 7) — `useEditorKeyboard` keeps its inline lane-key map for now, though it now reads from `schema.lanes[i].defaultKey` instead of a private const.
- Touching `EntityKindHandler` shape beyond adding scope to `locate` / `move` (phase 8 replaces it).

## Implementation notes (post-implementation)

What landed vs. what shifted to later phases:

- **`state.chart` and `state.track` removed from `ChartEditorState`.** The follow-up commit on PR #20 dropped both slices along with the `SET_CHART` action and the manual `newTrack` re-derivation in the reducer. Consumers read `state.chartDoc.parsedChart` directly and resolve the active track via `selectActiveTrack(state)`. `useEditCommands` now stores the rebuilt (re-parsed) chartDoc in `state.chartDoc`, so derived fields remain consistent without the parallel slice.
- **`InteractionManager` and `SceneOverlays` read `LANE_X_POSITIONS` from the schema.** Both renderer-side consumers now derive lane positions from `drums4LaneSchema.lanes[i].worldXOffset`. The renderer's `calculateNoteXOffset` is the formula the schema mirrors; if the formula changes, both update together. Phase 9's projection work no longer has lane-geometry to migrate.
- **`LaneDefinition.worldXOffset` was added to the schema.** Mirrors the same formula as `calculateNoteXOffset`, with a kept-in-sync comment in `instruments/drums.ts`. Schema is now the single source of truth for lane geometry.
- **`EntityKindHandler` shape changed minimally.** Added an optional `EntityContext = { trackKey?: TrackKey; partName?: string }` parameter to `listIds` / `locate` / `move`. Note-targeting handlers require `trackKey`; vocal handlers default `partName` to `'vocals'`; chart-wide handlers ignore the context. Phase 8 (plan 0037) replaces this with `EntityAdapter` + structured `EntityRef`.
- **Drum-specific commands require `trackKey: TrackKey`.** `AddNoteCommand`, `DeleteNotesCommand`, `ToggleFlagCommand` capture the target track at construction time. The `DEFAULT_DRUMS_KEY` fallback in `commands.ts` and `entities/index.ts` was removed in the follow-up commit; callers narrow the active scope before invoking. `MoveEntitiesCommand` accepts the broader `ctx?: EntityContext`.
- **`selectActiveTrack(state)` selector** was added in `ChartEditorContext.tsx` rather than a separate `selectors.ts`. The selector list will grow into its own file when phase 8 splits state.
- **`PRO_DRUMS_MODIFIERS` consolidation.** `readChart(files, override?)` accepts an `iniChartModifiersOverride` and re-parses the chart bytes with the merged modifiers, so the override takes effect at parse time. `drum-edit` and `drum-transcription/EditorApp` pass `{pro_drums: true}` so tom/cymbal interpretation is consistent from the first parse through every edit / re-parse cycle.
- **`schemaForTrack(track, drumType?)` signature.** `drumType` lives on `ParsedChart`, not on `ParsedTrackData`, so callers pass it explicitly. The drums schema dispatches on `drumType === 'fiveLane'`.
- **Guitar `flagBindings` use `strum / hopo / tap`.** scan-chart's `noteFlags` does not include `force` — the schema mirrors what scan-chart actually exposes.
- **Lane/flag lookups are schema-driven.** `LANE_ORDER` (commands.ts, entities/index.ts), `LANE_KEY_MAP` + `FLAG_SHORTCUT_MAP` (useEditorKeyboard.ts), `FLAG_ITEMS` (NoteInspector.tsx) all derive at module load from `drums4LaneSchema`. Adding/renaming a lane or shortcut is a schema-only change.

Pages now scoped:

- `app/drum-edit/page.tsx` → `DEFAULT_DRUMS_EXPERT_SCOPE`.
- `app/drum-transcription/page.tsx` → `DEFAULT_DRUMS_EXPERT_SCOPE`.
- `app/add-lyrics/page.tsx` → `DEFAULT_VOCALS_SCOPE`.

Browser validation status: blocked on the worktree missing `.env` (Supabase env vars required by middleware). User declined a `.env` copy for security reasons; manual copy / symlink / skip remains an open option. Type-check, lint, and Jest (674 passing) all green.
