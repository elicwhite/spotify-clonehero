# scan-chart Patches Spec

Parser bugs and limitations in `@eliwhite/scan-chart@7.2.1` discovered by the
cross-format validation test suite (`real-charts.test.ts`). All changes are
applied via `patch-package` to `dist/index.js` (compiled output).

## Patch 1: .chart parser — missing drum note mappings

`getEventType()` for drums is missing three note numbers. Events using these
notes are silently dropped during `.chart` parsing.

| .chart note | EventType | Name |
|-------------|-----------|------|
| 33 | `kickAccent` (50) | Kick accent modifier |
| 39 | `kickGhost` (44) | Kick ghost modifier |
| 109 | `forceFlam` (32) | Flam modifier |

**Fix:** Add three `case` branches to the drum `switch (value)` block inside
`getEventType()`:

```javascript
case "33": return eventTypes.kickAccent;
case "39": return eventTypes.kickGhost;
case "109": return eventTypes.forceFlam;
```

**Validated by:** `real-charts.test.ts` — removes need for the
`CHART_PARSER_UNSUPPORTED` and `ACCENT_GHOST_TYPES` filter sets.

## Patch 2: .chart parser — E events in track sections silently dropped

The track-section line regex:

```
/^(\d+) = ([A-Z]+) ([\w\s[\]]+?)( \d+)?$/
```

uses `[\w\s[\]]` which does **not** include `"`. Lines like
`60900 = E "solo"` fail to match and are silently dropped. This means:

- Solo sections (`E "solo"` / `E "soloend"`) in track sections → lost
- Any future quoted E events → lost

**Fix:**

1. Change the character class to `[\w\s[\]"]+?` so quoted strings match.
2. In `getEventType()`, strip `"` from the `value` parameter at the top:
   ```javascript
   value = value.replace(/"/g, '');
   ```

**Validated by:** `real-charts.test.ts` — removes need for the solo section
workaround (`soloSections: []` with comment about scan-chart limitation).

## Not patched

### MIDI lyrics on PART VOCALS (not a parser bug)

scan-chart reads lyrics from `PART VOCALS`, which is correct per the
[GuitarGame_ChartFormats spec](~/projects/GuitarGame_ChartFormats/docs/Chart-File-Formats/mid-format/Tracks/Vocals.md)
and Moonscraper's implementation. The MIDI writer (`writer-mid.ts`) was
incorrectly writing lyrics to the EVENTS track. Fixed by adding a
`buildVocalsTrack()` function that writes lyrics + phrase markers to a
`PART VOCALS` track.

### Format-inherent limitations

These are not parser bugs — they're inherent differences between .chart and
MIDI that no parser change can fix:

| Limitation | Reason |
|------------|--------|
| Cymbal/tom marker format difference | .chart uses cymbal markers (66-68), MIDI uses tom markers (110-112). Handled by cross-format conversion in writer-chart.ts / writer-mid.ts. |
| BPM precision loss | .chart stores millibeats (int), MIDI stores μs/beat (int). Round-trip introduces float drift. |
| kick2x per-difficulty | MIDI note 95 is Expert-only; .chart allows kick2x on any difficulty. |
| Accent/ghost encoding | .chart uses separate note events, MIDI uses velocity (requires ENABLE_CHART_DYNAMICS). Both parsers handle this correctly but the encoding differs. |
| Disco flip events | .chart-only; no MIDI equivalent. |
| Guitar modifiers in drum tracks | forceTap (note 104) can appear in MIDI drum tracks but is meaningless for drums. |
| Empty difficulties | .chart can have empty track sections; MIDI omits them. |
