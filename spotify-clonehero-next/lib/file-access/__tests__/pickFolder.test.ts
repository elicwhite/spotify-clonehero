/** @jest-environment jsdom */

import {chooseFiles} from '../fileInput';
import {pickFolder} from '../pickFolder';

function lastInput() {
  const inputs = document.querySelectorAll('input[type="file"]');
  return inputs[inputs.length - 1] as HTMLInputElement;
}

function selectFiles(input: HTMLInputElement, files: File[]) {
  Object.defineProperty(input, 'files', {configurable: true, value: files});
  input.dispatchEvent(new Event('change'));
}

function inFolder(path: string) {
  const file = new File([''], path.split('/').pop()!);
  Object.defineProperty(file, 'webkitRelativePath', {value: path});
  return file;
}

describe('chooseFiles', () => {
  let click: jest.SpyInstance;
  beforeEach(() => {
    click = jest
      .spyOn(HTMLInputElement.prototype, 'click')
      .mockImplementation(() => {});
  });
  afterEach(() => click.mockRestore());

  it('opens the dialog before it returns, inside the user gesture', () => {
    void chooseFiles({directory: true, accept: ['.sng']});

    expect(click).toHaveBeenCalledTimes(1);
    const input = lastInput();
    expect(input.webkitdirectory).toBe(true);
    expect(input.accept).toBe('.sng');
  });

  it('resolves with the picked files and removes its input', async () => {
    const picked = chooseFiles({multiple: true});
    const input = lastInput();
    const file = new File(['x'], 'a.sng');
    selectFiles(input, [file]);

    await expect(picked).resolves.toEqual([file]);
    expect(input.isConnected).toBe(false);
  });

  it('resolves with null when the user cancels', async () => {
    const picked = chooseFiles({});
    lastInput().dispatchEvent(new Event('cancel'));

    await expect(picked).resolves.toBeNull();
  });
});

describe('pickFolder', () => {
  beforeEach(() => {
    jest
      .spyOn(HTMLInputElement.prototype, 'click')
      .mockImplementation(() => {});
  });
  afterEach(() => {
    jest.restoreAllMocks();
    Reflect.deleteProperty(window, 'showDirectoryPicker');
  });

  it('reads a folder through a file input where there is no picker', async () => {
    const picked = pickFolder({id: 'test'});
    selectFiles(lastInput(), [inFolder('History/Streaming.json')]);

    const folder = await picked;
    expect(folder?.name).toBe('History');
    expect(folder?.handle).toBeNull();
    const {files} = await folder!.list();
    expect(files.map(file => file.name)).toEqual(['Streaming.json']);
  });

  it('uses the picker where there is one, and keeps its handle', async () => {
    const handle = {
      name: 'History',
      entries: async function* () {},
    } as unknown as FileSystemDirectoryHandle;
    const picker = jest.fn(async () => handle);
    window.showDirectoryPicker = picker as typeof window.showDirectoryPicker;

    const folder = await pickFolder({id: 'spotify-dump'});

    expect(picker).toHaveBeenCalledWith({id: 'spotify-dump'});
    expect(folder?.handle).toBe(handle);
  });

  it('resolves with null when the picker is cancelled', async () => {
    window.showDirectoryPicker = jest.fn(async () => {
      throw new DOMException('The user aborted a request.', 'AbortError');
    }) as typeof window.showDirectoryPicker;

    await expect(pickFolder({id: 'test'})).resolves.toBeNull();
  });
});
