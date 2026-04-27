'use client';

/**
 * Minimal positioned popover anchored to a click point on the highway. Each
 * tool popover (BPM / TimeSig / Section add / Section rename) wraps its form
 * in this primitive so the chrome (border, shadow, padding, Escape-to-close)
 * stays consistent.
 *
 * Phase 4 introduces this as a thin wrapper. Phase 9's tool plugin system is
 * expected to absorb each popover-form into a tool definition; the wrapper
 * primitive is what stays.
 */

import {useEffect, type ReactNode} from 'react';

export interface TickPopoverProps {
  /** Anchor coordinates in the interaction container's local space. */
  x: number;
  y: number;
  /** Closes the popover. Called on Escape and on Cancel. */
  onClose: () => void;
  /** Footer caption (typically "Tick: 480"). Optional. */
  caption?: string;
  children: ReactNode;
}

export default function TickPopover({
  x,
  y,
  onClose,
  caption,
  children,
}: TickPopoverProps) {
  // Escape-to-close at the document level so the popover closes even if focus
  // has moved off its inputs (e.g. user has tabbed away). The form's own
  // Escape handler still fires first; we stop double-closing by only
  // listening for the bare Escape (no modifiers).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
        onClose();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      className="absolute z-20 rounded-lg border bg-background p-2 shadow-lg"
      style={{left: x + 8, top: y - 16}}>
      {children}
      {caption !== undefined && (
        <p className="mt-1 text-[10px] text-muted-foreground">{caption}</p>
      )}
    </div>
  );
}
