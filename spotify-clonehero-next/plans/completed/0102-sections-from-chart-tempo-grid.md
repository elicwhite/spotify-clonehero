# 0102 — Sections from the chart's own tempo grid

## Problem

The Chart Assist "Sections" card always runs a full Beat This! pass before
LinkSeg: an 83 MB model download on the first run and ~10–14 s of WASM
inference on every run. In `/chart-editor` the chart usually already carries a
tempo map — the user opened an existing chart, or generated one with the Tempo
map card — and that grid is exactly what LinkSeg needs.

## Why this is safe

LinkSeg is robust to its beat source. The A/B is recorded in the drum-to-chart
repo (`msa-adoption-analysis.md`): section output moved <0.02 between madmom
beats and a "perfect grid" generated straight from the ground-truth chart
tempo map (`analysis/linkseg_eval/make_grid_beats.py`). The port's own code
says the same (`lib/section-names/linkseg-windows.ts:47`).

Two constraints from that probe carry over:

1. **Audio is still required.** LinkSeg reads beat-synced mel windows off the
   22.05 kHz full mix. Only the beat grid comes free from the chart.
2. **Quarter-note beats, not downbeats.** Match `make_grid_beats.py`.

## Scope

- `lib/section-names/chart-beat-grid.ts` (new, pure + tested):
  `chartQuarterNoteBeatTimes(parsedChart, durationSeconds)` and
  `hasMusicalTempoGrid(parsedChart)`.
- Pipeline: a `'sections'` run accepts caller-supplied `beatTimes` and then
  skips the Beat This! download and pass entirely.
- `generate-sections` task: an optional `deriveBeatTimes(durationSeconds)`
  input; when present, `planSteps` drops the two beat steps.
- `SectionsCard`: supplies the derivation when the loaded chart has a musical
  grid.

## The reuse rule

Reuse the chart's grid when it looks like a real one: more than one tempo
event, or any notes charted against it. A bare blank-project chart (flat 120
BPM, no notes) has a grid that means nothing musically, so it still runs Beat
This!. A generated tempo map always lands many tempo events, so a chart whose
grid this editor produced qualifies.

## Non-goals

- Changing LinkSeg itself, its operating point, or the tempo-map pipeline.
- Reusing the chart grid anywhere but the sections path (the tempo-map run
  builds the grid, so it cannot read one).
