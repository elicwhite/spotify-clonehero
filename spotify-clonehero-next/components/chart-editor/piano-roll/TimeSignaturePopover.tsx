'use client';

/**
 * The tempo lane's time-signature entry field: retype the meter of the
 * signature chip that was right-clicked.
 *
 * Reached only from a chip's own context menu, seeded with that signature's
 * current meter, so the fields always describe a signature that already
 * exists.
 *
 * Rendered as the contents of the tempo lane's `ContextMenuPopover` (in place
 * of its item list), like the tap tool and the BPM field, so it appears
 * exactly where the gesture started.
 */

import {useState} from 'react';

import {cn} from '@/lib/utils';
import {parseMeterInput} from './timeSignatureInput';

export interface TimeSignaturePopoverProps {
  /** The signature's current meter, which the fields start at. */
  initialNumerator: number;
  initialDenominator: number;
  /** `bar.beat` at the signature's tick, shown so the target is legible. */
  anchorLabel: string;
  /** Called with the typed meter. */
  onCommit: (numerator: number, denominator: number) => void;
  onCancel: () => void;
}

const BUTTON =
  'rounded border border-border px-1.5 py-0.5 text-[11px] hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent';

const FIELD =
  'w-12 rounded border border-border bg-background px-1.5 py-0.5 text-[11.5px] tabular-nums focus:outline-none focus-visible:ring-1 focus-visible:ring-ring';

export default function TimeSignaturePopover({
  initialNumerator,
  initialDenominator,
  anchorLabel,
  onCommit,
  onCancel,
}: TimeSignaturePopoverProps) {
  const [numeratorText, setNumeratorText] = useState(() =>
    String(initialNumerator),
  );
  const [denominatorText, setDenominatorText] = useState(() =>
    String(initialDenominator),
  );
  // Errors only appear once a commit has been attempted: an intermediate
  // keystroke ('1' on the way to '12') is not a mistake to report.
  const [showError, setShowError] = useState(false);

  const parsed = parseMeterInput(numeratorText, denominatorText);

  const commit = () => {
    if (!parsed.ok) {
      setShowError(true);
      return;
    }
    onCommit(parsed.numerator, parsed.denominator);
  };

  // Escape is left to the panel's own handler, which closes the menu and so
  // cancels these fields, and typed keys reach no editor hotkey because the
  // hotkey layer stands down inside text inputs.
  const onFieldKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    commit();
  };

  return (
    <div
      data-testid="time-signature-popover"
      className="flex w-48 flex-col gap-1.5 p-2">
      <div className="flex items-baseline justify-between">
        <span className="font-medium">Time signature</span>
        <span className="text-muted-foreground">Bar {anchorLabel}</span>
      </div>

      <div className="flex items-center gap-1.5">
        <input
          autoFocus
          type="text"
          inputMode="numeric"
          aria-label="Beats per bar"
          value={numeratorText}
          onChange={event => {
            setNumeratorText(event.target.value);
            setShowError(false);
          }}
          onFocus={event => event.currentTarget.select()}
          onKeyDown={onFieldKeyDown}
          className={FIELD}
        />
        <span aria-hidden className="text-muted-foreground">
          /
        </span>
        <input
          type="text"
          inputMode="numeric"
          aria-label="Beat unit"
          value={denominatorText}
          onChange={event => {
            setDenominatorText(event.target.value);
            setShowError(false);
          }}
          onFocus={event => event.currentTarget.select()}
          onKeyDown={onFieldKeyDown}
          className={FIELD}
        />
      </div>

      {showError && !parsed.ok && (
        <p role="alert" className="text-[10px] leading-snug text-red-500">
          {parsed.error}
        </p>
      )}

      <p className="text-[10px] leading-snug text-muted-foreground">
        Sets the meter from bar {anchorLabel} onward. Later bar lines count from
        here; notes keep their positions. Undo restores everything.
      </p>

      <div className="flex items-center gap-1">
        <button
          type="button"
          className={cn(BUTTON, 'flex-1')}
          disabled={!parsed.ok}
          onClick={commit}>
          Set
        </button>
        <button
          type="button"
          className={BUTTON}
          title="Close without changing the time signature."
          onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
