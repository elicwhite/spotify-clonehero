/**
 * @jest-environment jsdom
 */

import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';

import {StoragePanel} from '../storage/StoragePanel';

const getStoragePressure = jest.fn();
const isStoragePersisted = jest.fn();
const getPersistencePermission = jest.fn();
const requestPersistentStorage = jest.fn();
const listStemCacheEntries = jest.fn();
const pruneStemCache = jest.fn();
const deleteStemEntry = jest.fn();
const getCachedModelBytes = jest.fn();
const deleteCachedModels = jest.fn();
const measureProjectStorage = jest.fn();
const deleteStoredProject = jest.fn();
const chartExportDialog = jest.fn();
const attachStorageContext = jest.fn();

jest.mock('../../lib/browser-storage', () => ({
  getStoragePressure: () => getStoragePressure(),
  isStoragePersisted: () => isStoragePersisted(),
  getPersistencePermission: () => getPersistencePermission(),
  requestPersistentStorage: () => requestPersistentStorage(),
}));

jest.mock('../../lib/audio-pipeline/stem-cache', () => ({
  listStemCacheEntries: () => listStemCacheEntries(),
  pruneStemCache: (options: unknown) => pruneStemCache(options),
  deleteStemEntry: (fingerprint: string) => deleteStemEntry(fingerprint),
}));

jest.mock('../../lib/lyrics-align/model-cache', () => ({
  getCachedModelBytes: () => getCachedModelBytes(),
  deleteCachedModels: () => deleteCachedModels(),
}));

jest.mock('../../lib/project-storage/storedProjects', () => ({
  measureProjectStorage: () => measureProjectStorage(),
  deleteStoredProject: (namespace: string, id: string) =>
    deleteStoredProject(namespace, id),
}));

// The real one pulls the chart parser and the packager in behind it, which is
// the reason it is loaded only when a chart is chosen.
jest.mock('../../app/storage/ChartExportDialog', () => ({
  ChartExportDialog: (props: {
    project: {name: string};
    onReady: () => void;
  }) => {
    chartExportDialog(props.project);
    return (
      <div data-testid="export-dialog">
        {props.project.name}
        <button onClick={props.onReady}>ready</button>
      </div>
    );
  },
}));

jest.mock('../../lib/sentry/storage-context', () => ({
  attachStorageContext: () => attachStorageContext(),
}));

const MB = 1024 * 1024;

const CHART = {
  id: 'a',
  namespace: 'chart-editor',
  name: 'Song One',
  artist: 'Band',
  sizeBytes: 40 * MB,
  updatedAt: '2026-01-02T03:04:05.000Z',
  stemFingerprint: 'fp-1',
  isProject: true,
};

const click = async (element: HTMLElement) => {
  await act(async () => {
    fireEvent.click(element);
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  // A coherent origin: 60 of work, 200 of stems, 336 of models, and 104 the
  // page cannot name, adding to the 700 reported.
  getStoragePressure.mockResolvedValue({
    usageBytes: 700 * MB,
    quotaBytes: 1000 * MB,
    ratio: 0.7,
  });
  isStoragePersisted.mockResolvedValue(true);
  getPersistencePermission.mockResolvedValue('granted');
  listStemCacheEntries.mockResolvedValue([
    {fingerprint: 'fp-1', sizeBytes: 150 * MB, lastUsedMs: 2},
    {fingerprint: 'fp-orphan', sizeBytes: 50 * MB, lastUsedMs: 1},
  ]);
  getCachedModelBytes.mockResolvedValue(336 * MB);
  measureProjectStorage.mockResolvedValue({
    projects: [CHART],
    databaseBytes: 20 * MB,
    bytes: 60 * MB,
  });
  pruneStemCache.mockResolvedValue({
    deletedFingerprints: ['fp-1', 'fp-orphan'],
    freedBytes: 200 * MB,
    remainingBytes: 0,
  });
  deleteStoredProject.mockResolvedValue(true);
  deleteStemEntry.mockResolvedValue(true);
  deleteCachedModels.mockResolvedValue(336 * MB);
});

/** Clicks through the delete confirmation the page owns. */
const confirmDelete = async () => {
  await click(await screen.findByRole('button', {name: 'Delete'}));
  await click(await screen.findByRole('button', {name: 'Delete it'}));
};

describe('StoragePanel', () => {
  it('shows the total as the sum of its named parts', async () => {
    render(<StoragePanel />);

    // The bar's legend is the hierarchy: one total, and what is inside it.
    // The group headings repeat two of these figures, which is the point.
    await screen.findAllByText('60 MB');
    expect(screen.getAllByText('200 MB').length).toBeGreaterThan(0);
    expect(screen.getAllByText('336 MB').length).toBeGreaterThan(0);
    expect(screen.getByText('104 MB')).toBeVisible();
    expect(
      screen.getByText('700 MB stored, of about 1000 MB this browser allows.'),
    ).toBeVisible();
  });

  it('never draws a negative remainder', async () => {
    // The walks and the estimate are taken at slightly different moments, and
    // the estimate rounds. Neither is a reason to show a number below zero.
    getStoragePressure.mockResolvedValue({
      usageBytes: 1 * MB,
      quotaBytes: 1000 * MB,
      ratio: 0.001,
    });

    render(<StoragePanel />);

    await screen.findAllByText('Song One');
    expect(screen.getAllByText('0 B').length).toBeGreaterThan(0);
  });

  it('lists each chart with its size and its own actions', async () => {
    render(<StoragePanel />);

    // Twice: the chart's own row, and the stem row that names the chart it
    // belongs to.
    expect(await screen.findAllByText('Song One')).toHaveLength(2);
    expect(screen.getByText('40 MB')).toBeVisible();
    expect(screen.getByRole('button', {name: 'Download'})).toBeVisible();
    expect(screen.getByRole('button', {name: 'Delete'})).toBeVisible();
  });

  it('names the chart a cached stem belongs to', async () => {
    render(<StoragePanel />);

    await screen.findAllByText('Song One');
    // The stem row carries the chart's name, so a user can tell which song
    // they are freeing. An entry no chart claims says so.
    expect(screen.getByText('Separated drums and vocals')).toBeVisible();
    expect(
      screen.getByText('Not linked to a chart you still have'),
    ).toBeVisible();
  });

  it('opens the editor export dialog for one chart', async () => {
    // The same dialog the editor uses, so a copy taken here is the same
    // package as a copy taken there — one export path, not two that drift.
    render(<StoragePanel />);
    expect(screen.queryByTestId('export-dialog')).toBeNull();

    await click(await screen.findByRole('button', {name: 'Download'}));

    expect(chartExportDialog).toHaveBeenCalledWith(CHART);
    expect(screen.getByTestId('export-dialog')).toHaveTextContent('Song One');
  });

  it('says the download is opening while its chunk loads', async () => {
    // The chunk carries the chart parser and the packager, so on a cold click
    // there are seconds between the button and the dialog. A button that
    // looks unchanged for that long reads as one that did nothing.
    render(<StoragePanel />);

    await click(await screen.findByRole('button', {name: 'Download'}));

    const opening = screen.getByRole('button', {name: 'Opening…'});
    expect(opening).toBeDisabled();

    await click(screen.getByRole('button', {name: 'ready'}));
    expect(screen.getByRole('button', {name: 'Download'})).toBeEnabled();
  });

  it('does not offer a download for a directory that is not a chart', async () => {
    // Nothing to export: no metadata means no chart the packager could read.
    measureProjectStorage.mockResolvedValue({
      projects: [{...CHART, isProject: false, name: 'half-made'}],
      databaseBytes: 0,
      bytes: 40 * MB,
    });

    render(<StoragePanel />);

    expect(
      await screen.findByRole('button', {name: 'Download'}),
    ).toBeDisabled();
  });

  it('asks before deleting a chart, and does nothing when refused', async () => {
    // The one action here that waiting cannot undo: a chart is not
    // regenerable and there is no server copy.
    render(<StoragePanel />);

    await click(await screen.findByRole('button', {name: 'Delete'}));
    expect(await screen.findByText(/cannot be undone/)).toBeVisible();
    await click(screen.getByRole('button', {name: 'Keep it'}));

    expect(deleteStoredProject).not.toHaveBeenCalled();
  });

  it('deletes a chart once confirmed', async () => {
    render(<StoragePanel />);

    await confirmDelete();

    expect(deleteStoredProject).toHaveBeenCalledWith('chart-editor', 'a');
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Deleted Song One'),
    );
  });

  it('does not report a deletion that did not happen', async () => {
    // These helpers answer false rather than throwing, so a caller that only
    // handled the throw would print a saving the next redraw contradicts.
    deleteStoredProject.mockResolvedValue(false);
    render(<StoragePanel />);

    await confirmDelete();

    expect(screen.getByRole('status')).toHaveTextContent(/Could not delete/);
  });

  it('does not report freed stems that are still there', async () => {
    deleteStemEntry.mockResolvedValue(false);
    render(<StoragePanel />);

    const free = await screen.findAllByRole('button', {name: 'Free'});
    await click(free[0]!);

    expect(screen.getByRole('status')).toHaveTextContent(/in use somewhere/);
  });

  it('reports the bytes the models actually freed', async () => {
    // Not the size the row was showing: the two disagree when a file will
    // not delete, and the row is redrawn from disk a moment later.
    deleteCachedModels.mockResolvedValue(100 * MB);
    render(<StoragePanel />);

    await screen.findByText('Separation models');
    const free = screen.getAllByRole('button', {name: 'Free'});
    await click(free[free.length - 1]!);

    expect(screen.getByRole('status')).toHaveTextContent('Freed 100 MB.');
  });

  it('frees one stem entry without touching the others', async () => {
    render(<StoragePanel />);

    const free = await screen.findAllByRole('button', {name: 'Free'});
    await click(free[0]!);

    expect(deleteStemEntry).toHaveBeenCalledWith('fp-1');
    expect(pruneStemCache).not.toHaveBeenCalled();
  });

  it('frees every stem from the one button', async () => {
    render(<StoragePanel />);

    await click(await screen.findByRole('button', {name: /Free all stems/}));

    expect(pruneStemCache).toHaveBeenCalledWith({targetBytes: 0});
    expect(screen.getByRole('status')).toHaveTextContent('Freed 200 MB.');
  });

  it('says so when another tab holds the prune lock', async () => {
    pruneStemCache.mockResolvedValue(null);
    render(<StoragePanel />);

    await click(await screen.findByRole('button', {name: /Free all stems/}));

    expect(screen.getByRole('status')).toHaveTextContent(/Another tab/);
  });

  it('frees the models, which are the largest single item', async () => {
    render(<StoragePanel />);

    await screen.findByText('Separation models');
    const free = screen.getAllByRole('button', {name: 'Free'});
    await click(free[free.length - 1]!);

    expect(deleteCachedModels).toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Freed 336 MB.');
  });

  it('re-enables the buttons when an action fails', async () => {
    deleteStoredProject.mockRejectedValue(new Error('refused'));
    render(<StoragePanel />);

    await confirmDelete();

    // Without a finally, one throw leaves a user staring at dimmed buttons on
    // the page whose job is to give them an action.
    expect(screen.getByRole('button', {name: 'Delete'})).toBeEnabled();
    expect(screen.getByRole('status')).toHaveTextContent(/did not work/);
  });

  it.each(['granted', 'prompt', 'unknown'] as const)(
    'offers the ask when the charts are not kept and the permission is %s',
    async permission => {
      // Granted-but-not-taken is reachable: the site collects persistence on
      // load, and the panel can read the old answer while that is in flight.
      isStoragePersisted.mockResolvedValue(false);
      getPersistencePermission.mockResolvedValue(permission);

      render(<StoragePanel />);

      expect(
        await screen.findByRole('button', {name: /keep my charts/}),
      ).toBeVisible();
    },
  );

  it('explains a refusal instead of offering a button that cannot work', async () => {
    isStoragePersisted.mockResolvedValue(false);
    getPersistencePermission.mockResolvedValue('denied');

    render(<StoragePanel />);

    expect(await screen.findByText(/site settings/)).toBeVisible();
    expect(screen.queryByRole('button', {name: /keep my charts/})).toBeNull();
  });

  it('says whether the charts are promised, in the group that holds them', async () => {
    isStoragePersisted.mockResolvedValue(false);
    render(<StoragePanel />);

    // Persistence covers the charts. The stems and models are in the group
    // the browser is meant to take first, so a bare "kept" over everything
    // would promise what it cannot.
    expect(await screen.findByText(/may delete them/)).toBeVisible();
  });

  it('still renders when the cache cannot be read', async () => {
    // Firefox private browsing has no OPFS at all.
    listStemCacheEntries.mockRejectedValue(new Error('no OPFS'));

    render(<StoragePanel />);

    // The charts still list, and the models still report, from one failed
    // reading among six.
    expect(await screen.findAllByText('Song One')).toHaveLength(1);
    expect(screen.getByText('Separation models')).toBeVisible();
  });

  it('warns when the browser is nearly full', async () => {
    // The share the cache pruner treats as pressure. A sliver of colour in a
    // bar is not something a user can act on; a sentence is.
    render(<StoragePanel />);

    expect(await screen.findByText(/nearly full/)).toBeVisible();
  });

  it('does not warn when there is room', async () => {
    getStoragePressure.mockResolvedValue({
      usageBytes: 100 * MB,
      quotaBytes: 1000 * MB,
      ratio: 0.1,
    });

    render(<StoragePanel />);

    await screen.findAllByText('Song One');
    expect(screen.queryByText(/nearly full/)).toBeNull();
  });

  it('says so when the browser reports no estimate', async () => {
    getStoragePressure.mockResolvedValue(null);

    render(<StoragePanel />);

    expect(
      await screen.findByText(/does not say how much it allows/),
    ).toBeVisible();
  });
});
