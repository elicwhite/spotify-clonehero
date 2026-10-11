/** @jest-environment jsdom */

import {pickFiles} from '../pickFiles';

function lastInput() {
  const inputs = document.querySelectorAll('input[type="file"]');
  return inputs[inputs.length - 1] as HTMLInputElement;
}

describe('pickFiles', () => {
  beforeEach(() => {
    jest
      .spyOn(HTMLInputElement.prototype, 'click')
      .mockImplementation(() => {});
  });
  afterEach(() => {
    jest.restoreAllMocks();
    Reflect.deleteProperty(window, 'showOpenFilePicker');
  });

  it('opens a file input where there is no picker, accepting only extensions', async () => {
    const picked = pickFiles({
      id: 'sng-modify',
      types: [
        {
          description: 'SNG package',
          accept: {'application/octet-stream': ['.sng']},
        },
      ],
    });
    const input = lastInput();
    expect(input.accept).toBe('.sng');
    expect(input.multiple).toBe(false);

    const file = new File(['x'], 'song.sng');
    Object.defineProperty(input, 'files', {value: [file]});
    input.dispatchEvent(new Event('change'));

    await expect(picked).resolves.toEqual([file]);
  });

  it('resolves with null when the file input is cancelled', async () => {
    const picked = pickFiles({id: 'sng-add-files', multiple: true});
    expect(lastInput().multiple).toBe(true);
    lastInput().dispatchEvent(new Event('cancel'));

    await expect(picked).resolves.toBeNull();
  });

  it('uses the picker where there is one', async () => {
    const file = new File(['x'], 'stem.ogg');
    const picker = jest.fn(async () => [
      {getFile: async () => file} as unknown as FileSystemFileHandle,
    ]);
    window.showOpenFilePicker =
      picker as unknown as typeof window.showOpenFilePicker;

    await expect(
      pickFiles({id: 'chart-editor-add-stem', multiple: false}),
    ).resolves.toEqual([file]);
    expect(picker).toHaveBeenCalledWith({
      id: 'chart-editor-add-stem',
      multiple: false,
    });
  });
});
