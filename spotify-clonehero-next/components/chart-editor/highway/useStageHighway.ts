'use client';

/**
 * Mount one highway on the shared `HighwayStage` and expose the pieces of it
 * the interaction stack needs.
 *
 * The stage owns the renderer, the canvas, and the scene; a lane owns exactly
 * one highway group inside it. Mounting is `addHighway`, unmounting is
 * `removeHighway` — neither touches the renderer or the sibling highways.
 *
 * Returned refs are `null` until the highway's scene core resolves, and
 * `version` bumps once it does, so every sync effect can list it and seed the
 * fresh highway with the current editor state.
 */

import {useEffect, useRef, useState, type RefObject} from 'react';
import type {
  HighwayStage,
  StageHighwayHandle,
  InteractionManager,
  SceneReconciler,
} from '@/lib/preview/highway';
import type {Track} from '@/lib/preview/highway/types';
import type {InstrumentSchema} from '@/lib/chart-edit';

export interface StageHighwayBinding {
  handleRef: RefObject<StageHighwayHandle | null>;
  reconcilerRef: RefObject<SceneReconciler | null>;
  interactionManagerRef: RefObject<InteractionManager | null>;
  /** Bumped whenever this highway's handle is created or torn down. */
  version: number;
}

export interface UseStageHighwayInputs {
  stage: HighwayStage | null;
  /** Stable id for this highway within the stage (the lane's scope key). */
  id: string;
  /** Resolved notes track, or null for scopes with none (vocals/global). */
  track: Track | null;
  showDrumLanes: boolean;
  /** Lane geometry to draw for a scope with no track of its own. Display
   *  only — it never makes the lane editable. */
  neutralLaneSchema?: InstrumentSchema | null;
}

export function useStageHighway({
  stage,
  id,
  track,
  neutralLaneSchema = null,
  showDrumLanes,
}: UseStageHighwayInputs): StageHighwayBinding {
  const handleRef = useRef<StageHighwayHandle | null>(null);
  const reconcilerRef = useRef<SceneReconciler | null>(null);
  const interactionManagerRef = useRef<InteractionManager | null>(null);
  const [version, setVersion] = useState(0);

  // The highway is rebuilt only when its instrument/difficulty or lane
  // capability changes; chart edits flow through the reconciler instead, so
  // the mount effect reads the track through a ref rather than a dependency.
  const trackRef = useRef(track);
  const showDrumLanesRef = useRef(showDrumLanes);
  const neutralLaneSchemaRef = useRef(neutralLaneSchema);
  useEffect(() => {
    trackRef.current = track;
    showDrumLanesRef.current = showDrumLanes;
    neutralLaneSchemaRef.current = neutralLaneSchema;
  });

  const instrument = track?.instrument;
  const difficulty = track?.difficulty;

  useEffect(() => {
    if (!stage) return;
    // Unmounting cancels this mount's in-flight work, so a promise still
    // resolving for a highway that has since gone away can never write its
    // disposed reconciler back into the refs.
    let cancelled = false;

    void stage
      .addHighway(id, {
        track: trackRef.current,
        showDrumLanes: showDrumLanesRef.current,
        neutralLaneSchema: neutralLaneSchemaRef.current,
      })
      .then(async handle => {
        if (!handle || cancelled) return;
        const [reconciler, interactionManager] = await Promise.all([
          handle.getReconciler(),
          handle.getInteractionManager(),
        ]);
        if (cancelled) return;
        handleRef.current = handle;
        reconcilerRef.current = reconciler;
        interactionManagerRef.current = interactionManager;
        setVersion(v => v + 1);
      })
      .catch(error => {
        // A highway unmounted mid-build resolves its handle and then refuses
        // to hand out a disposed scene core. Anything else is a real failure.
        if (cancelled) return;
        console.warn(`Highway "${id}" failed to mount:`, error);
      });

    return () => {
      cancelled = true;
      handleRef.current = null;
      reconcilerRef.current = null;
      interactionManagerRef.current = null;
      stage.removeHighway(id);
      setVersion(v => v + 1);
    };
  }, [stage, id, instrument, difficulty, showDrumLanes]);

  return {handleRef, reconcilerRef, interactionManagerRef, version};
}
