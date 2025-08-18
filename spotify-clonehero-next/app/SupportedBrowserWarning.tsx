'use client';

import {useState, useEffect} from 'react';

export default function SupportedBrowserWarning({
  children,
}: {
  children?: React.ReactNode;
}) {
  const [isSupported, setIsSupported] = useState(true);

  useEffect(() => {
    const DIRECTORY_PICKER_SUPPROTED =
      typeof window !== 'undefined' &&
      typeof window.showDirectoryPicker === 'function';

    setIsSupported(DIRECTORY_PICKER_SUPPROTED);
  }, []);

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
