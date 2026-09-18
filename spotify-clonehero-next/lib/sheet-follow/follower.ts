/**
 * Score follower: where in the song is the band, right now.
 *
 * The reference is the song's own recording, not the chart. Matching the room
 * against the chart was tried four ways and failed every time — Eli plays a
 * simplified or different part, and rock drum density is too uniform to
 * localise against. Matching against the record works because it carries the
 * harmony the whole band is playing.
 *
 * The search is deliberately local. A bare 20-second window matched against a
 * whole song lands on the wrong verse: on one rehearsal take the errors
 * clustered at exactly the distance between verse 1 and verse 2, because chroma
 * correctly matched a verse to a harmonically identical verse. Constrained to
 * ±10 seconds of where the clock already thinks the band is, the same match is
 * accurate to a median of about 0.2 seconds.
 *
 * Everything here is causal: a window only ever reads audio that has already
 * arrived.
 */

import {CHROMA_BINS, CHROMA_FPS} from './chroma';

export interface FollowerOptions {
  /** Seconds of microphone audio each match reads. */
  windowSec: number;
  /** How far from the predicted position a tracking match may land.
   *
   *  Fixed on purpose. A radius that grows when the lock is lost was built and
   *  measured — with and without clipping to the physically reachable cone, and
   *  with a rule that only accepted distant matches when decisive — and every
   *  variant was worse across six takes than leaving it fixed. Widening the
   *  search in a repetitive song finds the other verse. Recovering a lost lock
   *  needs multiple hypotheses carried at once, not a bigger single guess. */
  searchRadiusSec: number;
  /** How far either side of the coasted prediction a cold start may look. */
  bootstrapRadiusSec: number;
  /**
   * Slowest and fastest the band may play relative to the recording.
   *
   * Centred on 1.0, because a covering band plays roughly at the record's
   * tempo. An earlier range of 0.95–1.4 came from measurements that were all
   * inflated by about 12%: the CLI recorder used to gather them was dropping
   * samples, so every take looked faster than it was. Verified against a
   * capture whose timebase was proven correct against wall clock, the same
   * performance runs at 1.01, not 1.13.
   */
  minSpeed: number;
  maxSpeed: number;
  /** A match must beat the best rival this far away to count as decisive. */
  rivalExclusionSec: number;
  /** Score margin over the best rival at which the match is fully trusted. */
  decisiveMargin: number;
  /** Most the position estimate may move in one update, beyond dead reckoning.
   *  Without this the estimate follows its own search window out of the song:
   *  one bad match shifts the centre, and the next search re-centres on the bad
   *  answer. */
  maxCorrectionSec: number;
  /** Share of the (bounded) position error applied each update. */
  positionGain: number;
  /** Share of the rate error implied by the position error applied each update. A position error of `e` seconds across a window of `w` seconds
   *  means the rate is wrong by about `e/w`, so this closes a rate error that
   *  the speed candidates alone are too coarse to see. Kept small, and scaled by
   *  confidence, because this is the term that wound the speed up to its limit
   *  when it was previously driven by unbounded error. */
  speedIntegralGain: number;
  /** The speed this band played this song at last time, if known.
   *
   *  Rehearsals repeat songs, within a night and across weeks, and a band's
   *  speed relative to the record is stable. Narrowing the cold-start sweep to
   *  a couple of percent either side of the remembered value took one take from
   *  75% of the time on screen with a 38-second outage to 100% with none, and
   *  moved nothing else. */
  rememberedSpeed?: number | undefined;
}

export const DEFAULT_FOLLOWER_OPTIONS: FollowerOptions = {
  windowSec: 20,
  searchRadiusSec: 6,
  bootstrapRadiusSec: 8,
  minSpeed: 0.85,
  maxSpeed: 1.25,
  rivalExclusionSec: 2,
  decisiveMargin: 0.02,
  maxCorrectionSec: 1,
  positionGain: 0.3,
  speedIntegralGain: 0.8,
};

export interface MatchResult {
  /** Reference time, in seconds, of the newest observation frame. */
  refEndSec: number;
  speed: number;
  score: number;
  /** Best score minus the best score `rivalExclusionSec` away. Large means the
   *  peak is decisive; near zero means the song repeats here and the match is a
   *  coin flip between two equally good places. */
  margin: number;
}

export interface MatchQuery {
  reference: Float32Array;
  referenceFrameCount: number;
  /** Newest-last chroma frames, row-major `[count × 12]`. */
  observation: Float32Array;
  observationCount: number;
  refEndLoSec: number;
  refEndHiSec: number;
  speeds: number[];
  rivalExclusionSec: number;
  /** Observation frames to skip between comparisons. Neighbouring chroma frames
   *  overlap by most of their window, so a stride of 2 costs half as much and
   *  does not move the argmax; a cold start uses 4 because it sweeps far more
   *  candidates. */
  stride?: number;
}

function dot12(a: Float32Array, ai: number, b: Float32Array, bi: number) {
  let s = 0;
  for (let k = 0; k < CHROMA_BINS; k++) s += a[ai + k] * b[bi + k];
  return s;
}

/**
 * Searches (reference position, speed) for the placement of the observation
 * window that best matches the reference. Pure, so the whole tracking rule can
 * be tested without audio hardware.
 */
export function matchWindow(query: MatchQuery): MatchResult | null {
  const {
    reference,
    referenceFrameCount,
    observation,
    observationCount,
    speeds,
    rivalExclusionSec,
  } = query;
  if (observationCount === 0 || referenceFrameCount === 0) return null;

  const stride = query.stride ?? 2;
  const loFrame = Math.max(0, Math.round(query.refEndLoSec * CHROMA_FPS));
  const hiFrame = Math.min(
    referenceFrameCount - 1,
    Math.round(query.refEndHiSec * CHROMA_FPS),
  );
  if (hiFrame < loFrame) return null;

  const scored: {frame: number; speed: number; score: number}[] = [];
  for (const speed of speeds) {
    for (let endFrame = loFrame; endFrame <= hiFrame; endFrame++) {
      let sum = 0;
      let counted = 0;
      for (let i = observationCount - 1; i >= 0; i -= stride) {
        const back = observationCount - 1 - i;
        const refFrame = Math.round(endFrame - back * speed);
        if (refFrame < 0) break;
        sum += dot12(
          reference,
          refFrame * CHROMA_BINS,
          observation,
          i * CHROMA_BINS,
        );
        counted++;
      }
      // A candidate that only overlaps the very start of the recording would
      // otherwise win on a handful of frames.
      if (counted < observationCount / stride / 2) continue;
      scored.push({frame: endFrame, speed, score: sum / counted});
    }
  }
  if (scored.length === 0) return null;

  let best = scored[0];
  for (const c of scored) if (c.score > best.score) best = c;

  const exclusion = rivalExclusionSec * CHROMA_FPS;
  let rival = -Infinity;
  for (const c of scored) {
    if (Math.abs(c.frame - best.frame) <= exclusion) continue;
    if (c.score > rival) rival = c.score;
  }

  return {
    refEndSec: best.frame / CHROMA_FPS,
    speed: best.speed,
    score: best.score,
    margin: rival === -Infinity ? best.score : best.score - rival,
  };
}

/** Speeds to try while tracking: small refinements around the current estimate. */
export function trackingSpeeds(speed: number, opts: FollowerOptions): number[] {
  const out: number[] = [];
  for (const factor of [0.96, 0.97, 0.98, 0.99, 1.0, 1.01, 1.02, 1.03, 1.04]) {
    const s = speed * factor;
    if (s >= opts.minSpeed && s <= opts.maxSpeed) out.push(s);
  }
  return out.length > 0 ? out : [speed];
}

/** Speeds to try on a cold start. With a remembered speed from a previous play
 *  this is a couple of percent either side of it; otherwise the whole plausible
 *  range, 2% apart. Finer
 *  steps are not better — halving them to 1% gave the search more chances to
 *  win with a wrong speed-and-position pair and lost a take that had been
 *  tracking to 0.28s. The rate error this leaves is closed by the tracking
 *  loop's drift term instead. */
export function bootstrapSpeeds(opts: FollowerOptions): number[] {
  const out: number[] = [];
  if (opts.rememberedSpeed && opts.rememberedSpeed > 0) {
    // ±8%, not ±2%. A band's speed for the same song is not stable between
    // nights: measured a week apart, the same song went from 1.10 to 1.15. A
    // window tight enough to be worth remembering would have excluded the
    // truth, making the memory actively harmful on the second play.
    for (let factor = 0.92; factor <= 1.0801; factor += 0.01) {
      out.push(opts.rememberedSpeed * factor);
    }
    return out;
  }
  for (let s = opts.minSpeed; s <= opts.maxSpeed + 1e-9; s += 0.02) {
    out.push(Number(s.toFixed(4)));
  }
  return out;
}

export type FollowPhase = 'idle' | 'bootstrapping' | 'tracking';

export interface FollowSnapshot {
  phase: FollowPhase;
  /** Reference time at `atStreamSec`, in seconds. */
  refTimeSec: number;
  /** Stream time the estimate belongs to. */
  atStreamSec: number;
  speed: number;
  /** 0 to 1. Low means the song repeats here and the match could not choose. */
  confidence: number;
}

/**
 * Holds the observation window and the current position estimate.
 *
 * The caller feeds chroma frames as they arrive and calls {@link update} at
 * whatever rate it likes; between updates {@link refTimeAt} dead-reckons, so the
 * page keeps moving even when a match is inconclusive. That is deliberate: a
 * frozen page and a wrong page look identical from behind a drum kit, and
 * coasting at the last known speed is almost always closer to the truth than
 * stopping.
 */
export class ScoreFollower {
  #opts: FollowerOptions;
  #reference: Float32Array;
  #referenceFrameCount: number;

  #window: Float32Array;
  #windowCapacity: number;
  #count = 0;
  #lastFrameStreamSec = 0;

  #phase: FollowPhase = 'idle';
  #refTimeSec = 0;
  #anchorStreamSec = 0;
  #songStartStreamSec = 0;
  #speed = 1;
  #confidence = 0;

  constructor(
    reference: Float32Array,
    referenceFrameCount: number,
    options: Partial<FollowerOptions> = {},
  ) {
    this.#opts = {...DEFAULT_FOLLOWER_OPTIONS, ...options};
    this.#reference = reference;
    this.#referenceFrameCount = referenceFrameCount;
    this.#windowCapacity = Math.round(this.#opts.windowSec * CHROMA_FPS);
    this.#window = new Float32Array(this.#windowCapacity * CHROMA_BINS);
  }

  get phase() {
    return this.#phase;
  }

  /** Discards the window and returns to waiting for a song to start. */
  reset() {
    this.#count = 0;
    this.#phase = 'idle';
    this.#refTimeSec = 0;
    this.#speed = 1;
    this.#confidence = 0;
  }

  /** Declares that a song just started, at the top. Songs start at the
   *  beginning in practice, and assuming it removes a global search that was
   *  measured not to work. */
  beginSong(streamSec: number) {
    this.#count = 0;
    this.#phase = 'bootstrapping';
    this.#refTimeSec = 0;
    this.#anchorStreamSec = streamSec;
    this.#songStartStreamSec = streamSec;
    // A band covering a song plays near the record's tempo, so that is the
    // starting guess when this song has not been played before.
    this.#speed = this.#opts.rememberedSpeed || 1.0;
    this.#confidence = 0;
  }

  pushFrame(chroma: Float32Array, streamSec: number) {
    if (this.#phase === 'idle') return;
    if (this.#count === this.#windowCapacity) {
      this.#window.copyWithin(0, CHROMA_BINS);
      this.#window.set(chroma, (this.#windowCapacity - 1) * CHROMA_BINS);
    } else {
      this.#window.set(chroma, this.#count * CHROMA_BINS);
      this.#count++;
    }
    this.#lastFrameStreamSec = streamSec;
  }

  /** Reference position at a given stream time, dead-reckoned from the last
   *  accepted match. */
  refTimeAt(streamSec: number): number {
    return this.#refTimeSec + (streamSec - this.#anchorStreamSec) * this.#speed;
  }

  snapshot(streamSec: number): FollowSnapshot {
    return {
      phase: this.#phase,
      refTimeSec: this.refTimeAt(streamSec),
      atStreamSec: streamSec,
      speed: this.#speed,
      confidence: this.#confidence,
    };
  }

  /**
   * Runs one match against the reference and folds the result into the
   * estimate. Returns the raw match so callers can log or display it.
   */
  update(): MatchResult | null {
    if (this.#phase === 'idle') return null;
    // A partial window is worth matching but not worth trusting; wait until it
    // holds at least half the configured span.
    if (this.#count < this.#windowCapacity / 2) return null;

    const bootstrapping = this.#phase === 'bootstrapping';
    // A cold start commits once, when the window is full. Running the wide
    // search every half second instead lets each pass move the estimate by the
    // whole search radius and then re-anchor to it, which walks the follower
    // out of the song within a few seconds.
    if (bootstrapping && this.#count < this.#windowCapacity) return null;

    const predicted = this.refTimeAt(this.#lastFrameStreamSec);
    // The cold start searches around the coasted prediction, exactly like
    // tracking does, only wider and over every candidate speed.
    //
    // It used to derive its range from elapsed-time-since-the-gate-fired. That
    // was wrong three separate ways: room noise before the band starts inflates
    // elapsed and puts the search past them; a late-detected start deflates it
    // and puts the search short of them; and on one take the commit replaced an
    // estimate that had coasted to within half a second of the truth with one
    // ten seconds out. Coasting from the top at a plausible speed is a good
    // estimate — measured band speeds span 1.07 to 1.27 — so the cold start's
    // real job is to pin the speed, not to find the song. Finding the song from
    // scratch is not on the table anyway: a whole-song search from a 20s window
    // lands within 10s of the truth about one time in ten, and lengthening the
    // window to 90s does not improve it.
    const radius = bootstrapping
      ? this.#opts.bootstrapRadiusSec
      : this.#opts.searchRadiusSec;
    const refEndLoSec = Math.max(0, predicted - radius);
    const refEndHiSec = predicted + radius;

    const match = matchWindow({
      reference: this.#reference,
      referenceFrameCount: this.#referenceFrameCount,
      observation: this.#window,
      observationCount: this.#count,
      refEndLoSec,
      refEndHiSec,
      speeds: bootstrapping
        ? bootstrapSpeeds(this.#opts)
        : trackingSpeeds(this.#speed, this.#opts),
      rivalExclusionSec: this.#opts.rivalExclusionSec,
      stride: bootstrapping ? 4 : 2,
    });
    if (!match) return null;

    const trust = Math.max(
      0,
      Math.min(1, match.margin / this.#opts.decisiveMargin),
    );
    this.#confidence = trust;

    if (bootstrapping) {
      this.#refTimeSec = match.refEndSec;
      this.#speed = match.speed;
      this.#anchorStreamSec = this.#lastFrameStreamSec;
      this.#phase = 'tracking';
      return match;
    }

    // Dead reckoning owns the estimate; the match only trims it.
    const error = match.refEndSec - predicted;
    const bounded = Math.max(
      -this.#opts.maxCorrectionSec,
      Math.min(this.#opts.maxCorrectionSec, error),
    );
    this.#refTimeSec =
      predicted + bounded * this.#opts.positionGain * Math.max(trust, 0.2);
    this.#anchorStreamSec = this.#lastFrameStreamSec;
    // A position error of `e` seconds across a window of `w` seconds means the
    // rate is wrong by about e/w, so the position error is also the rate
    // measurement. The search's own speed axis is not: at ±4% the far end of a
    // 20s window moves under a second, so the score surface over speed is nearly
    // flat and its argmax is mostly noise. Correcting from it as well was
    // measured to be no better on a first play and worse on a repeat.
    const rateCorrection =
      (bounded / this.#opts.windowSec) *
      this.#opts.speedIntegralGain *
      this.#speed *
      trust;
    this.#speed = Math.max(
      this.#opts.minSpeed,
      Math.min(this.#opts.maxSpeed, this.#speed + rateCorrection),
    );
    return match;
  }
}
