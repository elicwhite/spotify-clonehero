/**
 * @jest-environment jsdom
 */
/**
 * The A/B loop's UI-to-engine contract.
 *
 * The buttons only dispatch `SET_LOOP_REGION`; `useLoopRegionSync` — mounted
 * once by `ChartEditor` — hands the region to `AudioManager`, which does the
 * wrapping. These tests pin that one-way flow, and that the region is
 * recorded in chart time, the base the piano roll and highway draw it in.
 */

import '@testing-library/jest-dom';
import {act, fireEvent, render, screen} from '@testing-library/react';
import {TooltipProvider} from '@/components/ui/tooltip';
import LoopControls from '../LoopControls';
import {
  ChartEditorProvider,
  useChartEditorContext,
} from '../ChartEditorContext';
import {DRUM_EDIT_CAPABILITIES} from '../capabilities';
import {DEFAULT_DRUMS_EXPERT_SCOPE} from '../scope';
import {useLoopRegionSync} from '../hooks/useLoopRegionSync';
import type {AudioManager} from '@/lib/preview/audioManager';
import type {LoopRegion} from '@/lib/preview/loopRegion';

/** Records what the controls push onto the audio engine. */
function stubAudioManager(chartTimeSec: number) {
  const applied: (LoopRegion | null)[] = [];
  const am = {
    currentTime: chartTimeSec + 2,
    chartTime: chartTimeSec,
    setLoopRegion: (region: LoopRegion | null) => {
      applied.push(region);
    },
  } as unknown as AudioManager;
  return {am, applied};
}

/** Stands in for `ChartEditor`, the one component that carries the region
 *  from editor state to the engine. */
function LoopSyncHost({audioManager}: {audioManager: AudioManager}) {
  useLoopRegionSync(audioManager);
  return null;
}

/** Stands in for any other surface that writes the loop — the piano roll's
 *  draggable flags, the Mod+L clear — none of which touch the engine. */
function ExternalLoopWriter({
  onReady,
}: {
  onReady: (set: (region: LoopRegion | null) => void) => void;
}) {
  const {dispatch} = useChartEditorContext();
  onReady(region => dispatch({type: 'SET_LOOP_REGION', region}));
  return null;
}

function renderControls(
  chartTimeSec: number,
  onReady?: (set: (region: LoopRegion | null) => void) => void,
) {
  const {am, applied} = stubAudioManager(chartTimeSec);
  const {unmount} = render(
    <TooltipProvider>
      <ChartEditorProvider
        capabilities={DRUM_EDIT_CAPABILITIES}
        activeScope={DEFAULT_DRUMS_EXPERT_SCOPE}>
        <LoopSyncHost audioManager={am} />
        <LoopControls audioManager={am} />
        {onReady && <ExternalLoopWriter onReady={onReady} />}
      </ChartEditorProvider>
    </TooltipProvider>,
  );
  return {applied, unmount};
}

const clickA = () =>
  fireEvent.click(screen.getByRole('button', {name: /set loop start/i}));
const clickB = () =>
  fireEvent.click(screen.getByRole('button', {name: /set loop end/i}));
const clickClear = () =>
  fireEvent.click(screen.getByRole('button', {name: /clear loop/i}));

describe('LoopControls', () => {
  test('mounts with no loop applied to the engine', () => {
    const {applied} = renderControls(10);
    expect(applied).toEqual([null]);
  });

  test('setting A records the playhead in chart time and applies it', () => {
    const {applied} = renderControls(10);
    clickA();

    const region = applied[applied.length - 1];
    // chartTime 10s, not the audio clock's 12s.
    expect(region).toEqual({startMs: 10000, endMs: 14000});
  });

  test('setting B behind A keeps the region playable', () => {
    const {applied} = renderControls(10);
    clickA();
    clickB();

    const region = applied[applied.length - 1]!;
    expect(region.endMs).toBe(10000);
    expect(region.endMs).toBeGreaterThan(region.startMs);
  });

  test('B at the very start of the song still yields a forward region', () => {
    const {applied} = renderControls(0);
    clickB();

    const region = applied[applied.length - 1]!;
    expect(region.startMs).toBeGreaterThanOrEqual(0);
    expect(region.endMs).toBeGreaterThan(region.startMs);
  });

  test('clearing the loop clears it on the engine too', () => {
    const {applied} = renderControls(10);
    clickA();
    expect(applied[applied.length - 1]).not.toBeNull();

    clickClear();
    expect(applied[applied.length - 1]).toBeNull();
  });

  test('the clear button is disabled until a loop exists', () => {
    renderControls(10);
    expect(screen.getByRole('button', {name: /clear loop/i})).toBeDisabled();
    clickA();
    expect(screen.getByRole('button', {name: /clear loop/i})).toBeEnabled();
  });
});

describe('useLoopRegionSync', () => {
  test('a region written by another surface reaches the engine', () => {
    let setRegion: (region: LoopRegion | null) => void = () => {};
    const {applied} = renderControls(10, set => {
      setRegion = set;
    });

    act(() => setRegion({startMs: 2000, endMs: 5000}));
    expect(applied[applied.length - 1]).toEqual({startMs: 2000, endMs: 5000});

    act(() => setRegion(null));
    expect(applied[applied.length - 1]).toBeNull();
  });

  test('unmounting stops the engine wrapping for a region nothing shows', () => {
    let setRegion: (region: LoopRegion | null) => void = () => {};
    const {applied, unmount} = renderControls(10, set => {
      setRegion = set;
    });
    act(() => setRegion({startMs: 2000, endMs: 5000}));

    unmount();
    expect(applied[applied.length - 1]).toBeNull();
  });
});
