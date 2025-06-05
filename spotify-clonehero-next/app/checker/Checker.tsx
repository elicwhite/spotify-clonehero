'use client';

import {useCallback, useState} from 'react';

export default function CheckerPage() {
  const [keyId, setKeyId] = useState<number>(0);
  const [directoryHandle, setDirectoryHandle] =
    useState<FileSystemDirectoryHandle | null>(null);

  const handler = useCallback(async () => {
    let handle;

    try {
      handle = await window.showDirectoryPicker({
        id: 'charts-to-scan',
      });
    } catch {
      console.log('User canceled picker');
      return;
    }

    setDirectoryHandle(handle);
    setKeyId(key => key + 1);
  }, []);

  return (
    <>
      <p className="mb-4 text-center">
        This tool will scan charts in a folder on your computer,
        <br /> providing an Excel file with all the issues found.
        <br />
      </p>
      <p className="text-2xl text-red-700 mt-2 text-center">
        A recent Chrome update has prevented the online version of this issue
        scanner from working properly.
        <br />
        You can use the issue scanner built in to the{' '}
        <a
          className="underline text-blue-600 hover:text-blue-800 visited:text-purple-600"
          href="https://github.com/Geomitron/Bridge/releases/latest"
          target="_blank">
          Bridge Desktop App
        </a>{' '}
        for this feature.
      </p>
    </>
  );
}
