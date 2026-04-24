'use client';

import {useSyncExternalStore} from 'react';

// showDirectoryPicker support is a static capability for the lifetime
// of the page: it's not going to appear or disappear at runtime, so
// the "subscribe" function is a no-op. Rendering `true` on the server
// avoids the hydration flash of the warning before the first effect
// would otherwise run.
const noopSubscribe = () => () => {};
const getDirectoryPickerSupport = () =>
  typeof window.showDirectoryPicker === 'function';
const getServerSupport = () => true;

export default function SupportedBrowserWarning({
  children,
}: {
  children?: React.ReactNode;
}) {
  const isSupported = useSyncExternalStore(
    noopSubscribe,
    getDirectoryPickerSupport,
    getServerSupport,
  );

  if (!isSupported) {
    return (
      <p className="text-lg text-red-700 mt-2">
        Warning: These tools will not work on your browser. It requires some
        APIs that currently only exist in Chrome based browsers.
      </p>
    );
  }

  return children ?? null;
}
