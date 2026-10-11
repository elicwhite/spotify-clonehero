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

/** What a control that needs the picker says where there is none. */
export const NO_FOLDER_PICKER_MESSAGE = 'Your browser cannot open folders.';
