'use client';

/**
 * The tempo lane's BPM entry field: retype the tempo of the marker that was
 * right-clicked.
 *
 * Reached only from a marker's own context menu, seeded with that marker's
 * current value, so the field always describes a tempo that already exists.
 *
 * Rendered as the contents of the tempo lane's `ContextMenuPopover` (in place
 * of its item list), like the tap tool, so it appears exactly where the
 * gesture started.
 */

import {useState} from 'react';

import {cn} from '@/lib/utils';
import {formatBpmSeed, parseBpmInput} from './bpmInput';

export interface BpmValuePopoverProps {
  /** The marker's current BPM, which the field starts at. */
  initialBpm: number;
  /** `bar.beat` at the target tick, shown so the target is legible. */
  anchorLabel: string;
  /** Called with the typed BPM, full typed precision. */
  onCommit: (bpm: number) => void;
  onCancel: () => void;
}

const BUTTON =
  'rounded border border-border px-1.5 py-0.5 text-[11px] hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent';

export default function BpmValuePopover({
  initialBpm,
  anchorLabel,
  onCommit,
  onCancel,
}: BpmValuePopoverProps) {
  const [text, setText] = useState(() => formatBpmSeed(initialBpm));
  // Errors only appear once a commit has been attempted: an intermediate
  // keystroke ('1' on the way to '140') is not a mistake to report.
  const [showError, setShowError] = useState(false);

  const parsed = parseBpmInput(text);

  const commit = () => {
    if (!parsed.ok) {
      setShowError(true);
      return;
    }
    onCommit(parsed.bpm);
  };

  return (
    <div
      data-testid="bpm-value-popover"
      className="flex w-44 flex-col gap-1.5 p-2">
      <div className="flex items-baseline justify-between">
        <span className="font-medium">Set tempo</span>
        <span className="text-muted-foreground">Bar {anchorLabel}</span>
      </div>

      <label className="flex items-center gap-1.5">
        <input
          // Escape is left to the panel's own handler, which closes the menu
          // and so cancels this field, and typed keys reach no editor hotkey
          // because the hotkey layer stands down inside text inputs.
          autoFocus
          type="text"
          inputMode="decimal"
          aria-label="BPM"
          value={text}
          onChange={event => {
            setText(event.target.value);
            setShowError(false);
          }}
          onFocus={event => event.currentTarget.select()}
          onKeyDown={event => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            commit();
          }}
          className="w-20 rounded border border-border bg-background px-1.5 py-0.5 text-[11.5px] tabular-nums focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        <span className="text-[10px] text-muted-foreground">BPM</span>
      </label>

      {showError && !parsed.ok && (
        <p role="alert" className="text-[10px] leading-snug text-red-500">
          {parsed.error}
        </p>
      )}

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
          disabled={!parsed.ok}
          onClick={commit}>
          Set
        </button>
        <button
          type="button"
          className={BUTTON}
          title="Close without changing the tempo."
          onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
