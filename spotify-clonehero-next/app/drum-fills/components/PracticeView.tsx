'use client';

import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import useInterval from 'use-interval';
import {toast} from 'sonner';
import {Button} from '@/components/ui/button';
import {cn} from '@/lib/utils';
import {
  AudioManager,
  type PracticeModeConfig,
} from '@/lib/preview/audioManager';
import {getChartDelayMs} from '@/lib/chart-utils/chartDelay';
import type {ChartResponseEncore} from '@/lib/chartSelection';
import CloneHeroRenderer from '@/app/sheet-music/[slug]/CloneHeroRenderer';
import SheetMusic from '@/app/sheet-music/[slug]/SheetMusic';
import {BackingTrackPlayer} from '@/lib/drum-fills/practice/backingTrack';
import {
  applyAttempt,
  initFillSrsState,
  isDue,
  type FillSrsState,
} from '@/lib/drum-fills/practice/srs';
import {
  nextTempoPct,
  initialTempoPct,
} from '@/lib/drum-fills/practice/speedTrainer';
import {recordAttempt, upsertSrs} from '@/lib/local-db/drum-fills';
import type {ScoredAttempt} from '@/lib/drum-fills/practice/attempt';
import type {FillMode} from '@/lib/local-db/drum-fills';
import {useFillChart} from '../hooks/useFillChart';
import {useLiveScoring} from '../hooks/useLiveScoring';
import {useMidi} from '../contexts/MidiContext';
import PracticeHud from './PracticeHud';

export interface PracticeViewProps {
  fillId: string;
  onExit: () => void;
  /** Called when the user advances (queue/roulette). Falls back to onExit. */
  onNext?: () => void;
}

type Mode = 'song-context' | 'isolated' | 'speed-trainer' | 'roulette';

const MODE_LABELS: Record<Mode, string> = {
  'song-context': 'Song loop',
  isolated: 'Isolated synth',
  'speed-trainer': 'Speed trainer',
  roulette: 'Roulette',
};

const MODE_TO_DB: Record<Mode, FillMode> = {
  'song-context': 'song-context',
  isolated: 'isolated',
  'speed-trainer': 'speed-trainer',
  roulette: 'roulette',
};

// Pad (ms) before the groove and after the fill for the practice loop region.
const LOOP_PAD_MS = 600;

export default function PracticeView({
  fillId,
  onExit,
  onNext,
}: PracticeViewProps) {
  const data = useFillChart(fillId);
  const [mode, setMode] = useState<Mode>('song-context');

  if (data.status === 'loading') {
    return <Centered>Loading fill…</Centered>;
  }
  if (data.status === 'no-handle') {
    return (
      <Centered>
        <p>
          Re-grant access to your Songs folder from the Library to practice this
          fill.
        </p>
        <Button variant="outline" onClick={onExit}>
          Back to Library
        </Button>
      </Centered>
    );
  }
  if (data.status === 'not-found') {
    return (
      <Centered>
        <p>Could not find this fill&apos;s song in your library.</p>
        <Button variant="outline" onClick={onExit}>
          Back to Library
        </Button>
      </Centered>
    );
  }
  if (
    data.status === 'error' ||
    !data.chart ||
    !data.track ||
    !data.practiceData ||
    !data.fill
  ) {
    return (
      <Centered>
        <p>{data.error ?? 'Something went wrong loading this fill.'}</p>
        <Button variant="outline" onClick={onExit}>
          Back to Library
        </Button>
      </Centered>
    );
  }

  return (
    <PracticeSession
      key={fillId}
      fillId={fillId}
      mode={mode}
      onModeChange={setMode}
      data={{
        chart: data.chart,
        track: data.track,
        practiceData: data.practiceData,
        fill: data.fill,
        audioFiles: data.audioFiles,
        groovePattern: data.groovePattern,
      }}
      onExit={onExit}
      onNext={onNext}
    />
  );
}

function Centered({children}: {children: React.ReactNode}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
      {children}
    </div>
  );
}

type FillChartResult = ReturnType<typeof useFillChart>;
interface ReadyData {
  chart: NonNullable<FillChartResult['chart']>;
  track: NonNullable<FillChartResult['track']>;
  practiceData: NonNullable<FillChartResult['practiceData']>;
  fill: NonNullable<FillChartResult['fill']>;
  audioFiles: FillChartResult['audioFiles'];
  groovePattern: FillChartResult['groovePattern'];
}

function PracticeSession({
  fillId,
  mode,
  onModeChange,
  data,
  onExit,
  onNext,
}: {
  fillId: string;
  mode: Mode;
  onModeChange: (m: Mode) => void;
  data: ReadyData;
  onExit: () => void;
  onNext?: () => void;
}) {
  const {chart, track, practiceData, fill, audioFiles, groovePattern} = data;
  const {connectedIds} = useMidi();
  const hasMidi = connectedIds.length > 0;

  const isSynth = mode === 'isolated' || mode === 'roulette';

  const chartDelayMs = useMemo(() => getChartDelayMs(chart.metadata), [chart]);

  // Metadata shim for the highway + sheet music (only song_length is read).
  const metadata = useMemo<ChartResponseEncore>(
    () =>
      ({
        md5: fill.chartHash,
        name: fill.song,
        artist: fill.artist,
        charter: fill.charter,
        song_length: Math.ceil(
          ((chart.metadata as {length?: number} | undefined)?.length ?? 0) ||
            practiceData.fillEndMs + 4000,
        ),
        hasVideoBackground: false,
        albumArtMd5: '',
        notesData: undefined as never,
        modifiedTime: '',
        file: '',
      }) as unknown as ChartResponseEncore,
    [fill, chart, practiceData],
  );

  // --- Audio: AudioManager drives the highway clock + song-loop modes ---
  const audioManagerRef = useRef<AudioManager | null>(null);
  const [audioManager, setAudioManager] = useState<AudioManager | null>(null);
  const backingRef = useRef<BackingTrackPlayer | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);

  // --- Speed trainer / tempo ---
  const [tempoPct, setTempoPct] = useState(() => initialTempoPct());
  const recentAttemptsRef = useRef<{passed: boolean}[]>([]);

  const effectiveTempo = mode === 'speed-trainer' ? tempoPct / 100 : 1;

  // --- SRS state (seeded from the DB row; PracticeSession remounts per fill) ---
  const [srs, setSrs] = useState<FillSrsState>(() =>
    fill.srs
      ? {
          fillId,
          state: fill.srs.state,
          ease: fill.srs.ease,
          intervalDays: fill.srs.intervalDays,
          dueAt: fill.srs.dueAt != null ? new Date(fill.srs.dueAt) : null,
          passStreak: fill.srs.passStreak,
          totalAttempts: 0,
        }
      : initFillSrsState(fillId),
  );
  const srsRef = useRef<FillSrsState>(srs);
  useEffect(() => {
    srsRef.current = srs;
  }, [srs]);

  // --- Live scoring ---
  const {
    state: scoring,
    beginAttempt,
    finishAttempt,
    reset: resetScoring,
  } = useLiveScoring(practiceData.notes);

  // Loop region (chart ms).
  const loopStartMs = Math.max(0, practiceData.grooveStartMs - LOOP_PAD_MS);
  const loopEndMs = practiceData.fillEndMs + LOOP_PAD_MS;

  // Build the AudioManager when song audio is available. (No audio → leave the
  // manager null; the previous run's cleanup already cleared it.)
  useEffect(() => {
    if (!audioFiles || audioFiles.length === 0) return;
    let cancelled = false;
    const am = new AudioManager([...audioFiles], () => setIsPlaying(false));
    am.ready.then(() => {
      if (cancelled) {
        am.destroy();
        return;
      }
      am.setChartDelay(chartDelayMs / 1000);
      audioManagerRef.current = am;
      setAudioManager(am);
    });
    return () => {
      cancelled = true;
      audioManagerRef.current?.destroy();
      am.destroy();
      audioManagerRef.current = null;
      setAudioManager(null);
    };
  }, [audioFiles, chartDelayMs]);

  // Apply tempo to song audio (pitch-preserving) when the speed trainer changes.
  useEffect(() => {
    const am = audioManagerRef.current;
    if (!am) return;
    try {
      am.setTempo(effectiveTempo);
    } catch {
      // tempo out of supported range — ignore
    }
  }, [effectiveTempo, audioManager]);

  // The attempt loop: track when the playhead crosses the fill window so we can
  // begin/finish scoring attempts on each loop pass. Driven off a poll, never a
  // setState updater.
  const inFillRef = useRef(false);
  const fillStartChartMs = practiceData.fillStartMs;
  const fillEndChartMs = practiceData.fillEndMs;

  // Latest attempt-scored handler, called from the loop tick without coupling
  // the tick's identity to it (defined below).
  const onAttemptScoredRef = useRef<(result: ScoredAttempt) => void>(() => {});

  const handleLoopTick = useCallback(() => {
    const am = audioManagerRef.current;
    if (!am || !am.isInitialized) return;
    const chartMs = am.chartTime * 1000;

    // Practice-mode looping is handled by AudioManager.checkPracticeModeLoop,
    // but we re-anchor scoring here based on the fill window crossings.
    if (am.isPlaying) am.checkPracticeModeLoop();

    const inFill = chartMs >= fillStartChartMs && chartMs < fillEndChartMs;
    if (inFill && !inFillRef.current) {
      // Entered the fill: anchor scoring to now mapped to fill start.
      inFillRef.current = true;
      beginAttempt(performance.now() - (chartMs - fillStartChartMs));
    } else if (!inFill && inFillRef.current && chartMs >= fillEndChartMs) {
      // Left the fill (forward): finish + score the attempt.
      inFillRef.current = false;
      const result = finishAttempt();
      if (result) onAttemptScoredRef.current(result);
    } else if (!inFill && inFillRef.current && chartMs < fillStartChartMs) {
      // Looped back before scoring (shouldn't normally happen) — discard.
      inFillRef.current = false;
      finishAttempt();
    }
  }, [beginAttempt, finishAttempt, fillStartChartMs, fillEndChartMs]);

  useInterval(handleLoopTick, isPlaying && !isSynth ? 30 : null);

  // Persist an attempt + advance SRS / speed trainer.
  const onAttemptScored = useCallback(
    (result: ScoredAttempt) => {
      const passed = result.score.passed;
      const now = new Date();

      // SRS — compute next state from the current ref (no work inside the
      // setState updater), persist, then push to state.
      const base = srsRef.current ?? initFillSrsState(fillId);
      const updated = applyAttempt(
        base,
        {passed, tempoPct: mode === 'speed-trainer' ? tempoPct : 100},
        now,
      );
      setSrs(updated);
      void upsertSrs({
        fillId,
        state: updated.state,
        ease: updated.ease,
        intervalDays: updated.intervalDays,
        dueAt: updated.dueAt ? updated.dueAt.getTime() : now.getTime(),
        passStreak: updated.passStreak,
      }).catch(() => {});

      // Speed trainer ramp.
      if (mode === 'speed-trainer') {
        recentAttemptsRef.current = [
          ...recentAttemptsRef.current.slice(-9),
          {passed},
        ];
        setTempoPct(nextTempoPct(tempoPct, recentAttemptsRef.current));
      }

      // Record the attempt row (best-effort).
      void recordAttempt({
        fillId,
        mode: MODE_TO_DB[mode],
        tempoPct: mode === 'speed-trainer' ? tempoPct : 100,
        score: result.score.score,
        judgments: result.match.judgments.map(j => ({
          id: j.note.id,
          judgment: j.judgment,
          deltaMs: j.deltaMs,
        })),
      }).catch(() => {});
    },
    [fillId, mode, tempoPct],
  );

  useEffect(() => {
    onAttemptScoredRef.current = onAttemptScored;
  }, [onAttemptScored]);

  // --- Playback controls ---
  const startSongLoop = useCallback(() => {
    const am = audioManagerRef.current;
    if (!am) {
      toast.error('No song audio available — try Isolated synth mode.');
      return;
    }
    const config: PracticeModeConfig = {
      startMeasureMs: practiceData.grooveStartMs,
      endMeasureMs: practiceData.fillEndMs,
      startTimeMs: loopStartMs + chartDelayMs,
      endTimeMs: loopEndMs + chartDelayMs,
    };
    am.setPracticeMode(config);
    am.playChartTime(loopStartMs / 1000);
    setIsPlaying(true);
  }, [practiceData, loopStartMs, loopEndMs, chartDelayMs]);

  const startSynthLoop = useCallback(() => {
    if (!groovePattern) return;
    const am = audioManagerRef.current;
    // Mute song audio if present; synth is the audio source.
    if (am) {
      try {
        am.setPracticeMode(null);
        am.pause();
      } catch {
        // ignore
      }
    }
    const ctx = (window.ctx as AudioContext | undefined) ?? new AudioContext();
    window.ctx = ctx;
    void ctx.resume();
    backingRef.current?.stop();
    const synthTempo = mode === 'speed-trainer' ? tempoPct / 100 : 1;
    const bpm = practiceData.bpm * synthTempo;
    const player = new BackingTrackPlayer(ctx, groovePattern, bpm);
    backingRef.current = player;
    player.start();
    setIsPlaying(true);
  }, [groovePattern, practiceData.bpm, mode, tempoPct]);

  const stopAll = useCallback(() => {
    audioManagerRef.current?.pause();
    backingRef.current?.stop();
    backingRef.current = null;
    inFillRef.current = false;
    finishAttempt();
    setIsPlaying(false);
  }, [finishAttempt]);

  const togglePlay = useCallback(() => {
    if (isPlaying) {
      stopAll();
      return;
    }
    if (isSynth) startSynthLoop();
    else startSongLoop();
  }, [isPlaying, isSynth, startSynthLoop, startSongLoop, stopAll]);

  const restartLoop = useCallback(() => {
    stopAll();
    resetScoring();
    // Restart on next tick.
    setTimeout(() => {
      if (isSynth) startSynthLoop();
      else startSongLoop();
    }, 0);
  }, [stopAll, resetScoring, isSynth, startSynthLoop, startSongLoop]);

  const nudgeTempo = useCallback((delta: number) => {
    setTempoPct(prev => Math.max(50, Math.min(110, prev + delta)));
  }, []);

  // Stop everything on mode change (skip the initial mount — nothing to stop).
  const prevModeRef = useRef(mode);
  useEffect(() => {
    if (prevModeRef.current === mode) return;
    prevModeRef.current = mode;
    stopAll();
    resetScoring();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Keyboard shortcuts.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      switch (e.key) {
        case ' ':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowUp':
        case 'ArrowRight':
          nudgeTempo(5);
          break;
        case 'ArrowDown':
        case 'ArrowLeft':
          nudgeTempo(-5);
          break;
        case 'r':
        case 'R':
          restartLoop();
          break;
        case 'n':
        case 'N':
          (onNext ?? onExit)();
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [togglePlay, nudgeTempo, restartLoop, onNext, onExit]);

  // Practice-mode config for SheetMusic highlighting.
  const sheetPracticeConfig = useMemo<PracticeModeConfig>(
    () => ({
      startMeasureMs: practiceData.grooveStartMs,
      endMeasureMs: practiceData.fillEndMs,
      startTimeMs: loopStartMs,
      endTimeMs: loopEndMs,
    }),
    [practiceData, loopStartMs, loopEndMs],
  );

  return (
    <div className="flex flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">
            {fill.song}{' '}
            <span className="text-muted-foreground">— {fill.artist}</span>
          </h2>
          <p className="text-xs text-muted-foreground">
            {Math.round(fill.tempoBpm)} BPM · {fill.lengthBars} bar ·{' '}
            {fill.subdivision} · complexity {fill.complexity} ·{' '}
            {fill.voicingTags.join(', ')}
          </p>
        </div>
        <Button
          variant="ghost"
          onClick={() => {
            stopAll();
            onExit();
          }}>
          Back to Library
        </Button>
      </div>

      {/* Mode switcher */}
      <div className="flex flex-wrap gap-1 rounded-lg border bg-card p-1">
        {(Object.keys(MODE_LABELS) as Mode[]).map(m => (
          <button
            key={m}
            onClick={() => onModeChange(m)}
            className={cn(
              'rounded px-3 py-1.5 text-sm font-medium transition-colors',
              m === mode
                ? 'bg-primary text-primary-foreground'
                : 'hover:bg-muted',
            )}>
            {MODE_LABELS[m]}
          </button>
        ))}
      </div>

      {!hasMidi && (
        <div className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
          No MIDI device connected — connect your kit from the Library to score
          your hits.
        </div>
      )}

      {/* Transport */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-2">
        <Button onClick={togglePlay} disabled={!audioManager && !isSynth}>
          {isPlaying ? 'Pause (space)' : 'Play (space)'}
        </Button>
        <Button variant="outline" onClick={restartLoop}>
          Restart (R)
        </Button>
        {(mode === 'roulette' || onNext) && (
          <Button variant="outline" onClick={() => (onNext ?? onExit)()}>
            Next (N)
          </Button>
        )}
        {mode === 'speed-trainer' && (
          <div className="ml-2 flex items-center gap-1 text-sm">
            <Button variant="outline" size="sm" onClick={() => nudgeTempo(-5)}>
              −
            </Button>
            <span className="w-12 text-center font-mono">{tempoPct}%</span>
            <Button variant="outline" size="sm" onClick={() => nudgeTempo(5)}>
              +
            </Button>
          </div>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          Hits this pass: {scoring.pendingHits}
        </span>
      </div>

      {/* Views: highway + sheet music + HUD */}
      <div className="flex flex-1 flex-col gap-3 lg:flex-row">
        <div className="flex min-h-[280px] flex-1 flex-col gap-3 lg:flex-row">
          <div className="flex min-h-[280px] flex-1 overflow-hidden rounded-lg border">
            {audioManager ? (
              <CloneHeroRenderer
                metadata={metadata}
                chart={chart}
                track={track}
                audioManager={audioManager}
              />
            ) : (
              <div className="flex flex-1 items-center justify-center bg-muted text-sm text-muted-foreground">
                Highway preview needs song audio (Song loop mode).
              </div>
            )}
          </div>
          <div className="flex min-h-[280px] flex-1 overflow-hidden">
            <SheetMusic
              chart={chart}
              track={track}
              showBarNumbers={false}
              enableColors
              showLyrics={false}
              lyrics={[]}
              zoom={1}
              onSelectMeasure={() => {}}
              triggerRerender={mode}
              practiceModeConfig={sheetPracticeConfig}
              onPracticeMeasureSelect={() => {}}
              selectionIndex={null}
              audioManagerRef={audioManagerRef}
            />
          </div>
        </div>
        <div className="w-full lg:w-64">
          <PracticeHud
            lastAttempt={scoring.lastAttempt}
            srs={srs}
            tempoPct={tempoPct}
            speedTrainer={mode === 'speed-trainer'}
          />
          {srs && isDue(srs, new Date()) && (
            <p className="mt-2 text-center text-xs text-amber-600">
              Due for review
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
