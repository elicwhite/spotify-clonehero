'use client';

/**
 * One row of the Stems mixer (plan 0074 Phase 5): a stem name, a volume
 * slider with a live percent readout, and Mute/Solo toggles. `Solo` is
 * omitted for the metronome click row, which is solo-exempt (see
 * `StemsMixer`'s solo-bus resolution).
 */

import {Sparkles} from 'lucide-react';
import {Slider} from '@/components/ui/slider';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
import {cn} from '@/lib/utils';

export interface StemMixerRowProps {
  /** The AudioManager track name this row controls — used as a stable test
   *  hook (`data-testid="stem-row-${name}"`). The shared `Slider` primitive
   *  doesn't forward an accessible name onto its Thumb (the actual
   *  `role="slider"` element), so tests select a row by this testid rather
   *  than by the slider's accessible name. */
  name: string;
  label: string;
  volume: number;
  mute: boolean;
  solo: boolean;
  /** True for the click row — no Solo button, never dimmed by another row's
   *  solo. */
  soloExempt: boolean;
  /** True when this row is silent because some OTHER row is solo'd — a
   *  visually distinct state from an explicit mute (plan 0074 approved
   *  prototype: "solo-muted rendered distinctly from explicit mute"). */
  dimmedBySolo: boolean;
  /** Badges the row as AI-separated (session-added from the stem cache or a
   *  separation run), per 5a's `AudioStemOrigin`. */
  aiSeparated: boolean;
  /** True while an assist run has this stem's track locked — controls
   *  disable but the row keeps rendering its current values. */
  locked: boolean;
  onVolumeChange: (volume: number) => void;
  onReset: () => void;
  onToggleMute: () => void;
  onToggleSolo?: (() => void) | undefined;
}

export default function StemMixerRow({
  name,
  label,
  volume,
  mute,
  solo,
  soloExempt,
  dimmedBySolo,
  aiSeparated,
  locked,
  onVolumeChange,
  onReset,
  onToggleMute,
  onToggleSolo,
}: StemMixerRowProps) {
  return (
    <div
      data-testid={`stem-row-${name}`}
      // Solo-muted is a distinct state from an explicit mute, not just a
      // dimmer one: it carries a hatched fill and an explanatory title,
      // where mute turns the label red.
      title={
        dimmedBySolo
          ? "Silent because another stem is solo'd, not muted itself"
          : undefined
      }
      className={cn(
        'grid grid-cols-[minmax(0,1fr)_7rem_auto] items-center gap-2 rounded-md px-1 py-0.5',
        (mute || dimmedBySolo) && 'opacity-60',
        dimmedBySolo &&
          'bg-[repeating-linear-gradient(135deg,transparent,transparent_3px,currentColor_3px,currentColor_4px)] text-muted-foreground/25',
      )}>
      <div className="flex min-w-0 items-center gap-1">
        <span
          className={cn(
            'truncate text-xs text-foreground',
            mute && 'text-red-500 dark:text-red-400',
          )}>
          {label}
        </span>
        {aiSeparated && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex shrink-0 text-primary">
                <Sparkles
                  aria-label="AI-separated stem"
                  className="h-2.5 w-2.5"
                />
              </span>
            </TooltipTrigger>
            <TooltipContent side="right">
              Separated from the full mix by AI
            </TooltipContent>
          </Tooltip>
        )}
      </div>

      <div
        className="flex items-center gap-1.5"
        onDoubleClick={locked ? undefined : onReset}>
        <Slider
          aria-label={`${label} volume`}
          value={[volume]}
          min={0}
          max={100}
          step={1}
          disabled={locked}
          onValueChange={v => onVolumeChange(v[0])}
          className="flex-1"
        />
        <span className="w-7 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">
          {volume}%
        </span>
      </div>

      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label={mute ? `Unmute ${label}` : `Mute ${label}`}
          aria-pressed={mute}
          disabled={locked}
          onClick={onToggleMute}
          className={cn(
            'flex h-5 w-5 items-center justify-center rounded text-[10px] font-bold text-muted-foreground hover:bg-muted disabled:pointer-events-none disabled:opacity-50',
            mute &&
              'bg-red-100 text-red-600 dark:bg-red-950/40 dark:text-red-400',
          )}>
          M
        </button>
        {!soloExempt && onToggleSolo && (
          <button
            type="button"
            aria-label={solo ? `Unsolo ${label}` : `Solo ${label}`}
            aria-pressed={solo}
            disabled={locked}
            onClick={onToggleSolo}
            className={cn(
              'flex h-5 w-5 items-center justify-center rounded text-[10px] font-bold text-muted-foreground hover:bg-muted disabled:pointer-events-none disabled:opacity-50',
              solo &&
                'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400',
            )}>
            S
          </button>
        )}
      </div>
    </div>
  );
}
