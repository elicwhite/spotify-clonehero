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
import {Slider} from '@/components/ui/slider';
import {useChartEditorContext, type ToolMode} from './ChartEditorContext';
import {useUndoRedo} from './hooks/useEditCommands';
import NoteInspector from './NoteInspector';
import LoopControls from './LoopControls';
import ExportDialog from './ExportDialog';
import type {AudioManager} from '@/lib/preview/audioManager';
import type {AudioSource} from './ExportDialog';
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
  songName: string;
  dirty?: boolean;
  audioManager: AudioManager;
  artistName?: string;
  getChartText?: () => Promise<string>;
  getAudioSources?: () => Promise<AudioSource[]>;
  onNotesModified?: (noteIds: string[]) => void;
  leftPanelChildren?: ReactNode;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Left sidebar for the Moonscraper-inspired editor layout.
 *
 * Contains (from top to bottom):
 * 1. Project header (song name, dirty indicator, export)
 * 2. Settings panel (grid step, speed, highway length)
 * 3. Tool icon grid (cursor, eraser, place, BPM, timesig)
 * 4. Undo/Redo + Loop controls
 * 5. Note inspector (when notes selected)
 * 6. Page-specific panels (leftPanelChildren)
 */
export default function LeftSidebar({
  songName,
  dirty,
  audioManager,
  artistName,
  getChartText,
  getAudioSources,
  onNotesModified,
  leftPanelChildren,
}: LeftSidebarProps) {
  const {state, dispatch} = useChartEditorContext();
  const {undo, redo, canUndo, canRedo} = useUndoRedo();

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex flex-col w-[200px] shrink-0 bg-background/80 border-r overflow-y-auto overflow-x-hidden">
        {/* Project header */}
        <div className="shrink-0 px-3 py-2 border-b">
          <div className="flex items-center gap-1.5 min-w-0">
            <h2 className="text-sm font-semibold text-foreground truncate flex-1">
              {songName}
            </h2>
            {dirty && (
              <span
                className="h-2 w-2 rounded-full bg-amber-400 animate-pulse shrink-0"
                title="Unsaved changes"
              />
            )}
          </div>
          <div className="flex items-center gap-1 mt-1.5">
            <LoopControls audioManager={audioManager} className="flex-1" />
            {getChartText && (
              <ExportDialog
                songName={songName}
                artistName={artistName}
                getChartText={getChartText}
                getAudioSources={getAudioSources}
              />
            )}
          </div>
        </div>

        {/* Settings panel */}
        <div className="shrink-0 px-3 py-2 border-b space-y-3">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Settings
          </span>

          {/* Grid step */}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Step</label>
            <Select
              value={String(state.gridDivision)}
              onValueChange={value =>
                dispatch({
                  type: 'SET_GRID_DIVISION',
                  division: Number(value),
                })
              }>
              <SelectTrigger className="h-7 text-xs">
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

          {/* Speed */}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">
              Speed: {state.playbackSpeed.toFixed(2)}x
            </label>
            <Slider
              min={0}
              max={SPEED_PRESETS.length - 1}
              step={1}
              value={[SPEED_PRESETS.indexOf(state.playbackSpeed) >= 0
                ? SPEED_PRESETS.indexOf(state.playbackSpeed)
                : SPEED_PRESETS.indexOf(1.0)]}
              onValueChange={([idx]) => {
                const speed = SPEED_PRESETS[idx];
                audioManager.setTempo(speed);
                dispatch({type: 'SET_PLAYBACK_SPEED', speed});
              }}
            />
          </div>

          {/* Highway length (zoom) */}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">
              Zoom: {state.zoom.toFixed(1)}x
            </label>
            <Slider
              min={0.3}
              max={3.0}
              step={0.1}
              value={[state.zoom]}
              onValueChange={([val]) => {
                dispatch({type: 'SET_ZOOM', zoom: val});
              }}
            />
          </div>
        </div>

        {/* Tool icons grid */}
        <div className="shrink-0 px-3 py-2 border-b space-y-1.5">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Tools
          </span>
          <div className="grid grid-cols-3 gap-1">
            {TOOL_ITEMS.map(({mode, icon: Icon, label, hotkey}) => (
              <Tooltip key={mode}>
                <TooltipTrigger asChild>
                  <Button
                    variant={state.activeTool === mode ? 'secondary' : 'ghost'}
                    size="icon"
                    className={cn(
                      'h-8 w-8',
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

        {/* Undo/Redo */}
        <div className="shrink-0 px-3 py-1.5 border-b flex items-center gap-1">
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
            <TooltipContent side="right">Undo ({formatForDisplay('Mod+Z')})</TooltipContent>
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
            <TooltipContent side="right">Redo ({formatForDisplay('Mod+Shift+Z')})</TooltipContent>
          </Tooltip>
        </div>

        {/* Note inspector */}
        <div className="shrink-0 px-2 py-1">
          <NoteInspector onNotesModified={onNotesModified} />
        </div>

        {/* Page-specific panels */}
        {leftPanelChildren && (
          <div className="shrink-0 px-2 py-1 space-y-2">
            {leftPanelChildren}
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
