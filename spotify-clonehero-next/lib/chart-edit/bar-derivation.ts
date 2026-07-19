/**
 * Denominator-aware bar/beat derivation (plan 0061 §3b).
 *
 * The single shared implementation of "where are the beats, downbeats, and
 * bar lines" for every consumer — the highway `GridOverlay`, the piano-roll
 * timeline, and the `DownbeatFlags` store's load/save paths. Pure tick-domain
 * math: no tempo map, no ms, no React.
 *
 * The beat unit is denominator-scaled: `resolution * 4 / denominator` ticks
 * per beat (an eighth note for x/8 signatures, a sixteenth for x/16). A
 * tick-only model cannot distinguish 6/8 from 3/4, so downbeat entries carry
 * the denominator in effect for the bar they start.
 *
 * Both derivation directions live here:
 *  - load:  `timeSignatures` → beats/downbeats (`deriveBeatGrid`,
 *    `deriveDownbeatFlags`)
 *  - save:  downbeats → `timeSignatures` (`deriveTimeSignatures`)
 */

/** Minimal structural shape of a chart time-signature event (tick domain). */
export interface TimeSignatureInput {
  tick: number;
  numerator: number;
  denominator: number;
}

/** A time-signature event derived from downbeat flags (save direction). */
export interface DerivedTimeSignature {
  tick: number;
  numerator: number;
  denominator: number;
}

/** One beat flagged as a downbeat (bar 1 of some bar). */
export interface DownbeatEntry {
  tick: number;
  /** Time-signature denominator in effect for the bar this downbeat starts. */
  denominator: number;
}

/**
 * The canonical source of truth for bar structure (plan 0061 §3b). Bar
 * lines, bar numbering, the bar.beat readout, and the persisted TS events
 * are all derived from this — never mutated independently of it.
 */
export interface DownbeatFlags {
  /** Ascending, one entry per downbeat. Tick 0 is always present. */
  downbeats: DownbeatEntry[];
}

/** One beat position in the derived grid. */
export interface BeatGridEntry {
  tick: number;
  /** True when this beat starts a bar. */
  isDownbeat: boolean;
  /** Time-signature denominator of the region containing this beat. */
  denominator: number;
}

/**
 * Ticks per beat for a given time-signature denominator:
 * `resolution * 4 / denominator`.
 */
export function beatUnitTicks(resolution: number, denominator: number): number {
  return (resolution * 4) / denominator;
}

/**
 * End tick for the **audio-extended** beat grid the piano-roll timeline draws:
 * one bar past the furthest of the tempo/TS anchor ticks and the tick the audio
 * duration maps to. Note-independent by design, so a note edit never forces the
 * beat grid to rebuild.
 *
 * This is the single definition of the user-facing beat span. A beat offered in
 * the panel's tail (past the last charted event, out to the audio end) must snap
 * to the *same* beat when a downbeat command runs — so the commands take this
 * span and `Math.max` it with the note-inclusive `chartEndTick`, rather than
 * deriving their grid over a narrower span that would silently resolve a
 * tail beat to an earlier one.
 */
export function audioExtendedEndTick(
  maxAnchorTick: number,
  durationTick: number,
  resolution: number,
): number {
  return Math.max(maxAnchorTick, durationTick) + resolution * 4;
}

/**
 * Normalize a TS event list into sorted regions starting at tick 0.
 * Charts start in 4/4 if the first TS event is missing or late.
 */
export function normalizeTimeSignatures(
  timeSignatures: readonly TimeSignatureInput[],
): TimeSignatureInput[] {
  const sorted = [...timeSignatures].sort((a, b) => a.tick - b.tick);
  if (sorted.length === 0 || sorted[0].tick > 0) {
    sorted.unshift({tick: 0, numerator: 4, denominator: 4});
  }
  return sorted;
}

/**
 * Load-direction derivation: `timeSignatures` → every beat in `[0, endTick]`.
 *
 * Walks each time-signature region independently, anchored at the TS event's
 * own tick: beats fall every `beatUnitTicks(resolution, denominator)` ticks
 * and a downbeat falls every `numerator` beats from the region start. When a
 * region's length isn't a whole number of beats (a 17/16 bar is 4.25 quarter
 * notes), the next region re-anchors at its own tick so the grid stays
 * aligned with the notes. Regions with a non-positive numerator or beat unit
 * are skipped.
 */
export function deriveBeatGrid(
  timeSignatures: readonly TimeSignatureInput[],
  resolution: number,
  endTick: number,
): BeatGridEntry[] {
  const regions = normalizeTimeSignatures(timeSignatures);
  const beats: BeatGridEntry[] = [];

  for (let i = 0; i < regions.length; i++) {
    const ts = regions[i];
    const regionEndTick = i + 1 < regions.length ? regions[i + 1].tick : Infinity;

    const unit = beatUnitTicks(resolution, ts.denominator);
    if (!(unit > 0) || !(ts.numerator > 0)) continue;

    for (
      let tick = ts.tick, beatInBar = 0;
      tick < regionEndTick && tick <= endTick;
      tick += unit, beatInBar = (beatInBar + 1) % ts.numerator
    ) {
      beats.push({
        tick,
        isDownbeat: beatInBar === 0,
        denominator: ts.denominator,
      });
    }
  }

  return beats;
}

/**
 * Load-direction derivation: `timeSignatures` → `DownbeatFlags` over
 * `[0, endTick]`. Guarantees the tick-0 invariant: the first entry is always
 * tick 0 (with the first region's denominator, or 4/4 if none applies).
 */
export function deriveDownbeatFlags(
  timeSignatures: readonly TimeSignatureInput[],
  resolution: number,
  endTick: number,
): DownbeatFlags {
  const downbeats: DownbeatEntry[] = deriveBeatGrid(
    timeSignatures,
    resolution,
    endTick,
  )
    .filter(beat => beat.isDownbeat)
    .map(beat => ({tick: beat.tick, denominator: beat.denominator}));

  if (downbeats.length === 0 || downbeats[0].tick !== 0) {
    downbeats.unshift({tick: 0, denominator: 4});
  }

  return {downbeats};
}

/**
 * Save-direction derivation: downbeats → `timeSignatures`.
 *
 * For each downbeat, the derived numerator is the number of
 * denominator-scaled beats to the next downbeat's tick. The final entry has
 * no following gap; its numerator is `trailingNumerator` when supplied,
 * otherwise the previous entry's derived numerator (falling back to 4 when
 * there is only one downbeat). One TS event is emitted per index where the
 * derived `(numerator, denominator)` pair differs from the previous entry's —
 * the denominator is carried through, never synthesized, which is what makes
 * the round trip lossless for /8 meters.
 *
 * Downbeat gaps that aren't a whole number of beats (possible only when a
 * source chart's TS events aren't beat-aligned to the preceding region)
 * round to the nearest whole beat, clamped to at least 1.
 */
export function deriveTimeSignatures(
  flags: DownbeatFlags,
  resolution: number,
  trailingNumerator?: number,
): DerivedTimeSignature[] {
  const downbeats = [...flags.downbeats]
    .sort((a, b) => a.tick - b.tick)
    .filter((entry, i, arr) => i === 0 || entry.tick !== arr[i - 1].tick);
  if (downbeats.length === 0) return [];

  const events: DerivedTimeSignature[] = [];
  let prevNumerator: number | null = null;
  let prevDenominator: number | null = null;

  for (let i = 0; i < downbeats.length; i++) {
    const entry = downbeats[i];
    const unit = beatUnitTicks(resolution, entry.denominator);

    let numerator: number;
    if (i + 1 < downbeats.length) {
      numerator = Math.max(
        1,
        Math.round((downbeats[i + 1].tick - entry.tick) / unit),
      );
    } else {
      numerator = trailingNumerator ?? prevNumerator ?? 4;
    }

    if (numerator !== prevNumerator || entry.denominator !== prevDenominator) {
      events.push({tick: entry.tick, numerator, denominator: entry.denominator});
    }
    prevNumerator = numerator;
    prevDenominator = entry.denominator;
  }

  return events;
}
