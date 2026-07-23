/**
 * Shared intermediate representation (IR) for the drum difficulty-reducers.
 *
 * Both future reducer ports (HOPCAT — `reduce_port.py`, and Onyx —
 * `onyx_reduce.py`) read from this one shape. It is deliberately *not* a
 * 1:1 mirror of either Python port's own input model — each of those is a
 * projection derived from this IR by the adapter (`adapter/hopcat.ts`,
 * `adapter/onyx.ts`). The IR captures exactly the raw per-note facts both
 * ports need to reconstruct their respective gem models:
 *
 *  - the raw 5-lane pad color (HOPCAT works in pad colors; Onyx's
 *    `compute_pro` starts from raw colors too),
 *  - per-note tom/cymbal status (Onyx resolves Pro gems from it; HOPCAT
 *    reads tom markers in `remove_kick`/`single_snare`),
 *  - per-note disco-flip status (both ports swap red/yellow inside disco
 *    sections),
 *  - the fully-resolved Pro lane (tom/cymbal + disco already applied) for
 *    consumers that want scan-chart's resolution directly,
 *  - tempo / time-signature maps, sections, overdrive phrases, and
 *    roll/swell (flex-lane) markers.
 *
 * All ticks here are in the *source chart's* resolution (`resolution`,
 * conventionally 192 for `.chart`, 480 for `.mid`). Neither port consumes
 * ticks at this resolution directly: HOPCAT's grid math is hardcoded to 480
 * TQN (see `adapter/hopcat.ts` for the rescale), and Onyx works in exact
 * rational beats = tick / resolution (see `adapter/onyx.ts`).
 */

/**
 * Fully-resolved Pro drum lane (tom/cymbal + disco-flip applied). Matches
 * Onyx's `GEM_TO_LANE` output and `editrate.py`'s lane strings — the
 * comparison key the parity scorer matches on.
 */
export type DrumLane =
  | 'kick'
  | 'snare'
  | 'hihat' // yellow cymbal
  | 'high-tom' // yellow tom
  | 'ride' // blue cymbal
  | 'mid-tom' // blue tom
  | 'crash' // green cymbal
  | 'floor-tom'; // green tom

/**
 * Raw 5-lane pad color, *before* tom/cymbal or disco resolution — the input
 * alphabet HOPCAT operates on (kick / snare(=red) / yellow / blue / green)
 * and the color half of Onyx's unresolved `Pro <color>` gems.
 */
export type DrumPad = 'kick' | 'red' | 'yellow' | 'blue' | 'green';

/**
 * Per-note disco-flip status, from scan-chart's `disco` / `discoNoflip`
 * note flags. `'flip'` swaps red<->yellow (RB `[mix N drumsMd]`);
 * `'noflip'` marks a disco section that is authored un-swapped
 * (`disco-no-flip`) and therefore does *not* swap; `'off'` is normal.
 * Only red and yellow gems ever carry a non-`off` value (scan-chart only
 * flags the swappable lanes).
 */
export type DiscoState = 'off' | 'flip' | 'noflip';

/** One resolved drum gem in the shared IR. */
export interface RawDrumNote {
  /** Source-resolution tick. */
  tick: number;
  /** Milliseconds from `ParsedChart` (tempo-mapped by scan-chart). */
  msTime: number;
  /** Sustain length in source ticks (0 for most drum gems). */
  length: number;
  /** Raw pad color, pre-resolution. */
  pad: DrumPad;
  /**
   * Raw tom/cymbal status for yellow/blue/green pads (scan-chart `tom` /
   * `cymbal` flags), *ignoring* disco. `true` = cymbal, `false` = tom.
   * Always `false` for kick/red (they have no tom/cymbal dimension).
   */
  cymbal: boolean;
  /** Per-note disco-flip status. */
  disco: DiscoState;
  /** Fully-resolved Pro lane, with tom/cymbal and disco already applied. */
  lane: DrumLane;
  /** `true` for a 2x-kick (RB double-bass) note. */
  doubleKick: boolean;
  /** Raw scan-chart flag bitmask, passed through verbatim. */
  flags: number;
}

/** A tempo marker (tick-domain, as carried by `ParsedChart`). */
export interface TempoEvent {
  tick: number;
  beatsPerMinute: number;
}

/** A time-signature change (tick-domain). */
export interface TimeSignatureEvent {
  tick: number;
  numerator: number;
  denominator: number;
}

/** A named practice section. */
export interface RawSection {
  tick: number;
  name: string;
}

/**
 * An overdrive / star-power phrase. `[startTick, endTick)` half-open, to
 * match Onyx's `ensureODNotes` interval semantics.
 */
export interface OverdrivePhrase {
  startTick: number;
  endTick: number;
}

/**
 * A roll / cymbal-swell flex lane. `isDouble` distinguishes a two-lane
 * cymbal swell (HOPCAT marker 127) from a single-lane drum roll (marker
 * 126). Consumed by HOPCAT's `simplify_roll`.
 */
export interface RollMarker {
  startTick: number;
  endTick: number;
  isDouble: boolean;
}

/**
 * The complete shared IR for one chart's Expert drum track plus the
 * song-level timing/section/OD context both reducers need.
 */
export interface RawDrumChart {
  /** Source chart resolution (ticks per quarter note). */
  resolution: number;
  /** Expert gems, ascending by (tick, then pad sort order). */
  notes: RawDrumNote[];
  tempos: TempoEvent[];
  timeSignatures: TimeSignatureEvent[];
  sections: RawSection[];
  overdrivePhrases: OverdrivePhrase[];
  rollMarkers: RollMarker[];
  /**
   * The furthest tick of interest (last note / OD / section end), used to
   * bound measure-map generation. Mirrors the Python ports' `end_tick`.
   */
  endTick: number;
}

/**
 * Why an adapter run produced no usable chart. Surfaced as a typed result so
 * the page can show an explicit, non-blank error state (plan §8) instead of
 * mis-mapping a chart the reducers weren't designed for.
 */
export type AdapterRejection =
  | {reason: 'no-drums'}
  | {reason: 'no-expert-track'}
  | {reason: 'no-notes'}
  | {reason: 'not-pro-drums'; drumType: 'four-lane' | 'five-lane'};

/** Result of running the scan-chart -> raw-drums adapter. */
export type AdapterResult =
  | {ok: true; chart: RawDrumChart}
  | ({ok: false} & AdapterRejection);
