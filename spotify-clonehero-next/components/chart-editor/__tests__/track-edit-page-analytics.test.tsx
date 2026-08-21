/**
 * @jest-environment jsdom
 */
/**
 * What `/chart-editor`'s three entry paths report (plan 0105 Stage 4).
 *
 * This is the funnel's step 2, and the gap between it and a landing view is
 * the drop-off the whole plan exists to measure — so what has to be pinned
 * is not just that an event fires, but that each path fires EXACTLY ONE of
 * `chart_opened` / `chart_open_failed`. Both halves of that have regressed
 * during this plan's own review: an ordering that reported an open and a
 * failure for a single load, and two paths that reported success but never
 * failure and so had a numerator with no denominator.
 *
 * The load screen is what these drive, so the editor itself never mounts —
 * the drop zones are replaced with buttons, as the difficulty flow's suite
 * does, since their real file pickers need browser APIs jsdom lacks.
 */

import '@testing-library/jest-dom';
import {render, screen, fireEvent, waitFor} from '@testing-library/react';
import {createEmptyChart} from '@eliwhite/scan-chart';
import {TooltipProvider} from '@/components/ui/tooltip';
import type {ChartDocument} from '@/lib/chart-edit';
import {writeChartFolder} from '@/lib/chart-edit';
import {emptyTrackData} from '@/lib/chart-edit/__tests__/test-utils';
import TrackEditPage from '../TrackEditPage';
import {CONFIG as CHART_EDITOR_CONFIG} from '../../../app/chart-editor/ChartEditorClient';

const trackMock = jest.fn();
jest.mock('../../../lib/analytics/track', () => ({
  ...jest.requireActual('../../../lib/analytics/track'),
  track: (payload: unknown) => trackMock(payload),
}));

/** Every reported event of one kind, in order. */
function reported(event: string) {
  return trackMock.mock.calls
    .map(([payload]) => payload as {event: string})
    .filter(e => e.event === event);
}

/** Set to make the next `createProject` fail — a full disk, in practice. */
let nextCreateError: Error | null = null;
/** Set to make the navigation fail after the project was already written. */
let nextPushError: Error | null = null;

const createProject = jest.fn(async (_opts?: unknown) => {
  if (nextCreateError) {
    const err = nextCreateError;
    nextCreateError = null;
    throw err;
  }
  return {id: 'created-1'};
});
jest.mock('../../../lib/project-storage/opfsProjectStore', () => ({
  createOpfsProjectStore: jest.fn(() => ({
    listProjects: jest.fn(async () => []),
    namespaceOf: jest.fn(async () => 'chart-editor'),
    getProject: jest.fn(),
    readChartFile: jest.fn(),
    readSongIni: jest.fn(),
    loadAudioFiles: jest.fn(async () => []),
    writeSongIni: jest.fn(async () => {}),
    writeEditedChart: jest.fn(async () => {}),
    updateProject: jest.fn(async () => ({})),
    readAlbumArt: jest.fn(async () => null),
    writeAlbumArt: jest.fn(async () => {}),
    loadPassthroughAssets: jest.fn(async () => []),
    deleteProject: jest.fn(async () => {}),
    createProject: (opts: unknown) => createProject(opts),
  })),
}));

const createBlankProject = jest.fn(async (_opts?: unknown) => {
  if (nextCreateError) {
    const err = nextCreateError;
    nextCreateError = null;
    throw err;
  }
  return {id: 'blank-1', hasAudio: false};
});
jest.mock('../../../lib/project-storage/projects', () => ({
  ...jest.requireActual('../../../lib/project-storage/projects'),
  createBlankProject: (opts: unknown) => createBlankProject(opts),
  listProjects: jest.fn(async () => []),
  deleteProjectRecord: jest.fn(async () => {}),
}));
jest.mock('../../../lib/project-storage/attachAudio', () => ({
  attachAudioToProject: jest.fn(async () => {}),
}));

const push = jest.fn(() => {
  if (nextPushError) {
    const err = nextPushError;
    nextPushError = null;
    throw err;
  }
});
/** The editor's query string. `?from=` is what a redirecting landing page
 *  will use to say which tool sent the user. */
let searchParams = new URLSearchParams();
jest.mock('next/navigation', () => ({
  useSearchParams: () => searchParams,
  useRouter: () => ({push, replace: jest.fn()}),
}));

/** The chart a "Load a Chart" drop hands over. Replaced per test. */
let nextLoaded: {fileName: string; data: Uint8Array}[] = [];
jest.mock('../../chart-picker/ChartDropZone', () => ({
  __esModule: true,
  default: ({onLoaded, disabled}: any) => (
    <button
      disabled={disabled}
      onClick={() =>
        onLoaded({
          files: nextLoaded,
          sourceFormat: 'folder',
          originalName: 'Test Song',
        })
      }>
      drop chart
    </button>
  ),
}));
jest.mock('../../project-list/AudioDropZone', () => ({
  __esModule: true,
  default: ({onDropped, disabled}: any) => (
    <button
      disabled={disabled}
      onClick={() =>
        onDropped({
          fileName: 'song.ogg',
          data: new Uint8Array([1, 2, 3]),
          durationSeconds: 120,
        })
      }>
      drop audio
    </button>
  ),
}));
jest.mock('../../project-list/ProjectList', () => ({
  __esModule: true,
  default: () => <div />,
}));

/** A chart with an Expert Drums track and an audio file — one the editor
 *  accepts, so the success path is reachable. */
function playableChartFiles() {
  const parsed = createEmptyChart({bpm: 120, resolution: 480});
  parsed.trackData.push(emptyTrackData('drums', 'expert'));
  const doc: ChartDocument = {parsedChart: parsed, assets: []};
  doc.parsedChart.format = 'chart';
  const files = writeChartFolder(doc);
  const notes = files.find(f => f.fileName === 'notes.chart')!;
  return [notes, {fileName: 'song.ogg', data: new Uint8Array([1, 2, 3])}];
}

/** The same chart with its audio removed: accepted as a chart, refused for
 *  having nothing to play against. */
function chartFilesWithoutAudio() {
  return playableChartFiles().filter(f => f.fileName !== 'song.ogg');
}

function renderPage() {
  return render(
    <TooltipProvider>
      <TrackEditPage {...CHART_EDITOR_CONFIG} />
    </TooltipProvider>,
  );
}

beforeEach(() => {
  trackMock.mockClear();
  createProject.mockClear();
  createBlankProject.mockClear();
  push.mockClear();
  nextCreateError = null;
  nextPushError = null;
  nextLoaded = playableChartFiles();
  searchParams = new URLSearchParams();
});

describe('loading a chart somebody already wrote', () => {
  it('reports exactly one opened chart, with the format it arrived in', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', {name: 'drop chart'}));

    await waitFor(() => expect(reported('chart_opened')).toHaveLength(1));
    expect(reported('chart_opened')[0]).toEqual({
      event: 'chart_opened',
      origin: 'chart-editor',
      sourceFormat: 'folder',
    });
    expect(reported('chart_open_failed')).toHaveLength(0);
  });

  it('reports a chart with no audio as refused, and not as opened', async () => {
    nextLoaded = chartFilesWithoutAudio();
    renderPage();
    fireEvent.click(await screen.findByRole('button', {name: 'drop chart'}));

    await waitFor(() => expect(reported('chart_open_failed')).toHaveLength(1));
    expect(reported('chart_open_failed')[0]).toMatchObject({
      reason: 'no-audio',
    });
    expect(reported('chart_opened')).toHaveLength(0);
  });

  it('reports a failed project write as storage, not as a bad chart', async () => {
    // The chart was fine; the device was not. Counted among refused charts
    // it would overstate "users arriving with charts we cannot open".
    nextCreateError = new Error('quota exceeded');
    renderPage();
    fireEvent.click(await screen.findByRole('button', {name: 'drop chart'}));

    await waitFor(() => expect(reported('chart_open_failed')).toHaveLength(1));
    expect(reported('chart_open_failed')[0]).toMatchObject({
      reason: 'storage-error',
    });
    expect(reported('chart_opened')).toHaveLength(0);
  });

  it('reports a failed navigation once, as a failure — not as an open too', async () => {
    // `chart_opened` fires last for this reason. Reporting it before the
    // navigation gave one load both an open and a failure, and step 2 would
    // count a user who never arrived.
    nextPushError = new Error('navigation failed');
    renderPage();
    fireEvent.click(await screen.findByRole('button', {name: 'drop chart'}));

    await waitFor(() => expect(reported('chart_open_failed')).toHaveLength(1));
    expect(reported('chart_opened')).toHaveLength(0);
  });
});

describe('a chart that arrived from another tool', () => {
  // The tool routes are becoming landing pages that redirect here BEFORE a
  // project exists. `?from=` is the only thing that then says which tool the
  // chart belongs to, and an origin lost that way is not recoverable by any
  // later analysis — so this has to hold before that change ships.
  it('stamps and reports the tool named by ?from=', async () => {
    searchParams = new URLSearchParams('from=tempo');
    renderPage();
    fireEvent.click(await screen.findByRole('button', {name: 'drop chart'}));

    await waitFor(() => expect(reported('chart_opened')).toHaveLength(1));
    expect(reported('chart_opened')[0]).toMatchObject({origin: 'tempo'});
    expect(createProject).toHaveBeenCalledWith(
      expect.objectContaining({origin: 'tempo'}),
    );
  });

  it('ignores a ?from= that does not name a tool', async () => {
    // The value comes from the URL, so anyone can put anything in it.
    searchParams = new URLSearchParams('from=../../etc/passwd');
    renderPage();
    fireEvent.click(await screen.findByRole('button', {name: 'drop chart'}));

    await waitFor(() => expect(reported('chart_opened')).toHaveLength(1));
    expect(reported('chart_opened')[0]).toMatchObject({
      origin: 'chart-editor',
    });
  });

  it('stamps a chart started from nothing with the tool too', async () => {
    // A redirecting landing page can also send a user who then starts a
    // blank chart; that chart is still that tool's.
    searchParams = new URLSearchParams('from=add-lyrics');
    renderPage();
    fireEvent.click(
      await screen.findByRole('button', {name: /start from scratch/i}),
    );

    await waitFor(() => expect(reported('chart_opened')).toHaveLength(1));
    expect(createBlankProject).toHaveBeenCalledWith(
      expect.objectContaining({origin: 'add-lyrics'}),
    );
  });
});

describe('starting a chart from nothing', () => {
  it('counts a chart started from a song as an entry, not a drop-off', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', {name: 'drop audio'}));

    await waitFor(() => expect(reported('chart_opened')).toHaveLength(1));
    expect(reported('chart_opened')[0]).toMatchObject({sourceFormat: 'audio'});
  });

  it('counts a blank chart as an entry too', async () => {
    renderPage();
    fireEvent.click(
      await screen.findByRole('button', {name: /start from scratch/i}),
    );

    await waitFor(() => expect(reported('chart_opened')).toHaveLength(1));
    expect(reported('chart_opened')[0]).toMatchObject({sourceFormat: 'blank'});
  });

  it('reports a failure to start a chart, so step 2 has a denominator', async () => {
    nextCreateError = new Error('quota exceeded');
    renderPage();
    fireEvent.click(
      await screen.findByRole('button', {name: /start from scratch/i}),
    );

    await waitFor(() => expect(reported('chart_open_failed')).toHaveLength(1));
    expect(reported('chart_open_failed')[0]).toMatchObject({
      reason: 'storage-error',
    });
    expect(reported('chart_opened')).toHaveLength(0);
  });
});
