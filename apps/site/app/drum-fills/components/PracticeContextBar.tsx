'use client';

import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {cn} from '@/lib/utils';

export type PracticeMode =
  | 'song-context'
  | 'isolated'
  | 'speed-trainer'
  | 'roulette';

export const PRACTICE_MODE_LABELS: Record<PracticeMode, string> = {
  'song-context': 'Song loop',
  isolated: 'Isolated synth',
  'speed-trainer': 'Speed trainer',
  roulette: 'Roulette',
};

const TEMPO_PRESETS = [50, 75, 100] as const;

/** Per-fill identity + taxonomy shown in the practice context bar. */
export interface PracticeIdentity {
  song: string;
  artist: string;
  tempoBpm: number;
  lengthBars: number;
  subdivision: string;
  complexity: number;
  voicingTags: string[];
}

export interface PracticeContextBarProps {
  identity: PracticeIdentity;
  /** Back / exit affordance (label + handler). */
  onBack: () => void;
  backLabel?: string | undefined;

  // --- Mode (loop kind) ---
  mode: PracticeMode;
  onModeChange: (m: PracticeMode) => void;

  // --- Optional session context (groove "Rung n/N", etc.) ---
  sessionCtx?: React.ReactNode | undefined;

  // --- Transport ---
  isPlaying: boolean;
  onTogglePlay: () => void;
  playDisabled?: boolean | undefined;
  onRestart: () => void;
  /** When set (or roulette mode), show a Next control. */
  onNext?: (() => void) | undefined;
  nextLabel?: string | undefined;
  /** Extra transport controls (shuffle toggle / instance switcher). */
  transportExtras?: React.ReactNode | undefined;

  // --- Tempo ---
  tempoPct: number;
  tempoMin: number;
  tempoMax: number;
  onTempoChange: (pct: number) => void;
  tempoAuto: boolean;

  // --- MIDI + scoring ---
  hasMidi: boolean;
  pendingHits: number;
}

/**
 * `[T]` — the single practice context + transport bar. Collapses what used to be
 * four stacked bands (title, mode switcher, full-width MIDI warning, transport)
 * into one wrapping row so the highway + notation dominate the viewport. Purely
 * presentational and props-driven; all state lives in PracticeView / the session
 * components above it.
 *
 * The meta line here is the ONLY place per-fill BPM + taxonomy renders (the HUD
 * and header no longer repeat it).
 */
export default function PracticeContextBar({
  identity,
  onBack,
  backLabel = 'Back',
  mode,
  onModeChange,
  sessionCtx,
  isPlaying,
  onTogglePlay,
  playDisabled,
  onRestart,
  onNext,
  nextLabel,
  transportExtras,
  tempoPct,
  tempoMin,
  tempoMax,
  onTempoChange,
  tempoAuto,
  hasMidi,
  pendingHits,
}: PracticeContextBarProps) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border bg-card px-3 py-2">
      <Button variant="ghost" size="sm" className="px-2" onClick={onBack}>
        ‹ {backLabel}
      </Button>

      {/* Identity + taxonomy (single canonical copy). */}
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold leading-tight">
          {identity.song}{' '}
          <span className="font-normal text-muted-foreground">
            — {identity.artist}
          </span>
        </p>
        <p className="truncate text-xs text-muted-foreground leading-tight">
          {Math.round(identity.tempoBpm)} BPM · {identity.lengthBars} bar ·{' '}
          {identity.subdivision} · cx {identity.complexity}
          {identity.voicingTags.length > 0
            ? ` · ${identity.voicingTags.join(', ')}`
            : ''}
        </p>
      </div>

      {sessionCtx && <div className="flex items-center">{sessionCtx}</div>}

      <ModeChip mode={mode} onModeChange={onModeChange} />

      {/* Transport */}
      <div className="flex items-center gap-2">
        <Button onClick={onTogglePlay} disabled={playDisabled} size="sm">
          {isPlaying ? 'Pause (space)' : 'Play (space)'}
        </Button>
        <Button variant="outline" size="sm" onClick={onRestart}>
          Restart (R)
        </Button>
        {(mode === 'roulette' || onNext) && (
          <Button variant="outline" size="sm" onClick={onNext}>
            {nextLabel ? `Next: ${nextLabel} (N)` : 'Next (N)'}
          </Button>
        )}
        {transportExtras}
      </div>

      <TempoControl
        tempoPct={tempoPct}
        min={tempoMin}
        max={tempoMax}
        onChange={onTempoChange}
        auto={tempoAuto}
      />

      {!hasMidi && (
        <span
          className="flex items-center gap-1 rounded bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800"
          title="No MIDI device connected — connect your kit from the MIDI & calibration control in the header to score your hits.">
          ⚠ No kit
        </span>
      )}

      <span className="ml-auto whitespace-nowrap text-xs text-muted-foreground">
        Hits this pass: {pendingHits}
      </span>
    </div>
  );
}

/**
 * Mode picker as a collapsed disclosure: the active (journey-implied) loop mode
 * shows as a chip with a "Change" toggle; expanding reveals the full strip.
 */
function ModeChip({
  mode,
  onModeChange,
}: {
  mode: PracticeMode;
  onModeChange: (m: PracticeMode) => void;
}) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <div className="flex items-center gap-1.5 text-sm">
        <span className="rounded bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground">
          {PRACTICE_MODE_LABELS[mode]}
        </span>
        <button
          onClick={() => setOpen(true)}
          className="text-xs text-muted-foreground hover:text-foreground">
          Change
        </button>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-1 rounded-lg border bg-background p-1">
      {(Object.keys(PRACTICE_MODE_LABELS) as PracticeMode[]).map(m => (
        <button
          key={m}
          onClick={() => {
            onModeChange(m);
            setOpen(false);
          }}
          className={cn(
            'rounded px-2.5 py-1 text-xs font-medium transition-colors',
            m === mode
              ? 'bg-primary text-primary-foreground'
              : 'hover:bg-muted',
          )}>
          {PRACTICE_MODE_LABELS[m]}
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

/**
 * Tempo / slow-down control: slider + readout + quick presets, wired to the
 * shared tempo state. In speed-trainer mode the trainer drives the same state,
 * so the control reflects the live tempo and is marked auto.
 */
function TempoControl({
  tempoPct,
  min,
  max,
  onChange,
  auto,
}: {
  tempoPct: number;
  min: number;
  max: number;
  onChange: (pct: number) => void;
  auto: boolean;
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-xs text-muted-foreground">
        {auto ? 'Tempo (auto)' : 'Tempo'}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={5}
        value={tempoPct}
        onChange={e => onChange(Number(e.target.value))}
        className="h-1 w-24 cursor-pointer accent-primary"
        aria-label="Playback tempo"
      />
      <span className="w-10 text-center font-mono tabular-nums text-xs">
        {tempoPct}%
      </span>
      <div className="flex items-center gap-1">
        {TEMPO_PRESETS.map(p => (
          <button
            key={p}
            onClick={() => onChange(p)}
            className={cn(
              'rounded px-1.5 py-0.5 text-xs',
              tempoPct === p
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted',
            )}>
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}
