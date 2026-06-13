'use client';

import {useCallback, useSyncExternalStore} from 'react';

/**
 * State persisted to localStorage, used for drum-fills filter UI so choices
 * survive reloads. Backed by `useSyncExternalStore` (not setState-in-effect):
 * SSR-safe (server/hydration use the initial value, client re-syncs after) and
 * it stays in sync across tabs via the `storage` event.
 */

type Listener = () => void;

const listeners = new Map<string, Set<Listener>>();
// Cache the parsed value keyed by its raw string so getSnapshot returns a
// stable reference (required by useSyncExternalStore to avoid render loops).
const cache = new Map<string, {raw: string | null; value: unknown}>();

function read<T>(key: string, initial: T): T {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(key);
  } catch {
    // storage unavailable — use the default
  }
  const entry = cache.get(key);
  if (entry && entry.raw === raw) return entry.value as T;

  let value: T = initial;
  if (raw != null) {
    try {
      value = JSON.parse(raw) as T;
    } catch {
      value = initial;
    }
  }
  cache.set(key, {raw, value});
  return value;
}

function write<T>(key: string, value: T) {
  let raw: string | null = null;
  try {
    raw = JSON.stringify(value);
    window.localStorage.setItem(key, raw);
  } catch {
    // quota/availability — keep the in-memory cache authoritative
  }
  cache.set(key, {raw, value});
  listeners.get(key)?.forEach(fn => fn());
}

function subscribe(key: string, cb: Listener): () => void {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === key) {
      cache.delete(key);
      cb();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    set!.delete(cb);
    window.removeEventListener('storage', onStorage);
  };
}

export function useLocalStorageState<T>(
  key: string,
  initial: T,
): [T, (next: T | ((prev: T) => T)) => void] {
  const value = useSyncExternalStore(
    useCallback(cb => subscribe(key, cb), [key]),
    useCallback(() => read(key, initial), [key, initial]),
    useCallback(() => initial, [initial]),
  );

  const setValue = useCallback(
    (next: T | ((prev: T) => T)) => {
      const resolved =
        typeof next === 'function'
          ? (next as (prev: T) => T)(read(key, initial))
          : next;
      write(key, resolved);
    },
    [key, initial],
  );

  return [value, setValue];
}
