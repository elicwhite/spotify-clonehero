'use client';

import {
  createContext,
  useCallback,
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

/**
 * Pads the host's audio for the `audioAnchor` position the chart is ABOUT to
 * have, off the main thread, and holds the result for the rebuild that edit
 * triggers. Published by `usePaddedAudio` (the only owner of the original
 * PCM) and called by the Chart Assist leading-silence run, so the padding
 * happens under a progress card instead of inside the silent rebuild that
 * follows the command.
 *
 * Resolving means the audio is ready, not that anything has changed yet:
 * nothing is installed until the chart's `audioAnchor` actually moves. A
 * held result that no longer matches what the rebuild needs is discarded and
 * the rebuild pads for itself.
 */
export type PadAudioAhead = (
  /** Chart ms that original audio sample 0 will sit at after the edit — the
   *  `audioAnchor.ms` the rebuild will read. Given in ms, not samples, so
   *  the quantization is done once, by the same `anchorPadSamples` the
   *  rebuild uses; a caller quantizing separately could round to a different
   *  sample and silently miss the result it just paid for. */
  anchorMs: number,
  options: {
    signal?: AbortSignal | undefined;
    onProgress?: ((fraction: number, detail: string) => void) | undefined;
  },
) => Promise<void>;

class AudioService {
  #current: AudioManager | null = null;
  #listeners = new Set<() => void>();
  #padAudioAhead: PadAudioAhead | null = null;
  #clickSuppressed = false;
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

  setPadAudioAhead = (padAudioAhead: PadAudioAhead | null): void => {
    this.#padAudioAhead = padAudioAhead;
  };

  /** The current pre-pad function, or null on a host with no audio to pad.
   *  Deliberately not a subscription: callers read it when a run starts. */
  getPadAudioAhead = (): PadAudioAhead | null => this.#padAudioAhead;

  setClickSuppressed = (suppressed: boolean): void => {
    if (this.#clickSuppressed === suppressed) return;
    this.#clickSuppressed = suppressed;
    for (const listener of this.#listeners) listener();
  };

  getClickSuppressed = (): boolean => this.#clickSuppressed;

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
  /** Publishes the host's {@link PadAudioAhead}, or null when it has none. */
  setPadAudioAhead: (padAudioAhead: PadAudioAhead | null) => void;
  /** Reads the host's current {@link PadAudioAhead}. */
  getPadAudioAhead: () => PadAudioAhead | null;
  /**
   * Silences the click while a tool needs the song alone. Tap tempo is the
   * one caller: the user taps along to the music, so a click playing the
   * grid they are trying to replace would be the thing they hear.
   *
   * Suppression is a separate axis from the mixer's own mute, so the row's
   * M toggle is not flipped underneath the user and their setting comes
   * back when the tool closes.
   */
  setClickSuppressed: (suppressed: boolean) => void;
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
    throw new Error(
      'useAudioService must be used within an AudioServiceProvider',
    );
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
      setPadAudioAhead: service.setPadAudioAhead,
      getPadAudioAhead: service.getPadAudioAhead,
      setClickSuppressed: service.setClickSuppressed,
    }),
    [service],
  );
}

/**
 * The host's {@link PadAudioAhead}, read at call time, or null when there
 * isn't one — either because no host has published one yet or because this
 * surface renders outside an `AudioServiceProvider` at all (capability-gate
 * tests, sidebars mounted without a page's audio). Mirrors
 * `useOptionalAssistRunnerContext`: a card that can live in both worlds asks
 * for the capability rather than requiring the provider.
 */
export function usePadAudioAheadReader(): () => PadAudioAhead | null {
  const service = useContext(AudioServiceContext);
  return useMemo(
    () => (service ? service.getPadAudioAhead : () => null),
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

/**
 * Whether a tool is currently holding the click silent. The mixer reads this
 * so there is one writer of the click's gain: suppression changes what the
 * mixer resolves rather than reaching past it to the AudioManager, which is
 * what keeps the row's own mute state intact underneath.
 *
 * Returns false outside an `AudioServiceProvider`, so a sidebar mounted
 * without a page's audio behaves as if nothing is suppressing.
 */
export function useClickSuppressed(): boolean {
  const service = useContext(AudioServiceContext);
  return useSyncExternalStore(
    useCallback(
      (onChange: () => void) => service?.subscribe(onChange) ?? (() => {}),
      [service],
    ),
    () => service?.getClickSuppressed() ?? false,
    () => false,
  );
}

/**
 * Setter for {@link useClickSuppressed}, or a no-op outside an
 * `AudioServiceProvider`. Optional for the same reason
 * `usePadAudioAheadReader` is: the piano roll mounts in capability-gate and
 * unit tests that have no page audio, and holding the click silent is a
 * courtesy rather than something those surfaces need to provide.
 */
export function useSetClickSuppressed(): (suppressed: boolean) => void {
  const service = useContext(AudioServiceContext);
  return useMemo(() => service?.setClickSuppressed ?? (() => {}), [service]);
}
