# Plan 0027: Chart-Audio Delay Alignment

> **Dependencies:** None (cross-cutting fix)
> **Unlocks:** Correct timing for all chart types with delay/offset
>
> **Goal:** Properly align chart notes with audio playback by accounting for the chart's delay/offset metadata everywhere timing is compared. Use a utility function approach — a single `getChartDelayMs(metadata)` function that all consumers use to convert between audio time and chart time.

## Context

Charts can specify a delay between audio start and chart start:
- **`delay`** (song.ini) — milliseconds, positive = audio has lead-in silence before notes start
- **`chart_offset`** (`.chart` Offset field) — seconds, same meaning
- **Negative values** — chart starts before audio (audio should be delayed)

Currently only the highway animation loop accounts for this (added in a recent fix). Sheet music, click track, measure highlighting, editor seeking, and timeline display all ignore it.

## The Utility

```typescript
// lib/chart-utils/chartDelay.ts

/**
 * Compute the normalized chart delay in milliseconds from chart metadata.
 *
 * `delay` (ms, from song.ini) takes precedence.
 * `chart_offset` (seconds, from .chart Offset field) is only used as a
 * fallback if `delay` is not set. They are NOT combined — this matches
 * YARG's behavior.
 *
 * Positive value: audio has lead-in silence before the chart starts.
 * Negative value: chart starts before the audio.
 *
 * Usage:
 *   chartTimeMs = audioTimeMs - chartDelayMs   (reading: where is the chart?)
 *   audioTimeMs = chartTimeMs + chartDelayMs   (seeking: play audio at chart position)
 */
export function getChartDelayMs(
  metadata: { delay?: number; chart_offset?: number } | undefined,
): number {
  if (!metadata) return 0;
  // delay (ms) takes precedence; chart_offset (seconds) is fallback only
  if (metadata.delay != null && metadata.delay !== 0) {
    return metadata.delay;
  }
  if (metadata.chart_offset != null) {
    return metadata.chart_offset * 1000;
  }
  return 0;
}
```

## Consumers to Update

### 1. Highway animation loop (already done — verify uses utility)
**File:** `lib/preview/highway/index.ts`
**Current:** `chart.metadata?.delay ?? 0`
**Change:** Use `getChartDelayMs(chart.metadata)`

### 2. InteractionManager elapsed time
**File:** `lib/preview/highway/index.ts` (getElapsedMs callback)
**Current:** `currentMs - delay` (only audio latency)
**Change:** `currentMs - delay - chartDelayMs`

### 3. Sheet music playhead
**File:** `app/sheet-music/[slug]/Playhead.tsx`
**Current:** `audioManager.currentTime * 1000` (raw audio time)
**Change:** `audioManager.currentTime * 1000 - chartDelayMs`

### 4. Sheet music measure highlighting
**File:** `app/sheet-music/[slug]/SheetMusic.tsx`
**Current:** Compares `measure.startMs` against raw `currentTime * 1000`
**Change:** Compare against `currentTime * 1000 - chartDelayMs`

### 5. Click track generation
**File:** `app/sheet-music/[slug]/generateClickTrack.ts`
**Current:** Schedules clicks at `measure.startMs`
**Change:** Schedule at `measure.startMs + chartDelayMs` (offset clicks to match audio)

### 6. Editor transport time display
**File:** `components/chart-editor/TransportControls.tsx`
**Current:** Shows raw `audioManager.currentTime`
**Change:** Show `audioManager.currentTime - chartDelayMs/1000` (chart-relative time)

### 7. Editor timeline minimap
**File:** `components/chart-editor/TimelineMinimap.tsx`
**Current:** Uses raw `audioManager.currentTime * 1000`
**Change:** Use `audioManager.currentTime * 1000 - chartDelayMs`

### 8. Editor keyboard seek (getCursorFromAudio)
**File:** `components/chart-editor/hooks/useEditorKeyboard.ts`
**Current:** `msToTick(am.currentTime * 1000, ...)`
**Change:** `msToTick(am.currentTime * 1000 - chartDelayMs, ...)`

### 9. Editor wheel scroll
**File:** `components/chart-editor/HighwayEditor.tsx`
**Current:** `am.currentTime * 1000` for position, `am.play({time: ms / 1000})` for seek
**Change:** Reading: `am.currentTime * 1000 - chartDelayMs`. Seeking: `am.play({time: (ms + chartDelayMs) / 1000})`

### 10. Editor seek helpers (seekToTick)
**File:** `components/chart-editor/hooks/useEditorKeyboard.ts`
**Current:** `am.play({time: ms / 1000})`
**Change:** `am.play({time: (ms + chartDelayMs) / 1000})`

### 11. Practice mode / loop region
**File:** `lib/preview/audioManager.ts` (setPracticeMode)
**Current:** Uses raw ms values
**Change:** Add chartDelayMs when setting loop boundaries

## How to get chartDelayMs to each consumer

### Highway renderer
Already has access to `chart.metadata` in `setupRenderer`. Pass to `startRender` and `getElapsedMs` callback.

### Sheet music page
`SongView.tsx` has access to `chart` (ParsedChart). Compute `chartDelayMs = getChartDelayMs(chart.metadata)` and pass to `Playhead`, `SheetMusic`, and `generateClickTrack`.

### Editor (drum-edit / drum-transcription)
The editor has access to `chartDoc.metadata` via context. Compute `chartDelayMs` in the editor components or pass through context.

## Seeking Convention

When converting between chart time and audio time:

```
chartTimeMs = audioTimeMs - chartDelayMs    // "where in the chart are we?"
audioTimeMs = chartTimeMs + chartDelayMs    // "where in the audio should we play?"
```

- `play({time: X})` takes AUDIO time (seconds)
- Chart note `msTime` values are CHART time (0 = first tick)
- `audioManager.currentTime` returns AUDIO time

## Execution Order

1. Create `lib/chart-utils/chartDelay.ts` with `getChartDelayMs()`.
2. Update highway renderer to use the utility.
3. Update InteractionManager getElapsedMs.
4. Update sheet music: Playhead, SheetMusic, generateClickTrack.
5. Update editor: TransportControls, TimelineMinimap, HighwayEditor, useEditorKeyboard.
6. Add unit tests for `getChartDelayMs()` (positive, negative, both fields, missing metadata).
7. Test with charts that have non-zero delay.

## Verification

```bash
yarn test
yarn lint
```

Test with a chart that has delay=2000 (like Beautiful Losers by Coheed And Cambria on sheet-music) to verify notes align with audio.
