/**
 * Single bridge between the editor's per-kind opaque selection ids and the
 * reconciler's namespaced element keys.
 *
 * Selection state is `Map<EntityKind, Set<string>>` keyed by per-kind
 * opaque ids whose format is owned by the entity handlers in
 * `lib/chart-edit`. The reconciler indexes elements by namespaced strings
 * (e.g. `note:2880:yellowDrum`, `lyric:harm1:480`).
 *
 * Round-trip rule: the reconciler key is `${kind}:${id}`.
 *
 *   | kind          | selection id (today)           | reconciler key                  |
 *   |---------------|--------------------------------|---------------------------------|
 *   | note          | `2880:yellowDrum`              | `note:2880:yellowDrum`          |
 *   | section       | `2880`                         | `section:2880`                  |
 *   | lyric         | `harm1:480` (partName:tick)    | `lyric:harm1:480`               |
 *   | phrase-start  | `harm1:480` (partName:tick)    | `phrase-start:harm1:480`        |
 *   | phrase-end    | `harm2:1920` (partName:endTick)| `phrase-end:harm2:1920`         |
 *
 * `partName` is accepted for symmetry with chart-wide kinds; it is **ignored**
 * (the vocal id already encodes the part). Callers can pass it
 * unconditionally — the helper is safe on chart-wide kinds.
 */

import type {EntityKind, SelectableKind} from '@/lib/chart-edit';

/**
 * The kinds the reconciler actually indexes — exactly the rows of the table
 * above. `ChartEditorState.selection` is keyed by the wider
 * `SelectableKind` (the piano roll's marquee can select tempo markers and
 * time-signature chips, which exist only in the piano roll's tempo lane and
 * have no highway element), so the selection push filters through this
 * guard before building keys.
 */
export function isReconciledKind(kind: SelectableKind): kind is EntityKind {
  return kind !== 'tempo' && kind !== 'timesig';
}

export function reconcilerKeyFor(
  kind: EntityKind,
  id: string,
  _partName?: string,
): string {
  return `${kind}:${id}`;
}
