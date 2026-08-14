/**
 * @jest-environment jsdom
 */
/**
 * EditorApp <-> assist engine inline wiring (plan 0074 Phase 1, suite 2).
 *
 * Mounts the real `EditorApp` inside a real `ChartEditorProvider`
 * (`EditorSession`, `useExecuteCommand`, `ReplaceDrumTrackCommand` all run
 * for real). Only the highway/audio boundary is stubbed
 * (`ChartEditor` -> a note-count + `leftPanelChildren` + real `ChartAssist`
 * shim, so the run is driven through the card the user actually clicks,
 * `usePaddedAudio` -> a static fake `AudioManager`) and the OPFS/GPU
 * boundary is faked (`storage/opfs`, `audio-pipeline/separate-stems`,
 * `ml/transcriber`, `ml/roformer-separation`) — `lib/chart-edit`'s real
 * `readChart`/`writeChartFolder` build and re-parse actual chart bytes, and
 * the run's own snap stage runs for real, so the note-count assertion
 * reflects a genuine parse and a genuine transcription result, not a mock.
 */

import '@testing-library/jest-dom';
import {act} from 'react';

// jsdom has no ResizeObserver; Radix's Slider (rendered by the Stems
// mixer) needs one.
class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as {ResizeObserver: unknown}).ResizeObserver =
  FakeResizeObserver;

// The run waits for the page's ONNX Runtime <Script> to land
// (`waitForOrtRuntime`). Stand in for it: the runtime itself is never used
// here, since separation and transcription are mocked.
(globalThis as unknown as {ort: unknown}).ort = {};

import {render, screen, waitFor, fireEvent} from '@testing-library/react';
import {noteTypes} from '@eliwhite/scan-chart';
import {ChartEditorProvider} from '../ChartEditorContext';
import {AudioServiceProvider} from '../AudioServiceContext';
import {DEFAULT_DRUMS_EXPERT_SCOPE} from '../scope';
import {addDrumNote, writeChartFolder} from '@/lib/chart-edit';
import type {ChartDocument} from '@/lib/chart-edit';
import {makeEmptyDrumDoc} from './fixtures';

// ---------------------------------------------------------------------------
// Fixture chart bytes: the project's stored chart carries 3 notes, and the
// (mocked) transcriber returns 5 hits, so the note-count assertion actually
// distinguishes the pre- and post-run tracks rather than coincidentally
// matching.
// ---------------------------------------------------------------------------

function buildChartBytes(noteCount: number): Uint8Array {
  const doc: ChartDocument = makeEmptyDrumDoc();
  const drums = doc.parsedChart.trackData[0];
  const types = [
    noteTypes.kick,
    noteTypes.redDrum,
    noteTypes.yellowDrum,
    noteTypes.blueDrum,
    noteTypes.greenDrum,
  ];
  for (let i = 0; i < noteCount; i++) {
    addDrumNote(drums, {tick: i * 480, type: types[i % types.length]});
  }
  const files = writeChartFolder(doc);
  const chartFile = files.find(f => f.fileName === 'notes.chart');
  if (!chartFile) throw new Error('fixture: no notes.chart produced');
  return chartFile.data as Uint8Array;
}

const BEFORE_BYTES = buildChartBytes(3);

/** What the CRNN "detects": five hits, one per beat at the fixture's 120
 *  BPM, so the snapped track has five notes on distinct ticks. */
const TRANSCRIBED_EVENTS = [
  {timeSeconds: 0, drumClass: 'BD', midiPitch: 36, confidence: 0.9},
  {timeSeconds: 0.5, drumClass: 'SD', midiPitch: 38, confidence: 0.9},
  {timeSeconds: 1, drumClass: 'HH', midiPitch: 42, confidence: 0.9},
  {timeSeconds: 1.5, drumClass: 'MT', midiPitch: 47, confidence: 0.9},
  {timeSeconds: 2, drumClass: 'CR', midiPitch: 49, confidence: 0.9},
];

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

jest.mock('../ChartEditor', () => {
  const React = jest.requireActual('react');
  const ChartAssist = jest.requireActual('../sidebar/ChartAssist').default;
  const {TooltipProvider} = jest.requireActual('../../ui/tooltip');
  function MockChartEditor(props: any) {
    const drumsTrack = props.chart.trackData.find(
      (t: any) => t.instrument === 'drums' && t.difficulty === 'expert',
    );
    const noteCount = drumsTrack ? drumsTrack.noteEventGroups.flat().length : 0;
    // A local-state "remount witness", standing in for the real
    // StemsMixer's own local mixer state: if `EditorApp` (this mock's
    // parent) were to unmount/remount during a run, React would
    // create a fresh instance of this whole mocked component, resetting
    // this `useState` back to its initial value. Collapsing it before the
    // run and asserting it's still collapsed after is what proves the run
    // applied its result via `ReplaceDrumTrackCommand` rather than a
    // remount.
    const [expanded, setExpanded] = React.useState(true);
    return React.createElement(
      TooltipProvider,
      null,
      React.createElement(
        'div',
        null,
        React.createElement(
          'div',
          {'data-testid': 'note-count'},
          String(noteCount),
        ),
        React.createElement(
          'button',
          {
            type: 'button',
            onClick: () => setExpanded((prev: boolean) => !prev),
          },
          'Remount witness',
        ),
        expanded &&
          React.createElement('div', {
            role: 'slider',
            'aria-label': 'Remount witness marker',
          }),
        React.createElement(ChartAssist, props.chartAssist ?? {}),
        props.leftPanelChildren,
      ),
    );
  }
  return {
    __esModule: true,
    default: MockChartEditor,
  };
});

jest.mock('../hooks/usePaddedAudio', () => {
  const actual = jest.requireActual('../hooks/usePaddedAudio');
  return {
    ...actual,
    usePaddedAudio: () => ({
      audioManager: {trackNames: ['drums'], setVolume: jest.fn()},
      fullMixPcm: null,
      stems: [],
      durationSeconds: 100,
      rebuilding: false,
    }),
  };
});

jest.mock('../../../lib/drum-transcription/storage/opfs', () => ({
  getProject: jest.fn(async () => ({
    id: 'proj-1',
    name: 'Test Song',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    durationSeconds: 100,
    stage: 'editing',
  })),
  updateProject: jest.fn(
    async (id: string, patch: Record<string, unknown>) => ({
      id,
      name: 'Test Song',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      durationSeconds: 100,
      stage: 'editing',
      ...patch,
    }),
  ),
  findProjectChartFile: jest.fn(async () => 'notes.chart'),
  // The fixture project has only the pipeline's own chart file, which is
  // what the task reads its fresh notes back out of.
  projectFileExists: jest.fn(
    async (_id: string, name: string) => name === 'notes.chart',
  ),
  readProjectBinary: jest.fn(async () => BEFORE_BYTES.buffer),
  writeProjectBinary: jest.fn(async () => {}),
  loadAudioMeta: jest.fn(async () => ({
    sampleRate: 44100,
    channels: 2,
    samples: 0,
    durationMs: 0,
    audioMetadata: {
      name: 'test',
      originalFileName: 'test.mp3',
      durationMs: 0,
      originalSampleRate: 44100,
      fileSizeBytes: 0,
    },
  })),
  loadFullMixPcm: jest.fn(async () => new Float32Array(4)),
  readSongOpus: jest.fn(async () => null),
  readOriginalAudio: jest.fn(async () => null),
  readProjectAssets: jest.fn(async () => []),
  readPackageInfo: jest.fn(async () => null),
}));

jest.mock('../../../lib/drum-transcription/pipeline/decoded-onsets', () => ({
  loadDecodedOnsets: jest.fn(async () => null),
}));

jest.mock('../../../lib/drum-transcription/ml/roformer-separation', () => ({
  loadDrumStem: jest.fn(async () => {
    throw new Error('no stem in this fixture');
  }),
  hasVocalsStem: jest.fn(async () => false),
  loadVocalsStem: jest.fn(async () => {
    throw new Error('no vocals in this fixture');
  }),
  hasDrumStem: jest.fn(async () => true),
  readProjectAudioBytes: jest.fn(async () => new ArrayBuffer(4)),
  ensureProjectStemFingerprint: jest.fn(async () => 'fp-1'),
}));

/** Releases the (mocked) separation the run is parked on. */
let releaseSeparation: (() => void) | null = null;

jest.mock('../../../lib/audio-pipeline/separate-stems', () => ({
  DRUMS_STEM: 'drums',
  VOCALS_STEM: 'vocals',
  separateStems: jest.fn(
    (_bytes: Uint8Array, options: {signal?: AbortSignal} = {}) =>
      new Promise((resolve, reject) => {
        // The real `separateStems` terminates its worker on abort and
        // rejects with an AbortError; the task delegates cancellation to it.
        options.signal?.addEventListener('abort', () =>
          reject(new DOMException('Aborted', 'AbortError')),
        );
        releaseSeparation = () =>
          resolve({
            drums: {
              left: new Float32Array(1024),
              right: new Float32Array(1024),
            },
          });
      }),
  ),
}));

jest.mock('../../../lib/audio-pipeline/stem-cache', () => ({
  ...jest.requireActual('../../../lib/audio-pipeline/stem-cache'),
  hasStem: jest.fn(async () => false),
}));

jest.mock('../../../lib/drum-transcription/pipeline/crnn-audio-prep', () => ({
  CRNN_SAMPLE_RATE: 48000,
  planarStereoToCrnnInput: jest.fn(async () => new Float32Array(2048)),
}));

jest.mock('../../../lib/drum-transcription/ml/transcriber', () => ({
  CrnnTranscriber: class {
    async transcribe() {
      return {
        events: TRANSCRIBED_EVENTS,
        modelOutput: {
          predictions: new Float32Array(0),
          nFrames: 0,
          nClasses: 9,
        },
        durationSeconds: 4,
      };
    }
  },
}));

import EditorApp from '@/app/drum-transcription/components/EditorApp';
import {getProject} from '@/lib/drum-transcription/storage/opfs';
import {AssistRunnerProvider} from '@/components/assist/AssistRunnerProvider';
import {separateStems} from '@/lib/audio-pipeline/separate-stems';

const separateStemsMock = separateStems as jest.Mock;
const getProjectMock = getProject as jest.Mock;

function renderEditor() {
  return render(
    <AudioServiceProvider>
      <AssistRunnerProvider>
        <ChartEditorProvider activeScope={DEFAULT_DRUMS_EXPERT_SCOPE}>
          <EditorApp projectId="proj-1" showRegenerate />
        </ChartEditorProvider>
      </AssistRunnerProvider>
    </AudioServiceProvider>,
  );
}

/** Clicks the Drum transcription card's Run action and confirms the
 *  dialog it raises (the dialog's confirm shares the trigger's accessible
 *  name, so it is resolved scoped to the dialog). */
function confirmRun() {
  fireEvent.click(screen.getByRole('button', {name: /^run$/i}));
  // With the dialog open, Radix hides the rest of the app from the
  // accessibility tree, so the only reachable "Run" is the dialog's own
  // confirm action.
  fireEvent.click(screen.getByRole('button', {name: /^run$/i}));
}

beforeEach(() => {
  releaseSeparation = null;
  separateStemsMock.mockClear();
});

/**
 * Assist provenance can't ride a `.chart`/`.mid` file, so the project's OPFS
 * metadata carries it (plan 0074 Design C). These pin both directions.
 */
describe('assist provenance persistence', () => {
  it('honors a persisted stamp that no longer matches the chart', async () => {
    getProjectMock.mockResolvedValueOnce({
      id: 'proj-1',
      name: 'Test Song',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      durationSeconds: 100,
      stage: 'editing',
      // A stamp from a grid the user has since edited: the staleness prompt
      // the user was looking at before the reload comes back.
      assistProvenance: {
        tempoDerived: {'drum-transcription': {tempoStamp: 'from-an-old-grid'}},
      },
    });
    renderEditor();
    await waitFor(() =>
      expect(
        screen.getByText(/tempo grid changed after transcription/i),
      ).toBeInTheDocument(),
    );
  });

  it('seeds a stamp from the loaded chart when none was persisted', async () => {
    renderEditor();
    await waitFor(() =>
      expect(screen.getByTestId('note-count')).toHaveTextContent('3'),
    );
    // The chart on disk WAS transcribed against the grid it ships with, so
    // nothing is stale until the user moves that grid.
    expect(
      screen.queryByText(/tempo grid changed after transcription/i),
    ).not.toBeInTheDocument();
  });
});

describe('EditorApp inline drum transcription (plan 0074 suite 2)', () => {
  it('loads the project and shows the initial note count', async () => {
    renderEditor();
    await waitFor(() =>
      expect(screen.getByTestId('note-count')).toHaveTextContent('3'),
    );
  });

  it('clicking Run expands the inline card into a step list, keeps sibling controls enabled, and applies the new drums track without remounting', async () => {
    renderEditor();
    await waitFor(() =>
      expect(screen.getByTestId('note-count')).toHaveTextContent('3'),
    );

    // Collapse the remount-witness marker (a stateful sibling) before
    // running — if EditorApp were to unmount/remount during the run this
    // local state would reset back to expanded.
    fireEvent.click(screen.getByRole('button', {name: /remount witness/i}));
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();

    confirmRun();

    // Step list appears (AssistRunCard expands in place).
    await waitFor(() =>
      expect(
        screen.getByRole('list', {name: /progress steps/i}),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText(/separating stems/i)).toBeInTheDocument();

    // Sibling sidebar controls stay interactive while the run is in flight.
    expect(screen.getByRole('button', {name: /add lyrics/i})).toBeEnabled();

    // Resolve the (mocked) separation, which lets the run finish.
    await act(async () => {
      releaseSeparation!();
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(screen.getByTestId('note-count')).toHaveTextContent('5'),
    );

    // The editor never unmounted: the collapsed remount-witness state
    // (local component state, reset on remount) is still collapsed.
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();

    // Run is available again (idle button restored).
    expect(screen.getByRole('button', {name: /^run$/i})).toBeEnabled();
  });

  it('cancel restores the idle Run button and applies nothing', async () => {
    renderEditor();
    await waitFor(() =>
      expect(screen.getByTestId('note-count')).toHaveTextContent('3'),
    );

    confirmRun();

    await waitFor(() =>
      expect(
        screen.getByRole('list', {name: /progress steps/i}),
      ).toBeInTheDocument(),
    );

    // The card is taken over by the run: its action is gone, not merely
    // disabled.
    expect(
      screen.queryByRole('button', {name: /^run$/i}),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', {name: /^cancel$/i}));

    await waitFor(() =>
      expect(screen.getByRole('button', {name: /^run$/i})).toBeEnabled(),
    );
    expect(screen.getByText(/cancelled/i)).toBeInTheDocument();
    expect(screen.getByTestId('note-count')).toHaveTextContent('3');
  });
});
