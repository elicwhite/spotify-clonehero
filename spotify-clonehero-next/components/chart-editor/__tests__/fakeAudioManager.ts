/**
 * One inert `AudioManager` stand-in for every suite that mounts editor
 * chrome in jsdom, where a real one cannot exist: `AudioManager` builds an
 * `AudioContext` and decodes buffers.
 *
 * The baseline answers every call the editor's always-mounted chrome makes
 * while rendering — the transport's frame poll, the sidebar's stems mixer and
 * speed stepper, and the loop-region push — so a suite that only cares about
 * one of those doesn't have to know about the rest. When the editor starts
 * calling a new method, it is added here once instead of in each suite's
 * private copy.
 *
 * Pass `overrides` for the handful of values a suite actually asserts on
 * (a spied `setVolume`, a specific playhead position, a track list).
 */

import type {AudioManager} from '@/lib/preview/audioManager';

export function fakeAudioManager(
  overrides: Partial<Record<keyof AudioManager, unknown>> = {},
): AudioManager {
  return {
    // Transport poll.
    isInitialized: true,
    isPlaying: false,
    currentTime: 0,
    chartTime: 0,
    play: async () => {},
    pause: async () => {},
    resume: async () => {},
    playChartTime: async () => {},
    seekToChartTime: async () => {},
    // Speed stepper.
    setTempo: () => {},
    // Stems mixer.
    trackNames: [] as string[],
    setVolume: () => {},
    getVolume: () => 1,
    // Loop region.
    setPracticeMode: () => {},
    setLoopRegion: () => {},
    updateLoop: () => false,
    ...overrides,
  } as unknown as AudioManager;
}
