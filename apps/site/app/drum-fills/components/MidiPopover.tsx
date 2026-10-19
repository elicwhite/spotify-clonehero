'use client';

import {useEffect, useRef, useState} from 'react';
import {Button} from '@/components/ui/button';
import {cn} from '@/lib/utils';
import {useMidi} from '../contexts/MidiContext';
import MidiStatus from './MidiStatus';

/**
 * The single header MIDI/calibration control. A chip shows live connection
 * state; clicking opens the full `MidiStatus` controls in a floating panel
 * anchored to the chip. The panel is absolutely positioned so opening it never
 * grows the header or shoves the surfaces below — the problem the old
 * inline-expand chip had. Dismisses on outside-click or Escape.
 */
export default function MidiPopover() {
  const {connectedIds} = useMidi();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (containerRef.current?.contains(target)) return;
      // The calibration dialog renders in a portal at document.body, outside
      // our container. Clicks inside it must not dismiss the popover (which
      // would unmount the dialog mid-interaction).
      if (target?.closest('[role="dialog"]')) return;
      setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const connected = connectedIds.length > 0;

  return (
    <div ref={containerRef} className="relative">
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}>
        <span
          className={cn(
            'mr-2 inline-block h-2 w-2 rounded-full',
            connected ? 'bg-green-500' : 'bg-muted-foreground/50',
          )}
        />
        {connected
          ? `MIDI: ${connectedIds.length} connected`
          : 'MIDI & calibration'}
      </Button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-max max-w-[90vw]">
          <MidiStatus />
        </div>
      )}
    </div>
  );
}
