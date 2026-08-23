/**
 * @jest-environment jsdom
 */
/**
 * The waveform row's right-click menu offers on-demand stem separation
 * (plan 0123).
 *
 * This is the second of the two surfaces that start a `separate-stems` run,
 * and the one a user is most likely to reach for: they right-clicked the
 * waveform looking for a stem that is not in the source list. The menu only
 * starts the run — the Stems mixer is where its progress and Cancel live —
 * so what is asserted here is which items appear and what they ask for.
 */

import '@testing-library/jest-dom';
import {act, fireEvent, render, screen} from '@testing-library/react';
import {useEffect} from 'react';

import {AssistStore} from '@/lib/assist/assist-store';
import {retimeChart} from '@/lib/chart-edit';
import type {AudioManager} from '@/lib/preview/audioManager';
import PianoRollTimeline from '../PianoRollTimeline';
import {
  ChartEditorProvider,
  useChartEditorContext,
} from '../../ChartEditorContext';
import {makeFixtureDoc} from '../../__tests__/fixtures';
import type {StemSeparationHostProps} from '../../stemSeparation';

const PANEL_HEIGHT = 200;

beforeAll(() => {
  // jsdom ships neither ResizeObserver nor a canvas 2D context.
  (globalThis as {ResizeObserver?: unknown}).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  const ctxStub = new Proxy(
    {measureText: () => ({width: 10}), canvas: {width: 800, height: 200}},
    {
      get: (target, prop) =>
        prop in target
          ? (target as Record<string | symbol, unknown>)[prop]
          : () => {},
      set: () => true,
    },
  );
  HTMLCanvasElement.prototype.getContext = (() =>
    ctxStub) as unknown as HTMLCanvasElement['getContext'];
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      width: 800,
      height: PANEL_HEIGHT,
      top: 0,
      left: 0,
      right: 800,
      bottom: PANEL_HEIGHT,
      x: 0,
      y: 0,
      toJSON: () => {},
    }),
  });
});

function SeedDoc() {
  const {dispatch} = useChartEditorContext();
  useEffect(() => {
    const doc = makeFixtureDoc();
    retimeChart(doc.parsedChart);
    dispatch({type: 'SET_CHART_DOC', chartDoc: doc});
  }, [dispatch]);
  return null;
}

function stubAudioManager(): AudioManager {
  return {
    chartTime: 0,
    isPlaying: false,
    duration: 10,
    chartDelay: 0,
    ready: Promise.resolve(),
    trackNames: ['song'],
    getTrackPcm: () => null,
    seekToChartTime: () => {},
    playChartTime: () => {},
    pause: () => {},
    getCurrentTempo: () => 1,
  } as unknown as AudioManager;
}

function separation(
  overrides: Partial<StemSeparationHostProps> = {},
): StemSeparationHostProps {
  return {
    offer: {demucs: true, roformer: true},
    running: false,
    onSeparate: jest.fn(),
    store: new AssistStore(),
    onCancel: jest.fn(),
    onDismiss: jest.fn(),
    ...overrides,
  };
}

/** Mounts the panel and right-clicks the waveform row, which sits in the
 *  bottom band of the canvas. */
async function openWaveformMenu(
  stemSeparation?: StemSeparationHostProps,
): Promise<void> {
  const {container} = render(
    <ChartEditorProvider>
      <SeedDoc />
      <PianoRollTimeline
        audioManager={stubAudioManager()}
        durationSeconds={10}
        audioChannels={2}
        stemSeparation={stemSeparation}
      />
    </ChartEditorProvider>,
  );
  await act(async () => {
    await Promise.resolve();
  });
  const canvas = container.querySelector('canvas');
  if (!canvas) throw new Error('the panel rendered no canvas');
  fireEvent.contextMenu(canvas, {
    clientX: 400,
    clientY: PANEL_HEIGHT - 4,
  });
}

describe('the waveform row’s separation items', () => {
  it('offers both separations under the source list', async () => {
    await openWaveformMenu(separation());

    expect(screen.getByText('Song (full mix)')).toBeVisible();
    expect(screen.getByText('Separate stems: good and fast')).toBeVisible();
    expect(screen.getByText('Separate stems: great and slow')).toBeVisible();
  });

  it('starts the run the user picked, naming this surface', async () => {
    const stemSeparation = separation();
    await openWaveformMenu(stemSeparation);

    fireEvent.click(screen.getByText('Separate stems: good and fast'));

    expect(stemSeparation.onSeparate).toHaveBeenCalledWith({
      model: 'demucs',
      entrypoint: 'waveform-menu',
    });
  });

  it('leaves the source list alone on a host that cannot separate', async () => {
    await openWaveformMenu(undefined);

    expect(screen.getByText('Song (full mix)')).toBeVisible();
    expect(screen.queryByText(/^Separate stems/)).toBeNull();
  });

  it('offers only the separation that would still add a stem', async () => {
    await openWaveformMenu(
      separation({offer: {demucs: false, roformer: true}}),
    );

    expect(screen.queryByText('Separate stems: good and fast')).toBeNull();
    expect(screen.getByText('Separate stems: great and slow')).toBeVisible();
  });

  it('does not queue a second run while one is already in flight', async () => {
    const stemSeparation = separation({running: true});
    await openWaveformMenu(stemSeparation);

    fireEvent.click(screen.getByText('Separate stems: good and fast'));

    expect(stemSeparation.onSeparate).not.toHaveBeenCalled();
  });
});
