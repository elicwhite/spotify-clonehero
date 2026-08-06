/**
 * @jest-environment jsdom
 */
/**
 * `/chart-editor`'s audio, once `TrackEditPage` builds it through
 * `usePaddedAudio` (plan 0076 item 18).
 *
 * Under test: what the Stems mixer shows for a project opened through the
 * real `TrackEditPage` load path — the package's own audio files at load,
 * and a stem an assist run separated appearing beside them, badged
 * AI-separated, without a reload — and the leading-silence action this host
 * can now offer, including the anchor it persists so a reload pads the same
 * audio the chart was shifted against.
 *
 * Behavior-first: the run is driven through the editor's REAL assist runner
 * (a probe mounted via `leftPanelChildren` starts a stub task keyed
 * `generate-tempo-map`, whose `run` writes a drum stem into the mocked stem
 * cache exactly as the tempo pipeline's worker does), and every assertion
 * reads rendered mixer rows. Stubbed boundaries are the same ones
 * `track-edit-page-visibility-seeding.test.tsx` stubs — OPFS store, audio
 * decode, `AudioManager`, click-track synthesis, and the three
 * canvas/WebGL children — plus the stem cache itself.
 */

import '@testing-library/jest-dom';
import {useState} from 'react';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import {createEmptyChart, noteTypes} from '@eliwhite/scan-chart';
import {TooltipProvider} from '@/components/ui/tooltip';
import type {ChartDocument} from '@/lib/chart-edit';
import {addDrumNote, writeChartFolder} from '@/lib/chart-edit';
import {emptyTrackData} from '@/lib/chart-edit/__tests__/test-utils';
import type {AssistTaskDef} from '@/lib/assist/tasks/types';
import {useAssistRunnerContext} from '@/components/assist/AssistRunnerProvider';
import TrackEditPage from '../TrackEditPage';
import {CONFIG as CHART_EDITOR_CONFIG} from '../../../app/chart-editor/ChartEditorClient';

// jsdom has no ResizeObserver; the Stems mixer's Radix Slider needs one.
class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as {ResizeObserver: unknown}).ResizeObserver =
  FakeResizeObserver;

// jsdom's Blob has no `arrayBuffer()`; `encodeWavBlob` (inside
// `usePaddedAudio`'s build) relies on it. Node's Blob has it.
(globalThis as unknown as {Blob: unknown}).Blob = require('buffer').Blob;

// ---------------------------------------------------------------------------
// Heavy/canvas children
// ---------------------------------------------------------------------------
jest.mock('../HighwayEditor', () => ({
  __esModule: true,
  default: () => <div data-testid="highway-editor-stub" />,
}));
jest.mock('../piano-roll/PianoRollTimeline', () => ({
  __esModule: true,
  default: () => <div data-testid="piano-roll-stub" />,
}));
jest.mock('../TransportControls', () => ({
  __esModule: true,
  default: () => <div data-testid="transport-controls-stub" />,
}));

// ---------------------------------------------------------------------------
// Audio boundary
// ---------------------------------------------------------------------------
jest.mock('../../../lib/preview/audioManager', () => ({
  AudioManager: jest.fn().mockImplementation(function (
    this: any,
    audioFiles: {fileName: string}[],
  ) {
    this.ready = Promise.resolve();
    this.duration = 10;
    this.isPlaying = false;
    this.chartTime = 0;
    this.trackNames = audioFiles.map(f => f.fileName.replace(/\.wav$/, ''));
    this.setChartDelay = jest.fn();
    this.setVolume = jest.fn();
    this.getVolume = jest.fn(() => 1);
    this.pause = jest.fn(async () => {});
    this.resume = jest.fn(async () => {});
    this.seekToChartTime = jest.fn(async () => {});
    this.setLoopRegion = jest.fn();
    this.destroy = jest.fn();
  }),
}));
// Only the WAV synthesis is stubbed (it needs an OfflineAudioContext jsdom
// doesn't have); the rest of the module, `clickTrackSignature` included, is
// pure and stays real.
jest.mock('../../../lib/preview/clickTrack', () => ({
  ...jest.requireActual('../../../lib/preview/clickTrack'),
  generateBeatClickTrackSamples: jest.fn(async () => ({
    samples: new Float32Array(1),
    sampleRate: 8000,
  })),
}));
jest.mock('../../../lib/drum-transcription/audio/decoder', () => ({
  decodeAudio: jest.fn(async () => ({
    numberOfChannels: 2,
    length: 8,
    sampleRate: 44100,
    duration: 8 / 44100,
    getChannelData: () => new Float32Array(8),
  })),
  interleaveAudioBuffer: jest.fn(() => new Float32Array(16)),
}));

// ---------------------------------------------------------------------------
// Stem cache — the authority the editor probes for separated stems. Empty
// until the stub assist run "separates" a drum stem into it.
// ---------------------------------------------------------------------------
let cachedDrumStem: {left: Float32Array; right: Float32Array} | null = null;
// Which project's audio the cached stem belongs to. The cache is keyed by a
// fingerprint of the project's own audio bytes, so a stem separated out of
// one project must not resolve for another.
let cachedDrumFingerprint = '';
jest.mock('../../../lib/audio-pipeline/stem-cache', () => {
  const actual = jest.requireActual('../../../lib/audio-pipeline/stem-cache');
  return {
    ...actual,
    // Real fingerprints are a hash of the audio bytes; this keeps that
    // property (different audio, different key) without the crypto.
    computeStemFingerprint: jest.fn(
      async (bytes: Uint8Array) => `fingerprint-${bytes[0]}`,
    ),
    loadStem: jest.fn(async (fingerprint: string, stemName: string) =>
      stemName === 'drums' && fingerprint === cachedDrumFingerprint
        ? cachedDrumStem
        : null,
    ),
    loadStemOpus: jest.fn(async () => null),
  };
});

// ---------------------------------------------------------------------------
// OPFS project store — one-file package (song.ogg).
// ---------------------------------------------------------------------------
let fixtureChartText = '';
const mockWriteEditedChart = jest.fn(async () => {});
const mockUpdateProject = jest.fn(async () => ({}));
// The project the URL currently points at. Two projects with DIFFERENT
// audio bytes, so their stem-cache fingerprints differ.
let currentProjectId = 'proj1';
const PROJECT_AUDIO_BYTE: Record<string, number> = {proj1: 1, proj2: 9};

jest.mock('../../../lib/project-storage/opfsProjectStore', () => ({
  createOpfsProjectStore: jest.fn(() => ({
    listProjects: jest.fn(async () => []),
    namespaceOf: jest.fn(async () => 'chart-editor'),
    getProject: jest.fn(async () => ({
      id: currentProjectId,
      name: 'Test Song',
      artist: 'Test Artist',
      charter: 'Test Charter',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      durationSeconds: 180,
      sourceFormat: 'chart',
      originalName: 'Test Song',
    })),
    readChartText: jest.fn(async () => fixtureChartText),
    readSongIni: jest.fn(async () => null),
    loadAudioFiles: jest.fn(async () => [
      {
        fileName: 'song.ogg',
        data: new Uint8Array([PROJECT_AUDIO_BYTE[currentProjectId], 2, 3, 4]),
      },
    ]),
    writeSongIni: jest.fn(async () => {}),
    writeEditedChart: mockWriteEditedChart,
    updateProject: mockUpdateProject,
    // The album art slot and the export passthroughs: this fixture package
    // carries neither, which is the shape most projects have.
    readAlbumArt: jest.fn(async () => null),
    writeAlbumArt: jest.fn(async () => {}),
    loadPassthroughAssets: jest.fn(async () => []),
    deleteProject: jest.fn(async () => {}),
    createProject: jest.fn(),
  })),
}));

jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(`project=${currentProjectId}`),
  useRouter: () => ({push: jest.fn()}),
}));

/**
 * Stands in for a Chart Assist card that runs a separating task: starts a
 * real run on the editor's own runner with a stub task whose `run` writes a
 * drum stem into the stem cache, the way the tempo pipeline's worker does
 * during "Isolating the drums".
 */
function SeparatingRunProbe() {
  const runner = useAssistRunnerContext();
  const [error, setError] = useState('');
  const task: AssistTaskDef<{ok: true}, Record<string, never>> = {
    key: 'generate-tempo-map',
    title: 'Tempo map',
    planSteps: async () => [],
    run: async () => {
      cachedDrumStem = {
        left: new Float32Array([0.1, 0.2]),
        right: new Float32Array([0.3, 0.4]),
      };
      cachedDrumFingerprint = `fingerprint-${PROJECT_AUDIO_BYTE[currentProjectId]}`;
      return {ok: true};
    },
  };
  return (
    <>
      <button
        type="button"
        onClick={() => {
          runner.start(task, {}).catch((err: unknown) => {
            setError(err instanceof Error ? err.message : String(err));
          });
        }}>
        Run separating task
      </button>
      <div data-testid="run-error">{error}</div>
    </>
  );
}

function buildFixtureChartText(): string {
  const parsed = createEmptyChart({bpm: 120, resolution: 480});
  const drums = emptyTrackData('drums', 'expert');
  // A note at tick 0 is what makes leading silence applicable: the chart
  // starts with no room before its first note.
  addDrumNote(drums, {tick: 0, type: noteTypes.kick});
  parsed.trackData.push(drums);
  const doc: ChartDocument = {parsedChart: parsed, assets: []};
  doc.parsedChart.format = 'chart';
  const files = writeChartFolder(doc);
  const notesFile = files.find(f => f.fileName === 'notes.chart');
  if (!notesFile) {
    throw new Error('writeChartFolder did not produce notes.chart');
  }
  return new TextDecoder().decode(notesFile.data);
}

beforeEach(() => {
  fixtureChartText = buildFixtureChartText();
  currentProjectId = 'proj1';
  cachedDrumStem = null;
  cachedDrumFingerprint = '';
  mockWriteEditedChart.mockClear();
  mockUpdateProject.mockClear();
});

describe('/chart-editor Stems list', () => {
  it('lists the package’s own audio, and adds a separated stem badged AI-separated once an assist run produces one', async () => {
    render(
      <TooltipProvider>
        <TrackEditPage
          {...CHART_EDITOR_CONFIG}
          leftPanelChildren={<SeparatingRunProbe />}
        />
      </TooltipProvider>,
    );

    // The package's single audio file plays as the `song` track, with no
    // AI-separated badge — it came from the chart, not from separation.
    const songRow = await screen.findByTestId('stem-row-song');
    expect(
      within(songRow).queryByLabelText('AI-separated stem'),
    ).not.toBeInTheDocument();
    // Nothing has separated anything yet.
    expect(screen.queryByTestId('stem-row-drums')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', {name: 'Run separating task'}));

    const drumsRow = await screen.findByTestId('stem-row-drums');
    expect(
      within(drumsRow).getByLabelText('AI-separated stem'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('run-error')).toHaveTextContent('');
    // The package's own audio is still there beside it.
    expect(screen.getByTestId('stem-row-song')).toBeInTheDocument();
  });

  it('does not carry one project’s separated stems onto the next project', async () => {
    // The editor is not remounted when the URL's project changes, so
    // anything cached per-project on this host (the stem-cache fingerprint)
    // has to be dropped with it - otherwise project 2 plays project 1's
    // separated drums.
    const tree = () => (
      <TooltipProvider>
        <TrackEditPage
          {...CHART_EDITOR_CONFIG}
          leftPanelChildren={<SeparatingRunProbe />}
        />
      </TooltipProvider>
    );
    const {rerender} = render(tree());

    await screen.findByTestId('stem-row-song');
    fireEvent.click(screen.getByRole('button', {name: 'Run separating task'}));
    await screen.findByTestId('stem-row-drums');

    currentProjectId = 'proj2';
    rerender(tree());

    // Project 2's audio was never separated, so once its mixer is up it has
    // its own `song` row and no drums stem.
    await waitFor(() => {
      expect(screen.getByTestId('stem-row-song')).toBeInTheDocument();
      expect(screen.queryByTestId('stem-row-drums')).not.toBeInTheDocument();
    });
  });
});

describe('/chart-editor Add leading silence', () => {
  it('offers the action, because this host pads the audio it plays and exports', async () => {
    render(
      <TooltipProvider>
        <TrackEditPage {...CHART_EDITOR_CONFIG} />
      </TooltipProvider>,
    );

    const action = await screen.findByRole('button', {
      name: 'Add leading silence',
    });
    expect(action).toBeEnabled();
    // A disabled action carries its reason as the button's accessible
    // description; an offered one has nothing to explain away.
    expect(action).not.toHaveAccessibleDescription();
  });

  it('persists the audio anchor it applies, so a reload pads the same audio', async () => {
    render(
      <TooltipProvider>
        <TrackEditPage {...CHART_EDITOR_CONFIG} />
      </TooltipProvider>,
    );

    fireEvent.click(
      await screen.findByRole('button', {name: 'Add leading silence'}),
    );

    // Autosave runs on tab-hide as well as on its timer.
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    fireEvent(document, new Event('visibilitychange'));

    await waitFor(() => expect(mockWriteEditedChart).toHaveBeenCalled());
    await waitFor(() => expect(mockUpdateProject).toHaveBeenCalled());
    const [, patch] = mockUpdateProject.mock.calls.at(-1) as unknown as [
      string,
      {audioAnchor: {ms: number} | null},
    ];
    expect(patch.audioAnchor?.ms).toBeGreaterThan(0);
  });
});
