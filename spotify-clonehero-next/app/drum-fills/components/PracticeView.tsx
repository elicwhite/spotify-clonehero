'use client';

import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import useInterval from 'use-interval';
import {toast} from 'sonner';
import {Button} from '@/components/ui/button';
import {
  AudioManager,
  type PracticeModeConfig,
} from '@/lib/preview/audioManager';
import {getChartDelayMs} from '@/lib/chart-utils/chartDelay';
import type {ChartResponseEncore} from '@/lib/chartSelection';
import CloneHeroRenderer from '@/app/sheet-music/[slug]/CloneHeroRenderer';
import SheetMusic from '@/app/sheet-music/[slug]/SheetMusic';
import {
  buildPracticeChart,
  fillNotesToBeatOffsets,
} from '@/lib/drum-fills/practice/practiceChart';
import {renderBackingWav} from '@/lib/drum-fills/practice/backingAudio';
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
  getFillBest,
  getFillSiblings,
  recordAttempt,
  upsertSrs,
  type FillWithSrs,
} from '@/lib/drum-fills/db';
import {
  bestFromStored,
  type ScoredAttempt,
} from '@/lib/drum-fills/practice/attempt';
import type {FillMode} from '@/lib/drum-fills/db';
import {useFillChart} from '../hooks/useFillChart';
import {useLiveScoring} from '../hooks/useLiveScoring';
import {useMidi} from '../contexts/MidiContext';
import PracticeHud from './PracticeHud';
import PracticeFeedbackBanner, {
  type FeedbackCallout,
} from './PracticeFeedbackBanner';
import PracticeContextBar, {type PracticeMode} from './PracticeContextBar';

export interface PracticeViewProps {
  fillId: string;
  onExit: () => void;
  /** Called when the user advances (queue/roulette). Falls back to onExit. */
  onNext?: (() => void) | undefined;
  /**
   * Optional label for the Next control and a preview of the upcoming item
   * (groove/roulette sessions show the next fill one ahead).
   */
  nextLabel?: string | undefined;
  /** Notified after each scored attempt (for session summaries). */
  onAttemptScored?: ((result: ScoredAttempt) => void) | undefined;
  /** Extra controls rendered in the transport row (e.g. shuffle toggle). */
  transportExtras?: React.ReactNode | undefined;
  /**
   * Optional session-context node rendered in the practice bar's session slot
   * (e.g. a ladder "Rung n/N" readout). Sessions also publish identity into the
   * header `[H]` context slot themselves.
   */
  sessionCtx?: React.ReactNode | undefined;
  /** Practice mode to start in (defaults to song loop). */
  initialMode?: Mode | undefined;
  /**
   * Controlled tempo (percent). When provided, the parent owns tempo: the
   * manual slider/nudges report through {@link onTempoPctChange} and the
   * speed-trainer auto-ramp is disabled (the ladder drives tempo externally).
   * Omit for the default self-managed tempo.
   */
  tempoPct?: number | undefined;
  onTempoPctChange?: ((pct: number) => void) | undefined;
  /**
   * When true, PracticeView offers an instance switcher in the transport: it
   * loads the other fill instances that share this fill's pattern (cross-song
   * dedupe group) and lets the user practice a different one. Used when
   * launching from a grouped Library card.
   */
  enableInstanceSwitcher?: boolean | undefined;
  /** Persistent status shown in the across-the-room feedback banner (e.g. the
   * ladder rung). The tempo is appended automatically. */
  feedbackStatus?: string | undefined;
  /** Transient big callout in the banner on a rung/tempo change (replaces toasts). */
  feedbackCallout?: FeedbackCallout | null | undefined;
}

type Mode = PracticeMode;

const MODE_TO_DB: Record<Mode, FillMode> = {
  'song-context': 'song-context',
  isolated: 'isolated',
  'speed-trainer': 'speed-trainer',
  roulette: 'roulette',
};

// Pad (ms) after the fill before the loop wraps.
const LOOP_PAD_MS = 600;

// Arm scoring this many chart-ms before the fill's first note. The downbeat is
// commonly struck a hair early; without this, a hit landing before the fill
// window opened was dropped (the first note read as a miss). One timing window
// (the matcher's ±70ms `good` boundary) is enough to catch it while staying
// clear of the preceding groove note.
const SCORING_PREROLL_MS = 70;

// Lead-in before the practiced content (Clone Hero practice-mode behaviour): the
// loop starts here with an empty highway so the upcoming notes scroll into view
// and the player can prepare instead of being surprised by the first note. Song
// mode pads back from the groove by this many ms (clamped to chart start); synth
// mode authors whole empty bars ahead of the groove instead.
const LEAD_IN_MS = 1600;
const SYNTH_LEAD_IN_BARS = 1;

// Manual tempo (slow-down) range, shared by the slider, keyboard nudges, and
// the speed trainer. Well within AudioManager's 0.25–4.0 support.
const TEMPO_MIN_PCT = 40;
const TEMPO_MAX_PCT = 110;

export default function PracticeView({
  fillId,
  onExit,
  onNext,
  nextLabel,
  onAttemptScored,
  transportExtras,
  sessionCtx,
  initialMode,
  enableInstanceSwitcher,
  tempoPct: controlledTempoPct,
  onTempoPctChange,
  feedbackStatus,
  feedbackCallout,
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
      sessionCtx={sessionCtx}
      controlledTempoPct={controlledTempoPct}
      onTempoPctChange={onTempoPctChange}
      feedbackStatus={feedbackStatus}
      feedbackCallout={feedbackCallout}
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
  nextLabel,
  onAttemptScored: onAttemptScoredExternal,
  transportExtras,
  sessionCtx,
  controlledTempoPct,
  onTempoPctChange,
  feedbackStatus,
  feedbackCallout,
}: {
  fillId: string;
  mode: Mode;
  onModeChange: (m: Mode) => void;
  data: ReadyData;
  onExit: () => void;
  onNext?: (() => void) | undefined;
  nextLabel?: string | undefined;
  onAttemptScored?: ((result: ScoredAttempt) => void) | undefined;
  transportExtras?: React.ReactNode | undefined;
  sessionCtx?: React.ReactNode | undefined;
  controlledTempoPct?: number | undefined;
  onTempoPctChange?: ((pct: number) => void) | undefined;
  feedbackStatus?: string | undefined;
  feedbackCallout?: FeedbackCallout | null | undefined;
}) {
  const {chart, track, practiceData, fill, audioFiles, groovePattern} = data;
  const {connectedIds} = useMidi();
  const hasMidi = connectedIds.length > 0;

  const isSynth = mode === 'isolated' || mode === 'roulette';

  const chartDelayMs = useMemo(() => getChartDelayMs(chart.metadata), [chart]);

  // --- Synthetic practice chart (synth modes) ---
  // The groove and fill may come from different songs (groove sessions /
  // roulette), so synth modes never display or play the source chart. Instead
  // we author a small chart — groove bars + the fill at one tempo, starting at
  // t=0 — and everything (highway, sheet music, scoring window, backing audio)
  // derives from it. See lib/drum-fills/practice/practiceChart.
  const synthBundle = useMemo(() => {
    if (!groovePattern) return null;
    return buildPracticeChart({
      pattern: groovePattern,
      bpm: practiceData.bpm,
      fillNotes: fillNotesToBeatOffsets(
        practiceData.notes,
        fill.startTick,
        chart.resolution,
      ),
      // One empty bar of lead-in so the highway clears before the groove and the
      // practiced notes scroll into view (Clone Hero practice-mode behaviour).
      leadInBars: SYNTH_LEAD_IN_BARS,
    });
  }, [groovePattern, practiceData, fill.startTick, chart.resolution]);

  const useSynthChart = isSynth && synthBundle !== null;
  const activeChart = useSynthChart ? synthBundle.chart : chart;
  const activeTrack = useSynthChart ? synthBundle.track : track;
  const activeChartDelayMs = useSynthChart ? 0 : chartDelayMs;

  // Metadata shim for the highway + sheet music (only song_length is read).
  const metadata = useMemo<ChartResponseEncore>(
    () =>
      ({
        md5: fill.chartHash,
        name: fill.song,
        artist: fill.artist,
        charter: fill.charter,
        song_length: useSynthChart
          ? Math.ceil(synthBundle.fillEndMs + 1000)
          : Math.ceil(
              ((chart.metadata as {length?: number} | undefined)?.length ??
                0) ||
                practiceData.fillEndMs + 4000,
            ),
        hasVideoBackground: false,
        albumArtMd5: '',
        notesData: undefined as never,
        modifiedTime: '',
        file: '',
      }) as unknown as ChartResponseEncore,
    [fill, chart, practiceData, useSynthChart, synthBundle],
  );

  // --- Audio: AudioManager is the single clock for every mode. Song modes play
  // the song stems; synth modes play the rendered backing WAV. The highway,
  // playhead, and scoring all poll the active manager's chartTime. ---
  const audioManagerRef = useRef<AudioManager | null>(null);
  const [audioManager, setAudioManager] = useState<AudioManager | null>(null);
  const synthAmRef = useRef<AudioManager | null>(null);
  const [synthAudioManager, setSynthAudioManager] =
    useState<AudioManager | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);

  const activeAudioManager = isSynth ? synthAudioManager : audioManager;
  // Stable ref to the active manager for the playhead's rAF poll and the loop
  // tick. Updated via effect (one-way push, no render-time mutation).
  const activeAmRef = useRef<AudioManager | null>(null);
  useEffect(() => {
    activeAmRef.current = activeAudioManager;
  }, [activeAudioManager]);

  // --- Tempo (shared by the manual slider, keyboard nudges, and the speed
  // trainer's automatic ramp; one state so they never fight). The speed trainer
  // starts slow; other modes start at full speed.
  //
  // When `controlledTempoPct` is provided the parent owns tempo (the ladder
  // drives it): `tempoPct` reflects the prop and `setTempoPct` reports upward.
  // Exactly one writer is live, so the internal auto-ramp must stay off while
  // controlled (gated below). ---
  const tempoControlled = controlledTempoPct !== undefined;
  const [internalTempoPct, setInternalTempoPct] = useState(() =>
    mode === 'speed-trainer' ? initialTempoPct() : 100,
  );
  const tempoPct = tempoControlled ? controlledTempoPct : internalTempoPct;
  const setTempoPct = useMemo(
    () =>
      tempoControlled
        ? (onTempoPctChange ?? (() => {}))
        : setInternalTempoPct,
    [tempoControlled, onTempoPctChange],
  );
  const recentAttemptsRef = useRef<{passed: boolean}[]>([]);

  // Manual tempo applies in every mode (the plan's slow-down control); the
  // speed trainer also drives this same value automatically.
  const effectiveTempo = tempoPct / 100;

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

  // --- Live scoring (against the active chart's fill notes) ---
  const scoringNotes = useSynthChart
    ? synthBundle.expectedNotes
    : practiceData.notes;
  const {
    state: scoring,
    beginAttempt,
    finishAttempt,
    seedBest,
    reset: resetScoring,
  } = useLiveScoring(scoringNotes, effectiveTempo);

  // Seed the best attempt from history so it survives reloads + reflects prior
  // sessions. PracticeSession remounts per fill (keyed on fillId), so this runs
  // once per fill. The judgment ids are the same scheme the renderer uses, so a
  // seeded best can immediately mark the stave.
  useEffect(() => {
    let cancelled = false;
    getFillBest(fillId)
      .then(best => {
        if (cancelled) return;
        seedBest(best ? bestFromStored(best.score, best.judgments) : null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [fillId, seedBest]);

  // Loop region in the active chart's ms. Song modes pad around the source
  // chart's groove+fill span; the synthetic chart IS the loop (starts at 0,
  // ends at the fill end), so no pads.
  // The synth chart authors its own lead-in bars (synthBundle.grooveStartMs is
  // where the groove begins, after the empty lead-in), so the loop starts at 0
  // and the empty bars are the lead-in. Song mode starts LEAD_IN_MS before the
  // groove (clamped to 0) so the highway shows notes scrolling in first.
  const loopStartMs = useSynthChart
    ? 0
    : Math.max(0, practiceData.grooveStartMs - LEAD_IN_MS);
  const loopEndMs = useSynthChart
    ? synthBundle.fillEndMs
    : practiceData.fillEndMs + LOOP_PAD_MS;
  const grooveStartChartMs = useSynthChart
    ? synthBundle.grooveStartMs
    : practiceData.grooveStartMs;
  const fillStartChartMs = useSynthChart
    ? synthBundle.fillStartMs
    : practiceData.fillStartMs;
  const fillEndChartMs = useSynthChart
    ? synthBundle.fillEndMs
    : practiceData.fillEndMs;

  // Build the song AudioManager when song audio is available. (No audio →
  // leave the manager null; the previous run's cleanup already cleared it.)
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
      // Anchor the views on the lead-in before the user presses Play: seek the
      // (paused) manager to the loop start so the highway and sheet music show
      // the fill's measures instead of the top of the song.
      void am.seekToChartTime(
        Math.max(0, practiceData.grooveStartMs - LEAD_IN_MS) / 1000,
      );
    });
    return () => {
      cancelled = true;
      audioManagerRef.current?.destroy();
      am.destroy();
      audioManagerRef.current = null;
      setAudioManager(null);
    };
  }, [audioFiles, chartDelayMs, practiceData.grooveStartMs]);

  // Build the synth AudioManager when a synth mode is active: render the
  // backing WAV (groove bars with kit + click, fill bars silent) at the
  // practice chart's exact timing and feed it to AudioManager as a track.
  useEffect(() => {
    if (!isSynth || !groovePattern || !synthBundle) return;
    let cancelled = false;
    let created: AudioManager | null = null;
    (async () => {
      const wav = await renderBackingWav(groovePattern, synthBundle.bpm);
      if (cancelled) return;
      const am = new AudioManager([{fileName: 'backing.wav', data: wav}], () =>
        setIsPlaying(false),
      );
      created = am;
      await am.ready;
      if (cancelled) {
        am.destroy();
        return;
      }
      am.setChartDelay(0);
      synthAmRef.current = am;
      setSynthAudioManager(am);
    })().catch(err => {
      console.error('Failed to build synth backing track', err);
      if (!cancelled) toast.error('Could not build the synth backing track.');
    });
    return () => {
      cancelled = true;
      created?.destroy();
      synthAmRef.current = null;
      setSynthAudioManager(null);
    };
  }, [isSynth, groovePattern, synthBundle]);

  // Apply tempo (pitch-preserving) to the active manager whenever the tempo or
  // the active manager changes. Both song and synth managers are driven so the
  // slow-down control works in every mode; AudioManager.chartTime already
  // accounts for tempo, so the highway + playhead + scoring stay in sync.
  useEffect(() => {
    const am = activeAudioManager;
    if (!am) return;
    try {
      am.setTempo(effectiveTempo);
    } catch {
      // tempo out of supported range — ignore
    }
  }, [effectiveTempo, activeAudioManager]);

  // The attempt loop: track when the playhead crosses the fill window so we can
  // begin/finish scoring attempts on each loop pass. Driven off a poll, never a
  // setState updater. One handler for every mode — the active AudioManager is
  // the only clock, so what's scored is exactly what the views show.
  const inFillRef = useRef(false);

  // Latest attempt-scored handler, called from the loop tick without coupling
  // the tick's identity to it (defined below).
  const onAttemptScoredRef = useRef<(result: ScoredAttempt) => void>(() => {});

  const handleLoopTick = useCallback(() => {
    const am = activeAmRef.current;
    if (!am || !am.isInitialized) return;
    const chartMs = am.chartTime * 1000;

    // Practice-mode looping is handled by AudioManager.checkPracticeModeLoop,
    // but we re-anchor scoring here based on the fill window crossings.
    if (am.isPlaying) am.checkPracticeModeLoop();

    // Arm a timing-window early so an early downbeat hit is captured and
    // credited to the first note instead of being dropped.
    const enterAt = fillStartChartMs - SCORING_PREROLL_MS;
    const inFill = chartMs >= enterAt && chartMs < fillEndChartMs;
    if (inFill && !inFillRef.current) {
      // Entered the fill: sample the chart position and the real clock together
      // so the scorer can map hits to chart time at the current tempo.
      inFillRef.current = true;
      beginAttempt(chartMs, performance.now());
    } else if (!inFill && inFillRef.current && chartMs >= fillEndChartMs) {
      // Left the fill (forward): finish + score the attempt.
      inFillRef.current = false;
      const result = finishAttempt();
      if (result) onAttemptScoredRef.current(result);
    } else if (!inFill && inFillRef.current && chartMs < fillStartChartMs) {
      inFillRef.current = false;
      if (isSynth) {
        // The synth loop ends exactly at the fill end, so a wrap back to the
        // groove means the pass completed — finish + score.
        const result = finishAttempt();
        if (result) onAttemptScoredRef.current(result);
      } else {
        // Song loop wrapped mid-fill (shouldn't normally happen) — discard.
        finishAttempt();
      }
    }
  }, [beginAttempt, finishAttempt, fillStartChartMs, fillEndChartMs, isSynth]);

  useInterval(handleLoopTick, isPlaying ? 30 : null);

  // Dev-only test seam (parallels MidiContext.__drumFillsInjectHit): exposes the
  // active manager's chart time and the fill window so browser validation can
  // inject hits at precise loop-relative offsets and assert the per-note markers.
  // No-op in production.
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    const w = window as unknown as {__drumFillsDebug?: unknown};
    w.__drumFillsDebug = {
      chartMs: () => (activeAmRef.current?.chartTime ?? 0) * 1000,
      isPlaying: () => !!activeAmRef.current?.isPlaying,
      fillStartChartMs,
      fillEndChartMs,
      scoringNotes,
    };
    return () => {
      delete (window as unknown as {__drumFillsDebug?: unknown})
        .__drumFillsDebug;
    };
  }, [fillStartChartMs, fillEndChartMs, scoringNotes]);

  // Persist an attempt + advance SRS / speed trainer.
  const onAttemptScored = useCallback(
    (result: ScoredAttempt) => {
      const passed = result.score.passed;
      const now = new Date();

      // SRS — compute next state from the current ref (no work inside the
      // setState updater), persist, then push to state.
      const base = srsRef.current ?? initFillSrsState(fillId);
      // Report the real playback tempo so SRS only credits full-speed passes
      // toward mastery (masteryTempoPct). Under the controlled-tempo ladder this
      // means a rung isn't "mastered" until it's passed at full speed.
      const attemptTempoPct = Math.round(tempoPct);
      const updated = applyAttempt(base, {passed, tempoPct: attemptTempoPct}, now);
      setSrs(updated);
      void upsertSrs({
        fillId,
        state: updated.state,
        ease: updated.ease,
        intervalDays: updated.intervalDays,
        dueAt: updated.dueAt ? updated.dueAt.getTime() : now.getTime(),
        passStreak: updated.passStreak,
      }).catch(() => {});

      // Speed trainer ramp — only when this component owns tempo. Under a
      // controlled tempo (the ladder) the parent drives tempo, so the internal
      // ramp must stay off to avoid two writers fighting over one value.
      if (mode === 'speed-trainer' && !tempoControlled) {
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
        tempoPct: attemptTempoPct,
        score: result.score.score,
        judgments: result.match.judgments.map(j => ({
          id: j.note.id,
          judgment: j.judgment,
          deltaMs: j.deltaMs,
        })),
      }).catch(() => {});

      onAttemptScoredExternal?.(result);
    },
    [fillId, mode, tempoPct, tempoControlled, setTempoPct, onAttemptScoredExternal],
  );

  useEffect(() => {
    onAttemptScoredRef.current = onAttemptScored;
  }, [onAttemptScored]);

  // No song audio → song modes can't play; fall back to the synth loop once so
  // sessions that default to Song loop still work (e.g. ladder rungs whose
  // song has no audio files).
  const hasSongAudio = !!(audioFiles && audioFiles.length > 0);
  useEffect(() => {
    if (hasSongAudio) return;
    if (mode !== 'song-context' && mode !== 'speed-trainer') return;
    toast.message('No song audio for this fill — using Isolated synth.');
    onModeChange('isolated');
  }, [hasSongAudio, mode, onModeChange]);

  // --- Playback controls ---
  const startLoop = useCallback(() => {
    const am = isSynth ? synthAmRef.current : audioManagerRef.current;
    if (!am) {
      toast.error(
        isSynth ? 'Backing track still loading…' : 'Song audio still loading…',
      );
      return;
    }
    const config: PracticeModeConfig = {
      startMeasureMs: grooveStartChartMs,
      endMeasureMs: fillEndChartMs,
      startTimeMs: loopStartMs + activeChartDelayMs,
      endTimeMs: loopEndMs + activeChartDelayMs,
    };
    am.setPracticeMode(config);
    am.playChartTime(loopStartMs / 1000);
    setIsPlaying(true);
  }, [
    isSynth,
    grooveStartChartMs,
    fillEndChartMs,
    loopStartMs,
    loopEndMs,
    activeChartDelayMs,
  ]);

  const stopAll = useCallback(() => {
    audioManagerRef.current?.pause();
    synthAmRef.current?.pause();
    inFillRef.current = false;
    finishAttempt();
    setIsPlaying(false);
  }, [finishAttempt]);

  const togglePlay = useCallback(() => {
    if (isPlaying) {
      stopAll();
      return;
    }
    startLoop();
  }, [isPlaying, startLoop, stopAll]);

  const restartLoop = useCallback(() => {
    stopAll();
    resetScoring();
    // Restart on next tick.
    setTimeout(() => {
      startLoop();
    }, 0);
  }, [stopAll, resetScoring, startLoop]);

  // Compute from the current value (not a functional updater) so it works
  // whether tempo is self-managed or controlled by the parent.
  const nudgeTempo = useCallback(
    (delta: number) => {
      setTempoPct(
        Math.max(TEMPO_MIN_PCT, Math.min(TEMPO_MAX_PCT, tempoPct + delta)),
      );
    },
    [setTempoPct, tempoPct],
  );

  // Entering speed-trainer resets tempo to the trainer's slow start; the manual
  // slider value is left untouched when switching between the other modes.
  // Adjusted during render (React's "adjusting state on prop change" pattern, as
  // with activeFill above — prev value held in state, not a ref) so there's no
  // setState-in-effect cascade.
  const [tempoModeMark, setTempoModeMark] = useState(mode);
  if (tempoModeMark !== mode) {
    setTempoModeMark(mode);
    // Don't touch a controlled tempo (the parent owns it).
    if (mode === 'speed-trainer' && !tempoControlled) {
      setTempoPct(initialTempoPct());
    }
  }

  // Stop everything on mode change (skip the initial mount — nothing to stop).
  const prevModeRef = useRef(mode);
  useEffect(() => {
    if (prevModeRef.current === mode) return;
    prevModeRef.current = mode;
    stopAll();
    resetScoring();
    // Reset the speed trainer's run history when (re)entering it.
    if (mode === 'speed-trainer') recentAttemptsRef.current = [];
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

  // Per-note hit feedback for the sheet-music overlay: the most recent pass's
  // judgments keyed by fill-note id (the same ids the renderer attaches to each
  // notehead). Cleared while a fresh pass is in progress (inFillRef) so stale
  // markers don't linger, repainted when the pass is scored. Always defined (an
  // empty map) in practice so SheetMusic collects notehead positions.
  const noteFeedback = useMemo(() => {
    const map = new Map<
      string,
      {judgment: 'perfect' | 'good' | 'miss'; deltaMs: number | null}
    >();
    const attempt = scoring.lastAttempt;
    if (!attempt) return map;
    for (const j of attempt.match.judgments) {
      map.set(String(j.note.id), {judgment: j.judgment, deltaMs: j.deltaMs});
    }
    return map;
  }, [scoring.lastAttempt]);

  // Practice-mode config for SheetMusic highlighting.
  const sheetPracticeConfig = useMemo<PracticeModeConfig>(
    () => ({
      startMeasureMs: grooveStartChartMs,
      endMeasureMs: fillEndChartMs,
      startTimeMs: loopStartMs,
      endTimeMs: loopEndMs,
    }),
    [grooveStartChartMs, fillEndChartMs, loopStartMs, loopEndMs],
  );

  // The highway mirrors the sheet music's practice region: only notes within the
  // groove+fill span are drawn, so the player isn't shown (and lured into
  // playing) notes after the fill that the scorer doesn't count.
  const highwayTrack = useMemo(() => {
    const noteEventGroups = activeTrack.noteEventGroups.filter(group => {
      const ms = group[0]?.msTime ?? 0;
      return ms >= grooveStartChartMs && ms <= fillEndChartMs;
    });
    return {...activeTrack, noteEventGroups};
  }, [activeTrack, grooveStartChartMs, fillEndChartMs]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* [T] — the single practice context + transport bar (replaces the old
          title / mode switcher / MIDI-warning / transport quartet). The journey
          implies a default loop mode, so the current mode leads with a one-click
          picker; the "no kit" state is an inline chip, not a full-width band. */}
      <PracticeContextBar
        identity={{
          song: fill.song,
          artist: fill.artist,
          tempoBpm: fill.tempoBpm,
          lengthBars: fill.lengthBars,
          subdivision: fill.subdivision,
          complexity: fill.complexity,
          voicingTags: fill.voicingTags,
        }}
        onBack={() => {
          stopAll();
          onExit();
        }}
        mode={mode}
        onModeChange={onModeChange}
        sessionCtx={sessionCtx}
        isPlaying={isPlaying}
        onTogglePlay={togglePlay}
        playDisabled={!activeAudioManager}
        onRestart={restartLoop}
        onNext={
          mode === 'roulette' || onNext ? () => (onNext ?? onExit)() : undefined
        }
        nextLabel={nextLabel}
        transportExtras={transportExtras}
        tempoPct={tempoPct}
        tempoMin={TEMPO_MIN_PCT}
        tempoMax={TEMPO_MAX_PCT}
        onTempoChange={setTempoPct}
        tempoAuto={mode === 'speed-trainer' || tempoControlled}
        hasMidi={hasMidi}
        pendingHits={scoring.pendingHits}
      />

      {/* Views: highway + sheet music + HUD.
          The row fills the remaining bounded height (min-h-0 so flex children
          can shrink); the highway gets a stable, fully-visible container and
          the sheet-music pane scrolls internally (SheetMusic owns its own
          overflow-y-auto). On narrow screens the panes stack and the row
          itself scrolls so nothing is clipped. */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto lg:flex-row lg:overflow-hidden">
        <div className="flex min-h-[280px] flex-1 flex-col gap-3 lg:min-h-0 lg:flex-row">
          <div className="flex min-h-[280px] flex-1 overflow-hidden rounded-lg border lg:min-h-0">
            {activeAudioManager ? (
              <CloneHeroRenderer
                metadata={metadata}
                chart={activeChart}
                track={highwayTrack}
                audioManager={activeAudioManager}
              />
            ) : (
              <div className="flex flex-1 items-center justify-center bg-muted text-sm text-muted-foreground">
                Loading audio…
              </div>
            )}
          </div>
          <div className="flex min-h-[280px] flex-1 overflow-hidden lg:min-h-0">
            <SheetMusic
              chart={activeChart}
              track={activeTrack}
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
              getChartTimeSec={() => activeAmRef.current?.chartTime}
              noteFeedback={noteFeedback}
              measureWindowMs={{startMs: loopStartMs, endMs: loopEndMs}}
            />
          </div>
        </div>
        <div className="w-full shrink-0 lg:w-64 lg:overflow-y-auto">
          <PracticeHud
            lastAttempt={scoring.lastAttempt}
            bestAttempt={scoring.bestAttempt}
            newBest={scoring.newBest}
            srs={srs}
            dueNow={!!srs && isDue(srs, new Date())}
            tempoPct={tempoPct}
            speedTrainer={mode === 'speed-trainer'}
          />
        </div>
      </div>

      <PracticeFeedbackBanner
        lastAttempt={scoring.lastAttempt}
        statusText={`${feedbackStatus ? `${feedbackStatus} · ` : ''}${tempoPct}%`}
        callout={feedbackCallout}
      />
    </div>
  );
}
