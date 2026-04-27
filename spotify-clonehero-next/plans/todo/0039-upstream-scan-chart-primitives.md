# Plan 0039: Upstream scan-chart primitives (parallel side-track)

> **Source:** `plans/chart-editor-architecture-review.md` § "Upstream-to-scan-chart side track"
> **Runs parallel to:** 0035 (edit-path performance) and 0037 (chart-editor-core).
> **Unlocks:** Replacing the writer/parser round-trip with a targeted recompute.

## Context

scan-chart owns the canonical type system and computes derived fields (`msTime`, HOPO inference, chord shapes, drumType lane validation, sustain caps) **during parse**. It does not currently expose those computations as callable primitives — chart-edit and chart-editor have to re-parse the entire chart bytes to refresh derived fields.

The architecture review's no-duplication principle says: where scan-chart knows a rule but doesn't expose it, push upstream rather than reimplementing locally.

## Goal

Add primitives to scan-chart for use by chart-edit's normalization layer. Drop or defer redundant local code.

## Candidate primitives

| Primitive                                          | Purpose                                                                                                         | Replaces                                                       |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `recomputeDerived(parsedChart, dirtyRanges?)`      | Refresh msTime, HOPOs, chord shapes, drumType validation, sustain caps. Optional ranges allow incremental work. | `writeChartFolder + parseChartFile` round-trip                 |
| `tickToMs(parsedChart, tick)`                      | Compute ms from tick using the chart's tempo map.                                                               | `lib/drum-transcription/timing.ts buildTimedTempos / tickToMs` |
| `recomputeNoteTimings(parsedChart, dirtyRanges)`   | Per-field equivalent: only msTime.                                                                              | (subset of above)                                              |
| `recomputeChordFlags(parsedChart, dirtyRanges)`    | Per-field equivalent: only HOPOs / chord membership.                                                            | (subset of above)                                              |
| `recomputeMarkerTimings(parsedChart, dirtyRanges)` | Section / tempo / timesig msTime.                                                                               | (subset of above)                                              |
| `validateOperation(parsedChart, op)`               | Run the issue catalog against a proposed operation, returning `ChartIssueType[]`.                               | Editor-side ad-hoc validation                                  |
| `defaultIniChartModifiers` (export)                | The default modifier set for a fresh chart.                                                                     | `PRO_DRUMS_MODIFIERS` local constant                           |

## Design

### 1. recomputeDerived signature

```ts
interface RecomputeOptions {
  ranges?: TickRange[];
  fields?: Set<'msTime' | 'hopo' | 'chord' | 'drumType' | 'sustain'>;
}

export function recomputeDerived(
  parsedChart: ParsedChart,
  options?: RecomputeOptions,
): ParsedChart;
```

Implementation: extract the derivation passes from the existing parser into separately callable functions. Each pass takes a `ParsedChart` and a range filter, mutates a clone, returns the new chart.

If `ranges` is undefined, recompute everywhere. If a `fields` set is provided, only run the named passes.

### 2. tickToMs primitive

```ts
export function tickToMs(parsedChart: ParsedChart, tick: number): number;
```

Reads from the chart's normalized tempo map. O(log n) via binary search on tempo events.

### 3. validateOperation primitive

This may be too narrow for scan-chart's scope. Alternative: scan-chart exposes a `validateChart(parsedChart): ChartIssueType[]` and chart-edit composes it on a candidate post-op chart for operation-scoped validation.

### 4. Releases

scan-chart is `@eliwhite/scan-chart` published to npm (per memory). Each upstreamed primitive is a minor version bump. Coordinate the consumer-side bump with chart-edit's adoption.

## Tasks (suggested order)

This work happens in `~/projects/scan-chart` (or wherever the fork lives) and follows its release process. Sketch:

1. **Audit existing local re-implementations.** Confirm which exist:
   - `lib/drum-transcription/timing.ts buildTimedTempos / tickToMs` — likely redundant with parsed `msTime` fields.
   - `chartFileNames` filter in `lib/chart-edit/index.ts:130` — verify whether `parseChartAndIni` already classifies assets.
   - Any other tick→ms or HOPO-checking code in this repo.
2. **`tickToMs` upstream.** Smallest primitive; lowest risk. Publish, bump consumer, replace the local implementation. Drop or alias `lib/drum-transcription/timing.ts`.
3. **`defaultIniChartModifiers` export.** Verify it isn't already exported (memory suggests it is); if not, export it. `useEditCommands.ts` consumes it.
4. **`recomputeDerived` upstream.** Larger surface; gated by 0035's `dirtyRanges` plumbing being in place on the editor side.
5. **`validateOperation` or `validateChart` primitive.** Coordinated with phase 8's validation layer (0037).

## Tests

Tests run on the scan-chart side. Each new primitive needs:

- Unit tests against the existing chart fixtures.
- A round-trip test: `recomputeDerived(parseChart(bytes))` produces the same `parsedChart` as `parseChart(bytes)`. Idempotent.
- An incremental test: dirty range `[a, b]` recomputes only events in that range; events outside are bit-for-bit identical.

## Open questions

1. **scan-chart fork ownership.** This repo uses `@eliwhite/scan-chart`. Confirm the upstream fork process (PR to upstream first, or direct push to `@eliwhite` scope?). Per memory: `@eliwhite/scan-chart` is the publish target; patches don't necessarily land upstream.
2. **`recomputeDerived` complexity.** If extracting derivation passes from the parser is non-trivial, this work may shift to a chart-edit local for v1, with the upstream as v2. Decide based on cost during 0035 / 0037.
3. **Issue type catalog stability.** scan-chart's issue type unions may evolve as the editor exposes new validation paths. Coordinate API stability with the editor's `ValidationIssue` alias type.

## Out of scope

- Rewriting scan-chart's parser end-to-end.
- Moving editor-specific rules into scan-chart. Editor rules stay in chart-edit; scan-chart only exposes what's already its responsibility.
- Browser-based scan-chart bundling improvements.
