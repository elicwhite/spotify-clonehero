/**
 * @jest-environment jsdom
 */

import '@testing-library/jest-dom';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import ChartDropZone from '../ChartDropZone';
import {SELECT_SONG_FOLDER_MESSAGE} from '@/lib/chart-files/chart-package';

jest.mock('sonner', () => ({toast: {error: jest.fn(), success: jest.fn()}}));
const {toast} = jest.requireMock('sonner');

function directoryFile(relativePath: string, contents = 'x'): File {
  const file = new File([contents], relativePath.split('/').pop()!);
  Object.defineProperty(file, 'webkitRelativePath', {value: relativePath});
  // jsdom's File has no arrayBuffer().
  Object.defineProperty(file, 'arrayBuffer', {
    value: async () => new TextEncoder().encode(contents).buffer,
  });
  return file;
}

function folderInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>(
    'input[webkitdirectory]',
  );
  if (!input) throw new Error('No directory input rendered');
  return input;
}

function selectFiles(input: HTMLInputElement, files: File[]) {
  fireEvent.change(input, {target: {files}});
}

function folderButton() {
  return screen.getByRole('button', {name: /select a chart folder/i});
}

/** Installs a showDirectoryPicker that resolves to nothing useful — enough to
 *  tell which path ran without standing up a FileSystemDirectoryHandle. */
function stubDirectoryPicker() {
  const showDirectoryPicker = jest
    .fn()
    .mockRejectedValue(
      Object.assign(new DOMException('cancelled', 'AbortError')),
    );
  Object.defineProperty(window, 'showDirectoryPicker', {
    value: showDirectoryPicker,
    configurable: true,
  });
  return showDirectoryPicker;
}

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(() => {
  // @ts-expect-error — removing the optional picker between tests
  delete window.showDirectoryPicker;
});

describe('ChartDropZone folder picking', () => {
  it('uses showDirectoryPicker where it exists', async () => {
    const showDirectoryPicker = stubDirectoryPicker();
    render(<ChartDropZone onLoaded={jest.fn()} id="test-picker" />);

    const clicked = jest.fn();
    folderInput().addEventListener('click', clicked);
    fireEvent.click(folderButton());

    await waitFor(() =>
      expect(showDirectoryPicker).toHaveBeenCalledWith({id: 'test-picker'}),
    );
    // The fallback is for browsers without the API, and must stay out of the
    // way of the ones that have it — two dialogs would open otherwise.
    expect(clicked).not.toHaveBeenCalled();
  });

  it('falls back to a directory input where it does not', () => {
    render(<ChartDropZone onLoaded={jest.fn()} id="test-picker" />);

    const clicked = jest.fn();
    folderInput().addEventListener('click', clicked);
    fireEvent.click(folderButton());

    expect(clicked).toHaveBeenCalled();
  });

  it('loads the chart a directory input selection points at', async () => {
    const onLoaded = jest.fn();
    render(<ChartDropZone onLoaded={onLoaded} id="test-picker" />);

    selectFiles(folderInput(), [
      directoryFile('Song Name/notes.chart', '[Song]'),
      directoryFile('Song Name/song.ogg'),
    ]);

    await waitFor(() => expect(onLoaded).toHaveBeenCalled());
    const loaded = onLoaded.mock.calls[0][0];
    expect(loaded.sourceFormat).toBe('folder');
    expect(loaded.originalName).toBe('Song Name');
    expect(loaded.files.map((f: {fileName: string}) => f.fileName)).toEqual([
      'notes.chart',
      'song.ogg',
    ]);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('reports what was wrong with the folder, and recovers', async () => {
    const onLoaded = jest.fn();
    render(<ChartDropZone onLoaded={onLoaded} id="test-picker" />);

    selectFiles(folderInput(), [
      directoryFile('Charts/Song One/notes.chart'),
      directoryFile('Charts/Song Two/notes.chart'),
    ]);

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(SELECT_SONG_FOLDER_MESSAGE),
    );
    expect(onLoaded).not.toHaveBeenCalled();
    // The zone has to come back out of its loading state, or the failed pick
    // is the last pick the user gets to make.
    await waitFor(() => expect(folderButton()).toBeEnabled());
    expect(screen.queryByText(/reading files/i)).not.toBeInTheDocument();
  });

  it('stays put when the directory input is cancelled', async () => {
    const onLoaded = jest.fn();
    render(<ChartDropZone onLoaded={onLoaded} id="test-picker" />);

    selectFiles(folderInput(), []);

    await waitFor(() =>
      expect(screen.queryByText(/reading files/i)).not.toBeInTheDocument(),
    );
    expect(onLoaded).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('stays put when the directory picker is cancelled', async () => {
    const showDirectoryPicker = stubDirectoryPicker();
    const onLoaded = jest.fn();
    render(<ChartDropZone onLoaded={onLoaded} id="test-picker" />);

    fireEvent.click(folderButton());

    await waitFor(() => expect(showDirectoryPicker).toHaveBeenCalled());
    expect(onLoaded).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('reports a directory picker that fails for any other reason', async () => {
    const showDirectoryPicker = stubDirectoryPicker();
    showDirectoryPicker.mockRejectedValue(
      new DOMException('Must be handling a user gesture', 'SecurityError'),
    );
    render(<ChartDropZone onLoaded={jest.fn()} id="test-picker" />);

    fireEvent.click(folderButton());

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'Must be handling a user gesture',
      ),
    );
  });
});
