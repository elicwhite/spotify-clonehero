'use client';

/**
 * One row of the Stems mixer (plan 0074 Phase 5): a stem name, a volume
 * slider with a live percent readout, and Mute/Solo toggles. `Solo` is
 * omitted for the metronome click row, which is solo-exempt (see
 * `StemsMixer`'s solo-bus resolution).
 */

import type {ReactNode} from 'react';
import {Sparkles} from 'lucide-react';
import {Slider} from '@/components/ui/slider';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
import {cn} from '@/lib/utils';

/** The prototype's 17px bordered M/S toggles; the active state is a solid
 *  fill (red for mute, green for solo) rather than a tint. */
const MS_BUTTON_CLASS =
  'flex h-[1.0625rem] w-[1.0625rem] shrink-0 items-center justify-center rounded border text-[9.5px] font-bold text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground disabled:pointer-events-none disabled:opacity-50';

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
  /** Glyph beside the stem name: an instrument PNG (`InstrumentIcon`) for a
   *  row that names an instrument, a metronome for the click row, a waveform
   *  otherwise (the approved prototype's `.stem-name svg`). The name column
   *  sizes and colours it through descendant selectors, so an svg and an
   *  `img` both land at 12px with no cooperation from the glyph itself. */
  icon: ReactNode;
  /** Draws the dashed rule the prototype puts above the click row, marking it
   *  as the one row that is not part of the exported chart audio. */
  topSeparator?: boolean | undefined;
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
  icon,
  topSeparator = false,
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
        // The prototype's column rhythm: a fixed name column, the slider
        // taking the remaining width, then a fixed readout and the toggles.
        'grid h-6 grid-cols-[5.125rem_minmax(0,1fr)_2rem_auto] items-center gap-1.5 rounded-md px-1 hover:bg-muted/40',
        topSeparator && 'mt-1 border-t border-dashed pt-1 h-7 rounded-none',
        (mute || dimmedBySolo) && 'opacity-60',
        dimmedBySolo &&
          'bg-[repeating-linear-gradient(135deg,transparent,transparent_3px,currentColor_3px,currentColor_4px)] text-muted-foreground/25',
      )}>
      <div className="flex min-w-0 items-center gap-1 text-muted-foreground [&_svg]:size-3 [&_svg]:shrink-0 [&_img]:size-3 [&_img]:shrink-0 [&_img]:object-contain">
        {icon}
        <span
          className={cn(
            'truncate text-[11px] text-foreground',
            // Muted rows go quiet rather than alarming: the M toggle itself
            // carries the red, matching the prototype.
            (mute || dimmedBySolo) && 'text-muted-foreground',
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
        className="flex min-w-0 items-center"
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
      </div>

      <span className="text-right text-[10px] tabular-nums text-muted-foreground">
        {volume}%
      </span>

      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label={mute ? `Unmute ${label}` : `Mute ${label}`}
          aria-pressed={mute}
          disabled={locked}
          onClick={onToggleMute}
          className={cn(
            MS_BUTTON_CLASS,
            mute && 'border-red-600 bg-red-600 text-white',
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
              MS_BUTTON_CLASS,
              solo && 'border-green-600 bg-green-600 text-white',
            )}>
            S
          </button>
        )}
      </div>
    </div>
  );
}
