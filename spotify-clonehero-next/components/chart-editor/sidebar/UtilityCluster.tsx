'use client';

/**
 * Bottom-of-sidebar utility cluster: "SNAP · SPEED · LOOP" — a snap-grid
 * dropdown, a playback-speed stepper and the A/B loop controls, laid out as
 * the approved prototype's `.util-grid` (`loading-inline.html`).
 *
 * Speed and A/B loop always mount; the snap dropdown is gated on
 * `showEditingControls`, so capability-limited pages get only the
 * affordances they can act on.
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {useChartEditorContext} from '../ChartEditorContext';
import {usePlaybackSpeed} from '../hooks/usePlaybackSpeed';
import LoopControls from '../LoopControls';
import SectionHeading, {SIDEBAR_SECTION_CLASS} from './SectionHeading';
import type {AudioManager} from '@/lib/preview/audioManager';
import {cn} from '@/lib/utils';

/** Snap-grid options: subdivisions per whole note, wired to the
 *  `SET_GRID_DIVISION` action. "Snap" is the user-facing label for what the
 *  reducer and tests call "grid"/"gridDivision".
 *
 *  This list must be a superset of every division `GRID_SHORTCUT_MAP`
 *  (`hooks/useEditorKeyboard.ts`) can dispatch, or a Shift+N press leaves
 *  `state.gridDivision` with no matching `SelectItem` and the trigger
 *  renders blank. That is why 1/64 and Free (division 0) are here even
 *  though the prototype's mock dropdown stops at 1/32. */
const SNAP_OPTIONS: {value: string; label: string}[] = [
  {value: '0', label: 'Free'},
  {value: '4', label: '1/4'},
  {value: '8', label: '1/8'},
  {value: '12', label: '1/12'},
  {value: '16', label: '1/16'},
  {value: '24', label: '1/24'},
  {value: '32', label: '1/32'},
  {value: '64', label: '1/64'},
];

interface UtilityClusterProps {
  audioManager: AudioManager;
}

export default function UtilityCluster({audioManager}: UtilityClusterProps) {
  const {state, dispatch, capabilities} = useChartEditorContext();

  // The stepper and the transport's `[` / `]` hotkeys are two surfaces on
  // one ladder, one value and one write path.
  const {speed, setSpeed, step, canSlower, canFaster} =
    usePlaybackSpeed(audioManager);

  return (
    <div className={SIDEBAR_SECTION_CLASS}>
      <SectionHeading title="Snap · Speed · Loop" />

      {/* Equal columns (Snap | Speed | A/B loop), the prototype's
       *  `.util-grid`. Snap is capability-gated, so the track count
       *  follows the number of columns actually rendered — otherwise
       *  a gated page leaves a dead third column on the right. */}
      <div
        className={cn(
          'grid gap-x-2 gap-y-1.5',
          capabilities.showEditingControls ? 'grid-cols-3' : 'grid-cols-2',
        )}>
        {capabilities.showEditingControls && (
          <div className="space-y-1 min-w-0">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-muted-foreground">
                Snap
              </span>
            </div>
            <Select
              value={String(state.gridDivision)}
              onValueChange={value =>
                dispatch({
                  type: 'SET_GRID_DIVISION',
                  division: Number(value),
                })
              }>
              <SelectTrigger className="h-7 text-[13px] px-2" aria-label="Snap">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SNAP_OPTIONS.map(opt => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

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
