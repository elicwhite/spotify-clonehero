import {useSyncExternalStore} from 'react';

/**
 * Whether this browser can open a folder the site may keep and write into.
 *
 * A feature test, never a browser test: Brave is Chromium and still has no
 * `showDirectoryPicker`, so "is it Chrome" answers wrong for it.
 */
export function supportsDirectoryPicker(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.showDirectoryPicker === 'function'
  );
}

/** Whether this browser has the File System Access file picker. */
export function supportsFilePicker(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.showOpenFilePicker === 'function'
  );
}

// The picker cannot appear or disappear while the page is open, so there is
// nothing to subscribe to. The server renders as if it is there, which keeps a
// Chromium page from flashing the fallback before hydration.
const noopSubscribe = () => () => {};
const getServerSupport = () => true;

/** `supportsDirectoryPicker` for render, without a hydration mismatch. */
export function useSupportsDirectoryPicker(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    supportsDirectoryPicker,
    getServerSupport,
  );
}

/**
 * A folder or file picker that closed without a choice: the user cancelled,
 * or the user or the browser refused it. Neither is a failure to report.
 */
export function isPickerCancel(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === 'AbortError' || error.name === 'NotAllowedError')
  );
}
