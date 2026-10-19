'use client';

/**
 * Bottom-of-sidebar utility cluster: "SPEED · LOOP" — a playback-speed
 * stepper and the A/B loop controls, laid out as the approved prototype's
 * `.util-grid` (`loading-inline.html`).
 *
 * Snap is not here. It changes what the next click does, so it lives on the
 * transport bar beside the tool-mode switch it modifies (`SnapControl.tsx`).
 *
 * Tempo and time-signature editing has no entry here: the piano roll's
 * tempo-lane right-click menu offers "Add tempo marker here" and "Insert
 * time signature change here" (`PianoRollTimeline.tsx`'s `buildTempoMenu`),
 * and its tempo lane is the only place those values are read and edited.
 * Sections work the same way, through the section strip's own right-click
 * menu (`buildSectionMenu`).
 */

import {Plus, Minus} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {usePlaybackSpeed} from '../hooks/usePlaybackSpeed';
import LoopControls from '../LoopControls';
import SectionHeading, {SIDEBAR_SECTION_CLASS} from './SectionHeading';
import type {AudioManager} from '@/lib/preview/audioManager';

interface UtilityClusterProps {
  audioManager: AudioManager;
}

export default function UtilityCluster({audioManager}: UtilityClusterProps) {
  // The stepper and the transport's `[` / `]` hotkeys are two surfaces on
  // one ladder, one value and one write path.
  const {speed, setSpeed, step, canSlower, canFaster} =
    usePlaybackSpeed(audioManager);

  return (
    <div className={SIDEBAR_SECTION_CLASS}>
      <SectionHeading title="Speed · Loop" />

      {/* Equal columns (Speed | A/B loop), the prototype's `.util-grid`. */}
      <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
        <div className="space-y-1 min-w-0">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-muted-foreground">
              Speed
            </span>
          </div>
          <div className="flex items-center h-7 border rounded-md overflow-hidden">
            <Button
              variant="ghost"
              size="icon"
              className="h-full w-6 rounded-none"
              disabled={!canSlower}
              aria-label="Slower"
              onClick={() => step(-1)}>
              <Minus className="h-3 w-3" />
            </Button>
            <span
              className="flex-1 text-center text-[12px] font-mono tabular-nums cursor-pointer"
              onClick={() => setSpeed(1.0)}
              title="Click to reset to 100%">
              {Math.round(speed * 100)}%
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-full w-6 rounded-none"
              disabled={!canFaster}
              aria-label="Faster"
              onClick={() => step(1)}>
              <Plus className="h-3 w-3" />
            </Button>
          </div>
        </div>

        <div className="space-y-1 min-w-0">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-muted-foreground">
              A/B loop
            </span>
          </div>
          <LoopControls audioManager={audioManager} className="flex-wrap" />
          {/* The segmented A/B/clear control alone doesn't say what
           *  clicking it does, so this one-line caption carries the
           *  interaction (set at the current playhead position) alongside
           *  each button's accessible name/tooltip (`LoopControls.tsx`). */}
          <p className="text-[10px] leading-tight text-muted-foreground/70">
            Sets start/end at the playhead
          </p>
        </div>
      </div>
    </div>
  );
}
