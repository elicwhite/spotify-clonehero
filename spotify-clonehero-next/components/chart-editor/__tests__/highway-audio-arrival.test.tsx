/**
 * @jest-environment jsdom
 */
/**
 * What the highway does when a project's audio shows up after the editor is
 * already open — which is how `/chart-editor` loads, so the song can decode
 * behind a usable editor instead of in front of it.
 *
 * Two things have to hold, and neither is visible from the outside until
 * someone opens an album-length chart:
 *
 *   - The stage SURVIVES the swap. `usePaddedAudio` replaces its
 *     `AudioManager` when the real audio replaces the interim click track,
 *     and the stage only ever reads that manager as a clock. Rebuilding the
 *     stage for it would tear down the WebGL context and every highway on it
 *     — the editing surface visibly reloading because the clock changed.
 *   - Only the WAVEFORM highway waits for the samples. A classic highway is
 *     drawn entirely from the chart and is fully usable without audio, so
 *     covering it would be hiding a working editor.
 *
 * `@/lib/preview/highway` is mocked wholesale: a real stage needs a WebGL
 * context jsdom does not provide.
 */

import '@testing-library/jest-dom';
import {useEffect} from 'react';
import {render, screen} from '@testing-library/react';
import {createEmptyChart} from '@eliwhite/scan-chart';
import {
  ChartEditorProvider,
  useChartEditorContext,
} from '../ChartEditorContext';
import {AudioServiceProvider} from '../AudioServiceContext';
import HighwayEditor from '../HighwayEditor';
import {AudioSamples} from '../audioSamples';
import {emptyTrackData} from '@/lib/chart-edit/__tests__/test-utils';
import type {ChartDocument} from '@/lib/chart-edit';
import type {AudioManager} from '@/lib/preview/audioManager';
import type {HighwayMode} from '@/lib/preview/highway';
import {setupStage} from '@/lib/preview/highway';
import {createFakeStage as mockCreateFakeStage} from './fakeStage';

jest.mock('../../../lib/preview/highway', () => {
  const actual = jest.requireActual('../../../lib/preview/highway');
  return {
    ...actual,
    setupStage: jest.fn(() => mockCreateFakeStage()),
  };
});

const setupStageMock = setupStage as unknown as jest.Mock;

function makeDoc(): ChartDocument {
  const parsed = createEmptyChart({bpm: 120, resolution: 480});
  parsed.trackData.push(emptyTrackData('drums', 'expert'));
  return {parsedChart: parsed, assets: []};
}

const doc = makeDoc();

function Harness({
  audioManager,
  audioData,
  audioLoading,
  highwayMode,
}: {
  audioManager: AudioManager;
  audioData?: AudioSamples | undefined;
  audioLoading?: boolean | undefined;
  highwayMode: HighwayMode;
}) {
  const {dispatch} = useChartEditorContext();
  useEffect(() => {
    dispatch({type: 'SET_CHART_DOC', chartDoc: doc});
    dispatch({type: 'SET_VISIBLE_TRACKS', tracks: new Set(['drums-expert'])});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    dispatch({type: 'SET_HIGHWAY_MODE', mode: highwayMode});
  }, [highwayMode, dispatch]);
  return (
    <HighwayEditor
      chart={doc.parsedChart}
      audioManager={audioManager}
      audioData={audioData}
      audioLoading={audioLoading}
    />
  );
}

function renderHighway(props: {
  audioManager: AudioManager;
  audioData?: AudioSamples | undefined;
  audioLoading?: boolean | undefined;
  highwayMode?: HighwayMode;
}) {
  const tree = (p: typeof props) => (
    <AudioServiceProvider>
      <ChartEditorProvider>
        <Harness {...p} highwayMode={p.highwayMode ?? 'classic'} />
      </ChartEditorProvider>
    </AudioServiceProvider>
  );
  const result = render(tree(props));
  return {...result, update: (p: typeof props) => result.rerender(tree(p))};
}

beforeEach(() => {
  setupStageMock.mockClear();
});

describe('highway when audio arrives after the editor is open', () => {
  it('keeps the same stage when the AudioManager is swapped', () => {
    const clickOnly = {} as AudioManager;
    const withAudio = {} as AudioManager;
    const {update} = renderHighway({audioManager: clickOnly});
    expect(setupStageMock).toHaveBeenCalledTimes(1);

    update({audioManager: withAudio, audioData: new AudioSamples(pcm())});

    // One stage, still. A second call would mean the WebGL context and every
    // highway on it were thrown away and rebuilt.
    expect(setupStageMock).toHaveBeenCalledTimes(1);
  });

  it('reads the clock through a getter, so the stage sees the new manager', () => {
    const clickOnly = {} as AudioManager;
    const withAudio = {} as AudioManager;
    const {update} = renderHighway({audioManager: clickOnly});

    const getAudioManager = setupStageMock.mock.calls[0][3] as () => unknown;
    expect(getAudioManager()).toBe(clickOnly);

    update({audioManager: withAudio});
    expect(getAudioManager()).toBe(withAudio);
  });

  it('leaves a classic highway uncovered while the audio loads', () => {
    renderHighway({audioManager: {} as AudioManager, audioLoading: true});
    expect(screen.queryByText(/waveform/i)).not.toBeInTheDocument();
  });

  it('tells a waveform highway the audio is still coming', () => {
    renderHighway({
      audioManager: {} as AudioManager,
      audioLoading: true,
      highwayMode: 'waveform',
    });
    expect(
      screen.getByText('Loading audio for the waveform…'),
    ).toBeInTheDocument();
  });

  it('says so plainly when a waveform highway has no audio coming at all', () => {
    renderHighway({
      audioManager: {} as AudioManager,
      audioLoading: false,
      highwayMode: 'waveform',
    });
    expect(
      screen.getByText('No audio to draw a waveform from.'),
    ).toBeInTheDocument();
  });

  it('uncovers the waveform highway once the samples are here', () => {
    renderHighway({
      audioManager: {} as AudioManager,
      audioData: new AudioSamples(pcm()),
      highwayMode: 'waveform',
    });
    expect(screen.queryByText(/waveform/i)).not.toBeInTheDocument();
  });
});

function pcm(): Float32Array {
  return new Float32Array([0.1, -0.1, 0.2, -0.2]);
}
