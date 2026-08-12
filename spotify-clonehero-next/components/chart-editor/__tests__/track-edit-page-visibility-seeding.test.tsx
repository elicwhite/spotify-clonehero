/**
 * @jest-environment jsdom
 */
/**
 * What opening a project on `/chart-editor` produces (plan 0074 route model,
 * 2026-08-03 owner decision): which tracks start visible, and how the chart
 * was parsed to get there.
 *
 * Drives the REAL load path: `TrackEditPage` with `/chart-editor`'s own
 * `CONFIG`, reading a project from a
 * stubbed OPFS store the same shape `createOpfsProjectStore` returns, so
 * the parse (`readChartForEditing`) and the `TrackEditEditor` load effect
 * (`highestDifficultyTrackKeys` seeding `SET_VISIBLE_TRACKS` +
 * `SET_ACTIVE_SCOPE`) all run for real. Only three boundaries are stubbed:
 * `AudioContext` (jsdom has none), `AudioManager`/click-track synthesis
 * (real Web Audio), and the three heavy canvas/WebGL children
 * (`HighwayEditor`, `PianoRollTimeline`, `TransportControls` — same
 * boundary `chart-editor-layout.test.tsx` uses). The Chart Matrix itself is
 * real, so the assertions read its rendered buttons, not internal state.
 */

import '@testing-library/jest-dom';
import {render, screen, waitFor} from '@testing-library/react';
import {createEmptyChart, drumTypes, noteTypes} from '@eliwhite/scan-chart';
import {TooltipProvider} from '@/components/ui/tooltip';
import type {ChartDocument} from '@/lib/chart-edit';
import {addDrumNote, writeChartFolder} from '@/lib/chart-edit';
import {emptyTrackData} from '@/lib/chart-edit/__tests__/test-utils';
import TrackEditPage from '../TrackEditPage';
import {useChartEditorContext} from '../ChartEditorContext';
import {CONFIG as CHART_EDITOR_CONFIG} from '../../../app/chart-editor/ChartEditorClient';

// jsdom has no ResizeObserver; the sidebar's Stems mixer (Radix Slider)
// needs one on every mount, same as stems-mixer.test.tsx.
class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as {ResizeObserver: unknown}).ResizeObserver =
  FakeResizeObserver;

// ---------------------------------------------------------------------------
// Heavy/canvas children — same stubs as chart-editor-layout.test.tsx.
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
// Audio boundary — no real Web Audio in jsdom.
// ---------------------------------------------------------------------------
jest.mock('../../../lib/preview/audioManager', () => ({
  AudioManager: jest.fn().mockImplementation(function (
    this: any,
    audioFiles: {fileName: string}[],
  ) {
    this.ready = Promise.resolve();
    this.duration = 300;
    this.isPlaying = false;
    this.chartTime = 0;
    this.trackNames = audioFiles.map(f => f.fileName);
    this.setChartDelay = jest.fn();
    this.setVolume = jest.fn();
    // usePaddedAudio carries mixer state across a rebuild by reading
    // getVolume for every name in trackNames, then pauses the old manager.
    // Without these the rebuild throws on the first track and is swallowed by
    // its own catch, so the audio under test is silently never rebuilt.
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

// jsdom's Blob has no `arrayBuffer()`; `encodeWavBlob` (used by the padded
// export path) relies on it. Node's Blob has it.
(globalThis as unknown as {Blob: unknown}).Blob = require('buffer').Blob;

// The editor decodes the project's audio files into PCM for
// `usePaddedAudio`; jsdom has neither OfflineAudioContext nor the soxr
// resampler behind the real decode.
jest.mock('../../../lib/audio-pipeline/decode-audio', () => ({
  decodeAtRate: jest.fn(async () => ({
    numberOfChannels: 2,
    length: 8,
    sampleRate: 44100,
    duration: 8 / 44100,
    getChannelData: () => new Float32Array(8),
  })),
  nativeDecodeRate: jest.fn(() => 44100),
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
  interleaveAudioBufferYielding: jest.fn(async () => new Float32Array(16)),
}));

// The editor probes the stem cache for anything separation produced for
// this project's audio. Nothing was separated here, and jsdom has neither
// OPFS nor `crypto.subtle` for the fingerprint the probe is keyed by.
jest.mock('../../../lib/audio-pipeline/stem-cache', () => {
  const actual = jest.requireActual('../../../lib/audio-pipeline/stem-cache');
  return {
    ...actual,
    computeStemFingerprint: jest.fn(async () => 'fingerprint-1'),
    loadStem: jest.fn(async () => null),
    loadStemOpus: jest.fn(async () => null),
  };
});

class FakeAudioContext {
  async decodeAudioData(_buffer: ArrayBuffer) {
    return {
      numberOfChannels: 1,
      duration: 10,
      length: 10,
      sampleRate: 44100,
      getChannelData: () => new Float32Array(10),
    } as unknown as AudioBuffer;
  }
  async close() {}
}
(globalThis as unknown as {AudioContext: unknown}).AudioContext =
  FakeAudioContext;

// ---------------------------------------------------------------------------
// OPFS project store — stubbed to the fixture project built below.
// ---------------------------------------------------------------------------
let fixtureChartText = '';
const fixtureAudioFiles = [{fileName: 'song.ogg', data: new Uint8Array([1])}];

jest.mock('../../../lib/project-storage/opfsProjectStore', () => ({
  createOpfsProjectStore: jest.fn(() => ({
    listProjects: jest.fn(async () => []),
    namespaceOf: jest.fn(async () => 'chart-editor'),
    getProject: jest.fn(async () => ({
      id: 'proj1',
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
    // A fresh array each call, so a test that inspects what one call
    // returned can't be affected by another.
    loadAudioFiles: jest.fn(async () => fixtureAudioFiles.map(f => ({...f}))),
    writeSongIni: jest.fn(async () => {}),
    writeEditedChart: jest.fn(async () => {}),
    updateProject: jest.fn(async () => ({})),
    // The album art slot and the export passthroughs: this fixture package
    // carries neither, which is the shape most projects have.
    readAlbumArt: jest.fn(async () => null),
    writeAlbumArt: jest.fn(async () => {}),
    loadPassthroughAssets: jest.fn(async () => []),
    deleteProject: jest.fn(async () => {}),
    createProject: jest.fn(),
  })),
}));

// ---------------------------------------------------------------------------
// next/navigation — pin to `?project=proj1` so TrackEditPage skips the load
// screen and goes straight to TrackEditEditor.
// ---------------------------------------------------------------------------
jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('project=proj1'),
  useRouter: () => ({push: jest.fn()}),
}));

/** Reads `useChartEditorContext()` from inside the real provider tree
 *  (mounted via `leftPanelChildren`, which `LeftSidebar` renders inside
 *  `ChartEditorProvider`) so the test can assert the seeded state directly,
 *  alongside the Chart Matrix's own rendered buttons. */
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
      <div data-testid="drum-type">
        {String(state.chartDoc?.parsedChart.drumType)}
      </div>
    </>
  );
}

/** Multi-instrument doc: guitar charted only Hard/Medium (no Expert), bass
 *  only Easy, drums Expert (and Hard, to prove the *highest* charted
 *  difficulty is picked, not merely "any"). */
function buildFixtureChartText(): string {
  const parsed = createEmptyChart({bpm: 120, resolution: 480});
  parsed.trackData.push(emptyTrackData('guitar', 'hard'));
  parsed.trackData.push(emptyTrackData('guitar', 'medium'));
  parsed.trackData.push(emptyTrackData('bass', 'easy'));
  parsed.trackData.push(emptyTrackData('drums', 'expert'));
  parsed.trackData.push(emptyTrackData('drums', 'hard'));
  const doc: ChartDocument = {parsedChart: parsed, assets: []};
  doc.parsedChart.format = 'chart';
  const files = writeChartFolder(doc);
  const notesFile = files.find(f => f.fileName === 'notes.chart');
  if (!notesFile)
    throw new Error('writeChartFolder did not produce notes.chart');
  return new TextDecoder().decode(notesFile.data);
}

beforeEach(() => {
  fixtureChartText = buildFixtureChartText();
});

describe('/chart-editor load-path visibility seeding', () => {
  it('seeds one visible track per instrument, each at its highest charted difficulty, and focuses drums', async () => {
    render(
      <TooltipProvider>
        <TrackEditPage
          {...CHART_EDITOR_CONFIG}
          leftPanelChildren={<VisibilityProbe />}
        />
      </TooltipProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId('visible-tracks')).toHaveTextContent(
        'bass:easy,drums:expert,guitar:hard',
      ),
    );

    // activeScope focuses drums (present among the seeded tracks), per the
    // route model, not guitar (SUPPORTED_TRACK_INSTRUMENTS' first entry).
    expect(screen.getByTestId('active-scope')).toHaveTextContent(
      'drums:expert',
    );

    // The real Chart Matrix reflects the same three cells as pressed, and
    // nothing else — including NOT guitar Medium, proving "highest charted"
    // beat "any charted" for guitar.
    expect(screen.getByRole('button', {name: 'Guitar Hard'})).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', {name: 'Guitar Medium'})).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByRole('button', {name: 'Bass Easy'})).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', {name: 'Drums Expert'})).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', {name: 'Drums Hard'})).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('falls back to a non-drums first track when the chart has no drums', async () => {
    const parsed = createEmptyChart({bpm: 120, resolution: 480});
    parsed.trackData.push(emptyTrackData('bass', 'expert'));
    const doc: ChartDocument = {parsedChart: parsed, assets: []};
    doc.parsedChart.format = 'chart';
    const files = writeChartFolder(doc);
    const notesFile = files.find(f => f.fileName === 'notes.chart')!;
    fixtureChartText = new TextDecoder().decode(notesFile.data);

    render(
      <TooltipProvider>
        <TrackEditPage
          {...CHART_EDITOR_CONFIG}
          leftPanelChildren={<VisibilityProbe />}
        />
      </TooltipProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId('visible-tracks')).toHaveTextContent(
        'bass:expert',
      ),
    );
    expect(screen.getByTestId('active-scope')).toHaveTextContent('bass:expert');
  });
});

describe('/chart-editor load-path drum interpretation', () => {
  /** A plain four-lane drum chart: tom notes only, no cymbal markers, and no
   *  song.ini declaring `pro_drums` — nothing in the file says pro-drums. */
  function buildBasicFourLaneChartText(): string {
    const parsed = createEmptyChart({bpm: 120, resolution: 480});
    parsed.drumType = drumTypes.fourLane;
    parsed.trackData.push(emptyTrackData('drums', 'expert'));
    const doc: ChartDocument = {parsedChart: parsed, assets: []};
    addDrumNote(doc.parsedChart.trackData[0], {tick: 0, type: noteTypes.kick});
    addDrumNote(doc.parsedChart.trackData[0], {
      tick: 480,
      type: noteTypes.yellowDrum,
    });
    doc.parsedChart.format = 'chart';
    const notesFile = writeChartFolder(doc).find(
      f => f.fileName === 'notes.chart',
    )!;
    return new TextDecoder().decode(notesFile.data);
  }

  /**
   * The doc the editor edits is the doc it saves, so the drum type it loaded
   * with decides whether a cymbal edit can be written at all: the .chart
   * writer emits cymbal markers for pro-drums charts only (see
   * `lib/chart-edit/__tests__/read-chart-for-editing.test.ts` for the round
   * trip itself).
   */
  it('opens a plain four-lane drum chart as pro-drums, so its cymbal edits are savable', async () => {
    fixtureChartText = buildBasicFourLaneChartText();

    render(
      <TooltipProvider>
        <TrackEditPage
          {...CHART_EDITOR_CONFIG}
          leftPanelChildren={<VisibilityProbe />}
        />
      </TooltipProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId('drum-type')).toHaveTextContent(
        String(drumTypes.fourLanePro),
      ),
    );
  });

  it('leaves a five-lane drum chart five-lane', async () => {
    const parsed = createEmptyChart({bpm: 120, resolution: 480});
    parsed.drumType = drumTypes.fiveLane;
    parsed.trackData.push(emptyTrackData('drums', 'expert'));
    const doc: ChartDocument = {parsedChart: parsed, assets: []};
    addDrumNote(doc.parsedChart.trackData[0], {tick: 0, type: noteTypes.kick});
    addDrumNote(doc.parsedChart.trackData[0], {
      tick: 480,
      type: noteTypes.greenDrum,
    });
    doc.parsedChart.format = 'chart';
    fixtureChartText = new TextDecoder().decode(
      writeChartFolder(doc).find(f => f.fileName === 'notes.chart')!.data,
    );

    render(
      <TooltipProvider>
        <TrackEditPage
          {...CHART_EDITOR_CONFIG}
          leftPanelChildren={<VisibilityProbe />}
        />
      </TooltipProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId('drum-type')).toHaveTextContent(
        String(drumTypes.fiveLane),
      ),
    );
  });
});
