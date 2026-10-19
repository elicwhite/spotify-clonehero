/**
 * EntityAffordance — purely declarative per-kind metadata that drives the
 * mouse-interaction dispatch.
 *
 * The registry only declares **what an entity affords**: hover, select,
 * delete, lane-axis drag. Behavior (which command runs on delete) lives on
 * the active tool, not here. That keeps the registry data, not a
 * controller.
 *
 * Composition with `EditorCapabilities`: capabilities filter which kinds
 * are exposed for the active surface (`/chart-editor` vs `/preview`).
 * Affordances
 * declare per-kind interactivity. Lookup is `editor exposes kind &&
 * affordance.<flag>`. Plan 0037 unifies these into `EditorProfile`.
 */

import type {EntityKind} from '@/lib/chart-edit';

export interface EntityAffordance {
  kind: EntityKind;
  /** Shows hover feedback (cursor change, sprite tint). */
  hoverable: boolean;
  /** Click adds to / replaces selection. */
  selectable: boolean;
  /** Erase tool can remove the entity. */
  deletable: boolean;
  /** Drag changes the lane in addition to the tick. Notes only today. */
  laneAxis: boolean;
}

export const AFFORDANCES: Record<EntityKind, EntityAffordance> = {
  note: {
    kind: 'note',
    hoverable: true,
    selectable: true,
    deletable: true,
    laneAxis: true,
  },
  section: {
    kind: 'section',
    hoverable: true,
    selectable: true,
    deletable: true,
    laneAxis: false,
  },
  lyric: {
    kind: 'lyric',
    hoverable: true,
    selectable: true,
    deletable: true,
    laneAxis: false,
  },
  'phrase-start': {
    kind: 'phrase-start',
    hoverable: true,
    selectable: true,
    deletable: true,
    laneAxis: false,
  },
  'phrase-end': {
    kind: 'phrase-end',
    hoverable: true,
    selectable: true,
    deletable: true,
    laneAxis: false,
  },
};
