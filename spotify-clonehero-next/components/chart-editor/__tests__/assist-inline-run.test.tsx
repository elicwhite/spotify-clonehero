/**
 * @jest-environment jsdom
 */
/**
 * EditorApp <-> assist engine inline wiring (plan 0074 Phase 1, suite 2).
 *
 * Mounts the real `EditorApp` inside a real `ChartEditorProvider`
 * (`EditorSession`, `useExecuteCommand`, `ReplaceDrumTrackCommand` all run
 * for real). Only the highway/audio boundary is stubbed
 * (`ChartEditor` -> a note-count + `leftPanelChildren` shim,
 * `usePaddedAudio` -> a static fake `AudioManager`) and the OPFS/pipeline
 * boundary is faked (`storage/opfs`, `pipeline/runner`,
 * `ml/roformer-separation`) — `lib/chart-edit`'s real
 * `readChart`/`writeChartFolder` build and re-parse actual chart bytes, so
 * the note-count assertion reflects a genuine parse, not a mock.
 */

import '@testing-library/jest-dom';
import {act} from 'react';

// jsdom has no ResizeObserver; Radix's Slider (rendered by
// StemVolumeControls) needs one.
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

import {
  render,
  screen,
  waitFor,
  fireEvent,
  within,
} from '@testing-library/react';
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
  return {
    __esModule: true,
    default: (props: any) => {
      const drumsTrack = props.chart.trackData.find(
        (t: any) => t.instrument === 'drums' && t.difficulty === 'expert',
      );
      const noteCount = drumsTrack
        ? drumsTrack.noteEventGroups.flat().length
        : 0;
      return React.createElement(
        'div',
        null,
        React.createElement(
          'div',
          {'data-testid': 'note-count'},
          String(noteCount),
        ),
        props.leftPanelChildren,
      );
    },
  };
});

jest.mock('../hooks/usePaddedAudio', () => {
  const actual = jest.requireActual('../hooks/usePaddedAudio');
  return {
    ...actual,
    usePaddedAudio: () => ({
      audioManager: {trackNames: ['drums'], setVolume: jest.fn()},
      fullMixPcm: null,
      secondaryPcm: null,
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
import {AssistRunnerProvider} from '@/components/assist/AssistRunnerProvider';
import {regenerateProject} from '@/lib/drum-transcription/pipeline/runner';

const regenerateProjectMock = regenerateProject as jest.Mock;

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

/** Opens the confirm dialog and confirms it, returning the resolved
 *  confirm-button element scoped to the dialog (distinct from the sidebar's
 *  "Regenerate" trigger, which shares the same accessible name). */
function confirmRegenerate() {
  fireEvent.click(screen.getByRole('button', {name: /^regenerate$/i}));
  const dialog = screen.getByRole('alertdialog');
  fireEvent.click(within(dialog).getByRole('button', {name: /^regenerate$/i}));
}

beforeEach(() => {
  regenerated = false;
  releaseRegenerate = null;
  regenerateProjectMock.mockClear();
});

describe('EditorApp inline regenerate (plan 0074 suite 2)', () => {
  it('loads the project and shows the initial note count', async () => {
    renderEditor();
    await waitFor(() =>
      expect(screen.getByTestId('note-count')).toHaveTextContent('3'),
    );
  });

  it('clicking Regenerate expands the inline card into a step list, keeps sibling controls enabled, and applies the new drums track without remounting', async () => {
    renderEditor();
    await waitFor(() =>
      expect(screen.getByTestId('note-count')).toHaveTextContent('3'),
    );

    // Collapse the Stem Volumes panel (a stateful sibling) before running
    // regenerate — if EditorApp were to unmount/remount during the run this
    // local state would reset back to expanded.
    fireEvent.click(screen.getByRole('button', {name: /stem volumes/i}));
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

    // The editor never unmounted: the collapsed Stem Volumes state (local
    // component state, reset on remount) is still collapsed.
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();

    // Regenerate is available again (idle button restored).
    expect(screen.getByRole('button', {name: /^regenerate$/i})).toBeEnabled();
  });

  it('cancel restores the idle Regenerate button and applies nothing', async () => {
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

    expect(screen.getByRole('button', {name: /^regenerate$/i})).toBeDisabled();

    fireEvent.click(screen.getByRole('button', {name: /^cancel$/i}));

    await waitFor(() =>
      expect(screen.getByRole('button', {name: /^regenerate$/i})).toBeEnabled(),
    );
    expect(screen.getByText(/cancelled/i)).toBeInTheDocument();
    expect(screen.getByTestId('note-count')).toHaveTextContent('3');
  });
});
