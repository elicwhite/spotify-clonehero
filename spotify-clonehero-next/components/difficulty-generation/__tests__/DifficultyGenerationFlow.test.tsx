/**
 * @jest-environment jsdom
 */
/**
 * `/drum-difficulties` and `/guitar-difficulties`'s shared flow (plan 0074
 * route model, 2026-08-03): picker -> Expert-track validation -> a scripted
 * `generate-difficulties` run (the real task, `FakeWorker`-backed via its
 * `createWorker` seam) -> the real `ChartEditor` mounts with X/H/M/E visible
 * in the real Chart Matrix. Heavy canvas/WebGL children and `AudioManager`
 * are stubbed (same boundary as `track-edit-page-visibility-seeding.test.tsx`);
 * `ChartDropZone` is replaced with a button that fires `onLoaded` with a
 * fixture chart, since driving its real file/folder pickers needs browser
 * APIs jsdom doesn't have.
 */

import '@testing-library/jest-dom';
import {render, screen, fireEvent, waitFor} from '@testing-library/react';
import {
  createEmptyChart,
  noteTypes,
  noteFlags,
  drumTypes,
} from '@eliwhite/scan-chart';
import {TooltipProvider} from '@/components/ui/tooltip';
import type {ChartDocument} from '@/lib/chart-edit';
import {
  writeChartFolder,
  addDrumNote,
  addNote,
  guitarSchema,
} from '@/lib/chart-edit';
import {emptyTrackData} from '@/lib/chart-edit/__tests__/test-utils';
import {makeGenerateDifficultiesTask} from '@/lib/assist/tasks/generate-difficulties';
import type {
  DifficultyWorkerMessage,
  DifficultyWorkerRequest,
} from '@/lib/assist/difficulty-protocol';
import DifficultyGenerationFlow from '../DifficultyGenerationFlow';

// ResizeObserver: jsdom has none; the sidebar's Stems mixer (Radix Slider)
// needs one on every mount, same as track-edit-page-visibility-seeding.test.tsx.
class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as {ResizeObserver: unknown}).ResizeObserver =
  FakeResizeObserver;

// Heavy/canvas children — same stubs chart-editor-layout.test.tsx uses.
const mockRouterPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({push: mockRouterPush}),
}));

const createdProjects: {origin: string; chartDoc: unknown}[] = [];
/** Set to make the next project write fail, for the save-failure path. */
let nextSaveError: Error | null = null;
jest.mock('../../../lib/project-storage/createProjectFromDoc', () => ({
  createProjectFromDoc: jest.fn(async (opts: never) => {
    if (nextSaveError) {
      const err = nextSaveError;
      nextSaveError = null;
      throw err;
    }
    createdProjects.push(opts);
    return `project-${createdProjects.length}`;
  }),
}));

jest.mock('../../chart-editor/HighwayEditor', () => ({
  __esModule: true,
  default: () => <div data-testid="highway-editor-stub" />,
}));
jest.mock('../../chart-editor/piano-roll/PianoRollTimeline', () => ({
  __esModule: true,
  default: () => <div data-testid="piano-roll-stub" />,
}));
jest.mock('../../chart-editor/TransportControls', () => ({
  __esModule: true,
  default: () => <div data-testid="transport-controls-stub" />,
}));

// Audio boundary — no real Web Audio in jsdom. Every constructed manager is
// recorded so the tests can assert what the flow handed it.
const audioManagers: {
  stems: string[];
  setChartDelay: jest.Mock;
  destroy: jest.Mock;
}[] = [];
jest.mock('../../../lib/preview/audioManager', () => ({
  AudioManager: jest.fn().mockImplementation(function (
    this: any,
    audioFiles: {fileName: string}[],
  ) {
    this.ready = Promise.resolve();
    this.trackNames = audioFiles.map(f => f.fileName);
    this.setChartDelay = jest.fn();
    this.setVolume = jest.fn();
    this.setLoopRegion = jest.fn();
    this.destroy = jest.fn();
    audioManagers.push(this);
    this.stems = this.trackNames;
  }),
}));
jest.mock('../../../lib/preview/clickTrack', () => ({
  CLICK_TRACK_NAME: 'click',
  generateBeatClickTrackSamples: jest.fn(async () => ({
    samples: new Float32Array(1),
    sampleRate: 8000,
  })),
}));

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

// `ChartDropZone` — swapped for a button that fires `onLoaded` with
// whatever `nextLoaded` currently points to, so each test controls the
// dropped chart without driving the real file/folder pickers.
let nextLoaded: {files: {fileName: string; data: Uint8Array}[]} | null = null;
jest.mock('../../chart-picker/ChartDropZone', () => ({
  __esModule: true,
  default: ({onLoaded, disabled}: any) => (
    <button
      disabled={disabled}
      onClick={() =>
        onLoaded({
          files: nextLoaded!.files,
          sourceFormat: 'chart',
          originalName: 'Test Song',
        })
      }>
      drop chart
    </button>
  ),
}));

class FakeWorker {
  onmessage: ((e: {data: DifficultyWorkerMessage}) => void) | null = null;
  onerror: ((e: {message?: string}) => void) | null = null;
  posted: DifficultyWorkerRequest[] = [];
  terminated = false;
  postMessage(msg: DifficultyWorkerRequest) {
    this.posted.push(msg);
  }
  terminate() {
    this.terminated = true;
  }
  emit(msg: DifficultyWorkerMessage) {
    this.onmessage?.({data: msg});
  }
}

let fakeWorker: FakeWorker | null = null;
/** How many model runs the flow has started, so a retry can prove it did
 *  not repeat the generation. */
let workersSpawned = 0;
function spawnedWorkerCount() {
  return workersSpawned;
}
function scriptedTask() {
  return makeGenerateDifficultiesTask({
    createWorker: () => {
      fakeWorker = new FakeWorker();
      workersSpawned += 1;
      return fakeWorker as unknown as Worker;
    },
  });
}

function chartTextFor(doc: ChartDocument): string {
  doc.parsedChart.format = 'chart';
  const files = writeChartFolder(doc);
  const notesFile = files.find(f => f.fileName === 'notes.chart');
  if (!notesFile) {
    throw new Error('writeChartFolder did not produce notes.chart');
  }
  return new TextDecoder().decode(notesFile.data);
}

function loadedFilesFor(doc: ChartDocument) {
  return {
    files: [
      {
        fileName: 'notes.chart',
        data: new TextEncoder().encode(chartTextFor(doc)),
      },
      {fileName: 'song.ogg', data: new Uint8Array([1, 2, 3])},
    ],
  };
}

/** A pro-drums chart with a charted Expert track (a cymbal-flagged note, so
 *  it round-trips as fourLanePro and passes the pro-drums check
 *  `buildDifficultyGenerationInput` runs). `drumType` is set explicitly
 *  before serializing: the .chart writer only emits a note's cymbal-marker
 *  event when the doc already says it's a pro-drums chart (it doesn't infer
 *  that from the flag alone), and it's that written marker event —  not the
 *  in-memory flag — that `readChart` re-detects `drumType` from. */
function drumsChartDoc(): ChartDocument {
  const parsed = createEmptyChart({bpm: 120, resolution: 480});
  parsed.drumType = drumTypes.fourLanePro;
  parsed.trackData.push(emptyTrackData('drums', 'expert'));
  const doc: ChartDocument = {parsedChart: parsed, assets: []};
  addDrumNote(doc.parsedChart.trackData[0], {tick: 0, type: noteTypes.kick});
  addDrumNote(doc.parsedChart.trackData[0], {
    tick: 480,
    type: noteTypes.yellowDrum,
    flags: noteFlags.cymbal,
  });
  return doc;
}

/** A plain four-lane drums chart: tom notes only, no cymbal markers, and no
 *  song.ini to declare `pro_drums`. Nothing in the file says pro-drums, so
 *  it is only reducible (and only round-trips cymbal edits in the editor it
 *  lands in) because the editor's parse reads it as pro-drums. */
function basicFourLaneDrumsChartDoc(): ChartDocument {
  const parsed = createEmptyChart({bpm: 120, resolution: 480});
  parsed.drumType = drumTypes.fourLane;
  parsed.trackData.push(emptyTrackData('drums', 'expert'));
  const doc: ChartDocument = {parsedChart: parsed, assets: []};
  addDrumNote(doc.parsedChart.trackData[0], {tick: 0, type: noteTypes.kick});
  addDrumNote(doc.parsedChart.trackData[0], {
    tick: 480,
    type: noteTypes.yellowDrum,
  });
  return doc;
}

/** A chart with a charted Expert guitar track. */
function guitarChartDoc(): ChartDocument {
  const parsed = createEmptyChart({bpm: 120, resolution: 480});
  parsed.trackData.push(emptyTrackData('guitar', 'expert'));
  const doc: ChartDocument = {parsedChart: parsed, assets: []};
  addNote(
    doc.parsedChart.trackData[0],
    {tick: 0, type: noteTypes.green},
    guitarSchema,
  );
  addNote(
    doc.parsedChart.trackData[0],
    {tick: 480, type: noteTypes.red},
    guitarSchema,
  );
  return doc;
}

/** A chart with no drums track and no guitar track. */
function emptyChartDoc(): ChartDocument {
  const parsed = createEmptyChart({bpm: 120, resolution: 480});
  return {parsedChart: parsed, assets: []};
}

function drumTiers() {
  return {kind: 'drums' as const, hard: [], medium: [], easy: []};
}

function guitarTiers() {
  return {
    kind: 'guitar' as const,
    hard: emptyTrackData('guitar', 'hard'),
    medium: emptyTrackData('guitar', 'medium'),
    easy: emptyTrackData('guitar', 'easy'),
  };
}

beforeEach(() => {
  nextLoaded = null;
  fakeWorker = null;
  workersSpawned = 0;
  audioManagers.length = 0;
  createdProjects.length = 0;
  nextSaveError = null;
  mockRouterPush.mockClear();
});

function renderFlow(
  instrument: 'drums' | 'guitar',
  pageTitle = 'Difficulty Generation',
) {
  return render(
    <TooltipProvider>
      <DifficultyGenerationFlow
        instrument={instrument}
        pageTitle={pageTitle}
        pageDescription="desc"
        dropZoneId="test-picker"
        task={scriptedTask()}
      />
    </TooltipProvider>,
  );
}

describe('DifficultyGenerationFlow', () => {
  it('shows a clear error and stays on the picker when the chart has no Expert Drums', () => {
    nextLoaded = loadedFilesFor(emptyChartDoc());
    renderFlow('drums');

    fireEvent.click(screen.getByRole('button', {name: 'drop chart'}));

    expect(
      screen.getByText('This chart has no Expert Drums to generate from.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'drop chart'})).toBeEnabled();
  });

  it('shows a clear error and stays on the picker when the chart has no Expert Guitar', () => {
    nextLoaded = loadedFilesFor(emptyChartDoc());
    renderFlow('guitar');

    fireEvent.click(screen.getByRole('button', {name: 'drop chart'}));

    expect(
      screen.getByText('This chart has no Expert Guitar to generate from.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'drop chart'})).toBeEnabled();
  });

  it('saves the generated tiers as a project and opens it in /chart-editor', async () => {
    nextLoaded = loadedFilesFor(drumsChartDoc());
    renderFlow('drums');

    fireEvent.click(screen.getByRole('button', {name: 'drop chart'}));

    await waitFor(() =>
      expect(
        screen.getByText('Generating Drums Hard, Medium, Easy'),
      ).toBeInTheDocument(),
    );
    await waitFor(() => expect(fakeWorker).not.toBeNull());

    fakeWorker!.emit({type: 'result', tiers: drumTiers()});

    await waitFor(() => expect(mockRouterPush).toHaveBeenCalled());
    expect(mockRouterPush).toHaveBeenCalledWith(
      '/chart-editor?project=project-1',
    );
    expect(createdProjects).toHaveLength(1);
    expect(createdProjects[0]).toMatchObject({origin: 'drum-difficulties'});
  });

  it('hands over a document that already carries the generated tiers', async () => {
    nextLoaded = loadedFilesFor(drumsChartDoc());
    renderFlow('drums');

    fireEvent.click(screen.getByRole('button', {name: 'drop chart'}));
    await waitFor(() => expect(fakeWorker).not.toBeNull());
    fakeWorker!.emit({type: 'result', tiers: drumTiers()});

    await waitFor(() => expect(createdProjects).toHaveLength(1));
    const handedOver = createdProjects[0] as {
      chartDoc: {parsedChart: {trackData: {difficulty: string}[]}};
    };
    const difficulties = handedOver.chartDoc.parsedChart.trackData.map(
      t => t.difficulty,
    );
    // The project is created from the generated document, not the dropped
    // one, so the editor opens on all four tiers.
    expect(difficulties).toEqual(
      expect.arrayContaining(['expert', 'hard', 'medium', 'easy']),
    );
  });

  it('accepts a plain four-lane drum chart, which has no pro-drums declaration of its own', async () => {
    nextLoaded = loadedFilesFor(basicFourLaneDrumsChartDoc());
    renderFlow('drums');

    fireEvent.click(screen.getByRole('button', {name: 'drop chart'}));

    expect(screen.queryByText(/Pro Drums chart/i)).not.toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByText('Generating Drums Hard, Medium, Easy'),
      ).toBeInTheDocument(),
    );
  });

  it('records the guitar route as its own origin', async () => {
    nextLoaded = loadedFilesFor(guitarChartDoc());
    renderFlow('guitar');

    fireEvent.click(screen.getByRole('button', {name: 'drop chart'}));

    await waitFor(() => expect(fakeWorker).not.toBeNull());
    fakeWorker!.emit({type: 'result', tiers: guitarTiers()});

    await waitFor(() => expect(createdProjects).toHaveLength(1));
    expect(createdProjects[0]).toMatchObject({origin: 'guitar-difficulties'});
  });

  it("plays the chart's audio in sync: the chart delay is applied and the metronome click stem is registered", async () => {
    const doc = drumsChartDoc();
    // A chart whose audio leads its notes by 1.25s (`[Song] Offset`, in
    // seconds). Playback that ignored it would run the highway against
    // audio shifted by that much.
    doc.parsedChart.metadata.chart_offset = 1.25;
    nextLoaded = loadedFilesFor(doc);
    renderFlow('drums');

    fireEvent.click(screen.getByRole('button', {name: 'drop chart'}));
    await waitFor(() => expect(audioManagers).toHaveLength(1));

    expect(audioManagers[0].setChartDelay).toHaveBeenCalledWith(1.25);
    expect(audioManagers[0].stems).toEqual(['song.ogg', 'click.wav']);
  });

  it('reports a failed run in place on the processing screen, with a way back', async () => {
    nextLoaded = loadedFilesFor(drumsChartDoc());
    renderFlow('drums');

    fireEvent.click(screen.getByRole('button', {name: 'drop chart'}));
    await waitFor(() => expect(fakeWorker).not.toBeNull());

    fakeWorker!.emit({type: 'error', message: 'Reducer exploded'});

    // In place on the processing screen, not bounced to the picker.
    expect(await screen.findByText('Reducer exploded')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', {name: 'drop chart'}),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', {name: /back/i}));

    await waitFor(() =>
      expect(screen.getByRole('button', {name: 'drop chart'})).toBeEnabled(),
    );
    expect(screen.queryByText('Reducer exploded')).not.toBeInTheDocument();
  });

  it('cancel during generation returns to the picker cleanly, with no chart applied', async () => {
    nextLoaded = loadedFilesFor(drumsChartDoc());
    renderFlow('drums');

    fireEvent.click(screen.getByRole('button', {name: 'drop chart'}));
    await waitFor(() => expect(fakeWorker).not.toBeNull());

    fireEvent.click(screen.getByRole('button', {name: /^cancel$/i}));

    await waitFor(() =>
      expect(screen.getByRole('button', {name: 'drop chart'})).toBeEnabled(),
    );
    expect(fakeWorker!.terminated).toBe(true);
    expect(
      screen.queryByRole('button', {name: 'Drums Hard'}),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/generation failed/i)).not.toBeInTheDocument();
  });

  it('keeps the generated tiers when the save fails, and retries the save alone', async () => {
    nextSaveError = new Error('QuotaExceededError');
    nextLoaded = loadedFilesFor(drumsChartDoc());
    renderFlow('drums');

    fireEvent.click(screen.getByRole('button', {name: 'drop chart'}));
    await waitFor(() => expect(fakeWorker).not.toBeNull());
    fakeWorker!.emit({type: 'result', tiers: drumTiers()});

    // Reported as a save failure, not as a generation failure, and the run
    // is not repeated to recover.
    expect(await screen.findByText(/could not be saved/i)).toBeInTheDocument();
    expect(screen.getByText('QuotaExceededError')).toBeInTheDocument();
    expect(mockRouterPush).not.toHaveBeenCalled();
    expect(createdProjects).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', {name: /try again/i}));

    // The retry writes the same generated document; no second worker run.
    await waitFor(() => expect(mockRouterPush).toHaveBeenCalled());
    expect(createdProjects).toHaveLength(1);
    expect(spawnedWorkerCount()).toBe(1);
  });

  it('stops the song before handing off, rather than playing on over the editor', async () => {
    nextLoaded = loadedFilesFor(drumsChartDoc());
    renderFlow('drums');

    fireEvent.click(screen.getByRole('button', {name: 'drop chart'}));
    await waitFor(() => expect(fakeWorker).not.toBeNull());
    expect(audioManagers).toHaveLength(1);
    expect(audioManagers[0].destroy).not.toHaveBeenCalled();

    fakeWorker!.emit({type: 'result', tiers: drumTiers()});

    await waitFor(() => expect(mockRouterPush).toHaveBeenCalled());
    expect(audioManagers[0].destroy).toHaveBeenCalled();
  });

  it('stops the song when the route is left mid-generation', async () => {
    nextLoaded = loadedFilesFor(drumsChartDoc());
    const {unmount} = renderFlow('drums');

    fireEvent.click(screen.getByRole('button', {name: 'drop chart'}));
    await waitFor(() => expect(audioManagers).toHaveLength(1));

    unmount();

    expect(audioManagers[0].destroy).toHaveBeenCalled();
  });
});
