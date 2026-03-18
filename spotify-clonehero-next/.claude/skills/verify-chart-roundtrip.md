---
name: verify-chart-roundtrip
description: Verify chart serialization round-trips through scan-chart by running or writing Jest tests. All validation must go through Jest — no manual evaluate_script testing.
user_invocable: true
---

# Verify Chart Round-Trip

Test that chart serialization produces output that scan-chart can parse back identically. This is the core correctness check for plans 0002, 0009, and 0010.

**All verification MUST happen through Jest tests.** Never use `evaluate_script` for chart round-trip checks. Even one-off or exploratory checks must be written as a test case first. This ensures every check is repeatable and becomes part of the regression suite.

## Steps

1. **Run existing round-trip tests:**

```bash
yarn test -- --testPathPattern="chart-writer|chart-io|export"
```

If tests pass, report results and stop. If tests fail, report failures with details.

2. **If no tests exist yet**, or if new behavior needs verification, **write a new test** in `lib/drum-transcription/__tests__/chart-writer.test.ts` (or the appropriate test file). Do NOT test via the browser console.

3. **Test structure** — every round-trip test should follow this pattern:

```typescript
import { parseChartFile } from '@eliwhite/scan-chart';
import { serializeChart } from '../chart-io/writer';

describe('chart round-trip', () => {
  test('description of what is being verified', () => {
    // 1. Build a ChartDocument with the specific feature being tested
    const doc = {
      resolution: 480,
      metadata: { name: 'Test', artist: 'Test', resolution: 480 },
      tempos: [{ tick: 0, bpm: 120 }],
      timeSignatures: [{ tick: 0, numerator: 4, denominator: 4 }],
      sections: [],
      endEvents: [],
      tracks: [{
        instrument: 'drums',
        difficulty: 'expert',
        notes: [
          { tick: 0, type: 'kick', length: 0, flags: {} },
        ],
      }],
    };

    // 2. Serialize to .chart text
    const chartText = serializeChart(doc);

    // 3. Parse back with scan-chart
    const parsed = parseChartFile(
      new TextEncoder().encode(chartText),
      'chart',
      { pro_drums: true }
    );

    // 4. Assert specific properties match
    expect(parsed.resolution).toBe(doc.resolution);
    expect(parsed.tempos).toHaveLength(doc.tempos.length);
    // ... more assertions
  });
});
```

4. **Required test cases** — ensure these exist (create any that are missing):

| Test | Verifies |
|------|----------|
| Minimal chart (1 note, 1 tempo) | Basic structure serialization |
| Multiple notes at same tick | Chord grouping (kick + hi-hat) |
| Pro drums cymbal markers | Notes 66/67/68 round-trip, cymbal vs tom flags |
| Tempo changes | Multiple BPM events in SyncTrack, millibeats precision |
| Fractional BPM (e.g., 145.5) | Millibeats encoding (145500) doesn't lose precision |
| Time signature changes | Denominator exponent encoding (4/4, 3/4, 6/8, 7/8) |
| Accent and ghost flags | Modifier note numbers (33-37, 39-43) |
| Double kick | Note 32 alongside note 0 |
| Section markers | `E "section Name"` events with special characters |
| Star power phrases | `S 2` events with lengths |
| Full song simulation | ~500 notes, tempo changes, sections — realistic chart |
| ms → tick → ms round-trip | Timing precision within 1ms after conversion chain |

5. **Run the tests** after writing them:

```bash
yarn test -- --testPathPattern="chart-writer|chart-io" --verbose
```

6. **Report** — which tests pass, which fail, and for failures show the expected vs actual diff.

## When to use this skill

- After any change to the chart writer (`lib/drum-transcription/chart-io/writer.ts`)
- After any change to chart types or note mapping
- After implementing export packaging (0009, 0010) to verify exported charts parse correctly
- When investigating a chart that doesn't load correctly in Clone Hero or scan-chart
