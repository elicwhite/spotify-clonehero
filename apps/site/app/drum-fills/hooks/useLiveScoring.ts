'use client';

import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {useMidi} from '../contexts/MidiContext';
import {applyCalibration} from '@/lib/drum-fills/midi/calibration';
import {
  DEFAULT_WINDOWS,
  type ExpectedNote,
  type TimedHit,
} from '@/lib/drum-fills/midi/hitMatcher';
import type {DrumLane} from '@/lib/drum-fills/midi/padMapping';
import {
  bestFromScored,
  evaluateAttempt,
  isHitWithinFill,
  isNewBest,
  isRealAttempt,
  type BestAttempt,
  type ScoredAttempt,
} from '@/lib/drum-fills/practice/attempt';
import type {ExpectedFillNote} from '@/lib/drum-fills/practice/fillNotes';
import {
  buildAttemptDebug,
  recordAttemptDebug,
  type DebugHit,
} from '@/lib/drum-fills/practice/scoringDebug';

/** A live per-hit flash for highway feedback. */
export interface HitFlash {
  lane: DrumLane;
  isCymbal: boolean;
  /** performance.now() when the hit arrived. */
  at: number;
  judgment: 'perfect' | 'good' | 'extra';
}

export interface LiveScoringState {
  /** The most recently completed attempt's result, or null. */
  lastAttempt: ScoredAttempt | null;
  /** Best attempt for this fill (seeded from history, updated on finish). */
  bestAttempt: BestAttempt | null;
  /** True briefly when the latest attempt set a new best. */
  newBest: boolean;
  /** Recent flashes (caller renders + ages them out). */
  flashes: HitFlash[];
  /** Number of hits buffered for the in-progress attempt. */
  pendingHits: number;
}

/**
 * Subscribe to live MIDI pad hits and score them against a fill's expected
 * notes, one attempt per loop pass.
 *
 * The expected notes are positioned in *loop-relative* milliseconds (0 = fill
 * start). The caller drives the loop: it calls {@link beginAttempt} when a loop
 * pass over the fill starts (passing the performance.now() time that corresponds
 * to fill-start), and {@link finishAttempt} when the pass ends. Hits arriving
 * between those calls are matched against the notes.
 */
export function useLiveScoring(
  notes: ExpectedFillNote[],
  /**
   * Current playback tempo as a fraction (1 = full speed, 0.9 = 90%). Hits land
   * in real time but notes are in chart (musical) time; at a slowed tempo real
   * time runs ahead of chart time, so each hit's real elapsed must be scaled by
   * tempo to recover its chart position. Without this, slowing down pushes later
   * notes out of the timing window (phantom misses) — worse the slower you go.
   */
  tempo: number = 1,
): {
  state: LiveScoringState;
  beginAttempt: (entryChartMs: number, entryPerfNow: number) => void;
  finishAttempt: () => ScoredAttempt | null;
  /** Seed the best attempt from history (replaces any current best). */
  seedBest: (best: BestAttempt | null) => void;
  reset: () => void;
} {
  const {subscribe, calibrationOffsetMs} = useMidi();

  const [lastAttempt, setLastAttempt] = useState<ScoredAttempt | null>(null);
  const [bestAttempt, setBestAttempt] = useState<BestAttempt | null>(null);
  const [newBest, setNewBest] = useState(false);
  const bestRef = useRef<BestAttempt | null>(null);
  useEffect(() => {
    bestRef.current = bestAttempt;
  }, [bestAttempt]);
  const [flashes, setFlashes] = useState<HitFlash[]>([]);
  const [pendingHits, setPendingHits] = useState(0);

  // Loop anchor sampled at fill entry: the chart position and the real time
  // (performance.now) at that instant. A hit's chart position is then
  // anchorChartMs + (realElapsed × tempo); see the subscribe handler.
  const anchorChartMsRef = useRef<number | null>(null);
  const anchorPerfNowRef = useRef<number>(0);
  const hitsRef = useRef<TimedHit[]>([]);
  // Parallel to hitsRef, carrying the raw MIDI info dropped for scoring so the
  // debug log can explain why a hit was classified the way it was.
  const debugHitsRef = useRef<DebugHit[]>([]);
  const attemptCountRef = useRef(0);
  const calibrationRef = useRef(calibrationOffsetMs);
  useEffect(() => {
    calibrationRef.current = calibrationOffsetMs;
  }, [calibrationOffsetMs]);
  const tempoRef = useRef(tempo);
  useEffect(() => {
    tempoRef.current = tempo;
  }, [tempo]);

  // Expected notes shifted so the first note sits at t=0 (loop-relative ms).
  const {relativeNotes, baseMs} = useMemo(() => {
    if (notes.length === 0)
      return {relativeNotes: [] as ExpectedNote[], baseMs: 0};
    const base = notes[0].msTime;
    return {
      baseMs: base,
      relativeNotes: notes.map<ExpectedNote>(n => ({
        id: n.id,
        msTime: n.msTime - base,
        lane: n.lane,
        isCymbal: n.isCymbal,
      })),
    };
  }, [notes]);
  // relativeNotes are relative to the first note (baseMs); read it in the hit
  // handler without resubscribing.
  const baseMsRef = useRef(baseMs);
  useEffect(() => {
    baseMsRef.current = baseMs;
  }, [baseMs]);

  // Classify and buffer every incoming hit while an attempt is active.
  //
  // PERF: setFlashes/setPendingHits below fire per MIDI hit and re-render the
  // component that calls this hook (PracticeSession), which also renders the
  // THREE.js highway and the VexFlow sheet. Keep it this way only because those
  // are the existing consumers. Any NEW per-hit live feedback (e.g. a timing
  // dot) MUST live in its own leaf that subscribes to MIDI itself — do not lift
  // more per-hit state into PracticeSession or you reintroduce the PlaybackBar
  // stutter (heavy subtree re-rendering on every hit).
  useEffect(() => {
    const unsub = subscribe(hit => {
      if (anchorChartMsRef.current === null) return;
      if (hit.lane === null || hit.isCymbal === null) return; // unmapped pad
      // Latency is a real-time quantity, so correct it in real time first, then
      // convert the real elapsed since fill entry into chart (musical) time by
      // scaling by the current playback tempo. loopRelMs is chart-ms relative to
      // the first note, matching relativeNotes.
      const correctedPerfNow = applyCalibration(
        hit.timeStamp,
        calibrationRef.current,
      );
      const realSinceEntry = correctedPerfNow - anchorPerfNowRef.current;
      const chartMsOfHit =
        anchorChartMsRef.current + realSinceEntry * tempoRef.current;
      const loopRelMs = chartMsOfHit - baseMsRef.current;
      hitsRef.current.push({
        msTime: loopRelMs,
        lane: hit.lane as DrumLane,
        isCymbal: hit.isCymbal,
      });
      debugHitsRef.current.push({
        noteNumber: hit.noteNumber,
        velocity: hit.velocity,
        lane: hit.lane as DrumLane,
        isCymbal: hit.isCymbal,
        loopRelMs,
      });
      setPendingHits(hitsRef.current.length);
      setFlashes(prev => [
        ...prev.slice(-31),
        {
          lane: hit.lane as DrumLane,
          isCymbal: hit.isCymbal as boolean,
          at: hit.timeStamp,
          // Provisional flash; refined when the attempt is scored.
          judgment: 'good',
        },
      ]);
    });
    return unsub;
  }, [subscribe]);

  const beginAttempt = useCallback(
    (entryChartMs: number, entryPerfNow: number) => {
      anchorChartMsRef.current = entryChartMs;
      anchorPerfNowRef.current = entryPerfNow;
      hitsRef.current = [];
      debugHitsRef.current = [];
      setPendingHits(0);
    },
    [],
  );

  const finishAttempt = useCallback((): ScoredAttempt | null => {
    if (anchorChartMsRef.current === null) return null;
    const hits = hitsRef.current;
    const debugHits = debugHitsRef.current;
    anchorChartMsRef.current = null;
    hitsRef.current = [];
    debugHitsRef.current = [];
    setPendingHits(0);

    // Keep only hits inside the fill's note span (± one timing window). Hits
    // outside it aren't part of the fill and must not count as extras — most
    // commonly the kick + crash you land on the downbeat *after* the fill
    // resolves, which would otherwise be penalised as extra strikes.
    const good = DEFAULT_WINDOWS.good;
    const lastNoteMs = relativeNotes.reduce((m, n) => Math.max(m, n.msTime), 0);
    const keptIdx: number[] = [];
    for (let i = 0; i < hits.length; i++) {
      if (isHitWithinFill(hits[i].msTime, lastNoteMs, good)) {
        keptIdx.push(i);
      }
    }
    const fillHits = keptIdx.map(i => hits[i]);
    const fillDebugHits = keptIdx.map(i => debugHits[i]);

    // Ignore passes where no drum was hit at all (a water break, not yet
    // playing): they don't score, persist, or move the ladder/SRS in either
    // direction.
    if (!isRealAttempt(fillHits.length, relativeNotes.length)) return null;
    const result = evaluateAttempt(relativeNotes, fillHits);
    setLastAttempt(result);

    // Persistent per-attempt diagnostics (survives loop passes; readable from
    // window.__drumFillScoringLog).
    attemptCountRef.current += 1;
    recordAttemptDebug(
      buildAttemptDebug({
        attempt: attemptCountRef.current,
        calibrationOffsetMs: calibrationRef.current,
        tempoPct: Math.round(tempoRef.current * 100),
        notes: relativeNotes,
        hits: fillDebugHits,
        match: result.match,
        score: result.score.score,
      }),
    );

    // Update best (no work inside a setState updater — decide from the ref).
    if (isNewBest(bestRef.current, result.score.score)) {
      const next = bestFromScored(result);
      bestRef.current = next;
      setBestAttempt(next);
      setNewBest(true);
    } else {
      setNewBest(false);
    }
    return result;
  }, [relativeNotes]);

  const seedBest = useCallback((best: BestAttempt | null) => {
    bestRef.current = best;
    setBestAttempt(best);
    setNewBest(false);
  }, []);

  const reset = useCallback(() => {
    anchorChartMsRef.current = null;
    hitsRef.current = [];
    debugHitsRef.current = [];
    setPendingHits(0);
    setLastAttempt(null);
    setNewBest(false);
    setFlashes([]);
  }, []);

  // Age out old flashes (~400ms).
  useEffect(() => {
    if (flashes.length === 0) return;
    const id = setInterval(() => {
      const cutoff = performance.now() - 400;
      setFlashes(prev =>
        prev.length > 0 && prev.some(f => f.at < cutoff)
          ? prev.filter(f => f.at >= cutoff)
          : prev,
      );
    }, 120);
    return () => clearInterval(id);
  }, [flashes.length]);

  // baseMs is exposed indirectly so consumers can align (unused externally now).
  void baseMs;

  return {
    state: {lastAttempt, bestAttempt, newBest, flashes, pendingHits},
    beginAttempt,
    finishAttempt,
    seedBest,
    reset,
  };
}
