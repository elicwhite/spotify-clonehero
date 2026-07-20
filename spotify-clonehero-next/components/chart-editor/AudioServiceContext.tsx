'use client';

import {
  createContext,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from 'react';
import type {AudioManager} from '@/lib/preview/audioManager';

// ---------------------------------------------------------------------------
// AudioService
//
// Owns the current page's AudioManager instance. Pages create/destroy the
// AudioManager themselves (see usePaddedAudio) and publish it here via
// `setAudioManager`. Two read paths are exposed:
//
// - `audioManagerRef` — a stable ref for synchronous, non-reactive reads
//   (event handlers, rAF loops, wheel/keyboard listeners) that mirror the
//   ref-based access ChartEditorContext used to provide directly.
// - `useAudioManager()` — a `useSyncExternalStore` subscription that
//   re-renders when the AudioManager instance changes (created/replaced/
//   destroyed), for effects that need to resubscribe rather than close over
//   a possibly-stale ref.
// ---------------------------------------------------------------------------

class AudioService {
  #current: AudioManager | null = null;
  #listeners = new Set<() => void>();
  readonly ref: RefObject<AudioManager | null>;

  constructor() {
    // A plain object satisfying RefObject so existing `.current` read/write
    // call sites keep working unchanged.
    this.ref = {current: null};
  }

  setAudioManager = (manager: AudioManager | null): void => {
    if (this.#current === manager) return;
    this.#current = manager;
    this.ref.current = manager;
    for (const listener of this.#listeners) listener();
  };

  getAudioManager = (): AudioManager | null => this.#current;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };
}

export interface AudioServiceContextValue {
  /** Stable ref mirroring the current AudioManager; for synchronous reads. */
  audioManagerRef: RefObject<AudioManager | null>;
  /** Publishes a new (or null) AudioManager to all subscribers. */
  setAudioManager: (manager: AudioManager | null) => void;
}

const AudioServiceContext = createContext<AudioService | null>(null);

export function AudioServiceProvider({children}: {children: ReactNode}) {
  const [service] = useState(() => new AudioService());

  return (
    <AudioServiceContext.Provider value={service}>
      {children}
    </AudioServiceContext.Provider>
  );
}

function useAudioService(): AudioService {
  const service = useContext(AudioServiceContext);
  if (!service) {
    throw new Error('useAudioService must be used within an AudioServiceProvider');
  }
  return service;
}

/**
 * Ref-based access to the current AudioManager plus a setter to publish a
 * new one. Drop-in replacement for the old `audioManagerRef` field on
 * ChartEditorContext.
 */
export function useAudioServiceContext(): AudioServiceContextValue {
  const service = useAudioService();
  return useMemo(
    () => ({
      audioManagerRef: service.ref,
      setAudioManager: service.setAudioManager,
    }),
    [service],
  );
}

/**
 * Subscription-based access to the current AudioManager. Re-renders (and
 * lets effects that list it as a dependency re-run) whenever the instance
 * changes, unlike reading `audioManagerRef.current` directly.
 */
export function useAudioManager(): AudioManager | null {
  const service = useAudioService();
  return useSyncExternalStore(
    service.subscribe,
    service.getAudioManager,
    service.getAudioManager,
  );
}
