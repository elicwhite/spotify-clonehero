/**
 * Whether the user chose "Just download" over picking a Songs folder. It lives
 * beside the stored Songs folder because the two answer one question, where a
 * chart goes: picking a folder clears it.
 *
 * Kept in localStorage, since it is one viewer's preference in one browser.
 */
const KEY = 'songs-folder:prefers-download:v1';

const listeners = new Set<() => void>();

export function prefersBrowserDownload(): boolean {
  try {
    return window.localStorage.getItem(KEY) === 'download';
  } catch {
    return false;
  }
}

export function setPrefersBrowserDownload(prefers: boolean) {
  try {
    if (prefers) window.localStorage.setItem(KEY, 'download');
    else window.localStorage.removeItem(KEY);
  } catch {
    // Without storage the choice is not kept and the dialog asks again, which
    // is harmless.
  }
  listeners.forEach(listener => listener());
}

/** For `useSyncExternalStore`. */
export function subscribeToDownloadChoice(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
