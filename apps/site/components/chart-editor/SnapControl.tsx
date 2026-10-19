'use client';

/**
 * The snap-grid dropdown, as it sits on the transport bar.
 *
 * That bar is one row and must stay that height, so the control carries no
 * visible label: a grid icon plus the current division, with the name in a
 * tooltip. The division is the thing that changes and the thing worth
 * reading at a glance, so it is what shows.
 */

import {Grid3x3} from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
import {useChartEditorContext} from './ChartEditorContext';

/**
 * Snap-grid options: subdivisions per whole note, wired to the
 * `SET_GRID_DIVISION` action. "Snap" is the user-facing label for what the
 * reducer and tests call "grid"/"gridDivision".
 *
 * This list must be a superset of every division `GRID_SHORTCUT_MAP`
 * (`hooks/useEditorKeyboard.ts`) can dispatch, or a Shift+N press leaves
 * `state.gridDivision` with no matching `SelectItem` and the trigger renders
 * blank.
 */
export const SNAP_OPTIONS: {value: string; label: string}[] = [
  {value: '0', label: 'Free'},
  {value: '4', label: '1/4'},
  {value: '8', label: '1/8'},
  {value: '12', label: '1/12'},
  {value: '16', label: '1/16'},
  {value: '24', label: '1/24'},
  {value: '32', label: '1/32'},
  {value: '64', label: '1/64'},
];

/** The label for a division, for the trigger's own text. Falls back to the
 *  raw number so a division with no option still reads as something. */
function snapLabel(division: number): string {
  return (
    SNAP_OPTIONS.find(o => o.value === String(division))?.label ??
    `1/${division}`
  );
}

export default function SnapControl() {
  const {state, dispatch} = useChartEditorContext();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Select
          value={String(state.gridDivision)}
          onValueChange={value =>
            dispatch({type: 'SET_GRID_DIVISION', division: Number(value)})
          }>
          {/* Height matches TRANSPORT_BUTTON_CLASS so the row keeps its
           *  current height; `w-auto` and no chevron gap keep it as narrow
           *  as its widest label ("Free"). */}
          <SelectTrigger
            aria-label="Snap to Grid"
            className="h-[1.625rem] w-auto gap-1 border-0 bg-transparent px-1.5 text-xs tabular-nums text-[color:var(--ed-surface-fg-muted)] hover:bg-[var(--ed-surface-hover)] hover:text-white focus:ring-0">
            <Grid3x3 className="h-3.5 w-3.5 shrink-0" />
            {snapLabel(state.gridDivision)}
          </SelectTrigger>
          <SelectContent>
            {SNAP_OPTIONS.map(opt => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TooltipTrigger>
      <TooltipContent side="top">Snap to Grid</TooltipContent>
    </Tooltip>
  );
}
