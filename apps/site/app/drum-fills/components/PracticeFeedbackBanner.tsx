'use client';

import {useMemo} from 'react';
import {cn} from '@/lib/utils';
import {DEFAULT_WINDOWS} from '@/lib/drum-fills/midi/hitMatcher';
import type {ScoredAttempt} from '@/lib/drum-fills/practice/attempt';
import {
  feedbackVerdict,
  type Verdict,
} from '@/lib/drum-fills/practice/feedbackVerdict';

/**
 * Across-the-room practice feedback. The player is several feet away at a kit,
 * so this is a big, glanceable, per-pass read in the page's bottom band — NOT a
 * per-hit live display (the highway already pulses lanes as you hit). It shows
 * one headline (early / late / on-time / keep going), a single needle on an
 * EARLY|ON|LATE bar at the pass median, a miss/extra token when relevant, and a
 * big status + change callout (replacing toasts).
 *
 * Per-pass only: it reads `lastAttempt` (set once per loop) + a `callout` prop,
 * so it never participates in the per-hit render hot path.
 */

export interface FeedbackCallout {
  /** Bump to retrigger the entrance animation. */
  id: number;
  text: string;
  tone: 'up' | 'down' | 'info';
}

const VERDICT_TONE: Record<Verdict, string> = {
  dialed: 'text-green-500',
  rushing: 'text-amber-500',
  dragging: 'text-amber-500',
  'keep-going': 'text-red-500',
};

const VERDICT_GLYPH: Record<Verdict, string> = {
  dialed: '●',
  rushing: '◀',
  dragging: '▶',
  'keep-going': '✕',
};

// The bar spans ±this many ms; the good window fills most of it.
const BAR_RANGE_MS = DEFAULT_WINDOWS.good * 1.5;

function pct(deltaMs: number): number {
  const clamped = Math.max(-BAR_RANGE_MS, Math.min(BAR_RANGE_MS, deltaMs));
  return 50 + (clamped / BAR_RANGE_MS) * 50;
}

export default function PracticeFeedbackBanner({
  lastAttempt,
  statusText,
  callout,
}: {
  lastAttempt: ScoredAttempt | null;
  /** Persistent status, e.g. "Rung 4/91 · 90%". */
  statusText?: string | undefined;
  /** Transient big message on a rung/tempo change (replaces toasts). */
  callout?: FeedbackCallout | null | undefined;
}) {
  const verdict = useMemo(() => {
    if (!lastAttempt) return null;
    return feedbackVerdict(
      lastAttempt.match.judgments.map(j => ({
        judgment: j.judgment,
        deltaMs: j.deltaMs,
      })),
      lastAttempt.match.extras.length,
    );
  }, [lastAttempt]);

  const goodEdge = pct(-DEFAULT_WINDOWS.good);
  const goodEdgeR = pct(DEFAULT_WINDOWS.good);
  const perfEdge = pct(-DEFAULT_WINDOWS.perfect);
  const perfEdgeR = pct(DEFAULT_WINDOWS.perfect);

  return (
    <div className="flex w-full shrink-0 items-stretch gap-6 rounded-xl border bg-card px-6 py-4">
      {/* Headline */}
      <div className="flex min-w-[14rem] flex-col justify-center">
        {verdict ? (
          <>
            <div
              className={cn(
                'flex items-center gap-3 text-5xl font-extrabold leading-none tracking-tight',
                VERDICT_TONE[verdict.verdict],
              )}>
              <span aria-hidden>{VERDICT_GLYPH[verdict.verdict]}</span>
              <span>{verdict.label}</span>
            </div>
            {verdict.verdict !== 'keep-going' && verdict.medianMs != null && (
              <div className="mt-1 text-2xl font-semibold text-muted-foreground">
                {verdict.verdict === 'dialed'
                  ? 'on the beat'
                  : `${Math.abs(verdict.medianMs)}ms ${
                      verdict.medianMs < 0 ? 'early' : 'late'
                    }`}
              </div>
            )}
            {(verdict.missCount > 0 || verdict.extraCount > 0) && (
              <div className="mt-2 flex gap-4 text-xl font-bold">
                {verdict.missCount > 0 && (
                  <span className="text-red-500">
                    {verdict.missCount} MISSED
                  </span>
                )}
                {verdict.extraCount > 0 && (
                  <span className="text-muted-foreground">
                    +{verdict.extraCount} extra
                  </span>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="text-3xl font-bold text-muted-foreground">
            Play a pass to see your timing
          </div>
        )}
      </div>

      {/* EARLY | ON | LATE bar */}
      <div className="flex flex-1 flex-col justify-center">
        <div className="mb-1 flex justify-between text-sm font-bold uppercase tracking-wide text-muted-foreground">
          <span>◀ Early</span>
          <span>On time</span>
          <span>Late ▶</span>
        </div>
        <div className="relative h-10 overflow-hidden rounded-lg bg-muted">
          {/* good window band */}
          <div
            className="absolute inset-y-0 bg-amber-500/20"
            style={{left: `${goodEdge}%`, right: `${100 - goodEdgeR}%`}}
          />
          {/* perfect window band */}
          <div
            className="absolute inset-y-0 bg-green-500/30"
            style={{left: `${perfEdge}%`, right: `${100 - perfEdgeR}%`}}
          />
          {/* center line */}
          <div className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-foreground/50" />
          {/* needle at the pass median */}
          {verdict?.medianMs != null && (
            <div
              className={cn(
                'absolute inset-y-0 w-1.5 -translate-x-1/2 rounded',
                verdict.verdict === 'dialed' ? 'bg-green-500' : 'bg-amber-500',
              )}
              style={{left: `${pct(verdict.medianMs)}%`}}
            />
          )}
        </div>
      </div>

      {/* Status + change callout */}
      <div className="flex min-w-[12rem] flex-col items-end justify-center text-right">
        {callout && (
          <div
            key={callout.id}
            className={cn(
              'text-3xl font-extrabold leading-none duration-300 animate-in fade-in slide-in-from-bottom-2',
              callout.tone === 'up'
                ? 'text-green-500'
                : callout.tone === 'down'
                  ? 'text-amber-500'
                  : 'text-foreground',
            )}>
            {callout.text}
          </div>
        )}
        {statusText && (
          <div className="mt-2 text-xl font-semibold text-muted-foreground">
            {statusText}
          </div>
        )}
      </div>
    </div>
  );
}
