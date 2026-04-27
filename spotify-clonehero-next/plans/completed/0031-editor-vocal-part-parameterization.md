# Plan 0031: Vocal-part parameterization (Phase 2)

> **Source:** `plans/chart-editor-architecture-review.md` § "Migration plan → Phase 2"
> **Dependencies:** 0030 (EditorScope landed; `{ kind: 'vocals'; part: string }` shape exists)
> **Unlocks:** Multi-part vocal editing (vocals + harm1/2/3); makes vocal lyric/phrase editing actually general.

## Context

`lib/chart-edit/helpers/lyrics.ts:15` and `lib/chart-edit/helpers/phrases.ts:16` hard-code the part name `'vocals'`. Charts can carry up to four vocal parts: `vocals`, `harm1`, `harm2`, `harm3`. Each has its own lyrics + phrases. Today only the main `vocals` part is editable.

After phase 1, `EditorScope` for vocals is `{ kind: 'vocals'; part: string }`, so the plumbing for selecting the active part exists. This phase wires the helpers to honor it.

## Goal

`getLyrics`, `moveLyric`, `getPhrases`, `movePhraseStart`, `movePhraseEnd`, and the related `entityHandlers.lyric` / `entityHandlers.phrase-start` / `entityHandlers.phrase-end` operate on the part named in the active scope.

## Design

### 1. Helper signatures

`helpers/lyrics.ts` and `helpers/phrases.ts` accept an explicit `partName` argument. Default `'vocals'` for backwards compat in the helper layer; the editor always passes the explicit name from `state.activeScope`.

```ts
export function getLyrics(
  doc: ChartDocument,
  partName: string = 'vocals',
): NormalizedLyricEvent[];
export function moveLyric(
  doc: ChartDocument,
  oldTick: number,
  newTick: number,
  partName?: string,
): void;
export function getPhrases(
  doc: ChartDocument,
  partName: string = 'vocals',
): NormalizedVocalPhrase[];
export function movePhraseStart(
  doc: ChartDocument,
  oldTick: number,
  newTick: number,
  partName?: string,
): void;
export function movePhraseEnd(
  doc: ChartDocument,
  oldEndTick: number,
  newEndTick: number,
  partName?: string,
): void;
```

### 2. Entity handlers

`entityHandlers.lyric.locate / move` already receive `scope` (after phase 1). When `scope.kind === 'vocals'`, pass `scope.part` through to the helpers. Same for the two phrase handlers.

### 3. EntityRef format change

The current opaque tick-based id (e.g. `phrase:1234`) collides across vocal parts. After this phase, ids include the part:

- Lyric: `lyric:{part}:{tick}`
- Phrase start: `phrase:{part}:{tick}`
- Phrase end: `phrase-end:{part}:{endTick}`

This is still a string id — the structured `EntityRef` lands in phase 8. The format change is needed now to avoid lyric+harm1 collisions.

### 4. UI

A simple part selector in the left sidebar **only when the chart has more than one vocal part**. Default to `vocals`. Hidden in single-part charts (which is most charts today).

```ts
state.activeScope = {
  kind: 'vocals',
  part: 'vocals' | 'harm1' | 'harm2' | 'harm3',
};
```

When the user changes parts, the editor reloads markers from the new part's lyrics/phrases. Selection clears (phase 8 introduces stable cross-part refs; for now we punt).

### 5. add-lyrics page

The add-lyrics page mounts the editor with `activeScope: { kind: 'vocals', part: 'vocals' }`. After this phase, if the imported chart has harm1/2/3, the picker becomes visible and the user can switch parts. The export merges all parts back into the chart unchanged.

## Tasks (suggested order)

1. **Update `helpers/lyrics.ts` and `helpers/phrases.ts`** to accept `partName`. Tests cover all four parts.
2. **Update `entityHandlers.lyric` / `phrase-start` / `phrase-end`** to thread `scope.part`.
3. **EntityRef format migration.** Change id format and confirm selection logic still resolves across the format change. Search for any callers parsing the id back into a tick — they need the new format.
4. **Sidebar part selector.** Add a small dropdown in `LeftSidebar` (or a similar slot) that's hidden when `vocalTracks.length <= 1`.
5. **add-lyrics page test pass** — load a chart with harmonies (find one in `~/projects/example-charts` or generate one if needed), confirm switching parts updates the visible markers and that drag works in each part.
6. **Browser validation** on add-lyrics with both single-part and multi-part charts.

## Tests

- `lib/chart-edit/__tests__/lyrics.test.ts` — extend with harm1/2/3 cases. Move within part. Confirm parts don't bleed.
- `lib/chart-edit/__tests__/phrases.test.ts` — same.
- `components/chart-editor/__tests__/vocal-part-selection.test.tsx` — switching `activeScope.part` updates which markers are returned by the entity handlers.

## Open questions

1. **Selection persistence across part switch** — clear (proposed) or migrate by tick to the new part if a matching id exists? Lean: clear. Switching parts is rare; users won't expect drum-style cross-part selection.
2. **Harm1/2/3 visual distinction** — distinguishable color? Out of scope for this phase; the user is only ever looking at one part at a time.

## Out of scope

- Pitched vocal-note editing (the `pitch` field on `NormalizedVocalNote`). Comes when a vocals view exists (phase 9 + later).
- Cross-part lyric moves.
- Adding/removing vocal parts.
- Lyric **text** editing (still timing only).

## Implementation notes (post-implementation)

- **Helpers updated:** `lib/chart-edit/helpers/lyrics.ts` and `helpers/phrases.ts` now take an optional `partName` argument (default `'vocals'`). `DEFAULT_VOCALS_PART` is exported from both modules and re-exported from `lib/chart-edit/index.ts`.
- **EntityRef format:** `lyricId(tick, partName)`, `phraseStartId(tick, partName)`, `phraseEndId(tick, partName)` now produce `{part}:{tick}` strings. Companion `parseLyricId(id)` and `parsePhraseId(id)` accept both the new form and the legacy bare-tick form (interpreted as `'vocals'`) so older selections continue to resolve. The legacy fallback can be dropped after phase 8 introduces structured `EntityRef`.
- **Entity handlers:** `lyricHandler`, `phraseStartHandler`, `phraseEndHandler` resolve `partName` from `EntityContext.partName` (default `'vocals'`). They reject ids whose embedded part doesn't match the active scope's part — this prevents a vocals-scoped command from accidentally moving a harm1 entity if the id is somehow mis-routed.
- **HighwayEditor:** `markerHitToRef(hit, partName)` and a new `markerEntityId(kind, tick, partName)` produce part-aware ids. Marker drag → commit uses `markerEntityId` to construct both the original and current ids. `computeMarkerDragBounds(chart, kind, tick, partName)` now reads from the active part's phrases instead of the hardcoded `parts.vocals`.
- **Renderer:** `chartToElements(parsedChart, track, vocalPartName?)` accepts the active part and pulls lyrics + phrases from `parts[vocalPartName]`. The reconciler key format `lyric:{tick}` / `phrase-start:{tick}` / `phrase-end:{endTick}` stays unchanged — only one part renders at a time, so per-part disambiguation isn't needed at the renderer-key level.
- **LeftSidebar picker:** A new `Vocal Part` Select shows in the sidebar only when (a) the active scope is `vocals` and (b) the chart has more than one part. Switching parts dispatches `SET_ACTIVE_SCOPE` and clears any active lyric/phrase-start/phrase-end selections (selection migration is deferred per the open question — clear is the lean).
- **Multi-part isolation tests:** `lib/chart-edit/__tests__/entities.test.ts` adds a `chartWithMultiPartVocals` factory and 6 new tests proving harm1/harm2/harm3 isolation: `listLyricTicks`, `moveLyric`, `movePhraseStart`, `movePhraseEnd`, scoped `entityHandlers.lyric` listing, scoped phrase-start move, and the legacy bare-tick id fallback. Suite up to 681 tests (was 671).
- **MCP tools:** `EditorMCPTools.tsx` only exposes drum operations today. No update needed for vocal-part scoping.
- **Out of phase 2:** Karaoke renderer (`app/karaoke/`), sheet music (`app/sheet-music/[slug]/SongView.tsx`), add-lyrics export merge (`app/add-lyrics/page.tsx`), and the highway preview's vocal phrase synthesis (`lib/preview/highway/index.ts`) still read `parts.vocals` directly — they're outside the editor's edit pipeline. Phase 9's `VocalsProjection` will revisit those.

Browser validation: still blocked on the worktree's missing `.env`. Type-check, lint (no new warnings), and Jest (681 passing) all green.
