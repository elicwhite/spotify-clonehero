'use client';

import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {useMidi} from '../contexts/MidiContext';
import {applyCalibration} from '@/lib/drum-fills/midi/calibration';
import type {ExpectedNote, TimedHit} from '@/lib/drum-fills/midi/hitMatcher';
import type {DrumLane} from '@/lib/drum-fills/midi/padMapping';
import {
  evaluateAttempt,
  type ScoredAttempt,
} from '@/lib/drum-fills/practice/attempt';
import type {ExpectedFillNote} from '@/lib/drum-fills/practice/fillNotes';

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
export function useLiveScoring(notes: ExpectedFillNote[]): {
  state: LiveScoringState;
  beginAttempt: (fillStartPerfNow: number) => void;
  finishAttempt: () => ScoredAttempt | null;
  reset: () => void;
} {
  const {subscribe, calibrationOffsetMs} = useMidi();

  const [lastAttempt, setLastAttempt] = useState<ScoredAttempt | null>(null);
  const [flashes, setFlashes] = useState<HitFlash[]>([]);
  const [pendingHits, setPendingHits] = useState(0);

  // Loop anchor: performance.now() that maps to fill-start (notes[i].msTime is
  // relative to the fill's first note via the offset we compute).
  const anchorRef = useRef<number | null>(null);
  const hitsRef = useRef<TimedHit[]>([]);
  const calibrationRef = useRef(calibrationOffsetMs);
  useEffect(() => {
    calibrationRef.current = calibrationOffsetMs;
  }, [calibrationOffsetMs]);

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

  // Classify and buffer every incoming hit while an attempt is active.
  useEffect(() => {
    const unsub = subscribe(hit => {
      if (anchorRef.current === null) return;
      if (hit.lane === null || hit.isCymbal === null) return; // unmapped pad
      const correctedPerfNow = applyCalibration(
        hit.timeStamp,
        calibrationRef.current,
      );
      const loopRelMs = correctedPerfNow - anchorRef.current;
      hitsRef.current.push({
        msTime: loopRelMs,
        lane: hit.lane as DrumLane,
        isCymbal: hit.isCymbal,
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

  const beginAttempt = useCallback((fillStartPerfNow: number) => {
    anchorRef.current = fillStartPerfNow;
    hitsRef.current = [];
    setPendingHits(0);
  }, []);

  const finishAttempt = useCallback((): ScoredAttempt | null => {
    if (anchorRef.current === null) return null;
    const hits = hitsRef.current;
    anchorRef.current = null;
    hitsRef.current = [];
    setPendingHits(0);

    if (relativeNotes.length === 0 && hits.length === 0) return null;
    const result = evaluateAttempt(relativeNotes, hits);
    setLastAttempt(result);
    return result;
  }, [relativeNotes]);

  const reset = useCallback(() => {
    anchorRef.current = null;
    hitsRef.current = [];
    setPendingHits(0);
    setLastAttempt(null);
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
    state: {lastAttempt, flashes, pendingHits},
    beginAttempt,
    finishAttempt,
    reset,
  };
}
