'use client';

import {type ReactNode} from 'react';
import {formatForDisplay} from '@tanstack/react-hotkeys';
import {
  MousePointer2,
  Plus,
  Eraser,
  Activity,
  Timer,
  Bookmark,
  Undo2,
  Redo2,
  Minus,
  AudioWaveform,
} from 'lucide-react';
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
import {useChartEditorContext, type ToolMode} from './ChartEditorContext';
import {useUndoRedo} from './hooks/useEditCommands';
import NoteInspector from './NoteInspector';
import LoopControls from './LoopControls';
import type {AudioManager} from '@/lib/preview/audioManager';
import {cn} from '@/lib/utils';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TOOL_ITEMS: {
  mode: ToolMode;
  icon: React.ElementType;
  label: string;
  hotkey: string;
}[] = [
  {mode: 'cursor', icon: MousePointer2, label: 'Cursor', hotkey: 'Mod+1'},
  {mode: 'place', icon: Plus, label: 'Place Note', hotkey: 'Mod+2'},
  {mode: 'erase', icon: Eraser, label: 'Eraser', hotkey: 'Mod+3'},
  {mode: 'bpm', icon: Activity, label: 'BPM', hotkey: 'Mod+4'},
  {mode: 'timesig', icon: Timer, label: 'Time Sig', hotkey: 'Mod+5'},
  {mode: 'section', icon: Bookmark, label: 'Section', hotkey: 'Mod+6'},
];

const GRID_OPTIONS: {value: string; label: string}[] = [
  {value: '4', label: '1/4'},
  {value: '8', label: '1/8'},
  {value: '12', label: '1/12'},
  {value: '16', label: '1/16'},
  {value: '32', label: '1/32'},
  {value: '64', label: '1/64'},
  {value: '0', label: 'Free'},
];

/** Available speed presets matching TransportControls. */
const SPEED_PRESETS = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface LeftSidebarProps {
  audioManager: AudioManager;
  onNotesModified?: (noteIds: string[]) => void;
  leftPanelChildren?: ReactNode;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function LeftSidebar({
  audioManager,
  onNotesModified,
  leftPanelChildren,
}: LeftSidebarProps) {
  const {state, dispatch, capabilities} = useChartEditorContext();
  const {undo, redo, canUndo, canRedo} = useUndoRedo();

  const speedIdx = SPEED_PRESETS.indexOf(state.playbackSpeed);
  const canSlower = speedIdx > 0;
  const canFaster = speedIdx < SPEED_PRESETS.length - 1;

  // Vocal-part picker. Only renders when:
  //   - the active scope is vocals (else there's nothing to pick)
  //   - the chart actually has more than one part (single-part charts hide it)
  // Part names follow scan-chart's NormalizedVocalTrack.parts shape.
  const vocalParts =
    state.activeScope.kind === 'vocals'
      ? Object.keys(state.chartDoc?.parsedChart.vocalTracks?.parts ?? {})
      : [];
  const showVocalPartPicker =
    state.activeScope.kind === 'vocals' && vocalParts.length > 1;

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex flex-col w-64 shrink-0 border-r bg-background overflow-y-auto overflow-x-hidden">
        {/* Scrollable sidebar body */}
        <div className="space-y-4 overflow-y-auto flex-1 p-4">
          {/* Loop controls */}
          <LoopControls audioManager={audioManager} />
          {/* Grid step */}
          <div className="space-y-2 pt-4 border-t">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Grid</span>
              <Select
                value={String(state.gridDivision)}
                onValueChange={value =>
                  dispatch({
                    type: 'SET_GRID_DIVISION',
                    division: Number(value),
                  })
                }>
                <SelectTrigger className="h-8 w-[5.5rem] text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GRID_OPTIONS.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Speed */}
          <div className="space-y-2 pt-4 border-t">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Speed</span>
              <div className="flex items-center space-x-2">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-6 w-6"
                  disabled={!canSlower}
                  onClick={() => {
                    if (!canSlower) return;
                    const speed = SPEED_PRESETS[speedIdx - 1];
                    audioManager.setTempo(speed);
                    dispatch({type: 'SET_PLAYBACK_SPEED', speed});
                  }}>
                  <Minus className="h-3 w-3" />
                </Button>
                <span
                  className="text-sm font-mono bg-muted px-2 py-1 rounded min-w-[3rem] text-center cursor-pointer hover:bg-muted/80 transition-colors"
                  onClick={() => {
                    audioManager.setTempo(1.0);
                    dispatch({type: 'SET_PLAYBACK_SPEED', speed: 1.0});
                  }}
                  title="Click to reset to 1.00x">
                  {state.playbackSpeed.toFixed(2)}x
                </span>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-6 w-6"
                  disabled={!canFaster}
                  onClick={() => {
                    if (!canFaster) return;
                    const speed = SPEED_PRESETS[speedIdx + 1];
                    audioManager.setTempo(speed);
                    dispatch({type: 'SET_PLAYBACK_SPEED', speed});
                  }}>
                  <Plus className="h-3 w-3" />
                </Button>
              </div>
            </div>
          </div>

          {/* Zoom */}
          <div className="space-y-2 pt-4 border-t">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Zoom</span>
              <div className="flex items-center space-x-2">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-6 w-6"
                  disabled={state.zoom <= 0.3}
                  onClick={() =>
                    dispatch({
                      type: 'SET_ZOOM',
                      zoom: Math.max(0.3, +(state.zoom - 0.1).toFixed(1)),
                    })
                  }>
                  <Minus className="h-3 w-3" />
                </Button>
                <span
                  className="text-sm font-mono bg-muted px-2 py-1 rounded min-w-[3rem] text-center cursor-pointer hover:bg-muted/80 transition-colors"
                  onClick={() => dispatch({type: 'SET_ZOOM', zoom: 1.0})}
                  title="Click to reset to 100%">
                  {Math.round(state.zoom * 100)}%
                </span>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-6 w-6"
                  disabled={state.zoom >= 3.0}
                  onClick={() =>
                    dispatch({
                      type: 'SET_ZOOM',
                      zoom: Math.min(3.0, +(state.zoom + 0.1).toFixed(1)),
                    })
                  }>
                  <Plus className="h-3 w-3" />
                </Button>
              </div>
            </div>
          </div>

          {/* Vocal part picker — only for multi-part vocal charts. Switching
              parts clears any active marker selection (selection is
              part-scoped via the EntityRef id format), and the editor
              re-derives which lyrics/phrases are visible from the new
              part. */}
          {showVocalPartPicker && (
            <div className="space-y-2 pt-4 border-t">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Vocal Part</span>
                <Select
                  value={
                    state.activeScope.kind === 'vocals'
                      ? state.activeScope.part
                      : 'vocals'
                  }
                  onValueChange={value => {
                    dispatch({
                      type: 'SET_ACTIVE_SCOPE',
                      scope: {kind: 'vocals', part: value},
                    });
                    // Clear any cross-part selections that wouldn't survive
                    // the part switch — selection ids carry the part.
                    for (const k of [
                      'lyric',
                      'phrase-start',
                      'phrase-end',
                    ] as const) {
                      dispatch({
                        type: 'SET_SELECTION',
                        kind: k,
                        ids: new Set(),
                      });
                    }
                  }}>
                  <SelectTrigger className="h-8 w-[7rem] text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {vocalParts.map(part => (
                      <SelectItem key={part} value={part}>
                        {part}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {/* Highway mode toggle — hidden on pages that pin the mode (add-lyrics) */}
          {capabilities.showHighwayModeToggle && (
            <div className="space-y-2 pt-4 border-t">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Highway</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant={
                        state.highwayMode === 'waveform'
                          ? 'secondary'
                          : 'outline'
                      }
                      size="sm"
                      className="h-7 gap-1.5 text-xs"
                      onClick={() =>
                        dispatch({
                          type: 'SET_HIGHWAY_MODE',
                          mode:
                            state.highwayMode === 'waveform'
                              ? 'classic'
                              : 'waveform',
                        })
                      }>
                      <AudioWaveform className="h-3.5 w-3.5" />
                      {state.highwayMode === 'waveform'
                        ? 'Waveform'
                        : 'Classic'}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    Toggle waveform highway surface
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>
          )}

          {/* Tool palette + Note inspector. Hidden on pages that don't expose
           *  multiple tools (add-lyrics). Undo/Redo still surface below. */}
          {capabilities.showToolPalette && (
            <div className="space-y-2 pt-4 border-t">
              <span className="text-sm font-medium">Tools</span>
              <div className="grid grid-cols-3 gap-1.5">
                {TOOL_ITEMS.map(({mode, icon: Icon, label, hotkey}) => (
                  <Tooltip key={mode}>
                    <TooltipTrigger asChild>
                      <Button
                        variant={
                          state.activeTool === mode ? 'secondary' : 'ghost'
                        }
                        size="icon"
                        className={cn(
                          'h-9 w-full',
                          state.activeTool === mode && 'ring-1 ring-primary',
                        )}
                        onClick={() =>
                          dispatch({type: 'SET_ACTIVE_TOOL', tool: mode})
                        }>
                        <Icon className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="right">
                      {label} ({formatForDisplay(hotkey)})
                    </TooltipContent>
                  </Tooltip>
                ))}
              </div>
            </div>
          )}

          {/* Undo/Redo (always visible). */}
          <div className="space-y-2 pt-4 border-t">
            <span className="text-sm font-medium">History</span>
            <div className="flex items-center gap-1.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    disabled={!canUndo}
                    onClick={undo}>
                    <Undo2 className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">
                  Undo ({formatForDisplay('Mod+Z')})
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    disabled={!canRedo}
                    onClick={redo}>
                    <Redo2 className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">
                  Redo ({formatForDisplay('Mod+Shift+Z')})
                </TooltipContent>
              </Tooltip>
            </div>
          </div>

          {/* Note inspector — only useful when notes are selectable. */}
          {capabilities.selectable.has('note') && (
            <NoteInspector onNotesModified={onNotesModified} />
          )}

          {/* Page-specific panels */}
          {leftPanelChildren}
        </div>
      </div>
    </TooltipProvider>
  );
}
