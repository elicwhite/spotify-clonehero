/**
 * @jest-environment jsdom
 */
/**
 * Initial visibility seeding on `/drum-transcription` (plan 0074 route
 * model, 2026-08-03 owner decision): the editor opens with only Expert
 * Drums visible.
 *
 * Mounts the real `EditorApp` inside a real `ChartEditorProvider`, the same
 * harness `assist-inline-run.test.tsx` uses (OPFS/pipeline modules faked,
 * `lib/chart-edit`'s real `readChart`/`writeChartFolder` build and re-parse
 * actual chart bytes, `ChartEditor` stubbed at the highway/audio boundary).
 * A sibling inside the same provider reads `visibleTrackKeys`/`activeScope`
 * directly off context — no reach into `EditorApp` internals needed.
 */

import '@testing-library/jest-dom';
import {render, screen, waitFor} from '@testing-library/react';
import {createEmptyChart, noteTypes} from '@eliwhite/scan-chart';
import {
  ChartEditorProvider,
  useChartEditorContext,
} from '../ChartEditorContext';
import {AudioServiceProvider} from '../AudioServiceContext';
import {DEFAULT_DRUMS_EXPERT_SCOPE} from '../scope';
import {addDrumNote, writeChartFolder} from '@/lib/chart-edit';
import type {ChartDocument} from '@/lib/chart-edit';
import {emptyTrackData} from '@/lib/chart-edit/__tests__/test-utils';

// jsdom has no ResizeObserver; the sidebar's Stems mixer (Radix Slider)
// needs one.
class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as {ResizeObserver: unknown}).ResizeObserver =
  FakeResizeObserver;

// ---------------------------------------------------------------------------
// Fixture chart bytes: Expert Drums only, since that's all this pipeline
// ever produces.
// ---------------------------------------------------------------------------
function buildChartBytes(): Uint8Array {
  const parsed = createEmptyChart({bpm: 120, resolution: 480});
  parsed.trackData.push(emptyTrackData('drums', 'expert'));
  const doc: ChartDocument = {parsedChart: parsed, assets: []};
  addDrumNote(doc.parsedChart.trackData[0], {tick: 0, type: noteTypes.kick});
  const files = writeChartFolder(doc);
  const chartFile = files.find(f => f.fileName === 'notes.chart');
  if (!chartFile) throw new Error('fixture: no notes.chart produced');
  return chartFile.data as Uint8Array;
}
const CHART_BYTES = buildChartBytes();

// ---------------------------------------------------------------------------
// Module mocks — same boundary as assist-inline-run.test.tsx.
// ---------------------------------------------------------------------------
jest.mock('../ChartEditor', () => {
  const React = jest.requireActual('react');
  function MockChartEditor(props: any) {
    return React.createElement('div', null, props.leftPanelChildren);
  }
  return {__esModule: true, default: MockChartEditor};
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
      ...patch,
    }),
  ),
  findProjectChartFile: jest.fn(async () => 'notes.chart'),
  readProjectBinary: jest.fn(async () => CHART_BYTES.buffer),
  writeProjectBinary: jest.fn(async () => {}),
  projectFileExists: jest.fn(async () => false),
  SONG_INI_FILE_NAME: 'song.ini',
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

import EditorApp from '@/app/drum-transcription/components/EditorApp';
import {AssistRunnerProvider} from '@/components/assist/AssistRunnerProvider';

/** Reads visibility/scope straight off context, mounted as a sibling of
 *  `EditorApp` inside the same `ChartEditorProvider` it dispatches into. */
function VisibilityProbe() {
  const {state} = useChartEditorContext();
  return (
    <>
      <div data-testid="visible-tracks">
        {Array.from(state.visibleTrackKeys).sort().join(',')}
      </div>
      <div data-testid="active-scope">
        {state.activeScope.kind === 'track'
          ? `${state.activeScope.track.instrument}:${state.activeScope.track.difficulty}`
          : state.activeScope.kind}
      </div>
    </>
  );
}

function renderEditor() {
  return render(
    <AudioServiceProvider>
      <AssistRunnerProvider>
        <ChartEditorProvider activeScope={DEFAULT_DRUMS_EXPERT_SCOPE}>
          <VisibilityProbe />
          <EditorApp projectId="proj-1" />
        </ChartEditorProvider>
      </AssistRunnerProvider>
    </AudioServiceProvider>,
  );
}

describe('/drum-transcription load-path visibility seeding', () => {
  it('opens with only Drums Expert visible and focused', async () => {
    renderEditor();

    await waitFor(() =>
      expect(screen.getByTestId('visible-tracks')).toHaveTextContent(
        'drums:expert',
      ),
    );
    expect(screen.getByTestId('active-scope')).toHaveTextContent(
      'drums:expert',
    );
  });
});
