'use client';

/**
 * Bottom-of-sidebar utility cluster (plan 0074 Phase 7): "SNAP · SPEED ·
 * LOOP" — a snap-grid dropdown, a playback-speed stepper, the A/B loop
 * controls, and a compact tool row (cursor + add-note, undo/redo), matching
 * the approved prototype (`loading-inline.html`'s `.util-grid`/`.tools-row`).
 *
 * This replaces the sidebar's old separately-headed Grid/Speed/Zoom/Tools/
 * History blocks. It always mounts — Speed and A/B loop were never gated by
 * `EditorCapabilities` before this change either — but the snap dropdown and
 * the tool row stay conditional on the same flags their predecessors used
 * (`showEditingControls`, `showToolPalette`), so capability-gated pages keep
 * exactly the affordances they had.
 *
 * erase/section tools do NOT move here. Tempo and time-signature editing has
 * no tool row entry at all: the piano roll's tempo-lane right-click menu
 * offers "Add tempo marker here" and "Insert time signature change here"
 * (`PianoRollTimeline.tsx`'s `buildTempoMenu`), and its tempo lane is the
 * only place those values are read and edited. Erase is dropped because
 * Delete/Backspace and the
 * note context menu's "Delete note" already remove selected notes. Section
 * is dropped the same way (plan 0076 item 19): the section strip (the
 * piano roll's ruler) now has its own right-click menu — "Add section
 * here" on empty space, "Rename section…"/"Delete section" on an existing
 * flag (`PianoRollTimeline.tsx`'s `buildSectionMenu`, the same
 * hit-vs-empty split `buildTempoMenu` uses) — so the tool button's only
 * affordance (starting a new section) has a real replacement.
 */

import {formatForDisplay} from '@tanstack/react-hotkeys';
import {MousePointer2, Plus, Minus, Undo2, Redo2} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {useChartEditorContext} from '../ChartEditorContext';
import {useUndoRedo} from '../hooks/useEditCommands';
import {usePlaybackSpeed} from '../hooks/usePlaybackSpeed';
import LoopControls from '../LoopControls';
import SectionHeading, {SIDEBAR_SECTION_CLASS} from './SectionHeading';
import type {ToolMode} from '@/lib/chart-editor-core';
import type {AudioManager} from '@/lib/preview/audioManager';
import {cn} from '@/lib/utils';

/** Snap-grid options: subdivisions per whole note, wired to the existing
 *  `SET_GRID_DIVISION` action (unchanged since plan 0037). "Snap" is the
 *  approved prototype's label for what the reducer/tests still call
 *  "grid"/"gridDivision" — only the user-facing copy changes here.
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
  const {undo, redo, canUndo, canRedo} = useUndoRedo();

  // The stepper and the transport's `[` / `]` hotkeys are two surfaces on
  // one ladder, one value and one write path.
  const {speed, setSpeed, step, canSlower, canFaster} =
    usePlaybackSpeed(audioManager);

  const showTools = capabilities.showToolPalette;

  return (
    <TooltipProvider delayDuration={300}>
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
                <span className="text-[10px] font-semibold text-muted-foreground">
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
                <SelectTrigger className="h-7 text-xs px-2" aria-label="Snap">
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
              <span className="text-[10px] font-semibold text-muted-foreground">
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
                className="flex-1 text-center text-[11px] font-mono tabular-nums cursor-pointer"
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
              <span className="text-[10px] font-semibold text-muted-foreground">
                A/B loop
              </span>
            </div>
            <LoopControls audioManager={audioManager} className="flex-wrap" />
            {/* Item 21: the segmented A/B/clear control alone doesn't say
             *  what clicking it does — this one-line caption plus each
             *  button's accessible name/tooltip (`LoopControls.tsx`) is
             *  the discoverability fix; the interaction (set at the
             *  current playhead position) is unchanged. */}
            <p className="text-[9px] leading-tight text-muted-foreground/70">
              Sets start/end at the playhead
            </p>
          </div>
        </div>

        {showTools && (
          <div className="flex items-center gap-1 pt-2 mt-1 border-t border-dashed">
            <ToolButton
              mode="cursor"
              icon={MousePointer2}
              label="Cursor"
              hotkey="Mod+1"
            />
            <ToolButton
              mode="place"
              icon={Plus}
              label="Place Note"
              hotkey="Mod+2"
            />
            <span className="w-px h-4 bg-border mx-0.5" />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  disabled={!canUndo}
                  onClick={undo}>
                  <Undo2 className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">
                Undo ({formatForDisplay('Mod+Z')})
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  disabled={!canRedo}
                  onClick={redo}>
                  <Redo2 className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">
                Redo ({formatForDisplay('Mod+Shift+Z')})
              </TooltipContent>
            </Tooltip>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}

function ToolButton({
  mode,
  icon: Icon,
  label,
  hotkey,
}: {
  mode: ToolMode;
  icon: React.ElementType;
  label: string;
  hotkey: string;
}) {
  const {state, dispatch} = useChartEditorContext();
  const active = state.activeTool === mode;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={active ? 'secondary' : 'ghost'}
          size="icon"
          aria-label={label}
          className={cn('h-7 w-7', active && 'ring-1 ring-primary')}
          onClick={() => dispatch({type: 'SET_ACTIVE_TOOL', tool: mode})}>
          <Icon className="h-3.5 w-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">
        {label} ({formatForDisplay(hotkey)})
      </TooltipContent>
    </Tooltip>
  );
}
