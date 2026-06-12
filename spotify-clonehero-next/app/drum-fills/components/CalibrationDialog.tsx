'use client';

import {useCallback, useEffect, useRef, useState} from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';
import {toast} from 'sonner';
import {calibrate} from '@/lib/drum-fills/midi/calibration';
import {renderEvent} from '@/lib/drum-fills/practice/backingTrack';
import {useMidi} from '../contexts/MidiContext';

const CLICK_COUNT = 16;
const CLICK_BPM = 100;
const CLICK_INTERVAL_MS = (60 / CLICK_BPM) * 1000;

type Phase = 'idle' | 'running' | 'done';

/**
 * Tap-along latency calibration.
 *
 * A click plays {@link CLICK_COUNT} times; the user taps any pad on each click.
 * We record the click times and the MIDI tap times in the same performance.now
 * domain and estimate the median offset via {@link calibrate}. The resulting
 * offset is persisted through the MIDI context (localStorage).
 */
export default function CalibrationDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const {subscribe, calibrationOffsetMs, setCalibrationOffsetMs} = useMidi();

  const [phase, setPhase] = useState<Phase>('idle');
  const [clicksPlayed, setClicksPlayed] = useState(0);
  const [tapsCaptured, setTapsCaptured] = useState(0);
  const [result, setResult] = useState<number | null>(null);

  const clickTimesRef = useRef<number[]>([]);
  const hitTimesRef = useRef<number[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const runningRef = useRef(false);

  const cleanup = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    runningRef.current = false;
  }, []);

  // Capture taps only while a run is active.
  useEffect(() => {
    if (!open) return;
    return subscribe(hit => {
      if (!runningRef.current) return;
      hitTimesRef.current.push(hit.timeStamp);
      setTapsCaptured(hitTimesRef.current.length);
    });
  }, [open, subscribe]);

  useEffect(() => {
    return () => cleanup();
  }, [cleanup]);

  // Reset when the dialog closes.
  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) {
        cleanup();
        setPhase('idle');
        setClicksPlayed(0);
        setTapsCaptured(0);
        setResult(null);
        clickTimesRef.current = [];
        hitTimesRef.current = [];
      }
      onOpenChange(next);
    },
    [cleanup, onOpenChange],
  );

  const finish = useCallback(() => {
    cleanup();
    const {offsetMs, sampleCount} = calibrate(
      clickTimesRef.current,
      hitTimesRef.current,
    );
    setPhase('done');
    if (sampleCount === 0) {
      toast.error('No taps were detected. Try again and tap on each click.');
      return;
    }
    setResult(offsetMs);
  }, [cleanup]);

  const start = useCallback(() => {
    let ctx = audioCtxRef.current;
    if (!ctx) {
      ctx = new AudioContext();
      audioCtxRef.current = ctx;
    }
    void ctx.resume();

    clickTimesRef.current = [];
    hitTimesRef.current = [];
    setClicksPlayed(0);
    setTapsCaptured(0);
    setResult(null);
    setPhase('running');
    runningRef.current = true;

    let count = 0;
    const playOne = () => {
      const audioCtx = audioCtxRef.current!;
      // Audible click slightly in the future; record the intended click time in
      // the performance.now domain to match MIDI event timestamps.
      renderEvent(audioCtx, {
        time: audioCtx.currentTime + 0.02,
        voice: 'click',
      });
      clickTimesRef.current.push(performance.now() + 20);
      count += 1;
      setClicksPlayed(count);
      if (count >= CLICK_COUNT) {
        cleanup();
        // Give the last tap a moment to arrive before computing.
        setTimeout(finish, 400);
      }
    };

    playOne();
    timerRef.current = setInterval(playOne, CLICK_INTERVAL_MS);
  }, [cleanup, finish]);

  const apply = useCallback(() => {
    if (result == null) return;
    setCalibrationOffsetMs(result);
    toast.success(`Saved calibration offset: ${result.toFixed(0)} ms.`);
    handleOpenChange(false);
  }, [result, setCalibrationOffsetMs, handleOpenChange]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Latency calibration</DialogTitle>
          <DialogDescription>
            Tap any pad in time with the click {CLICK_COUNT} times. We&apos;ll
            measure your audio + MIDI latency so hits line up with the music.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2 text-sm">
          <div className="flex justify-between">
            <span>Current offset</span>
            <span className="font-mono">
              {calibrationOffsetMs.toFixed(0)} ms
            </span>
          </div>

          {phase === 'running' && (
            <div className="space-y-1">
              <p>
                Click {clicksPlayed} / {CLICK_COUNT}
              </p>
              <p className="text-muted-foreground">
                Taps captured: {tapsCaptured}
              </p>
            </div>
          )}

          {phase === 'done' && result != null && (
            <div className="rounded-md border bg-muted/40 p-3">
              <p className="font-medium">
                Measured offset: {result.toFixed(0)} ms
              </p>
              <p className="text-muted-foreground">
                Apply this to align your hits with the click.
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          {phase !== 'running' && (
            <Button variant="outline" onClick={start}>
              {phase === 'done' ? 'Redo' : 'Start'}
            </Button>
          )}
          {phase === 'done' && result != null && (
            <Button onClick={apply}>Apply offset</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
