'use client';

/**
 * The tempo lane's tap-tempo tool: tap any key along to the song, read the
 * fitted BPM, and write it at the tick that was right-clicked.
 *
 * Rendered as the contents of the tempo lane's `ContextMenuPopover` (in place
 * of its item list), so it appears exactly where the gesture started and the
 * anchor never has to travel across the app.
 */

import {useCallback, useEffect, useRef, useState} from 'react';

import {isEditableTarget} from '@/lib/dom/isEditableTarget';
import {
  clearTaps,
  emptyTapSession,
  fitTapTempo,
  MIN_TAPS_FOR_ACCEPT,
  pushTap,
  type TapSession,
} from '@/lib/tempo-map/tap-tempo';
import {cn} from '@/lib/utils';

/** The slice of `AudioManager` the tool needs. */
export interface TapTempoTransport {
  readonly isPlaying: boolean;
  /** Playback speed multiplier; taps are wall-clock and scaled by it. */
  getCurrentTempo(): number;
  playChartTime(chartTimeSec: number): unknown;
  pause(): unknown;
}

export interface TapTempoPopoverProps {
  /** Tick the BPM will be written at. */
  anchorTick: number;
  /** Chart-time ms of `anchorTick`, for the transport's seek. */
  anchorMs: number;
  /** `bar.beat` at the anchor, shown so the target is legible before Accept. */
  anchorLabel: string;
  audioManager: TapTempoTransport;
  /** Called with the fitted BPM, full precision. */
  onAccept: (bpm: number) => void;
  onCancel: () => void;
}

/** Keys that are never a tap: they either mean something here already or
 *  carry no press of their own. */
const NON_TAP_KEYS = new Set([
  'Escape',
  'Tab',
  'Shift',
  'Control',
  'Alt',
  'Meta',
  'CapsLock',
]);

/** How often the transport label and the playback rate are re-read. This
 *  drives a label and a reset rule, not a clock, so it does not need a frame
 *  loop. */
const TRANSPORT_POLL_MS = 120;

const BUTTON =
  'rounded border border-border px-1.5 py-0.5 text-[11px] hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent';

export default function TapTempoPopover({
  anchorTick,
  anchorMs,
  anchorLabel,
  audioManager,
  onAccept,
  onCancel,
}: TapTempoPopoverProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const padRef = useRef<HTMLButtonElement | null>(null);

  const [session, setSession] = useState<TapSession>(() =>
    emptyTapSession(anchorTick, anchorMs),
  );
  // Half/double-time correction, applied to the fit rather than to the taps —
  // tapping half time is the commonest tap-tempo mistake and it should not
  // cost a re-tap.
  const [octave, setOctave] = useState(1);
  const [isPlaying, setIsPlaying] = useState(audioManager.isPlaying);
  const [rate, setRate] = useState(() => audioManager.getCurrentTempo());
  const rateRef = useRef(rate);

  // Focus starts on the pad, so the first Space or Enter is a tap. Tab moves
  // to the real controls, where Space and Enter activate them normally.
  useEffect(() => {
    padRef.current?.focus();
  }, []);

  useEffect(() => {
    const poll = window.setInterval(() => {
      setIsPlaying(audioManager.isPlaying);
      const current = audioManager.getCurrentTempo();
      if (current === rateRef.current) return;
      // A speed change mid-session invalidates the taps recorded at the old
      // rate. Scaling per interval would need a rate history for a control
      // that shows the current speed right next to the readout.
      rateRef.current = current;
      setRate(current);
      setSession(clearTaps);
    }, TRANSPORT_POLL_MS);
    return () => window.clearInterval(poll);
  }, [audioManager]);

  const tap = useCallback((timeMs: number) => {
    setSession(current => pushTap(current, timeMs));
  }, []);

  // Window-capture, so a tap runs before the hotkey registry's document
  // listener and no editor shortcut fires on it.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // A held key must not machine-gun taps.
      if (event.repeat) return;
      // Modified chords (save, undo) are left entirely alone, as are Escape
      // (which the panel routes to closing the menu) and Tab.
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (NON_TAP_KEYS.has(event.key)) return;
      // Typing anywhere in the app still types.
      if (isEditableTarget(event.target)) return;
      // Inside this popover, only the pad taps: everything else stays
      // keyboard-activatable.
      const target = event.target instanceof Element ? event.target : null;
      if (rootRef.current && target && rootRef.current.contains(target)) {
        if (!target.closest('[data-tap-pad]')) return;
      }
      // `event.timeStamp` is stamped at input time in the `performance.now()`
      // timebase, so it carries none of the dispatch latency a canvas draw
      // loop can add.
      tap(event.timeStamp);
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener('keydown', onKeyDown, {capture: true});
    return () =>
      window.removeEventListener('keydown', onKeyDown, {capture: true});
  }, [tap]);

  const fit = fitTapTempo(session.taps, rate);
  const bpm = fit.status === 'ok' ? fit.bpm * octave : null;
  const stdErrBpm = fit.status === 'ok' ? fit.stdErrBpm * octave : null;
  const canAccept = bpm !== null && session.taps.length >= MIN_TAPS_FOR_ACCEPT;

  const reset = useCallback(() => {
    setSession(clearTaps);
    setOctave(1);
    padRef.current?.focus();
  }, []);

  const toggleTransport = useCallback(() => {
    if (audioManager.isPlaying) {
      audioManager.pause();
      setIsPlaying(false);
      return;
    }
    audioManager.playChartTime(anchorMs / 1000);
    setIsPlaying(true);
  }, [audioManager, anchorMs]);

  return (
    <div
      ref={rootRef}
      data-testid="tap-tempo-popover"
      className="flex w-52 flex-col gap-1.5 p-2">
      <div className="flex items-baseline justify-between">
        <span className="font-medium">Tap tempo</span>
        <span className="text-muted-foreground">Bar {anchorLabel}</span>
      </div>

      <button
        ref={padRef}
        type="button"
        data-tap-pad=""
        aria-label="Tap here, or press any key"
        onClick={event => tap(event.timeStamp)}
        className="rounded border border-dashed border-border py-2 text-center hover:bg-accent hover:text-accent-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring">
        <span className="block text-lg font-semibold tabular-nums">
          {bpm === null ? '--' : bpm.toFixed(1)}
          <span className="ml-1 text-[10px] font-normal text-muted-foreground">
            BPM
          </span>
        </span>
        <span className="block text-[10px] text-muted-foreground">
          {bpm === null
            ? 'Tap here, or press any key'
            : `± ${(stdErrBpm ?? 0).toFixed(1)} from ${session.taps.length} taps`}
        </span>
      </button>

      <div className="flex items-center gap-1">
        <button
          type="button"
          className={cn(BUTTON, 'flex-1')}
          onClick={toggleTransport}>
          {isPlaying ? 'Pause' : `Play from ${anchorLabel}`}
        </button>
        <button
          type="button"
          className={BUTTON}
          disabled={bpm === null}
          onClick={() => setOctave(o => o * 2)}>
          ×2
        </button>
        <button
          type="button"
          className={BUTTON}
          disabled={bpm === null}
          onClick={() => setOctave(o => o / 2)}>
          ÷2
        </button>
      </div>

      <p className="text-[10px] leading-snug text-muted-foreground">
        Sets the tempo from bar {anchorLabel} onward. Notes after that point
        keep their audio timing and move to new grid positions. Later tempo
        markers keep their chart positions and shift in time. Undo restores
        everything.
      </p>

      <div className="flex items-center gap-1">
        <button
          type="button"
          className={cn(BUTTON, 'flex-1')}
          disabled={!canAccept}
          onClick={() => {
            if (bpm === null) return;
            onAccept(bpm);
          }}>
          Accept
        </button>
        <button
          type="button"
          className={BUTTON}
          disabled={session.taps.length === 0}
          onClick={reset}>
          Reset
        </button>
        <button
          type="button"
          className={BUTTON}
          title="Close without setting a tempo. The taps are discarded."
          onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
