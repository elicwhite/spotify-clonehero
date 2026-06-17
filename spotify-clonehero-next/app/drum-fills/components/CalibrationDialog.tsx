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
import {renderClickTrackWav} from '@/lib/drum-fills/practice/clickTrack';
import {AudioManager} from '@/lib/preview/audioManager';
import {useMidi} from '../contexts/MidiContext';

const CLICK_COUNT = 16;
const CLICK_BPM = 100;
const CLICK_INTERVAL_SEC = 60 / CLICK_BPM;
const LEAD_IN_SEC = 0.6;
const TAIL_SEC = 0.5;

type Phase = 'idle' | 'loading' | 'running' | 'done';

/**
 * Tap-along latency calibration.
 *
 * A click track plays through {@link AudioManager} — the same audio path and
 * `chartTime` clock that scoring uses — and the user taps any pad on each click.
 * Each hit is mapped to chart time with the same anchor formula as live scoring
 * (`chartMs = hit.timeStamp − (perfNow − chartTime)`), then paired against the
 * known click times. The median offset (hit − click, in chart time) is exactly
 * the latency scoring needs to subtract, so {@link calibrate} returns the right
 * sign by construction. The result is persisted through the MIDI context.
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

  // Chart-time (ms) of each click and of each captured tap, paired at finish.
  const clickMsRef = useRef<number[]>([]);
  const hitMsRef = useRef<number[]>([]);
  // perfNow → chartMs anchor, refreshed every animation frame while playing.
  const anchorMsRef = useRef<number | null>(null);
  const amRef = useRef<AudioManager | null>(null);
  const rafRef = useRef<number>(0);
  const runningRef = useRef(false);
  const finishRef = useRef<() => void>(() => {});

  const teardown = useCallback(() => {
    runningRef.current = false;
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    anchorMsRef.current = null;
    amRef.current?.destroy();
    amRef.current = null;
  }, []);

  // Capture taps only while a run is active, mapping each to chart time via the
  // current anchor (identical to live scoring).
  useEffect(() => {
    if (!open) return;
    return subscribe(hit => {
      if (!runningRef.current || anchorMsRef.current === null) return;
      hitMsRef.current.push(hit.timeStamp - anchorMsRef.current);
      setTapsCaptured(hitMsRef.current.length);
    });
  }, [open, subscribe]);

  useEffect(() => () => teardown(), [teardown]);

  // Reset when the dialog closes.
  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) {
        teardown();
        setPhase('idle');
        setClicksPlayed(0);
        setTapsCaptured(0);
        setResult(null);
        clickMsRef.current = [];
        hitMsRef.current = [];
      }
      onOpenChange(next);
    },
    [teardown, onOpenChange],
  );

  const finish = useCallback(() => {
    teardown();
    const {offsetMs, sampleCount} = calibrate(
      clickMsRef.current,
      hitMsRef.current,
    );
    setPhase('done');
    if (sampleCount === 0) {
      toast.error('No taps were detected. Try again and tap on each click.');
      return;
    }
    setResult(offsetMs);
  }, [teardown]);
  useEffect(() => {
    finishRef.current = finish;
  }, [finish]);

  const start = useCallback(async () => {
    if (runningRef.current || phase === 'loading') return;

    clickMsRef.current = [];
    hitMsRef.current = [];
    anchorMsRef.current = null;
    setClicksPlayed(0);
    setTapsCaptured(0);
    setResult(null);
    setPhase('loading');

    let am: AudioManager;
    try {
      const {wav, clickTimesSec} = await renderClickTrackWav(
        CLICK_COUNT,
        CLICK_INTERVAL_SEC,
        LEAD_IN_SEC,
        TAIL_SEC,
      );
      clickMsRef.current = clickTimesSec.map(s => s * 1000);
      am = new AudioManager(
        [{fileName: 'calibration-click.wav', data: wav}],
        () => {},
      );
      amRef.current = am;
      await am.ready;
      am.setChartDelay(0);
    } catch (err) {
      console.error('Failed to start calibration', err);
      teardown();
      setPhase('idle');
      toast.error('Could not start calibration audio.');
      return;
    }

    runningRef.current = true;
    setPhase('running');

    const lastClickMs = clickMsRef.current[clickMsRef.current.length - 1] ?? 0;
    const endMs = lastClickMs + TAIL_SEC * 1000;

    const tick = () => {
      const manager = amRef.current;
      if (!runningRef.current || !manager) return;
      const chartMs = manager.chartTime * 1000;
      // Same anchor scoring uses: relate this perfNow to this chart position.
      anchorMsRef.current = performance.now() - chartMs;
      setClicksPlayed(
        clickMsRef.current.filter(c => c <= chartMs + 1).length,
      );
      if (chartMs >= endMs) {
        finishRef.current();
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    await am.playChartTime(0);
    rafRef.current = requestAnimationFrame(tick);
  }, [phase, teardown]);

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
          <Button
            variant="outline"
            onClick={start}
            disabled={phase === 'loading' || phase === 'running'}>
            {phase === 'loading'
              ? 'Loading…'
              : phase === 'running'
                ? 'Listening…'
                : phase === 'done'
                  ? 'Redo'
                  : 'Start'}
          </Button>
          {phase === 'done' && result != null && (
            <Button onClick={apply}>Apply offset</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
