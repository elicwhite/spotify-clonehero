'use client';

import {
  MousePointer2,
  Plus,
  Eraser,
  Activity,
  Timer,
  Grid3X3,
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
import {formatForDisplay} from '@tanstack/react-hotkeys';
import {useChartEditorContext, type ToolMode} from './ChartEditorContext';
import {useUndoRedo} from './hooks/useEditCommands';
import {cn} from '@/lib/utils';

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
];

const GRID_OPTIONS: {value: string; label: string; shortcut: string}[] = [
  {value: '4', label: '1/4', shortcut: 'Shift+1'},
  {value: '8', label: '1/8', shortcut: 'Shift+2'},
  {value: '12', label: '1/12', shortcut: 'Shift+3'},
  {value: '16', label: '1/16', shortcut: 'Shift+4'},
  {value: '32', label: '1/32', shortcut: 'Shift+5'},
  {value: '64', label: '1/64', shortcut: 'Shift+6'},
  {value: '0', label: 'Free', shortcut: 'Shift+0'},
];

interface EditToolbarProps {
  className?: string;
}

/**
 * Toolbar for selecting the active editing tool, grid snap division,
 * and undo/redo controls.
 */
export default function EditToolbar({className}: EditToolbarProps) {
  const {state, dispatch, capabilities} = useChartEditorContext();
  const {undo, redo, canUndo, canRedo} = useUndoRedo();

  // Hide place / erase / bpm / timesig when the page disables note placement.
  const visibleToolItems = capabilities.showNotePlacementTools
    ? TOOL_ITEMS
    : TOOL_ITEMS.filter(t => t.mode === 'cursor');

  return (
    <TooltipProvider delayDuration={300}>
      <div
        className={cn(
          'flex items-center gap-1 rounded-lg border bg-background px-2 py-1',
          className,
        )}>
        {/* Undo/Redo buttons */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              disabled={!canUndo}
              onClick={undo}>
              <Undo2 className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Undo ({formatForDisplay('Mod+Z')})</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              disabled={!canRedo}
              onClick={redo}>
              <Redo2 className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            Redo ({formatForDisplay('Mod+Shift+Z')})
          </TooltipContent>
        </Tooltip>

        {/* Separator */}
        <div className="mx-1 h-6 w-px bg-border" />

        {/* Tool mode buttons */}
        {visibleToolItems.map(({mode, icon: Icon, label, hotkey}) => (
          <Tooltip key={mode}>
            <TooltipTrigger asChild>
              <Button
                variant={state.activeTool === mode ? 'secondary' : 'ghost'}
                size="icon"
                className={cn(
                  'h-8 w-8',
                  state.activeTool === mode && 'ring-1 ring-primary',
                )}
                onClick={() => dispatch({type: 'SET_ACTIVE_TOOL', tool: mode})}>
                <Icon className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {label} ({formatForDisplay(hotkey)})
            </TooltipContent>
          </Tooltip>
        ))}

        {/* Separator */}
        <div className="mx-1 h-6 w-px bg-border" />

        {/* Grid snap selector */}
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-1">
              <Grid3X3 className="h-4 w-4 text-muted-foreground" />
              <Select
                value={String(state.gridDivision)}
                onValueChange={value =>
                  dispatch({
                    type: 'SET_GRID_DIVISION',
                    division: Number(value),
                  })
                }>
                <SelectTrigger className="h-8 w-[70px] text-xs">
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
          </TooltipTrigger>
          <TooltipContent>Grid Snap</TooltipContent>
        </Tooltip>

        {/* Dirty indicator */}
        {state.dirty && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="ml-2 flex items-center gap-1 text-xs text-muted-foreground">
                <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
                Unsaved
              </span>
            </TooltipTrigger>
            <TooltipContent>
              Unsaved changes. Press {formatForDisplay('Mod+S')} to save.
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </TooltipProvider>
  );
}
