/**
 * @jest-environment jsdom
 */
/**
 * Behavior tests for the transport bar's snap-grid control.
 *
 * Contracts covered here that nothing else does:
 * 1. Every grid division the `Shift+N` hotkeys can dispatch has a matching
 *    snap option, so the trigger always names the active snap. Without this
 *    a hotkey can leave `gridDivision` with no `SelectItem` and the trigger
 *    renders blank.
 * 2. The control names itself "Snap to Grid" for assistive tech and the
 *    tooltip, since the bar is one row and carries no visible label.
 * 3. A fresh editor snaps to 1/16.
 */

import '@testing-library/jest-dom';
import {useEffect} from 'react';
import {render, screen} from '@testing-library/react';
import {TooltipProvider} from '@/components/ui/tooltip';
import SnapControl from '../SnapControl';
import {
  ChartEditorProvider,
  useChartEditorContext,
} from '../ChartEditorContext';
import {DRUM_EDIT_CAPABILITIES} from '../capabilities';
import {DEFAULT_DRUMS_EXPERT_SCOPE} from '../scope';

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as {ResizeObserver: unknown}).ResizeObserver =
  FakeResizeObserver;

/** Divisions reachable from `GRID_SHORTCUT_MAP` in
 *  `hooks/useEditorKeyboard.ts` (Shift+1..Shift+6, Shift+0). */
const HOTKEY_DIVISIONS = [4, 8, 12, 16, 32, 64, 0];

function Harness({division}: {division?: number | undefined}) {
  const {dispatch} = useChartEditorContext();
  useEffect(() => {
    if (division !== undefined) {
      dispatch({type: 'SET_GRID_DIVISION', division});
    }
  }, [dispatch, division]);
  return <SnapControl />;
}

function renderSnap(division?: number) {
  return render(
    <TooltipProvider>
      <ChartEditorProvider
        capabilities={DRUM_EDIT_CAPABILITIES}
        activeScope={DEFAULT_DRUMS_EXPERT_SCOPE}>
        <Harness division={division} />
      </ChartEditorProvider>
    </TooltipProvider>,
  );
}

describe('SnapControl', () => {
  it.each(HOTKEY_DIVISIONS)(
    'names the active snap after the hotkey sets division %i',
    division => {
      renderSnap(division);
      expect(
        screen.getByRole('combobox', {name: 'Snap to Grid'}),
      ).toHaveTextContent(/\S/);
    },
  );

  it('labels free snap as Free and a subdivision as a fraction', () => {
    const {unmount} = renderSnap(0);
    expect(screen.getByRole('combobox')).toHaveTextContent('Free');
    unmount();

    renderSnap(64);
    expect(screen.getByRole('combobox')).toHaveTextContent('1/64');
  });

  it('starts at 1/16 with no division dispatched', () => {
    renderSnap();
    expect(screen.getByRole('combobox')).toHaveTextContent('1/16');
  });
});
