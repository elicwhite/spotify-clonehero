/**
 * One fake `HighwayStage` for every suite that renders `HighwayEditor` in
 * jsdom, where a real stage cannot exist: `setupStage` builds a
 * `WebGLRenderer` and jsdom has no WebGL context.
 *
 * The fake mirrors the real contract closely enough that everything above the
 * THREE.js boundary runs for real — `useStageHighway`'s mount/await handshake,
 * `useHighwayMouseInteraction`, the tool registry, and the command stack all
 * drive the same way they do in the browser. Only the scene objects are stubs.
 *
 * Suites parameterize it through `onHighwayMounted`, which sees each highway's
 * record as it mounts and can wire that highway's `hitTest` (or record it for
 * later assertions). The handle surface is `StageHighwayHandle` member for
 * member, so a change to that interface breaks here once instead of drifting
 * silently in each suite's private copy.
 */

import type {HitResult} from '@/lib/preview/highway';

export interface FakeHighwayTrack {
  instrument: string;
  difficulty: string;
}

export interface FakeReconciler {
  setElements: jest.Mock;
  setHoveredKey: jest.Mock;
  setSelectedKeys: jest.Mock;
  dispose: jest.Mock;
}

export interface FakeInteractionManager {
  hitTest: jest.Mock<HitResult, []>;
  screenToLane: jest.Mock;
  screenToMs: jest.Mock;
  screenToTick: jest.Mock;
  setTimingData: jest.Mock;
  dispose: jest.Mock;
}

/** Mirrors `StageHighwayHandle`. */
export interface FakeStageHighwayHandle {
  getCamera: jest.Mock;
  getWorldX: jest.Mock;
  setOverlayState: jest.Mock;
  getInteractionManager: jest.Mock;
  getReconciler: jest.Mock;
  setWaveformData: jest.Mock;
  setGridData: jest.Mock;
  setHighwayMode: jest.Mock;
}

export interface FakeHighway {
  id: string;
  track: FakeHighwayTrack | null;
  reconciler: FakeReconciler;
  interactionManager: FakeInteractionManager;
  handle: FakeStageHighwayHandle;
}

/** Mirrors `HighwayStage`, plus the hooks a suite needs to drive it. */
export interface FakeStage {
  addHighway: jest.Mock;
  removeHighway: jest.Mock;
  getHighway: jest.Mock;
  setLayout: jest.Mock;
  setLyricsData: jest.Mock;
  setTimingData: jest.Mock;
  startRender: jest.Mock;
  onContextLost: jest.Mock;
  destroy: jest.Mock;
  /** Every highway mounted on this stage, in mount order. */
  highways: FakeHighway[];
  /** Fires this stage's context-loss listeners, as a lost context would. */
  loseContext(): void;
}

export interface CreateFakeStageOptions {
  /** Runs as each highway mounts, before its handle is handed out. */
  onHighwayMounted?: (highway: FakeHighway) => void;
}

function makeFakeHighway(
  id: string,
  track: FakeHighwayTrack | null,
): FakeHighway {
  const reconciler: FakeReconciler = {
    setElements: jest.fn(),
    setHoveredKey: jest.fn(),
    setSelectedKeys: jest.fn(),
    dispose: jest.fn(),
  };
  const interactionManager: FakeInteractionManager = {
    hitTest: jest.fn(() => null as HitResult),
    screenToLane: jest.fn(() => 0),
    screenToMs: jest.fn(() => 0),
    screenToTick: jest.fn(() => 0),
    setTimingData: jest.fn(),
    dispose: jest.fn(),
  };
  const handle: FakeStageHighwayHandle = {
    getCamera: jest.fn(),
    getWorldX: jest.fn(() => 0),
    setOverlayState: jest.fn(),
    getInteractionManager: jest.fn(async () => interactionManager),
    getReconciler: jest.fn(async () => reconciler),
    setWaveformData: jest.fn(async () => {}),
    setGridData: jest.fn(async () => {}),
    setHighwayMode: jest.fn(),
  };
  return {id, track, reconciler, interactionManager, handle};
}

export function createFakeStage(
  options: CreateFakeStageOptions = {},
): FakeStage {
  const highways: FakeHighway[] = [];
  const mounted = new Map<string, FakeHighway>();
  const contextLostListeners = new Set<() => void>();

  return {
    highways,
    addHighway: jest.fn(
      async (id: string, opts: {track: FakeHighwayTrack | null}) => {
        const existing = mounted.get(id);
        if (existing) return existing.handle;
        const highway = makeFakeHighway(id, opts?.track ?? null);
        mounted.set(id, highway);
        highways.push(highway);
        options.onHighwayMounted?.(highway);
        return highway.handle;
      },
    ),
    // Mirrors the real stage: unmounting a highway disposes that highway's
    // own scene objects and leaves the renderer and its siblings alone.
    removeHighway: jest.fn((id: string) => {
      const highway = mounted.get(id);
      if (!highway) return;
      mounted.delete(id);
      highway.reconciler.dispose();
      highway.interactionManager.dispose();
    }),
    getHighway: jest.fn((id: string) => mounted.get(id)?.handle ?? null),
    setLayout: jest.fn(),
    setLyricsData: jest.fn(),
    setTimingData: jest.fn(),
    startRender: jest.fn(),
    onContextLost: jest.fn((listener: () => void) => {
      contextLostListeners.add(listener);
      return () => contextLostListeners.delete(listener);
    }),
    destroy: jest.fn(),
    loseContext: () => {
      for (const listener of Array.from(contextLostListeners)) listener();
    },
  };
}
