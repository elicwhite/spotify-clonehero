'use client';

const DIRECTORY_PICKER_SUPPROTED =
  typeof window !== 'undefined' &&
  typeof window.showDirectoryPicker === 'function';

const NOT_SUPPORTED = !DIRECTORY_PICKER_SUPPROTED;

export default function SupportedBrowserWarning({
  children,
}: {
  children?: React.ReactNode;
}) {
  if (NOT_SUPPORTED) {
    return (
      <p className="text-lg text-red-700 mt-2">
        Warning: These tools will not work on your browser. It requires some
        APIs that currently only exist in Chrome based browsers.
      </p>
    );
  }

  return children ?? null;
}
