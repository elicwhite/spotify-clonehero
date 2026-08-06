/**
 * @jest-environment jsdom
 */
/**
 * What `/chart-editor` mounts for a chart created with no audio.
 *
 * The whole editor shell has to come up against the synthesized metronome
 * click alone: no audio load, no full-mix waveform, a real transport
 * duration taken from the chart's own `song_length`, and the Stems section
 * inviting a file instead of listing stems. Chart Assist is absent, because
 * every card in it needs audio.
 *
 * Same stubbed boundaries as the other `TrackEditPage` load-path suites:
 * the OPFS store, audio decode, `AudioManager`, click-track synthesis and
 * the three canvas/WebGL children.
 */

import '@testing-library/jest-dom';
import {render, screen, waitFor} from '@testing-library/react';
import {createEmptyChart} from '@eliwhite/scan-chart';
import {TooltipProvider} from '@/components/ui/tooltip';
import type {ChartDocument} from '@/lib/chart-edit';
import {writeChartFolder} from '@/lib/chart-edit';
import {emptyTrackData} from '@/lib/chart-edit/__tests__/test-utils';
import TrackEditPage from '../TrackEditPage';
import {CONFIG as CHART_EDITOR_CONFIG} from '../../../app/chart-editor/ChartEditorClient';

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as {ResizeObserver: unknown}).ResizeObserver =
  FakeResizeObserver;
(globalThis as unknown as {Blob: unknown}).Blob = require('buffer').Blob;

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

/** Records what the manager was constructed from, so the suite can assert
 *  the click is the only track a no-audio project plays. */
let lastAudioFileNames: string[] = [];
jest.mock('../../../lib/preview/audioManager', () => ({
  AudioManager: jest.fn().mockImplementation(function (
    this: any,
    audioFiles: {fileName: string}[],
  ) {
    lastAudioFileNames = audioFiles.map(f => f.fileName);
    this.ready = Promise.resolve();
    this.duration = 300;
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
  decodeAudio: jest.fn(async () => {
    throw new Error('a project with no audio must not decode anything');
  }),
  interleaveAudioBuffer: jest.fn(() => new Float32Array(16)),
}));

let fixtureChartText = '';
const loadAudioFiles = jest.fn(async () => []);

jest.mock('../../../lib/project-storage/opfsProjectStore', () => ({
  createOpfsProjectStore: jest.fn(() => ({
    listProjects: jest.fn(async () => []),
    namespaceOf: jest.fn(async () => 'chart-editor'),
    getProject: jest.fn(async () => ({
      id: 'blank1',
      name: 'Blank Song',
      artist: '',
      charter: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      durationSeconds: 300,
      sourceFormat: 'folder',
      originalName: 'Blank Song',
      hasAudio: false,
    })),
    readChartText: jest.fn(async () => fixtureChartText),
    readSongIni: jest.fn(async () => null),
    loadAudioFiles,
    writeSongIni: jest.fn(async () => {}),
    writeEditedChart: jest.fn(async () => {}),
    updateProject: jest.fn(async () => ({})),
    deleteProject: jest.fn(async () => {}),
    createProject: jest.fn(),
  })),
}));

jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('project=blank1'),
  useRouter: () => ({push: jest.fn(), replace: jest.fn()}),
}));

function buildBlankChartText(): string {
  const parsed = createEmptyChart({bpm: 120, resolution: 480});
  parsed.trackData.push(emptyTrackData('drums', 'expert'));
  parsed.metadata = {...parsed.metadata, song_length: 300000};
  const doc: ChartDocument = {parsedChart: parsed, assets: []};
  doc.parsedChart.format = 'chart';
  const files = writeChartFolder(doc);
  const notesFile = files.find(f => f.fileName === 'notes.chart')!;
  return new TextDecoder().decode(notesFile.data);
}

beforeEach(() => {
  fixtureChartText = buildBlankChartText();
  lastAudioFileNames = [];
  loadAudioFiles.mockClear();
});

describe('/chart-editor on a chart with no audio', () => {
  it('mounts the whole editor against the click alone', async () => {
    render(
      <TooltipProvider>
        <TrackEditPage {...CHART_EDITOR_CONFIG} />
      </TooltipProvider>,
    );

    await screen.findByTestId('highway-editor-stub');
    expect(screen.getByTestId('piano-roll-stub')).toBeInTheDocument();
    expect(screen.getByTestId('transport-controls-stub')).toBeInTheDocument();
    // The Chart Matrix is real, and offers the track the blank chart has.
    expect(
      screen.getByRole('button', {name: 'Drums Expert'}),
    ).toBeInTheDocument();

    expect(lastAudioFileNames).toEqual(['click.wav']);
    expect(loadAudioFiles).not.toHaveBeenCalled();
  });

  it('shows the Stems null state and no Chart Assist section', async () => {
    render(
      <TooltipProvider>
        <TrackEditPage {...CHART_EDITOR_CONFIG} />
      </TooltipProvider>,
    );

    expect(
      await screen.findByLabelText(
        'Drop an audio file here to add it to this chart',
      ),
    ).toBeInTheDocument();

    await waitFor(() =>
      expect(screen.queryByText('Chart Assist')).not.toBeInTheDocument(),
    );
  });
});
