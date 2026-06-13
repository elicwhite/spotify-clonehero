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
import {
  BackingTrackPlayer,
  fillWindowSeconds,
} from '@/lib/drum-fills/practice/backingTrack';
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
import {
  getFillSiblings,
  recordAttempt,
  upsertSrs,
  type FillWithSrs,
} from '@/lib/local-db/drum-fills';
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
  /**
   * Optional label for the Next control and a preview of the upcoming item
   * (groove/roulette sessions show the next fill one ahead).
   */
  nextLabel?: string;
  /** Notified after each scored attempt (for session summaries). */
  onAttemptScored?: (result: ScoredAttempt) => void;
  /** Extra controls rendered in the transport row (e.g. shuffle toggle). */
  transportExtras?: React.ReactNode;
  /** Practice mode to start in (defaults to song loop). */
  initialMode?: Mode;
  /**
   * When true, PracticeView offers an instance switcher in the transport: it
   * loads the other fill instances that share this fill's pattern (cross-song
   * dedupe group) and lets the user practice a different one. Used when
   * launching from a grouped Library card.
   */
  enableInstanceSwitcher?: boolean;
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
  nextLabel,
  onAttemptScored,
  transportExtras,
  initialMode,
  enableInstanceSwitcher,
}: PracticeViewProps) {
  // When instance switching is enabled the user can practice a sibling instance
  // of the same pattern; `activeFillId` overrides the prop until they exit. The
  // override resets when the prop changes, adjusted during render (no effect) so
  // there's no cascading-render flash. See react.dev "adjusting state on prop
  // change".
  const [activeFill, setActiveFill] = useState<{anchor: string; id: string}>(
    () => ({anchor: fillId, id: fillId}),
  );
  if (activeFill.anchor !== fillId) {
    setActiveFill({anchor: fillId, id: fillId});
  }
  const activeFillId = activeFill.id;
  const setActiveFillId = (id: string) => setActiveFill({anchor: fillId, id});

  const [siblings, setSiblings] = useState<FillWithSrs[] | null>(null);
  const data = useFillChart(activeFillId);
  const [mode, setMode] = useState<Mode>(initialMode ?? 'song-context');

  // Load the pattern's sibling instances once the fill resolves (the chart load
  // gives us its similarity key). Only when switching is enabled and there is a
  // key to group by; otherwise the resolved value is null.
  const similarityKey = enableInstanceSwitcher
    ? (data.fill?.fillSimilarityKey ?? null)
    : null;
  useEffect(() => {
    let cancelled = false;
    if (!similarityKey) {
      Promise.resolve().then(() => {
        if (!cancelled) setSiblings(null);
      });
      return () => {
        cancelled = true;
      };
    }
    getFillSiblings(similarityKey)
      .then(rows => {
        if (!cancelled) setSiblings(rows);
      })
      .catch(() => {
        if (!cancelled) setSiblings(null);
      });
    return () => {
      cancelled = true;
    };
  }, [similarityKey]);

  const instanceSwitcher =
    siblings && siblings.length > 1 ? (
      <label className="ml-2 flex items-center gap-1.5 text-xs text-muted-foreground">
        Instance
        <select
          name="fill-instance"
          value={activeFillId}
          onChange={e => setActiveFillId(e.target.value)}
          className="max-w-[12rem] rounded border bg-background px-2 py-1 text-xs">
          {siblings.map(s => (
            <option key={s.id} value={s.id}>
              {s.song} · {Math.round(s.tempoBpm)} BPM
            </option>
          ))}
        </select>
      </label>
    ) : null;

  const mergedExtras =
    instanceSwitcher || transportExtras ? (
      <>
        {transportExtras}
        {instanceSwitcher}
      </>
    ) : undefined;

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
      key={activeFillId}
      fillId={activeFillId}
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
      nextLabel={nextLabel}
      onAttemptScored={onAttemptScored}
      transportExtras={mergedExtras}
    />
  );
}

/**
 * Mode picker as a collapsed disclosure: the active (journey-implied) mode shows
 * as a chip with a "Change mode" toggle; expanding reveals the full strip. Keeps
 * configuration reachable without making it the loudest element on the page.
 */
function ModeSwitcher({
  mode,
  onModeChange,
}: {
  mode: Mode;
  onModeChange: (m: Mode) => void;
}) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <div className="flex shrink-0 items-center gap-2 text-sm">
        <span className="rounded bg-primary px-3 py-1.5 font-medium text-primary-foreground">
          {MODE_LABELS[mode]}
        </span>
        <button
          onClick={() => setOpen(true)}
          className="text-xs text-muted-foreground hover:text-foreground">
          Change mode
        </button>
      </div>
    );
  }
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1 rounded-lg border bg-card p-1">
      {(Object.keys(MODE_LABELS) as Mode[]).map(m => (
        <button
          key={m}
          onClick={() => {
            onModeChange(m);
            setOpen(false);
          }}
          className={cn(
            'rounded px-3 py-1.5 text-sm font-medium transition-colors',
            m === mode
              ? 'bg-primary text-primary-foreground'
              : 'hover:bg-muted',
          )}>
          {MODE_LABELS[m]}
        </button>
      ))}
      <button
        onClick={() => setOpen(false)}
        className="ml-1 px-2 text-xs text-muted-foreground hover:text-foreground">
        Done
      </button>
    </div>
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
  nextLabel,
  onAttemptScored: onAttemptScoredExternal,
  transportExtras,
}: {
  fillId: string;
  mode: Mode;
  onModeChange: (m: Mode) => void;
  data: ReadyData;
  onExit: () => void;
  onNext?: () => void;
  nextLabel?: string;
  onAttemptScored?: (result: ScoredAttempt) => void;
  transportExtras?: React.ReactNode;
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

  // Synth-mode attempt loop: the backing player owns the clock, so track the
  // loop position and anchor scoring to the empty fill bars at the end of each
  // loop pass.
  const handleSynthTick = useCallback(() => {
    const player = backingRef.current;
    if (!player || !groovePattern) return;
    const posSec = player.loopPositionSeconds();
    if (posSec === null) return;

    const {start: fillStartSec} = fillWindowSeconds(
      groovePattern,
      practiceData.bpm,
    );
    const inFill = posSec >= fillStartSec;
    if (inFill && !inFillRef.current) {
      // Entered the fill bars: anchor scoring to now mapped to fill start.
      inFillRef.current = true;
      beginAttempt(performance.now() - (posSec - fillStartSec) * 1000);
    } else if (!inFill && inFillRef.current) {
      // Wrapped back to the groove bars: the fill window (which runs to the
      // end of the loop) is over — finish + score the attempt.
      inFillRef.current = false;
      const result = finishAttempt();
      if (result) onAttemptScoredRef.current(result);
    }
  }, [groovePattern, practiceData.bpm, beginAttempt, finishAttempt]);

  useInterval(handleSynthTick, isPlaying && isSynth ? 30 : null);

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

      onAttemptScoredExternal?.(result);
    },
    [fillId, mode, tempoPct, onAttemptScoredExternal],
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
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
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
          Back
        </Button>
      </div>

      {/* Mode switcher — the journey implies a default (ladder → isolated synth,
          song-launched → song loop), so the current mode leads and the full
          picker is a one-click disclosure rather than an always-on tab strip. */}
      <ModeSwitcher mode={mode} onModeChange={onModeChange} />

      {!hasMidi && (
        <div className="shrink-0 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
          No MIDI device connected — connect your kit from the Library to score
          your hits.
        </div>
      )}

      {/* Transport */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-lg border bg-card p-2">
        <Button onClick={togglePlay} disabled={!audioManager && !isSynth}>
          {isPlaying ? 'Pause (space)' : 'Play (space)'}
        </Button>
        <Button variant="outline" onClick={restartLoop}>
          Restart (R)
        </Button>
        {(mode === 'roulette' || onNext) && (
          <Button variant="outline" onClick={() => (onNext ?? onExit)()}>
            {nextLabel ? `Next: ${nextLabel} (N)` : 'Next (N)'}
          </Button>
        )}
        {transportExtras}
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

      {/* Views: highway + sheet music + HUD.
          The row fills the remaining bounded height (min-h-0 so flex children
          can shrink); the highway gets a stable, fully-visible container and
          the sheet-music pane scrolls internally (SheetMusic owns its own
          overflow-y-auto). On narrow screens the panes stack and the row
          itself scrolls so nothing is clipped. */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto lg:flex-row lg:overflow-hidden">
        <div className="flex min-h-[280px] flex-1 flex-col gap-3 lg:min-h-0 lg:flex-row">
          <div className="flex min-h-[280px] flex-1 overflow-hidden rounded-lg border lg:min-h-0">
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
          <div className="flex min-h-[280px] flex-1 overflow-hidden lg:min-h-0">
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
        <div className="w-full shrink-0 lg:w-64 lg:overflow-y-auto">
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
