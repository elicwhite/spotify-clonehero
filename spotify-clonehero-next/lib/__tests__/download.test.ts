/**
 * @jest-environment jsdom
 */
import {
  describe,
  test,
  expect,
  jest,
  beforeEach,
  afterEach,
} from '@jest/globals';
import {downloadBlob} from '../download';

describe('downloadBlob', () => {
  // jsdom doesn't implement URL.createObjectURL / revokeObjectURL.
  const createObjectURL = jest.fn(() => 'blob:mock-url');
  const revokeObjectURL = jest.fn();
  let clickSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
    URL.createObjectURL =
      createObjectURL as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL =
      revokeObjectURL as unknown as typeof URL.revokeObjectURL;
    clickSpy = jest
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});
  });

  afterEach(() => {
    clickSpy.mockRestore();
  });

  test('creates a URL from the blob, clicks once, and revokes it', () => {
    const blob = new Blob(['hello'], {type: 'text/plain'});
    downloadBlob(blob, 'file.txt');

    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });

  test('sets the download name and href on the anchor and cleans it up', () => {
    let captured: HTMLAnchorElement | undefined;
    clickSpy.mockImplementation(function (this: HTMLAnchorElement) {
      captured = this;
      // The anchor must be in the document when clicked (Firefox requirement).
      expect(document.body.contains(this)).toBe(true);
    });

    downloadBlob(new Blob(['x']), 'song.sng');

    expect(captured?.download).toBe('song.sng');
    expect(captured?.getAttribute('href')).toBe('blob:mock-url');
    // The temporary anchor is removed after the download.
    expect(document.querySelector('a[download="song.sng"]')).toBeNull();
  });
});
