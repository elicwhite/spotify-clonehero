/**
 * @jest-environment jsdom
 */
/**
 * Behavior tests for the sidebar's "Speed · Loop" utility cluster.
 *
 * Snap is not here — it lives on the transport bar (`snap-control.test.tsx`).
 *
 * Contracts covered here that nothing else does:
 * 1. The speed stepper reads and writes the same `playbackSpeed` the
 *    `[` / `]` transport hotkeys use, so the two surfaces can't disagree
 *    (plan 0074 Phase 7).
 * 2. The cluster holds no tool actions at all — cursor/place-note and
 *    undo/redo live on the transport bar, and the section tool's replacement
 *    is the piano roll's section-strip context menu.
 * 3. The Snap/Speed keyboard-hint pills are gone (plan 0076 item 20).
 * 4. The A/B loop buttons carry an accessible name stating the interaction
 *    (plan 0076 item 21).
 */

import '@testing-library/jest-dom';
import {useEffect} from 'react';
import {fireEvent, render, screen} from '@testing-library/react';
import {TooltipProvider} from '@/components/ui/tooltip';
import UtilityCluster from '../sidebar/UtilityCluster';
import {
  ChartEditorProvider,
  useChartEditorContext,
} from '../ChartEditorContext';
import {DRUM_EDIT_CAPABILITIES} from '../capabilities';
import {DEFAULT_DRUMS_EXPERT_SCOPE} from '../scope';
import type {AudioManager} from '@/lib/preview/audioManager';
import {fakeAudioManager} from './fakeAudioManager';

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as {ResizeObserver: unknown}).ResizeObserver =
  FakeResizeObserver;

function stubAudioManager(setTempo: (t: number) => void = () => {}) {
  return fakeAudioManager({setTempo});
}

/** Mounts the cluster and applies `division` / `speed` to editor state. */
function Harness({
  division,
  speed,
  audioManager,
}: {
  division?: number | undefined;
  speed?: number | undefined;
  audioManager: AudioManager;
}) {
  const {dispatch} = useChartEditorContext();
  useEffect(() => {
    if (division !== undefined) {
      dispatch({type: 'SET_GRID_DIVISION', division});
    }
    if (speed !== undefined) {
      dispatch({type: 'SET_PLAYBACK_SPEED', speed});
    }
  }, [dispatch, division, speed]);
  return <UtilityCluster audioManager={audioManager} />;
}

function renderCluster(opts: {
  division?: number;
  speed?: number;
  audioManager?: AudioManager;
}) {
  return render(
    <TooltipProvider>
      <ChartEditorProvider
        capabilities={DRUM_EDIT_CAPABILITIES}
        activeScope={DEFAULT_DRUMS_EXPERT_SCOPE}>
        <Harness
          division={opts.division}
          speed={opts.speed}
          audioManager={opts.audioManager ?? stubAudioManager()}
        />
      </ChartEditorProvider>
    </TooltipProvider>,
  );
}

describe('UtilityCluster tool actions live on the transport', () => {
  it('renders no section tool button (its replacement is the section-strip context menu)', () => {
    renderCluster({});
    expect(
      screen.queryByRole('button', {name: /section/i}),
    ).not.toBeInTheDocument();
  });

  it('renders no cursor, place-note or undo/redo buttons', () => {
    renderCluster({});
    for (const name of [/cursor/i, /place note/i, /^undo$/i, /^redo$/i]) {
      expect(screen.queryByRole('button', {name})).not.toBeInTheDocument();
    }
  });
});

describe('UtilityCluster keyboard-hint pills removal (plan 0076 item 20)', () => {
  it('renders no Snap/Speed/Loop keyboard-hint pills', () => {
    renderCluster({});
    expect(screen.queryByText('⇧1-6')).not.toBeInTheDocument();
    expect(screen.queryByText('[ ]')).not.toBeInTheDocument();
  });
});

describe('UtilityCluster A/B loop discoverability (plan 0076 item 21)', () => {
  it('names the loop-start and loop-end interaction on the A/B buttons', () => {
    renderCluster({});
    expect(
      screen.getByRole('button', {name: 'Set loop start at playhead'}),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', {name: 'Set loop end at playhead'}),
    ).toBeInTheDocument();
  });
});

describe('UtilityCluster speed stepper', () => {
  it('shows the speed the rest of the editor is playing at', () => {
    renderCluster({speed: 1.5});
    expect(screen.getByText('150%')).toBeInTheDocument();
  });

  it('steps down to the next preset and retempos the audio', () => {
    const setTempo = jest.fn();
    renderCluster({speed: 1.0, audioManager: stubAudioManager(setTempo)});

    fireEvent.click(screen.getByRole('button', {name: /slower/i}));

    expect(setTempo).toHaveBeenCalledWith(0.75);
    expect(screen.getByText('75%')).toBeInTheDocument();
  });

  it('stops at the slowest and fastest presets', () => {
    const {unmount} = renderCluster({speed: 0.25});
    expect(screen.getByRole('button', {name: /slower/i})).toBeDisabled();
    unmount();

    renderCluster({speed: 2.0});
    expect(screen.getByRole('button', {name: /faster/i})).toBeDisabled();
  });
});
