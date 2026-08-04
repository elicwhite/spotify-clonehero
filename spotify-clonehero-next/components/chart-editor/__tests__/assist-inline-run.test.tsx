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
 * `usePaddedAudio` -> a static fake `AudioManager`) and the OPFS/pipeline
 * boundary is faked (`storage/opfs`, `pipeline/runner`,
 * `ml/roformer-separation`) — `lib/chart-edit`'s real
 * `readChart`/`writeChartFolder` build and re-parse actual chart bytes, so
 * the note-count assertion reflects a genuine parse, not a mock.
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

// EditorApp gates a regenerate run on the page's ONNX Runtime <Script> having
// landed (`waitForOrtRuntime`). Stand in for it: the runtime itself is never
// used here, since the pipeline is mocked.
(globalThis as unknown as {ort: unknown}).ort = {};

import {render, screen, waitFor, fireEvent} from '@testing-library/react';
import {noteTypes} from '@eliwhite/scan-chart';
import {ChartEditorProvider} from '../ChartEditorContext';
import {AudioServiceProvider} from '../AudioServiceContext';
import {DEFAULT_DRUMS_EXPERT_SCOPE} from '../scope';
import {addDrumNote, writeChartFolder} from '@/lib/chart-edit';
import type {ChartDocument} from '@/lib/chart-edit';
import {makeEmptyDrumDoc} from './fixtures';
import type {PipelineProgress} from '@/lib/drum-transcription/pipeline/stages';

// ---------------------------------------------------------------------------
// Fixture chart bytes: "before" (3 notes) and "after" (5 notes), so the
// note-count assertion actually distinguishes the pre- and post-regenerate
// tracks rather than coincidentally matching.
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
const AFTER_BYTES = buildChartBytes(5);

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
    // parent) were to unmount/remount during a regenerate run, React would
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

let regenerated = false;

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
  CHART_FILE_BASENAMES: {chart: 'notes.chart', mid: 'notes.mid'},
  projectFileExists: jest.fn(
    async (_id: string, name: string) => name === 'notes.chart',
  ),
  readProjectBinary: jest.fn(
    async () => (regenerated ? AFTER_BYTES : BEFORE_BYTES).buffer,
  ),
  writeProjectBinary: jest.fn(async () => {}),
  editedVariant: (name: string) => name.replace(/\.chart$/, '.edited.chart'),
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

let releaseRegenerate: (() => void) | null = null;

jest.mock('../../../lib/drum-transcription/pipeline/runner', () => ({
  regenerateProject: jest.fn(
    (
      projectId: string,
      onProgress: (p: PipelineProgress) => void,
      _transcriber?: unknown,
      options: {signal?: AbortSignal} = {},
    ) => {
      onProgress({step: 'separating', progress: 0.2, projectId});
      return new Promise<string>((resolve, reject) => {
        // The real `regenerateProject` owns cancellation for its call: it
        // terminates its workers on abort and rejects with an AbortError.
        options.signal?.addEventListener('abort', () =>
          reject(new DOMException('Aborted', 'AbortError')),
        );
        releaseRegenerate = () => {
          regenerated = true;
          onProgress({step: 'transcribing', progress: 1, projectId});
          resolve(projectId);
        };
      });
    },
  ),
}));

import EditorApp from '@/app/drum-transcription/components/EditorApp';
import {getProject} from '@/lib/drum-transcription/storage/opfs';
import {AssistRunnerProvider} from '@/components/assist/AssistRunnerProvider';
import {regenerateProject} from '@/lib/drum-transcription/pipeline/runner';

const regenerateProjectMock = regenerateProject as jest.Mock;
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

/** Clicks the Drum transcription card's Re-run action and confirms the
 *  dialog it raises (the dialog's confirm shares the trigger's accessible
 *  name, so it is resolved scoped to the dialog). */
function confirmRegenerate() {
  fireEvent.click(screen.getByRole('button', {name: /^re-run$/i}));
  // With the dialog open, Radix hides the rest of the app from the
  // accessibility tree, so the only reachable "Re-run" is the dialog's own
  // confirm action.
  fireEvent.click(screen.getByRole('button', {name: /^re-run$/i}));
}

beforeEach(() => {
  regenerated = false;
  releaseRegenerate = null;
  regenerateProjectMock.mockClear();
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

describe('EditorApp inline regenerate (plan 0074 suite 2)', () => {
  it('loads the project and shows the initial note count', async () => {
    renderEditor();
    await waitFor(() =>
      expect(screen.getByTestId('note-count')).toHaveTextContent('3'),
    );
  });

  it('clicking Re-run expands the inline card into a step list, keeps sibling controls enabled, and applies the new drums track without remounting', async () => {
    renderEditor();
    await waitFor(() =>
      expect(screen.getByTestId('note-count')).toHaveTextContent('3'),
    );

    // Collapse the remount-witness marker (a stateful sibling) before
    // running regenerate — if EditorApp were to unmount/remount during the
    // run this local state would reset back to expanded.
    fireEvent.click(screen.getByRole('button', {name: /remount witness/i}));
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();

    confirmRegenerate();

    // Step list appears (AssistRunCard expands in place).
    await waitFor(() =>
      expect(
        screen.getByRole('list', {name: /progress steps/i}),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText(/separating stems/i)).toBeInTheDocument();

    // Sibling sidebar controls stay interactive while the run is in flight.
    expect(screen.getByRole('button', {name: /add lyrics/i})).toBeEnabled();

    // Resolve the (mocked) pipeline.
    await act(async () => {
      releaseRegenerate!();
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(screen.getByTestId('note-count')).toHaveTextContent('5'),
    );

    // The editor never unmounted: the collapsed remount-witness state
    // (local component state, reset on remount) is still collapsed.
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();

    // Re-run is available again (idle button restored).
    expect(screen.getByRole('button', {name: /^re-run$/i})).toBeEnabled();
  });

  it('cancel restores the idle Re-run button and applies nothing', async () => {
    renderEditor();
    await waitFor(() =>
      expect(screen.getByTestId('note-count')).toHaveTextContent('3'),
    );

    confirmRegenerate();

    await waitFor(() =>
      expect(
        screen.getByRole('list', {name: /progress steps/i}),
      ).toBeInTheDocument(),
    );

    // The card is taken over by the run: its action is gone, not merely
    // disabled.
    expect(
      screen.queryByRole('button', {name: /^re-run$/i}),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', {name: /^cancel$/i}));

    await waitFor(() =>
      expect(screen.getByRole('button', {name: /^re-run$/i})).toBeEnabled(),
    );
    expect(screen.getByText(/cancelled/i)).toBeInTheDocument();
    expect(screen.getByTestId('note-count')).toHaveTextContent('3');
  });
});
