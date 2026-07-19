# 0057 — GridOverlay tempo grid ignores time-signature denominators

## Problem

On /preview (e.g. "The Only Difference…" md5 3303a74a, which contains a
17/16 bar) the beat grid doesn't align with the notes, and the 17/16
measure doesn't show its 17 sixteenth-note beat lines.

## Root causes (all in `lib/preview/highway/GridOverlay.ts` `computeBeats`)

1. **Denominator ignored.** The walk always advances by one quarter
   note (`currentTick += resolution`). For x/16 the beat unit is a
   sixteenth (`resolution * 4 / denominator` ticks), so a 17/16 bar
   renders ~4 quarter lines instead of 17 sixteenth lines.
2. **No re-anchoring at TS changes.** A 17/16 measure is 4.25 quarter
   notes long; since ticks only move in whole-resolution steps from 0,
   every beat line after that bar is permanently offset by 0.25 beat
   from the real beats (the notes use scan-chart's correct timing).
3. **Measure counting in the wrong unit.** `beatsPerMeasure =
numerator` counted in quarter-note steps → a 17/16 "measure" line
   every 17 quarter notes; and `beatInMeasure` resets at a TS change
   without snapping `currentTick` to the TS tick.

## Fix

- Extract the grid computation into a pure exported function
  `computeBeatGrid(config)` in GridOverlay.ts (returns
  `{tick, msTime, isMeasure}[]`), used by the class.
- Walk per TS region: anchor at each `ts.tick`,
  `beatTicks = resolution * 4 / denominator`,
  measure line every `numerator` beats, jump to the next TS tick when
  the region ends (matches how Clone Hero/YARG generate beatlines).
- Prepend an implicit 4/4 at tick 0 when the chart's first TS starts
  later or is missing.

## Verification

- Jest tests: 4/4 baseline; 6/8 denominator scaling; a 17/16 bar
  between 4/4 regions (17 beats in the bar, next region re-anchored at
  the TS tick, no cumulative drift); missing/late first TS.
- Browser: /preview with the reporting chart — grid lines sit on the
  notes through and after the 17/16 bar.
