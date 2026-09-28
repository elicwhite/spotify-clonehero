/**
 * Loading what a frame needs before Remotion may capture it.
 *
 * Every kit API names a file by its path relative to the public folder
 * (`generated/timeline.json`); `publicUrl` turns such a path into the URL
 * the bundle serves it at, and is the only place the kit calls `staticFile`.
 *
 * `useLoaded(key, load, label)` runs `load` once per page for each `key` and
 * holds the frame (a `delayRender` named `label`) until the component has
 * rendered with the value. A failed load cancels the render with its error.
 *
 * `fetchFile` and `loadJson` fetch a public path. A missing file fails with
 * its path and, when given, the script that writes it.
 */
import {useEffect, useReducer, useRef} from 'react';
import {cancelRender, continueRender, delayRender, staticFile} from 'remotion';

/**
 * The URL of a file in the public folder, from its path relative to it
 * ('generated/timeline.json'; a leading slash is allowed).
 *
 * The one choke point between a public path and a URL: every kit API takes
 * the path and calls this (`fetchFile`, `loadJson`, the clock's audio, the
 * brand's and the highway's art, recordings), and no other module calls
 * `staticFile`, so how public files are served changes here alone. In a
 * render, a value that is already such a URL throws ("already prefixed with
 * the static base") instead of fetching a doubled URL.
 */
export const publicUrl = (path: string): string => staticFile(path);

const values = new Map<string, {value: unknown}>();
const loads = new Map<string, Promise<void>>();

/**
 * The value `load` resolves to, or null (with the frame held) until it has.
 * `key` names what `load` fetches: every component asking for the same key
 * shares one load and its result.
 */
export const useLoaded = <T>(
  key: string,
  load: () => Promise<T>,
  label: string,
): T | null => {
  const entry = values.get(key);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  // Taken during render, like Remotion's `useState(() => delayRender())`, on
  // the first render without the value (also after `key` changes).
  const hold = useRef<number | null>(null);
  if (!entry && hold.current === null) hold.current = delayRender(label);

  // Rendered without the value: start the load (or join it, even if it has
  // finished since that render) and render again once it is in.
  useEffect(() => {
    if (entry) return;
    let loading = loads.get(key);
    if (!loading) {
      loading = load().then(value => {
        values.set(key, {value});
      });
      loads.set(key, loading);
    }
    let mounted = true;
    loading.then(
      () => {
        if (mounted) rerender();
      },
      (error: unknown) => cancelRender(error),
    );
    return () => {
      mounted = false;
    };
    // `load` is identified by `key`: a new closure for the same key is the same load.
  }, [key, entry]);

  // Release the frame only after a render with the value has committed:
  // continuing right after the state update could capture the frame before
  // that render.
  useEffect(() => {
    if (entry && hold.current !== null) {
      continueRender(hold.current);
      hold.current = null;
    }
  });
  // A component that unmounts while loading must not hold the render.
  useEffect(
    () => () => {
      if (hold.current !== null) continueRender(hold.current);
    },
    [],
  );

  return entry ? (entry.value as T) : null;
};

export interface FetchFileOptions {
  /** What writes the file (a script and its flags), named when it is missing. */
  writtenBy?: string;
  init?: RequestInit;
}

/** Fetch a public path; a failed response throws with the path and who writes the file. */
export const fetchFile = async (
  path: string,
  {writtenBy, init}: FetchFileOptions = {},
): Promise<Response> => {
  const response = await fetch(publicUrl(path), init);
  if (!response.ok) {
    const hint = writtenBy ? ` ${writtenBy} writes it.` : '';
    throw new Error(
      `public/${path.replace(/^\/+/, '')} is missing (HTTP ${response.status}).${hint}`,
    );
  }
  return response;
};

/** Fetch and parse a JSON file at a public path. */
export const loadJson = async <T>(
  path: string,
  opts: Pick<FetchFileOptions, 'writtenBy'> = {},
): Promise<T> => (await fetchFile(path, opts)).json() as Promise<T>;
