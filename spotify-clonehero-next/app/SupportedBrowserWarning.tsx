'use client';

const DIRECTORY_PICKER_SUPPROTED =
  typeof window !== 'undefined' &&
  typeof window.showDirectoryPicker === 'function';

const SELF_REMOVE_SUPPORTED =
  // @ts-expect-error This doesn't exist in the type, but it is in Chrome
  typeof FileSystemHandle.prototype.remove == 'function';

const NOT_SUPPORTED = !DIRECTORY_PICKER_SUPPROTED || !SELF_REMOVE_SUPPORTED;

export default function SupportedBrowserWarning() {
  if (NOT_SUPPORTED) {
    return (
      <p className="my-4 text-red-700">
        Note: These tools will not work on your browser. It requires some APIs
        that currently only exist in Chrome based browsers.
      </p>
    );
  }

  return null;
}
